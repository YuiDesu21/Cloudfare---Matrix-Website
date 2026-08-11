-- Shipping workflow for approved commerce orders.

alter table public.commerce_orders
  add column if not exists courier_name text not null default 'J&T' check (char_length(trim(courier_name)) between 2 and 40),
  add column if not exists tracking_number text not null default '' check (tracking_number = '' or tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{1,79}$'),
  add column if not exists shipping_notes text not null default '' check (char_length(shipping_notes) <= 240);

create or replace function public.commerce_order_json(p_order public.commerce_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'orderCode', p_order.order_code,
    'memberId', p_order.member_id,
    'packageId', p_order.package_id,
    'packageType', p_order.package_type,
    'packageTypeLabel', public.commerce_package_type_label(p_order.package_type),
    'packageSnapshot', p_order.package_snapshot,
    'shippingAddressId', p_order.shipping_address_id,
    'shippingAddressSnapshot', p_order.shipping_address_snapshot,
    'packageTotal', p_order.package_total,
    'shippingFee', p_order.shipping_fee,
    'voucherAmount', p_order.voucher_amount,
    'amountDue', p_order.amount_due,
    'status', p_order.status,
    'memberNotes', p_order.member_notes,
    'adminNotes', p_order.admin_notes,
    'courierName', p_order.courier_name,
    'trackingNumber', p_order.tracking_number,
    'shippingNotes', p_order.shipping_notes,
    'latestPayment', (
      select public.commerce_order_payment_json(payment)
      from public.commerce_order_payments payment
      where payment.order_id = p_order.id
      order by payment.created_at desc
      limit 1
    ),
    'createdAt', p_order.created_at,
    'updatedAt', p_order.updated_at,
    'approvedAt', p_order.approved_at,
    'rejectedAt', p_order.rejected_at,
    'shippedAt', p_order.shipped_at,
    'receivedAt', p_order.received_at
  );
$$;

create or replace function public.admin_mark_commerce_order_shipped(
  p_order_id uuid,
  p_courier_name text default 'J&T',
  p_tracking_number text default '',
  p_shipping_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders;
  normalized_courier text := trim(coalesce(p_courier_name, 'J&T'));
  normalized_tracking text := trim(coalesce(p_tracking_number, ''));
  normalized_notes text := trim(coalesce(p_shipping_notes, ''));
  ship_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_courier) not between 2 and 40 then raise exception 'Courier name must be 2-40 characters.' using errcode = '22023'; end if;
  if normalized_tracking <> '' and normalized_tracking !~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{1,79}$' then raise exception 'Tracking number must be 2-80 letters, numbers, spaces, or . / # -.' using errcode = '22023'; end if;
  if char_length(normalized_notes) > 240 then raise exception 'Shipping notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.member_id = auth.uid() then raise exception 'You cannot ship your own order.' using errcode = '42501'; end if;
  if order_row.status <> 'payment_approved' then raise exception 'Only payment-approved orders can be marked shipped.' using errcode = '22023'; end if;

  update public.commerce_orders
  set status = 'shipped',
      courier_name = normalized_courier,
      tracking_number = normalized_tracking,
      shipping_notes = normalized_notes,
      shipped_at = ship_time,
      updated_at = ship_time
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-shipped', 'Admin marked an order as shipped.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'courierName', normalized_courier, 'trackingNumber', normalized_tracking));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.confirm_commerce_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders;
  received_time timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
    and member_id = auth.uid()
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.status <> 'shipped' then raise exception 'Only shipped orders can be marked received.' using errcode = '22023'; end if;

  update public.commerce_orders
  set status = 'received',
      received_at = received_time,
      updated_at = received_time
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-received', 'Member confirmed an order was received.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.get_my_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with notices as (
    select 'passive-income'::text as type, 'Passive income available'::text as title,
      'PHP ' || to_char(coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)), 0), 'FM999,999,999,990.00') || ' is available for withdrawal.' as message,
      max(ledger.due_at) as created_at, 'high'::text as priority
    from public.reward_ledger ledger
    where ledger.member_id = auth.uid() and ledger.status = 'due' and ledger.due_at <= now()
    having coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)), 0) > 0

    union all
    select 'exit-eligibility', 'Exit ' || rule.exit_number || ' eligible',
      'You have 3 qualified direct downlines for Exit ' || rule.exit_number || '. You can submit the required action.',
      now(), 'high'
    from public.matrix_exit_rules rule
    where (select count(*) from public.matrix_positions child
      where child.parent_member_id = auth.uid()
        and child.plan_id = 'power3-passive'
        and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit
    ) >= 3
    and not exists (select 1 from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status in ('pending', 'approved'))

    union all
    select 'admin-invitation', 'Admin invitation ready',
      'You have an active administrator invitation. Open the invite link from the owner to accept it.',
      invitation.created_at, 'high'
    from public.admin_invitations invitation
    where invitation.recipient_id = auth.uid()
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()

    union all
    select 'withdrawal-' || request.status::text, 'Withdrawal ' || request.status::text,
      'Withdrawal ' || request.withdrawal_code || ' for PHP ' || to_char(request.amount, 'FM999,999,999,990.00') || ' was ' || request.status::text || '.',
      coalesce(request.approved_at, request.rejected_at, request.created_at), case when request.status = 'pending' then 'normal' else 'high' end
    from public.withdrawal_requests request
    where request.member_id = auth.uid()
      and request.status in ('pending', 'approved', 'rejected')
      and coalesce(request.approved_at, request.rejected_at, request.created_at) >= now() - interval '45 days'

    union all
    select 'deposit-' || request.status::text, 'Entry deposit ' || request.status::text,
      'Your PHP ' || to_char(request.amount, 'FM999,999,999,990.00') || ' Entry deposit is ' || request.status::text || '.',
      coalesce(request.approved_at, request.rejected_at, request.created_at), case when request.status = 'pending' then 'normal' else 'high' end
    from public.upgrade_requests request
    where request.member_id = auth.uid()
      and request.status in ('pending', 'approved', 'rejected')
      and coalesce(request.approved_at, request.rejected_at, request.created_at) >= now() - interval '45 days'

    union all
    select 'products-plus-' || claim.status::text, 'Products Plus ' || claim.status::text,
      'Exit ' || claim.exit_number || ' Products Plus claim for PHP ' || to_char(claim.spend_amount, 'FM999,999,999,990.00') || ' is ' || claim.status::text || '.',
      coalesce(claim.approved_at, claim.rejected_at, claim.created_at), case when claim.status = 'pending' then 'normal' else 'high' end
    from public.product_plus_claims claim
    where claim.member_id = auth.uid()
      and claim.status in ('pending', 'approved', 'rejected')
      and coalesce(claim.approved_at, claim.rejected_at, claim.created_at) >= now() - interval '45 days'

    union all
    select 'commerce-order-' || order_row.status, 'Order ' ||
      case order_row.status when 'approved_for_payment' then 'approved' when 'payment_submitted' then 'payment submitted' when 'payment_approved' then 'payment approved' when 'shipped' then 'shipped' when 'received' then 'received' when 'rejected' then 'rejected' else 'updated' end,
      case order_row.status
        when 'approved_for_payment' then 'Order ' || order_row.order_code || ' is approved. Pay PHP ' || to_char(order_row.amount_due, 'FM999,999,999,990.00') || ' now.'
        when 'payment_submitted' then 'Order ' || order_row.order_code || ' payment reference is waiting for admin verification.'
        when 'payment_approved' then 'Order ' || order_row.order_code || ' payment is approved and ready for shipping.'
        when 'shipped' then 'Order ' || order_row.order_code || ' has been shipped' || case when order_row.tracking_number <> '' then ' via ' || order_row.courier_name || ' (' || order_row.tracking_number || ')' else ' via ' || order_row.courier_name end || '.'
        when 'received' then 'Order ' || order_row.order_code || ' is marked received.'
        when 'rejected' then 'Order ' || order_row.order_code || ' was rejected.'
        else 'Order ' || order_row.order_code || ' was updated.'
      end,
      order_row.updated_at,
      case when order_row.status in ('approved_for_payment','payment_approved','shipped') then 'high' else 'normal' end
    from public.commerce_orders order_row
    where order_row.member_id = auth.uid()
      and order_row.status in ('approved_for_payment','payment_submitted','payment_approved','shipped','received','rejected')
      and order_row.updated_at >= now() - interval '45 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', type, 'title', title, 'message', message, 'createdAt', created_at, 'priority', priority
  ) order by case priority when 'high' then 1 else 2 end, created_at desc), '[]'::jsonb)
  from notices;
$$;

revoke all on function
  public.commerce_order_json(public.commerce_orders),
  public.admin_mark_commerce_order_shipped(uuid,text,text,text),
  public.confirm_commerce_order_received(uuid),
  public.get_my_notifications()
from public, anon;

grant execute on function
  public.admin_mark_commerce_order_shipped(uuid,text,text,text),
  public.confirm_commerce_order_received(uuid),
  public.get_my_notifications()
to authenticated;
