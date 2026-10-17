-- Wallet transfers retain the existing exact-decimal ledger and member-level lock.
-- The client-generated key also serves as the shared ledger reference.
create function public.transfer_wallet_funds(
  p_from_account text, p_amount numeric, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  destination text;
  existing public.member_fund_ledger%rowtype;
  available numeric;
begin
  if member_id is null then
    raise exception 'Sign in to transfer funds.' using errcode = '42501';
  end if;
  if p_from_account not in ('main', 'investment') or p_from_account is null then
    raise exception 'Choose a valid source wallet.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000000
    or p_amount <> round(p_amount, 2) or p_idempotency_key is null then
    raise exception 'Enter a valid transfer amount.' using errcode = '22023';
  end if;
  destination := case when p_from_account = 'main' then 'investment' else 'main' end;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text, 0));

  select * into existing from public.member_fund_ledger
  where source_type = 'wallet_transfer' and source_id = p_idempotency_key
    and account = p_from_account;
  if existing.id is not null then
    if existing.member_id <> member_id or existing.amount <> -p_amount then
      raise exception 'This transfer reference was already used.' using errcode = '22023';
    end if;
    return jsonb_build_object('id', p_idempotency_key, 'amount', p_amount,
      'fromAccount', p_from_account, 'toAccount', destination,
      'mainAvailable', public.member_main_available(member_id),
      'investmentAvailable', public.member_investment_available(member_id));
  end if;
  if exists (select 1 from public.member_fund_ledger
    where source_type = 'wallet_transfer' and source_id = p_idempotency_key) then
    raise exception 'This transfer reference was already used.' using errcode = '22023';
  end if;

  available := case when p_from_account = 'main'
    then public.member_main_available(member_id)
    else public.member_investment_available(member_id) end;
  if available < p_amount then
    raise exception 'Available funds are not enough for this transfer.' using errcode = '22023';
  end if;
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values
    (member_id, p_from_account, -p_amount, 'wallet_transfer', p_idempotency_key,
      'Transfer to ' || initcap(destination) || ' Funds'),
    (member_id, destination, p_amount, 'wallet_transfer', p_idempotency_key,
      'Transfer from ' || initcap(p_from_account) || ' Funds');
  return jsonb_build_object('id', p_idempotency_key, 'amount', p_amount,
    'fromAccount', p_from_account, 'toAccount', destination,
    'mainAvailable', public.member_main_available(member_id),
    'investmentAvailable', public.member_investment_available(member_id));
end;
$$;

revoke all on function public.transfer_wallet_funds(text,numeric,uuid) from public, anon;
grant execute on function public.transfer_wallet_funds(text,numeric,uuid) to authenticated;

-- The earlier endpoints have no retry key; prevent new clients from bypassing it.
revoke execute on function public.transfer_main_to_investment(numeric),
  public.transfer_investment_to_main(numeric) from authenticated;

create or replace function public.get_my_member_funds_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'mainBalance', public.member_fund_balance(auth.uid(), 'main'),
    'mainAvailable', public.member_main_available(auth.uid()),
    'investmentBalance', public.member_fund_balance(auth.uid(), 'investment'),
    'investmentAvailable', public.member_investment_available(auth.uid()),
    'investmentLocked', coalesce((select sum(principal)
      from public.budget_investment_contracts where member_id = auth.uid() and unlocks_at > now()), 0),
    'investmentPending', coalesce((select sum(amount)
      from public.budget_investment_requests where member_id = auth.uid() and status = 'pending'), 0),
    'matrixBalances', (select coalesce(jsonb_object_agg(plan_id, available), '{}'::jsonb)
      from (select plan_id, sum(amount - withdrawn_amount) as available
        from public.reward_ledger
        where member_id = auth.uid() and status = 'due' and due_at <= now()
        group by plan_id
        union all
        select 'budget-plan'::text, coalesce(sum(amount - transferred_amount), 0)
        from public.budget_plan_passive_income
        where member_id = auth.uid() and due_at <= now()) balances),
    'topups', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', topup.id, 'amount', topup.amount, 'referenceNumber', topup.reference_number,
      'methodName', topup.payment_method_snapshot ->> 'methodName',
      'status', topup.status, 'createdAt', topup.created_at, 'reviewedAt', topup.reviewed_at
    ) order by topup.created_at desc), '[]'::jsonb)
      from public.member_fund_topups topup where topup.member_id = auth.uid()),
    'withdrawals', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', request.id, 'code', request.withdrawal_code, 'amount', request.amount,
      'status', request.status, 'createdAt', request.created_at, 'approvedAt', request.approved_at
    ) order by request.created_at desc), '[]'::jsonb)
      from public.withdrawal_requests request
      where request.member_id = auth.uid() and request.fund_source = 'main'),
    'investments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', contract.id, 'rank', contract.rank_number, 'rankName', rule.rank_name,
      'principal', contract.principal, 'months', contract.months,
      'startedAt', contract.started_at, 'unlocksAt', contract.unlocks_at
    ) order by contract.started_at desc), '[]'::jsonb)
      from public.budget_investment_contracts contract
      join public.budget_plan_rank_rules rule on rule.rank_number = contract.rank_number
      where contract.member_id = auth.uid()),
    'investmentRequests', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', request.id, 'rankName', rule.rank_name, 'amount', request.amount,
      'status', request.status, 'createdAt', request.created_at, 'reviewedAt', request.reviewed_at
    ) order by request.created_at desc), '[]'::jsonb)
      from public.budget_investment_requests request
      join public.budget_plan_rank_rules rule on rule.rank_number = request.rank_number
      where request.member_id = auth.uid()),
    'fundActivity', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', fund.id, 'account', fund.account, 'amount', fund.amount,
      'sourceType', fund.source_type, 'sourceId', fund.source_id,
      'note', fund.note, 'availableAt', fund.available_at, 'createdAt', fund.created_at
    ) order by fund.created_at desc), '[]'::jsonb)
      from (select * from public.member_fund_ledger where member_id = auth.uid()
        order by created_at desc limit 200) fund)
  );
$$;
