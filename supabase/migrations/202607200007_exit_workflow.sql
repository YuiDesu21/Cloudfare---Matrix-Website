-- Secure sequential Exit request and administrator processing workflow.

create or replace function public.request_exit_action(p_exit_number smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles%rowtype;
  rule public.matrix_exit_rules%rowtype;
  qualified_count integer;
  created_request public.exit_actions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.status <> 'active' then raise exception 'Active Entry is required.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = p_exit_number;
  if rule.exit_number is null then raise exception 'Exit rule not found.'; end if;

  if p_exit_number > 1 and not exists (
    select 1 from public.exit_actions previous
    where previous.member_id = member.id and previous.exit_number = p_exit_number - 1 and previous.status = 'approved'
  ) then raise exception 'The previous Exit must be approved first.'; end if;

  select count(*) into qualified_count
  from public.matrix_positions child
  where child.parent_member_id = member.id
    and coalesce((
      select max(action.exit_number) from public.exit_actions action
      where action.member_id = child.member_id and action.status = 'approved'
    ), 0) >= rule.required_downline_exit;
  if qualified_count < 3 then raise exception 'Three qualified direct matrix downlines are required.'; end if;

  if exists (
    select 1 from public.exit_actions action where action.member_id = member.id
      and action.exit_number = p_exit_number and action.status in ('pending', 'approved')
  ) then raise exception 'An active request already exists for this Exit.'; end if;

  insert into public.exit_actions (member_id, exit_number, action_type, action_amount)
  values (member.id, rule.exit_number, rule.action_type, rule.action_amount)
  returning * into created_request;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (member.id, 'exit-request', member.full_name || ' requested Exit ' || rule.exit_number || '.',
    jsonb_build_object('requestId', created_request.id, 'exit', rule.exit_number));
  return to_jsonb(created_request);
end;
$$;

revoke all on function public.request_exit_action(smallint) from public, anon;
grant execute on function public.request_exit_action(smallint) to authenticated;

create or replace function public.admin_get_exit_requests()
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
    'id', action.id, 'memberId', action.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code,
    'exit', action.exit_number, 'actionType', action.action_type,
    'actionLabel', rule.action_label, 'actionAmount', action.action_amount,
    'status', action.status, 'createdAt', action.created_at,
    'approvedAt', action.approved_at, 'rejectedAt', action.rejected_at
  ) order by action.created_at desc), '[]'::jsonb)
  into result
  from public.exit_actions action
  join public.profiles member on member.id = action.member_id
  join public.matrix_exit_rules rule on rule.exit_number = action.exit_number;
  return result;
end;
$$;

revoke all on function public.admin_get_exit_requests() from public, anon;
grant execute on function public.admin_get_exit_requests() to authenticated;

create or replace function public.admin_approve_exit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.exit_actions%rowtype;
  rule public.matrix_exit_rules%rowtype;
  member_name text;
  approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.exit_actions where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Exit request is no longer pending.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = target.exit_number;
  select full_name into member_name from public.profiles where id = target.member_id;
  update public.exit_actions set status = 'approved', approved_at = approval_time where id = target.id;

  if not exists (
    select 1 from public.reward_ledger ledger
    where ledger.member_id = target.member_id and ledger.source_type = 'exit' and ledger.exit_number = target.exit_number
  ) then
    insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
    select target.member_id, 'exit', 'Exit ' || target.exit_number || ' Passive Income', target.exit_number,
      rule.passive_income, approval_time + months.month_number * interval '1 month', 'due', approval_time
    from generate_series(1, rule.passive_months) as months(month_number);
  end if;

  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'exit-approval', 'Approved Exit ' || target.exit_number || ' for ' || member_name || '.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'exit', target.exit_number));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'exit', target.exit_number);
end;
$$;

revoke all on function public.admin_approve_exit(uuid) from public, anon;
grant execute on function public.admin_approve_exit(uuid) to authenticated;

create or replace function public.admin_reject_exit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.exit_actions%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.exit_actions where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Exit request is no longer pending.'; end if;
  update public.exit_actions set status = 'rejected', rejected_at = now() where id = target.id;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'exit-rejection', 'Rejected Exit ' || target.exit_number || ' request.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'exit', target.exit_number));
  return jsonb_build_object('id', target.id, 'status', 'rejected');
end;
$$;

revoke all on function public.admin_reject_exit(uuid) from public, anon;
grant execute on function public.admin_reject_exit(uuid) to authenticated;
