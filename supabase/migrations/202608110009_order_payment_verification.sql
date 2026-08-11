-- Admin review for submitted commerce order payment references.

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
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_note) > 320 then raise exception 'Admin note must be 320 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.member_id = auth.uid() then raise exception 'You cannot approve your own order payment.' using errcode = '42501'; end if;
  if order_row.status <> 'payment_submitted' then raise exception 'This order has no submitted payment to approve.' using errcode = '22023'; end if;

  select * into payment
  from public.commerce_order_payments
  where order_id = order_row.id
    and status = 'submitted'
  order by created_at desc
  limit 1
  for update;

  if payment.id is null then raise exception 'Submitted payment reference not found.' using errcode = 'P0002'; end if;

  update public.commerce_order_payments
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = payment.id;

  update public.commerce_orders
  set status = 'payment_approved',
      admin_notes = case when normalized_note = '' then admin_notes else normalized_note end,
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-payment-approved', 'Admin approved an order payment reference.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'paymentId', payment.id));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.admin_reject_commerce_order_payment(
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
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_note) < 3 or char_length(normalized_note) > 320 then raise exception 'Rejection note must be 3-320 characters.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.member_id = auth.uid() then raise exception 'You cannot reject your own order payment.' using errcode = '42501'; end if;
  if order_row.status <> 'payment_submitted' then raise exception 'This order has no submitted payment to reject.' using errcode = '22023'; end if;

  select * into payment
  from public.commerce_order_payments
  where order_id = order_row.id
    and status = 'submitted'
  order by created_at desc
  limit 1
  for update;

  if payment.id is null then raise exception 'Submitted payment reference not found.' using errcode = 'P0002'; end if;

  update public.commerce_order_payments
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = payment.id;

  update public.commerce_orders
  set status = 'approved_for_payment',
      admin_notes = normalized_note,
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-payment-rejected', 'Admin rejected an order payment reference.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'paymentId', payment.id));

  return public.commerce_order_json(order_row);
end;
$$;

revoke all on function
  public.admin_approve_commerce_order_payment(uuid,text),
  public.admin_reject_commerce_order_payment(uuid,text)
from public, anon;

grant execute on function
  public.admin_approve_commerce_order_payment(uuid,text),
  public.admin_reject_commerce_order_payment(uuid,text)
to authenticated;
