-- Keep every Main Matrix workflow explicitly scoped now that an account can
-- hold a separate Timeline Matrix position.

create or replace function public.enforce_matrix_position_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_member_id is not null and not exists (
    select 1 from public.matrix_positions parent
    where parent.member_id = new.parent_member_id and parent.plan_id = new.plan_id
  ) then
    raise exception 'A matrix parent must be active in the same plan.';
  end if;
  return new;
end;
$$;

drop trigger if exists matrix_positions_enforce_plan on public.matrix_positions;
create trigger matrix_positions_enforce_plan
  before insert or update of plan_id, parent_member_id on public.matrix_positions
  for each row execute function public.enforce_matrix_position_plan();

create or replace function public.get_matrix_level(p_root_member_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller_id uuid := auth.uid(); root_id uuid := coalesce(p_root_member_id, auth.uid()); result jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if not public.is_admin()
    and not exists (
      with recursive descendants(member_id) as (
        select caller_id
        union all
        select child.member_id from public.matrix_positions child
        join descendants parent on child.parent_member_id = parent.member_id
        where child.plan_id = 'power3-passive'
      ) select 1 from descendants where member_id = root_id
    )
    and not exists (
      with recursive ancestors(member_id) as (
        select caller_id
        union all
        select position.parent_member_id from public.matrix_positions position
        join ancestors child on position.member_id = child.member_id
        where position.plan_id = 'power3-passive' and position.parent_member_id is not null
      ) select 1 from ancestors where member_id = root_id
    ) then
    raise exception 'You may only view your own matrix line.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', root_profile.id, 'fullName', root_profile.full_name, 'username', root_profile.username,
    'accountCode', root_profile.account_code, 'planId', root_position.plan_id,
    'matrixStage', public.matrix_stage_for(root_profile.id),
    'parent', case when parent_profile.id is null then null else jsonb_build_object(
      'id', parent_profile.id, 'fullName', parent_profile.full_name, 'username', parent_profile.username, 'accountCode', parent_profile.account_code
    ) end,
    'children', coalesce((select jsonb_agg(child_record.data order by child_record.sort_time, child_record.sort_name)
      from (
        select child_position.placed_at as sort_time, child_profile.full_name as sort_name,
          jsonb_build_object(
            'id', child_profile.id, 'fullName', child_profile.full_name, 'username', child_profile.username,
            'accountCode', child_profile.account_code, 'matrixStage', public.matrix_stage_for(child_profile.id),
            'isReferralPending', false,
            'canTraverse', public.is_admin() or child_profile.id = caller_id or exists (
              with recursive descendants(member_id) as (
                select caller_id
                union all
                select descendant.member_id from public.matrix_positions descendant
                join descendants ancestor on descendant.parent_member_id = ancestor.member_id
                where descendant.plan_id = 'power3-passive'
              ) select 1 from descendants where member_id = child_profile.id
            ) or exists (
              with recursive ancestors(member_id) as (
                select caller_id
                union all
                select position.parent_member_id from public.matrix_positions position
                join ancestors child on position.member_id = child.member_id
                where position.plan_id = 'power3-passive' and position.parent_member_id is not null
              ) select 1 from ancestors where member_id = child_profile.id
            )
          ) as data
        from public.matrix_positions child_position
        join public.profiles child_profile on child_profile.id = child_position.member_id
        where child_position.parent_member_id = root_profile.id and child_position.plan_id = 'power3-passive'
        union all
        select referred.created_at, referred.full_name,
          jsonb_build_object(
            'id', referred.id, 'fullName', referred.full_name, 'username', referred.username, 'accountCode', referred.account_code,
            'matrixStage', jsonb_build_object('label', 'Registered', 'status', 'registered', 'exit', 0),
            'isReferralPending', true, 'canTraverse', false
          )
        from public.profiles referred
        where referred.sponsor_id = root_profile.id
          and not exists (
            select 1 from public.matrix_positions positioned
            where positioned.member_id = referred.id and positioned.plan_id = 'power3-passive'
          )
      ) child_record
    ), '[]'::jsonb)
  ) into result
  from public.profiles root_profile
  join public.matrix_positions root_position on root_position.member_id = root_profile.id and root_position.plan_id = 'power3-passive'
  left join public.profiles parent_profile on parent_profile.id = root_position.parent_member_id
  where root_profile.id = root_id;
  if result is null then raise exception 'The requested member is not placed in the Main Matrix.'; end if;
  return result;
end;
$$;
revoke all on function public.get_matrix_level(uuid) from public, anon;
grant execute on function public.get_matrix_level(uuid) to authenticated;

create or replace function public.admin_get_eligible_parents()
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
    'memberId', member.id, 'fullName', member.full_name, 'username', member.username,
    'accountCode', member.account_code, 'childrenCount', counts.occupied, 'slotsLeft', 3 - counts.occupied
  ) order by member.full_name), '[]'::jsonb) into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  cross join lateral (
    select (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = 'power3-passive')
      + (select count(*) from public.profiles referred where referred.sponsor_id = member.id and not exists (
        select 1 from public.matrix_positions placed where placed.member_id = referred.id and placed.plan_id = 'power3-passive'
      )) as occupied
  ) counts
  where position.plan_id = 'power3-passive' and counts.occupied < 3;
  return result;
end;
$$;
revoke all on function public.admin_get_eligible_parents() from public, anon;
grant execute on function public.admin_get_eligible_parents() to authenticated;

