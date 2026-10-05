alter table public.withdrawal_requests
  add column fund_source text not null default 'legacy'
  check (fund_source in ('legacy', 'main'));

create function public.member_main_available(p_member_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select greatest(public.member_fund_balance(p_member_id, 'main')
    - coalesce((select sum(amount) from public.withdrawal_requests
      where member_id = p_member_id and fund_source = 'main' and status = 'pending'), 0), 0);
$$;

create or replace function public.transfer_main_to_investment(p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare transfer_id uuid := extensions.gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Sign in to transfer funds.' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid transfer amount.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if public.member_main_available(auth.uid()) < p_amount then
    raise exception 'Available Main Funds are not enough.' using errcode = '22023';
  end if;
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values
    (auth.uid(), 'main', -p_amount, 'main_to_investment', transfer_id, 'Transfer to Investment Funds'),
    (auth.uid(), 'investment', p_amount, 'main_to_investment', transfer_id, 'Transfer from Main Funds');
  return jsonb_build_object('id', transfer_id, 'amount', p_amount);
end;
$$;

create or replace function public.request_withdrawal(
  p_amount numeric, p_account_name text, p_gcash_number text, p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  normalized_number text := regexp_replace(trim(coalesce(p_gcash_number, '')), '[ -]', '', 'g');
  created_request public.withdrawal_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw.' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 500 or p_amount <> round(p_amount, 2) then
    raise exception 'Withdrawal amount must be at least PHP 500.' using errcode = '22023';
  end if;
  if trim(coalesce(p_account_name, '')) = '' then
    raise exception 'GCash account name is required.' using errcode = '22023';
  end if;
  if normalized_number !~ '^([+]?63|0)9[0-9]{9}$' then
    raise exception 'Enter a valid Philippine mobile number.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if public.member_main_available(auth.uid()) < p_amount then
    raise exception 'Available Main Funds are not enough.' using errcode = '22023';
  end if;
  insert into public.withdrawal_requests
    (member_id, withdrawal_code, amount, payout_method, payout_details,
     account_name, gcash_number, origins, fund_source)
  values (auth.uid(), 'WD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    p_amount, 'GCash', left(coalesce(p_notes, ''), 240), trim(p_account_name), normalized_number,
    jsonb_build_array(jsonb_build_object('sourceLabel', 'Main Funds', 'amount', p_amount)), 'main')
  returning * into created_request;
  return to_jsonb(created_request);
end;
$$;

create or replace function public.admin_approve_withdrawal(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  target public.withdrawal_requests%rowtype;
  ledger public.reward_ledger%rowtype;
  remaining numeric;
  available numeric;
  applied numeric;
  approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.withdrawal_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then
    raise exception 'Withdrawal is no longer pending.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target.member_id::text, 0));
  if target.fund_source = 'main' then
    if public.member_fund_balance(target.member_id, 'main') < target.amount then
      raise exception 'The member no longer has enough Main Funds.' using errcode = '22023';
    end if;
    insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
    values (target.member_id, 'main', -target.amount, 'main_withdrawal', target.id,
      'Approved withdrawal ' || target.withdrawal_code);
  else
    remaining := target.amount;
    for ledger in select * from public.reward_ledger
      where member_id = target.member_id and status = 'due' and due_at <= approval_time
      order by due_at, created_at for update loop
      exit when remaining <= 0;
      available := greatest(ledger.amount - ledger.withdrawn_amount, 0);
      applied := least(available, remaining);
      if applied > 0 then
        update public.reward_ledger
        set withdrawn_amount = withdrawn_amount + applied,
            status = case when withdrawn_amount + applied >= amount
              then 'paid'::public.ledger_status else status end,
            paid_withdrawal_id = case when withdrawn_amount + applied >= amount then target.id else paid_withdrawal_id end,
            paid_at = case when withdrawn_amount + applied >= amount then approval_time else paid_at end
        where id = ledger.id;
        remaining := remaining - applied;
      end if;
    end loop;
    if remaining > 0 then
      raise exception 'The member no longer has enough due balance for this withdrawal.' using errcode = '22023';
    end if;
  end if;
  update public.withdrawal_requests set status = 'approved', approved_at = approval_time
  where id = target.id;
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'withdrawal-approval', 'Approved withdrawal ' || target.withdrawal_code || '.',
    jsonb_build_object('requestId', target.id, 'memberId', target.member_id,
      'amount', target.amount, 'fundSource', target.fund_source));
  return jsonb_build_object('id', target.id, 'status', 'approved');
end;
$$;

create function public.get_my_member_funds_dashboard()
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
      'status', topup.status, 'createdAt', topup.created_at
    ) order by topup.created_at desc), '[]'::jsonb)
      from public.member_fund_topups topup
      where topup.member_id = auth.uid()),
    'investments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', contract.id, 'rank', contract.rank_number, 'rankName', rule.rank_name,
      'principal', contract.principal, 'months', contract.months,
      'startedAt', contract.started_at, 'unlocksAt', contract.unlocks_at
    ) order by contract.started_at desc), '[]'::jsonb)
      from public.budget_investment_contracts contract
      join public.budget_plan_rank_rules rule on rule.rank_number = contract.rank_number
      where contract.member_id = auth.uid()),
    'fundActivity', (select coalesce(jsonb_agg(jsonb_build_object(
      'account', fund.account, 'amount', fund.amount, 'sourceType', fund.source_type,
      'note', fund.note, 'availableAt', fund.available_at
    ) order by fund.created_at desc), '[]'::jsonb)
      from (select * from public.member_fund_ledger where member_id = auth.uid()
        order by created_at desc limit 80) fund)
  );
$$;

revoke all on function public.member_main_available(uuid) from public, anon, authenticated;
revoke all on function public.get_my_member_funds_dashboard() from public, anon;
grant execute on function public.get_my_member_funds_dashboard() to authenticated;
