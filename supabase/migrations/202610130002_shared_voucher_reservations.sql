-- All voucher checkout routes reserve from the same member balance.
create function public.enforce_commerce_voucher_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  balance numeric;
  reserved numeric;
begin
  if new.status <> 'pending_shipping_fee' or new.voucher_amount <= 0
     or (new.package_type <> 'product_plus_voucher' and new.order_purpose <> 'shop') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.member_id::text));
  select coalesce(sum(amount), 0) into balance
  from public.voucher_ledger where member_id = new.member_id;
  select coalesce(sum(voucher_amount), 0) into reserved
  from public.commerce_orders
  where member_id = new.member_id and id <> new.id and status = 'pending_shipping_fee'
    and (package_type = 'product_plus_voucher' or order_purpose = 'shop');
  if new.voucher_amount > balance - reserved then
    raise exception 'Voucher balance is not enough for this order.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger commerce_voucher_reservation_guard
before insert or update of voucher_amount, status on public.commerce_orders
for each row execute function public.enforce_commerce_voucher_reservation();
revoke all on function public.enforce_commerce_voucher_reservation() from public, anon, authenticated;

create or replace function public.admin_approve_commerce_order_fee(
  p_order_id uuid, p_shipping_fee numeric, p_admin_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  order_row public.commerce_orders;
  fee numeric := round(coalesce(p_shipping_fee, 0), 2);
  balance numeric;
  other_reservations numeric;
  next_due numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into order_row from public.commerce_orders where id = p_order_id for update;
  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.member_id = auth.uid() and not public.is_owner() then
    raise exception 'Administrators cannot approve their own orders.' using errcode = '42501';
  end if;
  if order_row.status <> 'pending_shipping_fee' then raise exception 'Only orders waiting for shipping fee can be approved.' using errcode = '22023'; end if;

  if order_row.voucher_amount > 0 then
    perform pg_advisory_xact_lock(hashtext(order_row.member_id::text));
    select coalesce(sum(amount), 0) into balance from public.voucher_ledger
    where member_id = order_row.member_id;
    select coalesce(sum(voucher_amount), 0) into other_reservations
    from public.commerce_orders
    where member_id = order_row.member_id and id <> order_row.id
      and status = 'pending_shipping_fee'
      and (package_type = 'product_plus_voucher' or order_purpose = 'shop');
    if order_row.voucher_amount > balance - other_reservations then
      raise exception 'Member voucher balance is no longer enough for this order.' using errcode = '22023';
    end if;
  end if;

  if order_row.order_purpose <> 'shop' then
    return public.admin_approve_commerce_order_fee_before_shop(p_order_id, p_shipping_fee, p_admin_notes);
  end if;
  if fee < 0 or fee > 100000 then raise exception 'Shipping fee is out of range.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_admin_notes, ''))) > 320 then raise exception 'Admin notes are too long.' using errcode = '22023'; end if;
  if order_row.voucher_amount > 0 then
    insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
    values (order_row.member_id, order_row.id, 'redemption', -order_row.voucher_amount,
      order_row.order_code, 'Shop order voucher redemption', auth.uid());
  end if;
  next_due := round(order_row.package_total - order_row.voucher_amount + fee, 2);
  update public.commerce_orders
  set shipping_fee = fee, amount_due = next_due,
      status = case when next_due = 0 then 'payment_approved' else 'approved_for_payment' end,
      admin_notes = trim(coalesce(p_admin_notes, '')), approved_at = now(), updated_at = now()
  where id = order_row.id returning * into order_row;
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'shop-order-fee-approved', 'Admin approved shop order shipping.',
    jsonb_build_object('orderId', order_row.id, 'shippingFee', fee, 'voucherAmount', order_row.voucher_amount));
  return public.commerce_order_json(order_row);
end;
$$;
