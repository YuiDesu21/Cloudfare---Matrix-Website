create table public.budget_investment_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  rank_number smallint not null references public.budget_plan_rank_rules(rank_number),
  amount numeric(12,2) not null check (amount > 0),
  months smallint not null check (months > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  admin_note text not null default '' check (char_length(admin_note) <= 320)
);
create unique index budget_investment_one_pending_rank
  on public.budget_investment_requests(member_id, rank_number) where status = 'pending';
alter table public.budget_investment_requests enable row level security;
create policy budget_investment_requests_read on public.budget_investment_requests
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.budget_investment_requests to authenticated;

create table public.budget_investment_contracts (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique references public.budget_investment_requests(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  rank_number smallint not null references public.budget_plan_rank_rules(rank_number),
  principal numeric(12,2) not null check (principal > 0),
  months smallint not null check (months > 0),
  started_at timestamptz not null,
  unlocks_at timestamptz not null,
  check (unlocks_at > started_at)
);
create index budget_investment_contracts_member_idx
  on public.budget_investment_contracts(member_id, rank_number, unlocks_at);
alter table public.budget_investment_contracts enable row level security;
create policy budget_investment_contracts_read on public.budget_investment_contracts
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.budget_investment_contracts to authenticated;

create table public.budget_investment_income (
  id uuid primary key default extensions.gen_random_uuid(),
  contract_id uuid not null references public.budget_investment_contracts(id) on delete restrict,
  month_number smallint not null check (month_number > 0),
  amount numeric(12,2) not null check (amount > 0),
  due_at timestamptz not null,
  unique (contract_id, month_number)
);
alter table public.budget_investment_income enable row level security;
create policy budget_investment_income_read on public.budget_investment_income
  for select to authenticated using (exists (
    select 1 from public.budget_investment_contracts contract
    where contract.id = contract_id and (contract.member_id = auth.uid() or public.is_admin())
  ));
grant select on public.budget_investment_income to authenticated;

create function public.member_investment_available(p_member_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select greatest(public.member_fund_balance(p_member_id, 'investment')
    - coalesce((select sum(principal) from public.budget_investment_contracts
      where member_id = p_member_id and unlocks_at > now()), 0)
    - coalesce((select sum(amount) from public.budget_investment_requests
      where member_id = p_member_id and status = 'pending'), 0), 0);
$$;

create function public.request_budget_investment(p_rank_number smallint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rule public.budget_plan_rank_rules%rowtype;
  committed_months integer;
  requested public.budget_investment_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to invest.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into rule from public.budget_plan_rank_rules where rank_number = p_rank_number;
  if rule.rank_number is null or rule.investment_amount <= 0 then
    raise exception 'This rank has no investment option.' using errcode = '22023';
  end if;
  if public.budget_plan_rank_for(auth.uid()) < rule.rank_number then
    raise exception 'Reach this Budget Plan rank first.' using errcode = '22023';
  end if;
  if public.budget_plan_qualification_total(auth.uid()) < 450 then
    raise exception 'Complete the PHP 300 post-entry purchase qualification first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.budget_investment_contracts
    where member_id = auth.uid() and rank_number = p_rank_number and unlocks_at > now()) then
    raise exception 'This rank has an active contract. Wait until its principal unlocks.' using errcode = '22023';
  end if;
  if exists (select 1 from public.budget_investment_requests
    where member_id = auth.uid() and rank_number = p_rank_number and status = 'pending') then
    raise exception 'This rank already has a pending investment request.' using errcode = '22023';
  end if;
  select coalesce(sum(months), 0) into committed_months
  from public.budget_investment_contracts
  where member_id = auth.uid() and rank_number = p_rank_number;
  if committed_months >= rule.investment_months then
    raise exception 'This rank has completed its eligible investment months.' using errcode = '22023';
  end if;
  if public.member_investment_available(auth.uid()) < rule.investment_amount then
    raise exception 'Transfer enough Main Funds into Investment Funds first.' using errcode = '22023';
  end if;
  insert into public.budget_investment_requests(member_id, rank_number, amount, months)
  values (auth.uid(), p_rank_number, rule.investment_amount,
    least(rule.contract_months, rule.investment_months - committed_months))
  returning * into requested;
  return to_jsonb(requested);
end;
$$;

create function public.admin_get_budget_investment_requests()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'memberName', profile.full_name,
    'rank', request.rank_number, 'rankName', rule.rank_name,
    'amount', request.amount, 'months', request.months,
    'status', request.status, 'createdAt', request.created_at, 'reviewedAt', request.reviewed_at
  ) order by request.created_at desc), '[]'::jsonb) into result
  from public.budget_investment_requests request
  join public.profiles profile on profile.id = request.member_id
  join public.budget_plan_rank_rules rule on rule.rank_number = request.rank_number;
  return result;
