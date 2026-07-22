-- Secure balance reservation and GCash withdrawal processing.

create or replace function public.request_withdrawal(
  p_amount numeric,
  p_account_name text,
  p_gcash_number text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles%rowtype;
  normalized_number text := regexp_replace(trim(p_gcash_number), '[ -]', '', 'g');
  due_balance numeric;
  reserved_balance numeric;
  available_balance numeric;
  created_request public.withdrawal_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into member from public.profiles where id = auth.uid();
  if member.id is null or member.status <> 'active' then raise exception 'Active Entry is required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Withdrawal amount must be greater than zero.'; end if;
  if trim(p_account_name) = '' then raise exception 'GCash account name is required.'; end if;
  if normalized_number !~ '^([+]?63|0)9[0-9]{9}$' then raise exception 'Enter a valid Philippine mobile number.'; end if;

  select coalesce(sum(greatest(amount - withdrawn_amount, 0)), 0) into due_balance
  from public.reward_ledger where member_id = member.id and status = 'due' and due_at <= now();
  select coalesce(sum(amount), 0) into reserved_balance
  from public.withdrawal_requests where member_id = member.id and status = 'pending';
  available_balance := greatest(due_balance - reserved_balance, 0);
  if p_amount > available_balance then raise exception 'Withdrawal amount exceeds the available balance.'; end if;

  insert into public.withdrawal_requests (
    member_id, withdrawal_code, amount, payout_method, payout_details,
    account_name, gcash_number, origins
  ) values (
    member.id,
    'WD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    p_amount, 'GCash', left(coalesce(p_notes, ''), 240), trim(p_account_name), normalized_number,
    jsonb_build_array(jsonb_build_object('sourceLabel', 'Available Passive Income', 'amount', p_amount))
  ) returning * into created_request;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (member.id, 'withdrawal-request', member.full_name || ' requested a PHP ' || p_amount || ' withdrawal.',
    jsonb_build_object('requestId', created_request.id, 'withdrawalCode', created_request.withdrawal_code));
  return to_jsonb(created_request);
end;
$$;

revoke all on function public.request_withdrawal(numeric, text, text, text) from public, anon;
grant execute on function public.request_withdrawal(numeric, text, text, text) to authenticated;

create or replace function public.get_my_withdrawals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'withdrawalCode', request.withdrawal_code,
    'amount', request.amount, 'payoutMethod', request.payout_method,
    'payoutDetails', request.payout_details, 'accountName', request.account_name,
    'gcashNumber', request.gcash_number, 'origins', request.origins,
    'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  from public.withdrawal_requests request where request.member_id = auth.uid();
$$;

revoke all on function public.get_my_withdrawals() from public, anon;
grant execute on function public.get_my_withdrawals() to authenticated;

create or replace function public.admin_get_withdrawals()
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
    'withdrawalCode', request.withdrawal_code, 'amount', request.amount,
    'accountName', request.account_name, 'gcashNumber', request.gcash_number,
    'payoutDetails', request.payout_details, 'status', request.status,
    'createdAt', request.created_at, 'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.withdrawal_requests request
  join public.profiles member on member.id = request.member_id;
  return result;
end;
$$;

revoke all on function public.admin_get_withdrawals() from public, anon;
grant execute on function public.admin_get_withdrawals() to authenticated;

create or replace function public.admin_approve_withdrawal(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.withdrawal_requests%rowtype;
  ledger record;
  remaining numeric;
  available numeric;
  applied numeric;
  approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.withdrawal_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Withdrawal is no longer pending.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.member_id::text, 0));
  remaining := target.amount;
  for ledger in
    select * from public.reward_ledger
    where member_id = target.member_id and status = 'due' and due_at <= approval_time
    order by due_at, created_at for update
  loop
    exit when remaining <= 0;
    available := greatest(ledger.amount - ledger.withdrawn_amount, 0);
    applied := least(available, remaining);
    if applied > 0 then
      update public.reward_ledger set
        withdrawn_amount = withdrawn_amount + applied,
        status = case when withdrawn_amount + applied >= amount then 'paid'::public.ledger_status else status end,
        paid_withdrawal_id = case when withdrawn_amount + applied >= amount then target.id else paid_withdrawal_id end,
        paid_at = case when withdrawn_amount + applied >= amount then approval_time else paid_at end
      where id = ledger.id;
      remaining := remaining - applied;
    end if;
  end loop;
  if remaining > 0 then raise exception 'The member no longer has enough due balance for this withdrawal.'; end if;
  update public.withdrawal_requests set status = 'approved', approved_at = approval_time where id = target.id;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'withdrawal-approval', 'Approved withdrawal ' || target.withdrawal_code || '.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'amount', target.amount));
  return jsonb_build_object('id', target.id, 'status', 'approved');
end;
$$;

revoke all on function public.admin_approve_withdrawal(uuid) from public, anon;
grant execute on function public.admin_approve_withdrawal(uuid) to authenticated;

create or replace function public.admin_reject_withdrawal(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.withdrawal_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.withdrawal_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Withdrawal is no longer pending.'; end if;
  update public.withdrawal_requests set status = 'rejected', rejected_at = now() where id = target.id;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'withdrawal-rejection', 'Rejected withdrawal ' || target.withdrawal_code || '.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'amount', target.amount));
  return jsonb_build_object('id', target.id, 'status', 'rejected');
end;
$$;

revoke all on function public.admin_reject_withdrawal(uuid) from public, anon;
grant execute on function public.admin_reject_withdrawal(uuid) to authenticated;
