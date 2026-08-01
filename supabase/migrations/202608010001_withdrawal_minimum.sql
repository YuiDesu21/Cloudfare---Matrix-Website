-- Enforce a PHP 1,000 minimum withdrawal amount in the production RPC.

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
  reserved_withdrawals numeric;
  reserved_exit_buys numeric;
  available_balance numeric;
  created_request public.withdrawal_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into member from public.profiles where id = auth.uid();
  if member.id is null or member.status <> 'active' then raise exception 'Active Entry is required.'; end if;
  if p_amount is null or p_amount < 1000 then raise exception 'Withdrawal amount must be at least PHP 1,000.'; end if;
  if trim(p_account_name) = '' then raise exception 'GCash account name is required.'; end if;
  if normalized_number !~ '^([+]?63|0)9[0-9]{9}$' then raise exception 'Enter a valid Philippine mobile number.'; end if;

  select coalesce(sum(greatest(amount - withdrawn_amount, 0)), 0) into due_balance
  from public.reward_ledger where member_id = member.id and status = 'due' and due_at <= now();
  select coalesce(sum(amount), 0) into reserved_withdrawals
  from public.withdrawal_requests where member_id = member.id and status = 'pending';
  select coalesce(sum(action_amount), 0) into reserved_exit_buys
  from public.exit_actions
  where member_id = member.id and status = 'pending' and payment_method = 'available_balance';
  available_balance := greatest(due_balance - reserved_withdrawals - reserved_exit_buys, 0);
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