end;
$$;

create function public.admin_review_budget_investment(
  p_request_id uuid, p_approve boolean, p_admin_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  request public.budget_investment_requests%rowtype;
  contract public.budget_investment_contracts%rowtype;
  income public.budget_investment_income%rowtype;
  approved_at timestamptz := now();
  month_index integer;
  available numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(coalesce(p_admin_note, '')) > 320 then
    raise exception 'Admin note is too long.' using errcode = '22023';
  end if;
  select * into request from public.budget_investment_requests where id = p_request_id for update;
  if request.id is null or request.status <> 'pending' then
    raise exception 'Investment request is not pending.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(request.member_id::text, 0));
  if p_approve then
    available := public.member_investment_available(request.member_id) + request.amount;
    if available < request.amount then
      raise exception 'Member Investment Funds are no longer sufficient.' using errcode = '22023';
    end if;
    if exists (select 1 from public.budget_investment_contracts
      where member_id = request.member_id and rank_number = request.rank_number and unlocks_at > approved_at) then
      raise exception 'An active contract already exists for this rank.' using errcode = '22023';
    end if;
  end if;
  update public.budget_investment_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = approved_at, reviewed_by = auth.uid(), admin_note = trim(coalesce(p_admin_note, ''))
  where id = request.id returning * into request;
  if p_approve then
    insert into public.budget_investment_contracts
      (request_id, member_id, rank_number, principal, months, started_at, unlocks_at)
    values (request.id, request.member_id, request.rank_number, request.amount,
      request.months, approved_at, approved_at + make_interval(months => request.months))
    returning * into contract;
    for month_index in 1..request.months loop
      insert into public.budget_investment_income(contract_id, month_number, amount, due_at)
      values (contract.id, month_index, round(contract.principal * 0.30, 2),
        approved_at + make_interval(months => month_index))
      returning * into income;
      insert into public.member_fund_ledger
        (member_id, account, amount, source_type, source_id, note, available_at)
      values (request.member_id, 'investment', income.amount, 'budget_investment_income',
        income.id, 'Budget Plan ' || request.rank_number || ' investment month ' || month_index,
        income.due_at);
    end loop;
  end if;
  return to_jsonb(request);
end;
$$;

create function public.transfer_investment_to_main(p_amount numeric)
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
  if public.member_investment_available(auth.uid()) < p_amount then
    raise exception 'Unlocked Investment Funds are not enough.' using errcode = '22023';
  end if;
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values
    (auth.uid(), 'investment', -p_amount, 'investment_to_main', transfer_id, 'Transfer to Main Funds'),
    (auth.uid(), 'main', p_amount, 'investment_to_main', transfer_id, 'Transfer from Investment Funds');
  return jsonb_build_object('id', transfer_id, 'amount', p_amount);
end;
$$;

revoke all on function public.member_investment_available(uuid) from public, anon, authenticated;
revoke all on function public.request_budget_investment(smallint),
  public.admin_get_budget_investment_requests(),
  public.admin_review_budget_investment(uuid,boolean,text),
  public.transfer_investment_to_main(numeric) from public, anon;
grant execute on function public.request_budget_investment(smallint),
  public.admin_get_budget_investment_requests(),
  public.admin_review_budget_investment(uuid,boolean,text),
  public.transfer_investment_to_main(numeric) to authenticated;
