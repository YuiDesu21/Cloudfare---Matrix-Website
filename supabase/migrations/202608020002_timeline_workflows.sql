-- Timeline Matrix transactional workflow and explicit Main Matrix isolation.
-- All placement and progression decisions happen in the database so browser
-- state cannot change queue order, qualification, or rewards.

alter table public.reward_ledger
  add column if not exists plan_id text not null default 'power3-passive';

drop index if exists public.reward_ledger_member_plan_due_idx;
create index reward_ledger_member_plan_due_idx
  on public.reward_ledger(member_id, plan_id, due_at, status);

alter table public.reward_ledger drop constraint if exists reward_ledger_source_type_check;
alter table public.reward_ledger add constraint reward_ledger_source_type_check
  check (source_type in ('entry', 'exit', 'matrix', 'timeline_matrix'));

-- Returns the highest automatically unlocked Timeline exit for a member.
create or replace function public.timeline_exit_for(p_member_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(progress.exit_number), 0)::smallint
  from public.timeline_exit_progress progress
  where progress.member_id = p_member_id and progress.status = 'active';
$$;
revoke all on function public.timeline_exit_for(uuid) from public, anon;

-- Adds each monthly Timeline Matrix Income installment once an Exit unlocks.
create or replace function public.create_timeline_matrix_income(
  p_member_id uuid,
  p_exit_number smallint,
  p_unlocked_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.timeline_exit_rules%rowtype;
begin
  select * into rule from public.timeline_exit_rules where exit_number = p_exit_number;
  if rule.exit_number is null or rule.matrix_income <= 0 or rule.matrix_months <= 0 then return; end if;

  insert into public.reward_ledger (
    member_id, plan_id, source_type, source_label, exit_number, amount, due_at, status, created_at
  )
  select
    p_member_id,
    'timeline-power3',
    'timeline_matrix',
    'Timeline Exit ' || p_exit_number || ' Matrix Income',
    p_exit_number,
    rule.matrix_income,
    p_unlocked_at + installment.month_number * interval '1 month',
    'due',
    p_unlocked_at
  from generate_series(1, rule.matrix_months) as installment(month_number)
  where not exists (
    select 1
    from public.reward_ledger existing
    where existing.member_id = p_member_id
      and existing.plan_id = 'timeline-power3'
      and existing.source_type = 'timeline_matrix'
      and existing.exit_number = p_exit_number
  );
end;
$$;
revoke all on function public.create_timeline_matrix_income(uuid, smallint, timestamptz) from public, anon, authenticated;

-- Evaluates one member. Exits unlock sequentially and never need a purchase
-- or a restake; each requires three direct Timeline children at the prior exit.
create or replace function public.refresh_timeline_progress(p_member_id uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.timeline_exit_rules%rowtype;
  qualified_downlines integer;
  unlocked_at timestamptz := now();
  highest smallint;
begin
  if not exists (
    select 1 from public.matrix_positions position
    where position.member_id = p_member_id and position.plan_id = 'timeline-power3'
  ) then
    return 0;
  end if;

  for rule in select * from public.timeline_exit_rules order by exit_number loop
    if exists (
      select 1 from public.timeline_exit_progress progress
      where progress.member_id = p_member_id and progress.exit_number = rule.exit_number
    ) then
      continue;
    end if;

    if rule.exit_number > 1 and not exists (
      select 1 from public.timeline_exit_progress progress
      where progress.member_id = p_member_id and progress.exit_number = rule.exit_number - 1
    ) then
      exit;
    end if;

    select count(*)::integer into qualified_downlines
    from public.matrix_positions child
    where child.parent_member_id = p_member_id
      and child.plan_id = 'timeline-power3'
      and public.timeline_exit_for(child.member_id) >= rule.required_downline_exit;

    exit when qualified_downlines < 3;

    insert into public.timeline_exit_progress(member_id, exit_number, status, approved_at)
    values (p_member_id, rule.exit_number, 'active', unlocked_at)
    on conflict (member_id, exit_number) do nothing;

    perform public.create_timeline_matrix_income(p_member_id, rule.exit_number, unlocked_at);
  end loop;

  select public.timeline_exit_for(p_member_id) into highest;
  return highest;
end;
$$;
revoke all on function public.refresh_timeline_progress(uuid) from public, anon, authenticated;

-- A child becoming active or reaching an Exit can advance every ancestor.
create or replace function public.refresh_timeline_ancestor_progress(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_member_id uuid := p_member_id;
  parent_id uuid;
begin
  loop
    perform public.refresh_timeline_progress(current_member_id);
    select position.parent_member_id into parent_id
    from public.matrix_positions position
    where position.member_id = current_member_id and position.plan_id = 'timeline-power3';
    exit when parent_id is null;
    current_member_id := parent_id;
  end loop;
end;
$$;
revoke all on function public.refresh_timeline_ancestor_progress(uuid) from public, anon, authenticated;

create or replace function public.request_timeline_activation(
  p_payment_method text,
  p_gcash_name text default '',
  p_gcash_number text default '',
  p_reference_number text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  created_request public.timeline_requests%rowtype;
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
  available_balance numeric;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if p_payment_method not in ('gcash', 'available_balance') then raise exception 'Choose GCash or Available Balance.'; end if;

  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile not found.'; end if;
  if exists (select 1 from public.matrix_positions position where position.member_id = caller.id and position.plan_id = 'timeline-power3') then
    raise exception 'Timeline Matrix is already active for this account.';
  end if;
  if exists (select 1 from public.timeline_requests request where request.member_id = caller.id and request.status = 'pending') then
    raise exception 'You already have a pending Timeline Matrix request.';
  end if;

  if p_payment_method = 'gcash' then
    if nullif(trim(p_gcash_name), '') is null or nullif(trim(p_gcash_number), '') is null or normalized_reference !~ '^[A-Z0-9-]{6,40}$' then
      raise exception 'GCash name, number, and a valid reference number are required.';
    end if;
    if exists (select 1 from public.upgrade_requests request where request.reference_number = normalized_reference)
      or exists (select 1 from public.exit_actions action where upper(coalesce(action.reference_number, '')) = normalized_reference)
      or exists (select 1 from public.timeline_requests request where request.reference_number = normalized_reference) then
      raise exception 'This GCash reference number is already in use.';
    end if;
  else
    select
      coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (
        where ledger.status = 'due' and ledger.due_at <= now()
      ), 0)
      - coalesce((select sum(request.amount) from public.withdrawal_requests request where request.member_id = caller.id and request.status = 'pending'), 0)
      - coalesce((select sum(action.action_amount) from public.exit_actions action where action.member_id = caller.id and action.status = 'pending' and action.payment_method = 'available_balance'), 0)
      - coalesce((select sum(request.amount) from public.timeline_requests request where request.member_id = caller.id and request.status = 'pending' and request.payment_method = 'available_balance'), 0)
    into available_balance
    from public.reward_ledger ledger
    where ledger.member_id = caller.id;
    if available_balance < 693 then raise exception 'Not enough Available Balance for the PHP 693 Timeline activation.'; end if;
  end if;

  insert into public.timeline_requests(member_id, payment_method, gcash_name, gcash_number, reference_number)
  values (
    caller.id,
    p_payment_method,
    case when p_payment_method = 'gcash' then trim(p_gcash_name) else '' end,
    case when p_payment_method = 'gcash' then trim(p_gcash_number) else '' end,
    case when p_payment_method = 'gcash' then normalized_reference else '' end
  ) returning * into created_request;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (caller.id, 'timeline-request', caller.full_name || ' requested Timeline Matrix activation.', jsonb_build_object('requestId', created_request.id, 'paymentMethod', p_payment_method));
  return to_jsonb(created_request);
end;
$$;
revoke all on function public.request_timeline_activation(text, text, text, text) from public, anon;
grant execute on function public.request_timeline_activation(text, text, text, text) to authenticated;

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

  -- Serialize placement so concurrent approvals cannot take the same slot.
  perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));
  select * into target from public.timeline_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Timeline request is no longer pending.'; end if;
  if target.member_id = auth.uid() then raise exception 'Administrators may not approve their own request.' using errcode = '42501'; end if;
  select * into target_member from public.profiles where id = target.member_id for update;
  if exists (select 1 from public.matrix_positions position where position.member_id = target.member_id and position.plan_id = 'timeline-power3') then
    raise exception 'Timeline Matrix is already active for this account.';
  end if;

  if target.payment_method = 'available_balance' then
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
  values (auth.uid(), 'timeline-approval', 'Approved Timeline Matrix activation for ' || target_member.full_name || '.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'parentMemberId', selected_parent);
end;
$$;
revoke all on function public.admin_approve_timeline_request(uuid, text) from public, anon;
grant execute on function public.admin_approve_timeline_request(uuid, text) to authenticated;

create or replace function public.admin_reject_timeline_request(p_request_id uuid, p_decision_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.timeline_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if nullif(trim(p_decision_note), '') is null then raise exception 'A rejection note is required.'; end if;
  select * into target from public.timeline_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Timeline request is no longer pending.'; end if;
  if target.member_id = auth.uid() then raise exception 'Administrators may not reject their own request.' using errcode = '42501'; end if;
  update public.timeline_requests set status = 'rejected', rejected_at = now(), reviewed_by = auth.uid(), decision_note = trim(p_decision_note) where id = target.id;
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'timeline-rejection', 'Rejected Timeline Matrix activation request.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id));
  return jsonb_build_object('id', target.id, 'status', 'rejected');
end;
$$;
revoke all on function public.admin_reject_timeline_request(uuid, text) from public, anon;
grant execute on function public.admin_reject_timeline_request(uuid, text) to authenticated;

create or replace function public.admin_get_timeline_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code, 'amount', request.amount,
    'paymentMethod', request.payment_method, 'gcashName', request.gcash_name, 'gcashNumber', request.gcash_number,
    'referenceNumber', request.reference_number, 'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at, 'reviewedBy', request.reviewed_by,
    'decisionNote', request.decision_note
  ) order by request.created_at desc), '[]'::jsonb) into result
  from public.timeline_requests request join public.profiles member on member.id = request.member_id;
  return result;
