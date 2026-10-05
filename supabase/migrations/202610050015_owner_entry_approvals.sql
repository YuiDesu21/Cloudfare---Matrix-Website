-- Existing approval RPCs still rejected the owner before the self-review trigger ran.
create or replace function public.admin_approve_commerce_order_fee(
  p_order_id uuid,
  p_shipping_fee numeric,
  p_admin_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders%rowtype;
  normalized_fee numeric := round(coalesce(p_shipping_fee, 0), 2);
  voucher_balance numeric;
  next_status text;
  next_amount_due numeric;
  discounted_subtotal numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if normalized_fee < 0 or normalized_fee > 100000 then raise exception 'Shipping fee must be between PHP 0 and PHP 100,000.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_admin_notes, ''))) > 320 then raise exception 'Admin notes must be 320 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.status <> 'pending_shipping_fee' then raise exception 'Only orders waiting for shipping fee can be approved.' using errcode = '22023'; end if;
  if order_row.member_id = auth.uid() and not public.is_owner() then
    raise exception 'Administrators cannot approve their own orders.' using errcode = '42501';
  end if;

  if order_row.package_type = 'product_plus_voucher' and order_row.order_purpose = 'standard' then
    perform pg_advisory_xact_lock(hashtext(order_row.member_id::text));
    select coalesce(sum(amount), 0) into voucher_balance
    from public.voucher_ledger
    where member_id = order_row.member_id;

    if voucher_balance < order_row.package_total then
      raise exception 'Member voucher balance is no longer enough for this order.' using errcode = '22023';
    end if;

    insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
    values (order_row.member_id, order_row.id, 'redemption', -order_row.package_total, order_row.order_code, 'Product Plus voucher package approved', auth.uid());

    next_amount_due := normalized_fee;
  else
    discounted_subtotal := greatest(order_row.package_total - coalesce(order_row.discount_amount, 0), 0);
    next_amount_due := round(discounted_subtotal + normalized_fee, 2);
  end if;

  next_status := case when next_amount_due = 0 then 'payment_approved' else 'approved_for_payment' end;

  update public.commerce_orders
  set shipping_fee = normalized_fee,
      amount_due = next_amount_due,
      status = next_status,
      admin_notes = trim(coalesce(p_admin_notes, '')),
      approved_at = now(),
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-fee-approved', 'Admin approved an order shipping fee.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'shippingFee', normalized_fee, 'amountDue', next_amount_due, 'discountAmount', order_row.discount_amount));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.admin_approve_commerce_order_payment(
  p_order_id uuid,
  p_admin_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders;
  payment public.commerce_order_payments;
  normalized_note text := trim(coalesce(p_admin_notes, ''));
  review_time timestamptz := now();
  benefit jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_note) > 320 then raise exception 'Admin note must be 320 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.member_id = auth.uid() and not public.is_owner() then
    raise exception 'You cannot approve your own order payment.' using errcode = '42501';
  end if;
  if order_row.status <> 'payment_submitted' then raise exception 'This order has no submitted payment to approve.' using errcode = '22023'; end if;

  select * into payment
  from public.commerce_order_payments
  where order_id = order_row.id
    and status = 'submitted'
  order by created_at desc
  limit 1
  for update;

  if payment.id is null then raise exception 'Submitted payment reference not found.' using errcode = 'P0002'; end if;

  benefit := public.apply_commerce_order_benefit(order_row, review_time);

  update public.commerce_order_payments
  set status = 'approved',
      reviewed_at = review_time,
      reviewed_by = auth.uid()
  where id = payment.id;

  update public.commerce_orders
  set status = 'payment_approved',
      admin_notes = case when normalized_note = '' then admin_notes else normalized_note end,
      updated_at = review_time
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-payment-approved', 'Admin approved an order payment reference.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'paymentId', payment.id, 'benefit', benefit));

  return public.commerce_order_json(order_row) || jsonb_build_object('benefit', benefit);
end;
$$;

create or replace function public.admin_approve_patronizing_token_request(
  p_request_id uuid,
  p_decision_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.patronizing_token_requests%rowtype;
  approval_time timestamptz := now();
  activation jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_decision_note, ''))) > 240 then raise exception 'Decision note must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into target from public.patronizing_token_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Patronizing token request is no longer pending.' using errcode = '22023'; end if;
  if target.member_id = auth.uid() and not public.is_owner() then
    raise exception 'You cannot approve your own Patronizing entry.' using errcode = '42501';
  end if;

  activation := public.activate_patronizing_entry(target.member_id, 'f3_token', target.id, null, approval_time);

  update public.patronizing_token_requests
  set status = 'approved',
      approved_at = approval_time,
      reviewed_by = auth.uid(),
      decision_note = trim(coalesce(p_decision_note, ''))
  where id = target.id;

  return jsonb_build_object('status', 'approved', 'requestId', target.id, 'activation', activation);
end;
$$;
