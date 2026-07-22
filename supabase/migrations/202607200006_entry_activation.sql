-- Secure Entry activation request and administrator processing workflow.

create or replace function public.request_entry_activation(p_reference_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  normalized_reference text := upper(trim(p_reference_number));
  created_request public.upgrade_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile not found.'; end if;
  if caller.status = 'active' then raise exception 'Entry is already active.'; end if;
  if normalized_reference !~ '^[A-Z0-9-]{6,40}$' then raise exception 'Enter a valid GCash reference number.'; end if;
  if exists (select 1 from public.upgrade_requests where reference_number = normalized_reference) then
    raise exception 'This reference number is already in use.';
  end if;
  if exists (select 1 from public.upgrade_requests where member_id = caller.id and status = 'pending') then
    raise exception 'You already have a pending Entry request.';
  end if;

  insert into public.upgrade_requests (member_id, plan_id, amount, reference_number)
  values (caller.id, 'power3-passive', 1200, normalized_reference)
  returning * into created_request;

  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (caller.id, 'upgrade-request', caller.full_name || ' requested Entry activation.', jsonb_build_object('requestId', created_request.id));
  return to_jsonb(created_request);
end;
$$;

revoke all on function public.request_entry_activation(text) from public, anon;
grant execute on function public.request_entry_activation(text) to authenticated;

create or replace function public.get_my_entry_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'planId', request.plan_id,
    'amount', request.amount, 'referenceNumber', request.reference_number,
    'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  from public.upgrade_requests request where request.member_id = auth.uid();
$$;

revoke all on function public.get_my_entry_requests() from public, anon;
grant execute on function public.get_my_entry_requests() to authenticated;

create or replace function public.admin_get_entry_requests()
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
    'username', member.username, 'accountCode', member.account_code,
    'referenceNumber', request.reference_number, 'amount', request.amount,
    'status', request.status, 'createdAt', request.created_at,
    'sponsorId', sponsor.id, 'sponsorName', sponsor.full_name, 'sponsorCode', sponsor.account_code
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.upgrade_requests request
  join public.profiles member on member.id = request.member_id
  left join public.profiles sponsor on sponsor.id = member.sponsor_id;
  return result;
end;
$$;

revoke all on function public.admin_get_entry_requests() from public, anon;
grant execute on function public.admin_get_entry_requests() to authenticated;

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
    'accountCode', member.account_code, 'childrenCount', counts.occupied,
    'slotsLeft', 3 - counts.occupied
  ) order by member.full_name), '[]'::jsonb)
  into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  cross join lateral (
    select
      (select count(*) from public.matrix_positions child where child.parent_member_id = member.id) +
      (select count(*) from public.profiles referred where referred.sponsor_id = member.id
        and not exists (select 1 from public.matrix_positions placed where placed.member_id = referred.id)) as occupied
  ) counts
  where counts.occupied < 3;
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
  target_request public.upgrade_requests%rowtype;
  target_member public.profiles%rowtype;
  selected_parent uuid;
  occupied integer;
  approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target_request from public.upgrade_requests where id = p_request_id for update;
  if target_request.id is null or target_request.status <> 'pending' then raise exception 'Entry request is no longer pending.'; end if;
  select * into target_member from public.profiles where id = target_request.member_id for update;
  if target_member.status = 'active' then raise exception 'Member Entry is already active.'; end if;
  selected_parent := coalesce(target_member.sponsor_id, p_parent_member_id);

  if selected_parent is null then
    if exists (select 1 from public.matrix_positions where plan_id = target_request.plan_id and parent_member_id is null) then
      raise exception 'Select a matrix parent for this member.';
    end if;
  else
    if not exists (select 1 from public.matrix_positions where member_id = selected_parent and plan_id = target_request.plan_id) then
      raise exception 'The selected parent is not active in this matrix.';
    end if;
    select
      (select count(*) from public.matrix_positions where parent_member_id = selected_parent) +
      (select count(*) from public.profiles referred where referred.sponsor_id = selected_parent
        and referred.id <> target_member.id
        and not exists (select 1 from public.matrix_positions placed where placed.member_id = referred.id))
    into occupied;
    if occupied >= 3 then raise exception 'The selected parent has no open matrix positions.'; end if;
  end if;

  update public.profiles set status = 'active', approved_at = approval_time, cumulative_f3_tokens = 20
  where id = target_member.id;
  insert into public.matrix_positions (member_id, plan_id, parent_member_id, placed_at)
  values (target_member.id, target_request.plan_id, selected_parent, approval_time);
  update public.upgrade_requests set status = 'approved', approved_at = approval_time where id = target_request.id;

  insert into public.reward_ledger (member_id, source_type, source_label, amount, due_at, status, created_at)
  select target_member.id, 'entry', 'Entry Passive Income', 231,
    approval_time + month_number * interval '1 month', 'due', approval_time
  from generate_series(1, 3) as months(month_number);

  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'upgrade-approval', 'Approved Entry for ' || target_member.full_name,
    jsonb_build_object('requestId', target_request.id, 'memberId', target_member.id, 'parentMemberId', selected_parent));
  return jsonb_build_object('id', target_request.id, 'status', 'approved', 'memberId', target_member.id, 'parentMemberId', selected_parent);
end;
$$;

revoke all on function public.admin_approve_entry(uuid, uuid) from public, anon;
grant execute on function public.admin_approve_entry(uuid, uuid) to authenticated;

create or replace function public.admin_reject_entry(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.upgrade_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.upgrade_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Entry request is no longer pending.'; end if;
  update public.upgrade_requests set status = 'rejected', rejected_at = now() where id = target.id;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'upgrade-rejection', 'Rejected Entry activation request.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id));
  return jsonb_build_object('id', target.id, 'status', 'rejected');
end;
$$;

revoke all on function public.admin_reject_entry(uuid) from public, anon;
grant execute on function public.admin_reject_entry(uuid) to authenticated;
