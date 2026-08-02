-- Automatically place approved Entry members into the next open 3-wide slot.
-- Admins can still choose a starting parent; if omitted, the sponsor is used,
-- then the Main Matrix root is used for members who registered without an upline.

create or replace function public.find_open_main_matrix_parent(p_start_member_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  root_member_id uuid;
  selected_parent uuid;
begin
  if p_start_member_id is not null then
    if not exists (
      select 1 from public.matrix_positions position
      where position.member_id = p_start_member_id
        and position.plan_id = 'power3-passive'
    ) then
      raise exception 'The selected parent is not active in this matrix.';
    end if;
    root_member_id := p_start_member_id;
  else
    select position.member_id into root_member_id
    from public.matrix_positions position
    where position.plan_id = 'power3-passive'
      and position.parent_member_id is null
    order by position.placed_at, position.id
    limit 1;

    if root_member_id is null then
      return null;
    end if;
  end if;

  with recursive visible_positions(member_id, depth, placed_at) as (
    select position.member_id, 0, position.placed_at
    from public.matrix_positions position
    where position.member_id = root_member_id
      and position.plan_id = 'power3-passive'
    union all
    select child.member_id, parent.depth + 1, child.placed_at
    from public.matrix_positions child
    join visible_positions parent on child.parent_member_id = parent.member_id
    where child.plan_id = 'power3-passive'
  )
  select candidate.member_id into selected_parent
  from visible_positions candidate
  where (
    select count(*)
    from public.matrix_positions child
    where child.parent_member_id = candidate.member_id
      and child.plan_id = 'power3-passive'
  ) < 3
  order by candidate.depth, candidate.placed_at, candidate.member_id
  limit 1;

  if selected_parent is null then
    raise exception 'No open matrix positions are available under the selected line.';
  end if;

  return selected_parent;
end;
$$;

revoke all on function public.find_open_main_matrix_parent(uuid) from public, anon;

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
    'accountCode', member.account_code, 'childrenCount', counts.children_count, 'slotsLeft', 3 - counts.children_count
  ) order by member.full_name), '[]'::jsonb) into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  cross join lateral (
    select count(*) as children_count
    from public.matrix_positions child
    where child.parent_member_id = member.id
      and child.plan_id = 'power3-passive'
  ) counts
  where position.plan_id = 'power3-passive'
    and counts.children_count < 3;
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
  placement_start uuid; selected_parent uuid; approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  -- Serialize placement so concurrent approvals cannot choose the same open slot.
  perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

  select * into target_request from public.upgrade_requests where id = p_request_id for update;
  if target_request.id is null or target_request.status <> 'pending' then raise exception 'Entry request is no longer pending.'; end if;
  if target_request.plan_id <> 'power3-passive' then raise exception 'Unsupported Entry plan.'; end if;

  select * into target_member from public.profiles where id = target_request.member_id for update;
  if target_member.status = 'active' then raise exception 'Member Entry is already active.'; end if;
  if exists (select 1 from public.matrix_positions where member_id = target_member.id and plan_id = 'power3-passive') then raise exception 'Member is already placed in this matrix.'; end if;

  placement_start := coalesce(p_parent_member_id, target_member.sponsor_id);
  selected_parent := public.find_open_main_matrix_parent(placement_start);

  update public.profiles set status = 'active', approved_at = approval_time, cumulative_f3_tokens = 20 where id = target_member.id;
  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (target_member.id, 'power3-passive', selected_parent, approval_time);
  update public.upgrade_requests set status = 'approved', approved_at = approval_time where id = target_request.id;
  insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
  select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, approval_time + month_number * interval '1 month', 'due', approval_time
  from generate_series(1, 3) as months(month_number);
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'upgrade-approval', 'Approved Entry for ' || target_member.full_name, jsonb_build_object('requestId', target_request.id, 'memberId', target_member.id, 'placementStartMemberId', placement_start, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target_request.id, 'status', 'approved', 'memberId', target_member.id, 'placementStartMemberId', placement_start, 'parentMemberId', selected_parent);
end;
$$;
revoke all on function public.admin_approve_entry(uuid, uuid) from public, anon;
grant execute on function public.admin_approve_entry(uuid, uuid) to authenticated;