create or replace function public.admin_approve_entry(p_request_id uuid, p_parent_member_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.upgrade_requests%rowtype; target_member public.profiles%rowtype;
  selected_parent uuid; occupied integer; approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target_request from public.upgrade_requests where id = p_request_id for update;
  if target_request.id is null or target_request.status <> 'pending' then raise exception 'Entry request is no longer pending.'; end if;
  select * into target_member from public.profiles where id = target_request.member_id for update;
  if target_member.status = 'active' then raise exception 'Member Entry is already active.'; end if;
  selected_parent := coalesce(target_member.sponsor_id, p_parent_member_id);
  if selected_parent is null then
    if exists (select 1 from public.matrix_positions where plan_id = 'power3-passive' and parent_member_id is null) then raise exception 'Select a matrix parent for this member.'; end if;
  else
    if not exists (select 1 from public.matrix_positions where member_id = selected_parent and plan_id = 'power3-passive') then raise exception 'The selected parent is not active in this matrix.'; end if;
    select (select count(*) from public.matrix_positions where parent_member_id = selected_parent and plan_id = 'power3-passive')
      + (select count(*) from public.profiles referred where referred.sponsor_id = selected_parent and referred.id <> target_member.id and not exists (
        select 1 from public.matrix_positions placed where placed.member_id = referred.id and placed.plan_id = 'power3-passive'
      )) into occupied;
    if occupied >= 3 then raise exception 'The selected parent has no open matrix positions.'; end if;
  end if;
  update public.profiles set status = 'active', approved_at = approval_time, cumulative_f3_tokens = 20 where id = target_member.id;
  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (target_member.id, 'power3-passive', selected_parent, approval_time);
  update public.upgrade_requests set status = 'approved', approved_at = approval_time where id = target_request.id;
  insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
  select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, approval_time + month_number * interval '1 month', 'due', approval_time
  from generate_series(1, 3) as months(month_number);
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'upgrade-approval', 'Approved Entry for ' || target_member.full_name, jsonb_build_object('requestId', target_request.id, 'memberId', target_member.id, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target_request.id, 'status', 'approved', 'memberId', target_member.id, 'parentMemberId', selected_parent);
end;
$$;
revoke all on function public.admin_approve_entry(uuid, uuid) from public, anon;
grant execute on function public.admin_approve_entry(uuid, uuid) to authenticated;

create or replace function public.request_exit_action(
  p_exit_number smallint,
  p_payment_method text,
  p_f3_wallet text default '',
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
  member public.profiles%rowtype; rule public.matrix_exit_rules%rowtype;
  qualified_count integer; created_request public.exit_actions%rowtype; available_balance numeric;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.status <> 'active' or not exists (select 1 from public.matrix_positions where member_id = member.id and plan_id = 'power3-passive') then raise exception 'Active Main Matrix Entry is required.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = p_exit_number;
  if rule.exit_number is null then raise exception 'Exit rule not found.'; end if;
  if p_exit_number > 1 and not exists (select 1 from public.exit_actions previous where previous.member_id = member.id and previous.exit_number = p_exit_number - 1 and previous.status = 'approved') then raise exception 'The previous Exit must be approved first.'; end if;
  select count(*) into qualified_count from public.matrix_positions child
  where child.parent_member_id = member.id and child.plan_id = 'power3-passive'
    and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit;
  if qualified_count < 3 then raise exception 'Three qualified direct Main Matrix downlines are required.'; end if;
  if exists (select 1 from public.exit_actions action where action.member_id = member.id and action.exit_number = p_exit_number and action.status in ('pending', 'approved')) then raise exception 'An active request already exists for this Exit.'; end if;
  if rule.action_type = 'reinvest' then
    if nullif(trim(p_f3_wallet), '') is null then raise exception 'F3 wallet address is required.'; end if;
    p_payment_method := 'f3_wallet';
  elsif p_payment_method = 'available_balance' then
    select coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (where ledger.status = 'due' and ledger.due_at <= now()), 0)
      - coalesce((select sum(request.amount) from public.withdrawal_requests request where request.member_id = member.id and request.status = 'pending'), 0)
      - coalesce((select sum(action.action_amount) from public.exit_actions action where action.member_id = member.id and action.status = 'pending' and action.payment_method = 'available_balance'), 0)
      - coalesce((select sum(request.amount) from public.timeline_requests request where request.member_id = member.id and request.status = 'pending' and request.payment_method = 'available_balance'), 0)
    into available_balance from public.reward_ledger ledger where ledger.member_id = member.id;
    if available_balance < rule.action_amount then raise exception 'Not enough balance.'; end if;
  else
    p_payment_method := 'gcash';
    if nullif(trim(p_gcash_name), '') is null or nullif(trim(p_gcash_number), '') is null or nullif(trim(p_reference_number), '') is null then raise exception 'GCash name, number, and reference number are required.'; end if;
  end if;
  insert into public.exit_actions(member_id, exit_number, action_type, action_amount, payment_method, f3_wallet, gcash_name, gcash_number, reference_number)
  values (member.id, rule.exit_number, rule.action_type, rule.action_amount, p_payment_method, nullif(trim(p_f3_wallet), ''), nullif(trim(p_gcash_name), ''), nullif(trim(p_gcash_number), ''), nullif(trim(p_reference_number), '')) returning * into created_request;
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (member.id, 'exit-request', member.full_name || ' requested Exit ' || rule.exit_number || '.', jsonb_build_object('requestId', created_request.id, 'exit', rule.exit_number, 'paymentMethod', p_payment_method));
  return to_jsonb(created_request);
end;
$$;
revoke all on function public.request_exit_action(smallint, text, text, text, text, text) from public, anon;
grant execute on function public.request_exit_action(smallint, text, text, text, text, text) to authenticated;
