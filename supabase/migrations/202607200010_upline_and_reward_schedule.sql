-- Add privacy-safe upline traversal and make the first passive installment due
-- one full month after approval. Already withdrawn ledger amounts are untouched.

create or replace function public.get_matrix_level(p_root_member_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  root_id uuid := coalesce(p_root_member_id, auth.uid());
  result jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;

  if not public.is_admin()
    and not exists (
      with recursive descendants(member_id) as (
        select caller_id union all
        select child.member_id from public.matrix_positions child
        join descendants parent on child.parent_member_id = parent.member_id
      ) select 1 from descendants where member_id = root_id
    )
    and not exists (
      with recursive ancestors(member_id) as (
        select caller_id union all
        select position.parent_member_id from public.matrix_positions position
        join ancestors child on position.member_id = child.member_id
        where position.parent_member_id is not null
      ) select 1 from ancestors where member_id = root_id
    ) then
    raise exception 'You may only view your own matrix line.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', root_profile.id, 'fullName', root_profile.full_name,
    'username', root_profile.username, 'accountCode', root_profile.account_code,
    'planId', root_position.plan_id, 'matrixStage', public.matrix_stage_for(root_profile.id),
    'parent', case when parent_profile.id is null then null else jsonb_build_object(
      'id', parent_profile.id, 'fullName', parent_profile.full_name,
      'username', parent_profile.username, 'accountCode', parent_profile.account_code
    ) end,
    'children', coalesce((
      select jsonb_agg(child_record.data order by child_record.sort_time, child_record.sort_name)
      from (
        select child_position.placed_at as sort_time, child_profile.full_name as sort_name,
          jsonb_build_object(
            'id', child_profile.id, 'fullName', child_profile.full_name,
            'username', child_profile.username, 'accountCode', child_profile.account_code,
            'matrixStage', public.matrix_stage_for(child_profile.id), 'isReferralPending', false,
            'canTraverse', public.is_admin() or child_profile.id = caller_id or exists (
              with recursive descendants(member_id) as (
                select caller_id union all
                select descendant.member_id from public.matrix_positions descendant
                join descendants ancestor on descendant.parent_member_id = ancestor.member_id
              ) select 1 from descendants where member_id = child_profile.id
            ) or exists (
              with recursive ancestors(member_id) as (
                select caller_id union all
                select position.parent_member_id from public.matrix_positions position
                join ancestors child on position.member_id = child.member_id
                where position.parent_member_id is not null
              ) select 1 from ancestors where member_id = child_profile.id
            )
          ) as data
        from public.matrix_positions child_position
        join public.profiles child_profile on child_profile.id = child_position.member_id
        where child_position.parent_member_id = root_profile.id and child_position.plan_id = root_position.plan_id
        union all
        select referred.created_at, referred.full_name,
          jsonb_build_object(
            'id', referred.id, 'fullName', referred.full_name, 'username', referred.username,
            'accountCode', referred.account_code,
            'matrixStage', jsonb_build_object('label', 'Registered', 'status', 'registered', 'exit', 0),
            'isReferralPending', true, 'canTraverse', false
          )
        from public.profiles referred
        where referred.sponsor_id = root_profile.id
          and not exists (select 1 from public.matrix_positions positioned where positioned.member_id = referred.id)
      ) child_record
    ), '[]'::jsonb)
  ) into result
  from public.profiles root_profile
  join public.matrix_positions root_position on root_position.member_id = root_profile.id
  left join public.matrix_positions current_position on current_position.member_id = root_profile.id
  left join public.profiles parent_profile on parent_profile.id = current_position.parent_member_id
  where root_profile.id = root_id;

  if result is null then raise exception 'The requested member is not placed in the matrix.'; end if;
  return result;
end;
$$;

revoke all on function public.get_matrix_level(uuid) from public, anon;
grant execute on function public.get_matrix_level(uuid) to authenticated;