end;
$$;
revoke all on function public.admin_get_timeline_requests() from public, anon;
grant execute on function public.admin_get_timeline_requests() to authenticated;

create or replace function public.get_my_timeline_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with position as (
    select * from public.matrix_positions
    where member_id = auth.uid() and plan_id = 'timeline-power3'
  ), balances as (
    select coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (
      where ledger.status = 'due' and ledger.due_at <= now()
    ), 0) as earned
    from public.reward_ledger ledger where ledger.member_id = auth.uid()
  )
  select jsonb_build_object(
    'isActive', exists(select 1 from position),
    'pendingRequest', (
      select jsonb_build_object('id', request.id, 'status', request.status, 'createdAt', request.created_at)
      from public.timeline_requests request where request.member_id = auth.uid() and request.status = 'pending'
      order by request.created_at desc limit 1
    ),
    'position', (select jsonb_build_object('id', id, 'memberId', member_id, 'planId', plan_id, 'parentMemberId', parent_member_id, 'placedAt', placed_at) from position),
    'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'timeline-power3'),
    'highestExit', public.timeline_exit_for(auth.uid()),
    'earnedBalance', (select earned from balances),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
      'exit', rule.exit_number, 'requiredDownlineExit', rule.required_downline_exit,
      'productSpend', rule.product_spend, 'productBonusAmount', rule.product_bonus_amount,
      'productMonths', rule.product_months, 'matrixIncome', rule.matrix_income, 'matrixMonths', rule.matrix_months,
      'qualifiedDownlines', (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'timeline-power3' and public.timeline_exit_for(child.member_id) >= rule.required_downline_exit),
      'status', case when exists(select 1 from public.timeline_exit_progress progress where progress.member_id = auth.uid() and progress.exit_number = rule.exit_number) then 'active'
        when rule.exit_number > 1 and not exists(select 1 from public.timeline_exit_progress progress where progress.member_id = auth.uid() and progress.exit_number = rule.exit_number - 1) then 'locked'
        when (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'timeline-power3' and public.timeline_exit_for(child.member_id) >= rule.required_downline_exit) >= 3 then 'qualified'
        else 'locked' end
    ) order by rule.exit_number) from public.timeline_exit_rules rule), '[]'::jsonb),
    'rewardLedger', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ledger.id, 'planId', ledger.plan_id, 'sourceType', ledger.source_type, 'sourceLabel', ledger.source_label,
      'exit', ledger.exit_number, 'amount', ledger.amount, 'withdrawnAmount', ledger.withdrawn_amount,
      'dueAt', ledger.due_at, 'status', ledger.status, 'paidAt', ledger.paid_at
    ) order by ledger.due_at) from public.reward_ledger ledger where ledger.member_id = auth.uid() and ledger.plan_id = 'timeline-power3'), '[]'::jsonb)
  );
