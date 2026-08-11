-- Apply package benefits after admin verifies a commerce order payment.

create unique index if not exists one_product_plus_requirement_credit_per_order
  on public.voucher_ledger(commerce_order_id)
  where commerce_order_id is not null and entry_type = 'credit';

create or replace function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.profiles%rowtype;
  selected_parent uuid;
  voucher_credit numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select * into target_member
  from public.profiles
  where id = p_order.member_id
  for update;

  if target_member.id is null then raise exception 'Order member not found.' using errcode = 'P0002'; end if;
  if target_member.status = 'suspended' then raise exception 'Suspended members cannot receive package benefits.' using errcode = '42501'; end if;

  if p_order.package_type = 'matrix_1200_entry' then
    perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'power3-passive'
    ) then
      raise exception 'This member is already active in the PHP 1,200 Matrix.' using errcode = '22023';
    end if;

    selected_parent := public.find_open_main_matrix_parent(target_member.sponsor_id);

    update public.profiles
    set status = 'active',
        approved_at = coalesce(approved_at, p_activation_time),
        cumulative_f3_tokens = greatest(cumulative_f3_tokens, 20)
    where id = target_member.id;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'power3-passive', selected_parent, p_activation_time);

    insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
    select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, p_activation_time + month_number * interval '1 month', 'due', p_activation_time
    from generate_series(1, 3) as months(month_number);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-main-matrix-activation', 'Activated PHP 1,200 Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent));

    return jsonb_build_object('type', 'matrix_1200_entry', 'planId', 'power3-passive', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'timeline_entry' then
    perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Timeline Matrix is already active for this account.' using errcode = '22023';
    end if;

    select position.member_id into selected_parent
    from public.matrix_positions position
    where position.plan_id = 'timeline-power3'
      and (
        select count(*)
        from public.matrix_positions child
        where child.plan_id = 'timeline-power3'
          and child.parent_member_id = position.member_id
      ) < 3
    order by position.placed_at, position.id
    limit 1;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'timeline-power3', selected_parent, p_activation_time);

    perform public.refresh_timeline_ancestor_progress(target_member.id);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-timeline-activation', 'Activated Timeline Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent));

    return jsonb_build_object('type', 'timeline_entry', 'planId', 'timeline-power3', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'product_plus_requirement' then
    voucher_credit := round(p_order.package_total, 2);
    if voucher_credit <= 0 then raise exception 'Product Plus voucher credit must be greater than zero.' using errcode = '22023'; end if;

    if not exists (
      select 1 from public.voucher_ledger
      where commerce_order_id = p_order.id
        and entry_type = 'credit'
    ) then
      insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
      values (target_member.id, p_order.id, 'credit', voucher_credit, p_order.order_code, 'Product Plus package purchase completed', auth.uid());
    end if;

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-product-plus-credit', 'Credited Product Plus vouchers from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'voucherCredit', voucher_credit));

    return jsonb_build_object('type', 'product_plus_requirement', 'voucherCredit', voucher_credit);
  end if;

  return jsonb_build_object('type', p_order.package_type, 'status', 'no_matrix_or_voucher_benefit');
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

revoke all on function
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz),
  public.admin_approve_commerce_order_payment(uuid,text)
from public, anon;

grant execute on function
  public.admin_approve_commerce_order_payment(uuid,text)
to authenticated;