-- Shift only untouched rows that still exactly match the old immediate-first-payment schedule.
with scheduled as (
  select ledger.id, ledger.due_at, ledger.withdrawn_amount,
    row_number() over (
      partition by ledger.member_id, ledger.source_type, ledger.exit_number
      order by ledger.due_at, ledger.created_at, ledger.id
    ) as installment,
    case when ledger.source_type = 'entry' then profile.approved_at else action.approved_at end as approval_time
  from public.reward_ledger ledger
  join public.profiles profile on profile.id = ledger.member_id
  left join public.exit_actions action on action.member_id = ledger.member_id
    and action.exit_number = ledger.exit_number and action.status = 'approved'
  where ledger.source_type in ('entry', 'exit')
)
update public.reward_ledger ledger
set due_at = ledger.due_at + interval '1 month'
from scheduled
where ledger.id = scheduled.id and scheduled.withdrawn_amount = 0
  and scheduled.approval_time is not null
  and scheduled.due_at = scheduled.approval_time + (scheduled.installment - 1) * interval '1 month';

create or replace function public.admin_approve_entry(p_request_id uuid, p_parent_member_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    if exists (select 1 from public.matrix_positions where plan_id = target_request.plan_id and parent_member_id is null) then raise exception 'Select a matrix parent for this member.'; end if;
  else
    if not exists (select 1 from public.matrix_positions where member_id = selected_parent and plan_id = target_request.plan_id) then raise exception 'The selected parent is not active in this matrix.'; end if;
    select (select count(*) from public.matrix_positions where parent_member_id = selected_parent) +
      (select count(*) from public.profiles referred where referred.sponsor_id = selected_parent and referred.id <> target_member.id and not exists (select 1 from public.matrix_positions placed where placed.member_id = referred.id)) into occupied;
    if occupied >= 3 then raise exception 'The selected parent has no open matrix positions.'; end if;
  end if;
  update public.profiles set status = 'active', approved_at = approval_time, cumulative_f3_tokens = 20 where id = target_member.id;
  insert into public.matrix_positions (member_id, plan_id, parent_member_id, placed_at) values (target_member.id, target_request.plan_id, selected_parent, approval_time);
  update public.upgrade_requests set status = 'approved', approved_at = approval_time where id = target_request.id;
  insert into public.reward_ledger (member_id, source_type, source_label, amount, due_at, status, created_at)
  select target_member.id, 'entry', 'Entry Passive Income', 231, approval_time + month_number * interval '1 month', 'due', approval_time from generate_series(1, 3) as months(month_number);
  insert into public.activity_logs (actor_id, event_type, message, metadata) values (auth.uid(), 'upgrade-approval', 'Approved Entry for ' || target_member.full_name, jsonb_build_object('requestId', target_request.id, 'memberId', target_member.id, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target_request.id, 'status', 'approved', 'memberId', target_member.id, 'parentMemberId', selected_parent);
end; $$;
revoke all on function public.admin_approve_entry(uuid, uuid) from public, anon;
grant execute on function public.admin_approve_entry(uuid, uuid) to authenticated;

create or replace function public.admin_approve_exit(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.exit_actions%rowtype; rule public.matrix_exit_rules%rowtype;
  member_name text; approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.exit_actions where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Exit request is no longer pending.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = target.exit_number;
  select full_name into member_name from public.profiles where id = target.member_id;
  update public.exit_actions set status = 'approved', approved_at = approval_time where id = target.id;
  if not exists (select 1 from public.reward_ledger ledger where ledger.member_id = target.member_id and ledger.source_type = 'exit' and ledger.exit_number = target.exit_number) then
    insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
    select target.member_id, 'exit', 'Exit ' || target.exit_number || ' Passive Income', target.exit_number, rule.passive_income,
      approval_time + months.month_number * interval '1 month', 'due', approval_time from generate_series(1, rule.passive_months) as months(month_number);
  end if;
  insert into public.activity_logs (actor_id, event_type, message, metadata) values (auth.uid(), 'exit-approval', 'Approved Exit ' || target.exit_number || ' for ' || member_name || '.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'exit', target.exit_number));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'exit', target.exit_number);
end; $$;
revoke all on function public.admin_approve_exit(uuid) from public, anon;
grant execute on function public.admin_approve_exit(uuid) to authenticated;
