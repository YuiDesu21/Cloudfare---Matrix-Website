alter table public.exit_actions
  add column if not exists payment_method text,
  add column if not exists f3_wallet text,
  add column if not exists gcash_name text,
  add column if not exists gcash_number text,
  add column if not exists reference_number text;

drop function if exists public.request_exit_action(smallint);
create function public.request_exit_action(
  p_exit_number smallint,
  p_payment_method text,
  p_f3_wallet text default '',
  p_gcash_name text default '',
  p_gcash_number text default '',
  p_reference_number text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles%rowtype; rule public.matrix_exit_rules%rowtype;
  qualified_count integer; created_request public.exit_actions%rowtype; available_balance numeric;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.status <> 'active' then raise exception 'Active Entry is required.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = p_exit_number;
  if rule.exit_number is null then raise exception 'Exit rule not found.'; end if;
  if p_exit_number > 1 and not exists (select 1 from public.exit_actions previous where previous.member_id = member.id and previous.exit_number = p_exit_number - 1 and previous.status = 'approved') then raise exception 'The previous Exit must be approved first.'; end if;
  select count(*) into qualified_count from public.matrix_positions child where child.parent_member_id = member.id and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit;
  if qualified_count < 3 then raise exception 'Three qualified direct matrix downlines are required.'; end if;
  if exists (select 1 from public.exit_actions action where action.member_id = member.id and action.exit_number = p_exit_number and action.status in ('pending', 'approved')) then raise exception 'An active request already exists for this Exit.'; end if;

  if rule.action_type = 'reinvest' then
    if nullif(trim(p_f3_wallet), '') is null then raise exception 'F3 wallet address is required.'; end if;
    p_payment_method := 'f3_wallet';
  elsif p_payment_method = 'available_balance' then
    select coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (where ledger.status = 'due' and ledger.due_at <= now()), 0)
      - coalesce((select sum(request.amount) from public.withdrawal_requests request where request.member_id = member.id and request.status = 'pending'), 0)
      - coalesce((select sum(action.action_amount) from public.exit_actions action where action.member_id = member.id and action.status = 'pending' and action.payment_method = 'available_balance'), 0)
    into available_balance from public.reward_ledger ledger where ledger.member_id = member.id;
    if available_balance < rule.action_amount then raise exception 'Not enough balance'; end if;
  else
    p_payment_method := 'gcash';
    if nullif(trim(p_gcash_name), '') is null or nullif(trim(p_gcash_number), '') is null or nullif(trim(p_reference_number), '') is null then raise exception 'GCash name, number, and reference number are required.'; end if;
  end if;

  insert into public.exit_actions (member_id, exit_number, action_type, action_amount, payment_method, f3_wallet, gcash_name, gcash_number, reference_number)
  values (member.id, rule.exit_number, rule.action_type, rule.action_amount, p_payment_method, nullif(trim(p_f3_wallet), ''), nullif(trim(p_gcash_name), ''), nullif(trim(p_gcash_number), ''), nullif(trim(p_reference_number), '')) returning * into created_request;
  insert into public.activity_logs (actor_id, event_type, message, metadata) values (member.id, 'exit-request', member.full_name || ' requested Exit ' || rule.exit_number || '.', jsonb_build_object('requestId', created_request.id, 'exit', rule.exit_number, 'paymentMethod', p_payment_method));
  return to_jsonb(created_request);
end; $$;
revoke all on function public.request_exit_action(smallint, text, text, text, text, text) from public, anon;
grant execute on function public.request_exit_action(smallint, text, text, text, text, text) to authenticated;

create or replace function public.admin_get_exit_requests() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', action.id, 'memberId', action.member_id, 'fullName', member.full_name, 'username', member.username, 'accountCode', member.account_code,
    'exit', action.exit_number, 'actionType', action.action_type, 'actionLabel', rule.action_label, 'actionAmount', action.action_amount,
    'paymentMethod', action.payment_method, 'f3Wallet', action.f3_wallet, 'gcashName', action.gcash_name, 'gcashNumber', action.gcash_number,
    'referenceNumber', action.reference_number, 'status', action.status, 'createdAt', action.created_at, 'approvedAt', action.approved_at, 'rejectedAt', action.rejected_at
  ) order by action.created_at desc), '[]'::jsonb) into result
  from public.exit_actions action join public.profiles member on member.id = action.member_id join public.matrix_exit_rules rule on rule.exit_number = action.exit_number;
  return result;
end; $$;
revoke all on function public.admin_get_exit_requests() from public, anon;
grant execute on function public.admin_get_exit_requests() to authenticated;

create or replace function public.admin_approve_exit(p_request_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.exit_actions%rowtype; rule public.matrix_exit_rules%rowtype; ledger_row record;
  member_name text; approval_time timestamptz := now(); remaining numeric; ledger_available numeric; reserved_elsewhere numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.exit_actions where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Exit request is no longer pending.'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = target.exit_number;
  select full_name into member_name from public.profiles where id = target.member_id;
  if target.payment_method = 'available_balance' then
    select coalesce(sum(greatest(amount - withdrawn_amount, 0)) filter (where status = 'due' and due_at <= now()), 0) into ledger_available from public.reward_ledger where member_id = target.member_id;
    select coalesce((select sum(amount) from public.withdrawal_requests where member_id = target.member_id and status = 'pending'), 0)
      + coalesce((select sum(action_amount) from public.exit_actions where member_id = target.member_id and status = 'pending' and payment_method = 'available_balance' and id <> target.id), 0)
      into reserved_elsewhere;
    if ledger_available - reserved_elsewhere < target.action_amount then raise exception 'Not enough balance'; end if;
    remaining := target.action_amount;
    for ledger_row in select id, amount, withdrawn_amount from public.reward_ledger where member_id = target.member_id and status = 'due' and due_at <= now() order by due_at for update loop
      exit when remaining <= 0;
      ledger_available := least(greatest(ledger_row.amount - ledger_row.withdrawn_amount, 0), remaining);
      if ledger_available > 0 then
        update public.reward_ledger set withdrawn_amount = withdrawn_amount + ledger_available, status = case when withdrawn_amount + ledger_available >= amount then 'paid'::public.ledger_status else status end where id = ledger_row.id;
        remaining := remaining - ledger_available;
      end if;
    end loop;
  end if;
  update public.exit_actions set status = 'approved', approved_at = approval_time where id = target.id;
  if not exists (select 1 from public.reward_ledger ledger where ledger.member_id = target.member_id and ledger.source_type = 'exit' and ledger.exit_number = target.exit_number) then
    insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
    select target.member_id, 'exit', 'Exit ' || target.exit_number || ' Passive Income', target.exit_number, rule.passive_income, approval_time + months.month_number * interval '1 month', 'due', approval_time from generate_series(1, rule.passive_months) as months(month_number);
  end if;
  insert into public.activity_logs (actor_id, event_type, message, metadata) values (auth.uid(), 'exit-approval', 'Approved Exit ' || target.exit_number || ' for ' || member_name || '.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'exit', target.exit_number));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'exit', target.exit_number);
end; $$;
revoke all on function public.admin_approve_exit(uuid) from public, anon;
grant execute on function public.admin_approve_exit(uuid) to authenticated;