$$;
revoke all on function public.get_my_timeline_dashboard() from public, anon;
grant execute on function public.get_my_timeline_dashboard() to authenticated;

-- Timeline explorer intentionally contains only Timeline placements; referrals
-- and Main Matrix positions can never appear as pending Timeline children.
create or replace function public.get_my_timeline_level(p_root_member_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller_id uuid := auth.uid(); root_id uuid := coalesce(p_root_member_id, auth.uid()); result jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if not public.is_admin() and root_id <> caller_id and not exists (
    with recursive visible(member_id) as (
      select caller_id union all
      select child.member_id from public.matrix_positions child join visible parent on child.parent_member_id = parent.member_id
      where child.plan_id = 'timeline-power3'
    ) select 1 from visible where member_id = root_id
  ) then raise exception 'You may only view your own Timeline Matrix line.' using errcode = '42501'; end if;

  select jsonb_build_object(
    'id', profile.id, 'fullName', profile.full_name, 'username', profile.username, 'accountCode', profile.account_code,
    'planId', 'timeline-power3', 'matrixStage', jsonb_build_object('label', case when public.timeline_exit_for(profile.id) > 0 then 'Exit ' || public.timeline_exit_for(profile.id) else 'Entry' end, 'status', 'active', 'exit', public.timeline_exit_for(profile.id)),
    'parent', case when parent_profile.id is null then null else jsonb_build_object('id', parent_profile.id, 'fullName', parent_profile.full_name, 'username', parent_profile.username, 'accountCode', parent_profile.account_code) end,
    'children', coalesce((select jsonb_agg(jsonb_build_object(
      'id', child_profile.id, 'fullName', child_profile.full_name, 'username', child_profile.username, 'accountCode', child_profile.account_code,
      'matrixStage', jsonb_build_object('label', case when public.timeline_exit_for(child_profile.id) > 0 then 'Exit ' || public.timeline_exit_for(child_profile.id) else 'Entry' end, 'status', 'active', 'exit', public.timeline_exit_for(child_profile.id)),
      'isReferralPending', false, 'canTraverse', public.is_admin() or child_profile.id = caller_id
    ) order by child_position.placed_at, child_position.id) from public.matrix_positions child_position join public.profiles child_profile on child_profile.id = child_position.member_id where child_position.parent_member_id = profile.id and child_position.plan_id = 'timeline-power3'), '[]'::jsonb)
  ) into result
  from public.profiles profile join public.matrix_positions current_position on current_position.member_id = profile.id and current_position.plan_id = 'timeline-power3'
  left join public.profiles parent_profile on parent_profile.id = current_position.parent_member_id
  where profile.id = root_id;
  if result is null then raise exception 'The requested member is not placed in the Timeline Matrix.'; end if;
  return result;
end;
$$;
revoke all on function public.get_my_timeline_level(uuid) from public, anon;
grant execute on function public.get_my_timeline_level(uuid) to authenticated;

-- Main Matrix helpers remain scoped to its own plan after Timeline positions exist.
create or replace function public.matrix_stage_for(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare selected_exit smallint; selected_status text;
begin
  select rule.exit_number into selected_exit from public.matrix_exit_rules rule
  where (select count(*) from public.matrix_positions child where child.parent_member_id = p_member_id and child.plan_id = 'power3-passive' and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit) >= 3
  order by rule.exit_number desc limit 1;
  if selected_exit is null then return jsonb_build_object('label', 'Entry', 'status', 'active', 'exit', 0); end if;
  select case action.status::text when 'approved' then 'active' when 'pending' then 'pending' else 'qualified' end into selected_status
  from public.exit_actions action where action.member_id = p_member_id and action.exit_number = selected_exit and action.status in ('pending','approved') order by case action.status when 'approved' then 1 else 2 end limit 1;
  return jsonb_build_object('label', 'Exit ' || selected_exit, 'status', coalesce(selected_status, 'qualified'), 'exit', selected_exit);
end;
$$;
revoke all on function public.matrix_stage_for(uuid) from public, anon;
grant execute on function public.matrix_stage_for(uuid) to authenticated;

create or replace function public.get_my_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (select profile.* from public.profiles profile where profile.id = auth.uid()),
  exit_statuses as (
    select rule.*,
      (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'power3-passive' and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit)::integer as qualified_downlines,
      (select action.status::text from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status in ('pending','approved') order by case action.status when 'approved' then 1 else 2 end limit 1) as action_status,
      (select action.approved_at from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'approved' limit 1) as approved_at,
      (select action.created_at from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'pending' limit 1) as requested_at
    from public.matrix_exit_rules rule
  ), balances as (
    select coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (where ledger.status = 'due' and ledger.due_at <= now()), 0) as earned,
      coalesce((select sum(request.amount) from public.withdrawal_requests request where request.member_id = auth.uid() and request.status = 'pending'), 0) as pending
    from public.reward_ledger ledger where ledger.member_id = auth.uid()
  ) select jsonb_build_object(
    'member', (select jsonb_build_object('id', caller.id, 'accountCode', caller.account_code, 'fullName', caller.full_name, 'username', caller.username, 'email', caller.email, 'phone', caller.phone, 'walletAddress', caller.wallet_address, 'sponsorId', caller.sponsor_id, 'status', caller.status, 'cumulativeF3Tokens', caller.cumulative_f3_tokens, 'createdAt', caller.created_at, 'approvedAt', caller.approved_at) from caller),
    'isAdmin', public.is_admin(), 'referralCount', (select count(*) from public.profiles where sponsor_id = auth.uid()),
    'directChildrenCount', (select count(*) from public.matrix_positions where parent_member_id = auth.uid() and plan_id = 'power3-passive'),
    'position', (select jsonb_build_object('id', position.id, 'memberId', position.member_id, 'planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'placedAt', position.placed_at) from public.matrix_positions position where position.member_id = auth.uid() and position.plan_id = 'power3-passive'),
    'rules', jsonb_build_object('programName', 'Matrix Power of Three Passive Income', 'matrixId', 'power3-passive', 'matrixName', 'Power of Three Passive Income', 'maxDirectDownlines', 3, 'entry', jsonb_build_object('name', 'Entry', 'holdF3', 20, 'holdPesoValue', 1200, 'passiveIncome', 231, 'passiveMonths', 3)),
    'exits', coalesce((select jsonb_agg(jsonb_build_object('exit', status.exit_number, 'requirementRank', status.requirement_rank, 'requiredDownlineExit', status.required_downline_exit, 'actionType', status.action_type, 'actionLabel', status.action_label, 'actionAmount', status.action_amount, 'passiveIncome', status.passive_income, 'passiveMonths', status.passive_months, 'productSpend', status.product_spend, 'productBonusPercent', status.product_bonus_percent, 'productMonths', status.product_months, 'qualifiedDownlines', status.qualified_downlines, 'requiredDownlines', 3, 'status', case when status.action_status = 'approved' then 'active' when status.action_status = 'pending' then 'pending' when status.qualified_downlines >= 3 then 'qualified' else 'locked' end, 'approvedAt', status.approved_at, 'requestedAt', status.requested_at) order by status.exit_number) from exit_statuses status), '[]'::jsonb),
    'rewardLedger', coalesce((select jsonb_agg(jsonb_build_object('id', ledger.id, 'memberId', ledger.member_id, 'planId', ledger.plan_id, 'sourceType', ledger.source_type, 'sourceLabel', ledger.source_label, 'exit', ledger.exit_number, 'amount', ledger.amount, 'withdrawnAmount', ledger.withdrawn_amount, 'dueAt', ledger.due_at, 'status', ledger.status, 'paidAt', ledger.paid_at) order by ledger.due_at) from public.reward_ledger ledger where ledger.member_id = auth.uid()), '[]'::jsonb),
    'earnedBalance', (select earned from balances), 'pendingWithdrawal', (select pending from balances),
    'productPlusClaims', coalesce((select jsonb_agg(to_jsonb(claim)) from public.product_plus_claims claim where claim.member_id = auth.uid()), '[]'::jsonb), 'productPlusEntitlements', '[]'::jsonb
  );
$$;
revoke all on function public.get_my_dashboard() from public, anon;
grant execute on function public.get_my_dashboard() to authenticated;
