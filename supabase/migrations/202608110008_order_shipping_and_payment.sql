-- Commerce order shipping-fee approval and member payment submission.

alter table public.voucher_ledger
  add column if not exists commerce_order_id uuid references public.commerce_orders(id) on delete restrict;

create unique index if not exists one_voucher_redemption_per_commerce_order
  on public.voucher_ledger(commerce_order_id)
  where commerce_order_id is not null and entry_type = 'redemption';

create table if not exists public.commerce_order_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  payment_method_snapshot jsonb not null,
  amount numeric(12,2) not null check (amount > 0),
  reference_number text not null check (reference_number ~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$'),
  notes text not null default '' check (char_length(notes) <= 240),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists one_submitted_commerce_payment_per_order
  on public.commerce_order_payments(order_id)
  where status = 'submitted';

create index if not exists commerce_order_payments_order_created_idx on public.commerce_order_payments(order_id, created_at desc);

alter table public.commerce_order_payments enable row level security;

drop policy if exists commerce_order_payments_read_self_or_admin on public.commerce_order_payments;
create policy commerce_order_payments_read_self_or_admin
  on public.commerce_order_payments for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

create or replace function public.commerce_order_payment_json(p_payment public.commerce_order_payments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_payment.id,
    'orderId', p_payment.order_id,
    'memberId', p_payment.member_id,
    'paymentMethodId', p_payment.payment_method_id,
    'paymentMethodSnapshot', p_payment.payment_method_snapshot,
    'amount', p_payment.amount,
    'referenceNumber', p_payment.reference_number,
    'notes', p_payment.notes,
    'status', p_payment.status,
    'createdAt', p_payment.created_at,
    'reviewedAt', p_payment.reviewed_at
  );
$$;

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
  order_row public.commerce_orders;
  normalized_fee numeric := round(coalesce(p_shipping_fee, 0), 2);
  voucher_balance numeric;
  next_status text;
  next_amount_due numeric;
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
  if order_row.member_id = auth.uid() then raise exception 'Administrators cannot approve their own orders.' using errcode = '42501'; end if;

  if order_row.package_type = 'product_plus_voucher' then
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
    next_amount_due := order_row.package_total + normalized_fee;
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
  values (auth.uid(), 'commerce-order-fee-approved', 'Admin approved an order shipping fee.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'shippingFee', normalized_fee, 'amountDue', next_amount_due));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.admin_reject_commerce_order(
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
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_admin_notes, ''))) > 320 then raise exception 'Admin notes must be 320 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.status <> 'pending_shipping_fee' then raise exception 'Only orders waiting for shipping fee can be rejected.' using errcode = '22023'; end if;
  if order_row.member_id = auth.uid() then raise exception 'Administrators cannot reject their own orders.' using errcode = '42501'; end if;

  update public.commerce_orders
  set status = 'rejected',
      admin_notes = trim(coalesce(p_admin_notes, '')),
      rejected_at = now(),
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-rejected', 'Admin rejected an order request.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.submit_commerce_order_payment(
  p_order_id uuid,
  p_payment_method_id uuid,
  p_reference_number text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders;
  method public.payment_methods;
  payment public.commerce_order_payments;
  normalized_reference text := trim(coalesce(p_reference_number, ''));
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if normalized_reference !~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$' then raise exception 'Reference must be 3-60 letters, numbers, spaces, or . / # -.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_notes, ''))) > 240 then raise exception 'Payment notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
    and member_id = auth.uid()
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.status <> 'approved_for_payment' then raise exception 'This order is not ready for payment.' using errcode = '22023'; end if;
  if order_row.amount_due <= 0 then raise exception 'This order has no payment due.' using errcode = '22023'; end if;

  select * into method
  from public.payment_methods
  where id = p_payment_method_id
    and is_active = true;
  if method.id is null then raise exception 'Choose an active payment method.' using errcode = 'P0002'; end if;

  if exists (select 1 from public.commerce_order_payments where order_id = order_row.id and status = 'submitted') then
    raise exception 'A payment reference was already submitted for this order.' using errcode = '23505';
  end if;

  insert into public.commerce_order_payments(
    order_id, member_id, payment_method_id, payment_method_snapshot,
    amount, reference_number, notes
  )
  values (
    order_row.id, order_row.member_id, method.id, public.payment_method_json(method),
    order_row.amount_due, normalized_reference, trim(coalesce(p_notes, ''))
  )
  returning * into payment;

  update public.commerce_orders
  set status = 'payment_submitted',
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-payment-submitted', 'Member submitted an order payment reference.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'paymentId', payment.id));

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
        when 'shipped' then 'Order ' || order_row.order_code || ' has been shipped.'
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
  public.commerce_order_payment_json(public.commerce_order_payments),
  public.admin_approve_commerce_order_fee(uuid,numeric,text),
  public.admin_reject_commerce_order(uuid,text),
  public.submit_commerce_order_payment(uuid,uuid,text,text),
  public.get_my_notifications()
from public, anon;

grant execute on function
  public.admin_approve_commerce_order_fee(uuid,numeric,text),
  public.admin_reject_commerce_order(uuid,text),
  public.submit_commerce_order_payment(uuid,uuid,text,text),
  public.get_my_notifications()
to authenticated;
