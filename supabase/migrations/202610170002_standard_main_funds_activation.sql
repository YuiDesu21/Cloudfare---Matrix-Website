alter table public.timeline_requests drop constraint timeline_requests_payment_method_check;
alter table public.timeline_requests add constraint timeline_requests_payment_method_check
  check (payment_method in ('gcash', 'available_balance', 'external', 'main_funds'));

create or replace function public.member_main_available(p_member_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select greatest(public.member_fund_balance(p_member_id, 'main')
    - coalesce((select sum(amount) from public.withdrawal_requests
      where member_id = p_member_id and fund_source = 'main' and status = 'pending'), 0)
    - coalesce((select sum(amount) from public.timeline_requests
      where member_id = p_member_id and payment_method = 'main_funds' and status = 'pending'), 0), 0);
$$;

create or replace function public.request_timeline_activation(
  p_payment_method text, p_payment_method_id uuid, p_reference_number text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  member public.profiles%rowtype;
  method public.payment_methods%rowtype;
  created_request public.timeline_requests%rowtype;
  request_data jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if p_payment_method = 'main_funds' then
    if p_payment_method_id is not null or nullif(trim(coalesce(p_reference_number, '')), '') is not null then
      raise exception 'Main Funds does not use a payment reference.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
    select * into member from public.profiles where id = caller_id for update;
    if member.id is null then raise exception 'Member profile not found.'; end if;
    if exists (select 1 from public.matrix_positions
      where member_id = member.id and plan_id = 'timeline-power3') then
      raise exception 'Standard Plan is already active for this account.';
    end if;
    if exists (select 1 from public.timeline_requests
      where member_id = member.id and status = 'pending') then
      raise exception 'You already have a pending Standard Plan request.';
    end if;
    if public.member_main_available(member.id) < 693 then
      raise exception 'Main Funds needs at least PHP 693 for Standard Plan activation.' using errcode = '22023';
    end if;
    insert into public.timeline_requests(member_id, payment_method)
    values (member.id, 'main_funds') returning * into created_request;
    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (member.id, 'timeline-request', member.full_name || ' requested Standard Plan activation.',
      jsonb_build_object('requestId', created_request.id, 'paymentMethod', 'main_funds'));
    return to_jsonb(created_request);
  end if;

  if p_payment_method <> 'external' then raise exception 'Choose a payment method.' using errcode = '22023'; end if;
  select * into method from public.payment_methods where id = p_payment_method_id and is_active;
  if method.id is null then raise exception 'Choose an active payment method.'; end if;
  request_data := public.request_timeline_activation('gcash', method.account_name, method.account_number, p_reference_number);
  update public.timeline_requests
  set payment_method = 'external', payment_method_id = method.id,
      payment_method_snapshot = public.payment_method_json(method), gcash_name = '', gcash_number = ''
  where id = (request_data->>'id')::uuid and member_id = caller_id and status = 'pending';
  return request_data || jsonb_build_object('paymentMethod', 'external',
    'paymentMethodSnapshot', public.payment_method_json(method));
end;
$$;

create or replace function public.admin_approve_timeline_request(p_request_id uuid, p_decision_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.timeline_requests%rowtype;
  target_member public.profiles%rowtype;
  selected_parent uuid;
  approval_time timestamptz := now();
  remaining numeric;
  applied numeric;
  ledger_row record;
  due_balance numeric;
  other_reserved numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if nullif(trim(p_decision_note), '') is null then raise exception 'An approval note is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));
  select * into target from public.timeline_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Timeline request is no longer pending.'; end if;
  if target.member_id = auth.uid() then raise exception 'Administrators may not approve their own request.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.member_id::text, 0));
  select * into target_member from public.profiles where id = target.member_id for update;
  if exists (select 1 from public.matrix_positions position where position.member_id = target.member_id and position.plan_id = 'timeline-power3') then
    raise exception 'Timeline Matrix is already active for this account.';
  end if;

  if target.payment_method = 'main_funds' then
    select
      coalesce((select sum(amount) from public.withdrawal_requests
        where member_id = target.member_id and fund_source = 'main' and status = 'pending'), 0)
      + coalesce((select sum(amount) from public.timeline_requests
        where member_id = target.member_id and status = 'pending'
          and payment_method = 'main_funds' and id <> target.id), 0)
    into other_reserved;
    if public.member_fund_balance(target.member_id, 'main') - other_reserved < target.amount then
      raise exception 'Main Funds balance is no longer enough for Standard Plan activation.' using errcode = '22023';
    end if;
    insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
    values (target.member_id, 'main', -target.amount, 'timeline_activation', target.id,
      'Standard Plan activation');
  elsif target.payment_method = 'available_balance' then
    select coalesce(sum(greatest(amount - withdrawn_amount, 0)) filter (where status = 'due' and due_at <= approval_time), 0)
    into due_balance from public.reward_ledger where member_id = target.member_id;
    select
      coalesce((select sum(amount) from public.withdrawal_requests where member_id = target.member_id and status = 'pending'), 0)
      + coalesce((select sum(action_amount) from public.exit_actions where member_id = target.member_id and status = 'pending' and payment_method = 'available_balance'), 0)
      + coalesce((select sum(amount) from public.timeline_requests where member_id = target.member_id and status = 'pending' and payment_method = 'available_balance' and id <> target.id), 0)
    into other_reserved;
    if due_balance - other_reserved < target.amount then raise exception 'Not enough Available Balance.'; end if;
    remaining := target.amount;
    for ledger_row in
      select id, amount, withdrawn_amount from public.reward_ledger
      where member_id = target.member_id and status = 'due' and due_at <= approval_time
      order by due_at, created_at, id for update
    loop
      exit when remaining <= 0;
      applied := least(greatest(ledger_row.amount - ledger_row.withdrawn_amount, 0), remaining);
      if applied > 0 then
        update public.reward_ledger set
          withdrawn_amount = withdrawn_amount + applied,
          status = case when withdrawn_amount + applied >= amount then 'paid'::public.ledger_status else status end,
          paid_at = case when withdrawn_amount + applied >= amount then approval_time else paid_at end
        where id = ledger_row.id;
        remaining := remaining - applied;
      end if;
    end loop;
  end if;

  select position.member_id into selected_parent
  from public.matrix_positions position
  where position.plan_id = 'timeline-power3'
    and (select count(*) from public.matrix_positions child where child.plan_id = 'timeline-power3' and child.parent_member_id = position.member_id) < 3
  order by position.placed_at, position.id
  limit 1;

  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (target.member_id, 'timeline-power3', selected_parent, approval_time);
  update public.timeline_requests set
    status = 'approved', approved_at = approval_time, reviewed_by = auth.uid(), decision_note = trim(p_decision_note)
  where id = target.id;

  perform public.refresh_timeline_ancestor_progress(target.member_id);
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'timeline-approval', 'Approved Timeline Matrix activation for ' || target_member.full_name || '.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'parentMemberId', selected_parent);
end;
$$;
