-- Guard member package orders against duplicate active requests and over-reserved vouchers.

create or replace function public.request_commerce_order(
  p_package_id uuid,
  p_shipping_address_id uuid,
  p_member_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package public.commerce_packages;
  address public.shipping_addresses;
  order_row public.commerce_orders;
  package_snapshot jsonb;
  address_snapshot jsonb;
  package_total numeric;
  current_voucher_balance numeric;
  reserved_voucher_balance numeric;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));

  select * into package
  from public.commerce_packages
  where id = p_package_id
    and is_active = true;
  if package.id is null then raise exception 'Package is not available.' using errcode = 'P0002'; end if;

  select * into address
  from public.shipping_addresses
  where id = p_shipping_address_id
    and member_id = auth.uid();
  if address.id is null then raise exception 'Choose one of your saved shipping addresses.' using errcode = 'P0002'; end if;

  package_snapshot := public.commerce_package_json(package);
  package_total := coalesce((package_snapshot ->> 'totalPrice')::numeric, 0);
  if jsonb_array_length(coalesce(package_snapshot -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Package has no items yet.' using errcode = '22023';
  end if;
  if package_total <= 0 then raise exception 'Package total must be greater than zero.' using errcode = '22023'; end if;

  if exists (
    select 1
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.package_id = package.id
      and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then
    raise exception 'You already have an active order for this package.' using errcode = '23505';
  end if;

  if package.package_type = 'matrix_1200_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
    ) then
      raise exception 'Your PHP 1,200 Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.upgrade_requests
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
        and status = 'pending'
    ) then
      raise exception 'You already have a pending PHP 1,200 Matrix entry request.' using errcode = '23505';
    end if;
  end if;

  if package.package_type = 'timeline_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Your Timeline Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.timeline_requests
      where member_id = auth.uid()
        and status = 'pending'
    ) then
      raise exception 'You already have a pending Timeline Matrix entry request.' using errcode = '23505';
    end if;
  end if;

  if package.package_type in ('matrix_1200_entry','timeline_entry') and exists (
    select 1
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.package_type = package.package_type
      and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then
    raise exception 'You already have an active request for this entry type.' using errcode = '23505';
  end if;

  if package.package_type = 'product_plus_voucher' then
    select coalesce(sum(amount), 0) into current_voucher_balance
    from public.voucher_ledger
    where member_id = auth.uid();

    select coalesce(sum(voucher_amount), 0) into reserved_voucher_balance
    from public.commerce_orders
    where member_id = auth.uid()
      and package_type = 'product_plus_voucher'
      and status = 'pending_shipping_fee';

    if current_voucher_balance - reserved_voucher_balance < package_total then
      raise exception 'Voucher balance is not enough for this package.' using errcode = '22023';
    end if;
  end if;

  address_snapshot := public.shipping_address_json(address);

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), package.id, package.package_type, package_snapshot,
    address.id, address_snapshot, package_total,
    case when package.package_type = 'product_plus_voucher' then package_total else 0 end,
    case when package.package_type = 'product_plus_voucher' then 0 else package_total end,
    trim(coalesce(p_member_notes, ''))
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-requested', 'Member requested a package order.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'packageType', order_row.package_type));

  return public.commerce_order_json(order_row);
end;
$$;

revoke all on function public.request_commerce_order(uuid,uuid,text) from public, anon;
grant execute on function public.request_commerce_order(uuid,uuid,text) to authenticated;
