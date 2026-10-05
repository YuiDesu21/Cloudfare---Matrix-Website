alter table public.reward_ledger
  add column transferred_amount numeric(12,2) not null default 0
  check (transferred_amount >= 0 and transferred_amount <= withdrawn_amount);

create table public.member_reward_transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  plan_id text not null check (plan_id in ('power3-passive', 'timeline-power3', 'patronizing-income', 'budget-plan')),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create table public.member_reward_transfer_lines (
  transfer_id uuid not null references public.member_reward_transfers(id) on delete restrict,
  reward_id uuid not null references public.reward_ledger(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  primary key (transfer_id, reward_id)
);
create table public.member_budget_reward_transfer_lines (
  transfer_id uuid not null references public.member_reward_transfers(id) on delete restrict,
  income_id uuid not null references public.budget_plan_passive_income(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  primary key (transfer_id, income_id)
);
alter table public.member_reward_transfers enable row level security;
alter table public.member_reward_transfer_lines enable row level security;
alter table public.member_budget_reward_transfer_lines enable row level security;
create policy member_reward_transfers_read on public.member_reward_transfers
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy member_reward_transfer_lines_read on public.member_reward_transfer_lines
  for select to authenticated using (exists (
    select 1 from public.member_reward_transfers transfer
    where transfer.id = transfer_id and (transfer.member_id = auth.uid() or public.is_admin())
  ));
create policy member_budget_reward_transfer_lines_read on public.member_budget_reward_transfer_lines
  for select to authenticated using (exists (
    select 1 from public.member_reward_transfers transfer
    where transfer.id = transfer_id and (transfer.member_id = auth.uid() or public.is_admin())
  ));
grant select on public.member_reward_transfers, public.member_reward_transfer_lines,
  public.member_budget_reward_transfer_lines to authenticated;

create function public.transfer_matrix_income_to_main(p_plan_id text, p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  transfer public.member_reward_transfers%rowtype;
  reward_row public.reward_ledger%rowtype;
  budget_row public.budget_plan_passive_income%rowtype;
  remaining numeric := p_amount;
  available numeric;
  applied numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to transfer earnings.' using errcode = '42501'; end if;
  if p_plan_id is null or p_plan_id not in ('power3-passive', 'timeline-power3', 'patronizing-income', 'budget-plan') then
    raise exception 'Choose an eligible matrix.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid transfer amount.' using errcode = '22023';
  end if;
  if p_plan_id = 'power3-passive' and p_amount < 1000 then
    raise exception 'The 1200 Matrix requires at least PHP 1,000 per transfer.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (select 1 from public.withdrawal_requests
    where member_id = auth.uid() and status = 'pending')
    or exists (select 1 from public.exit_actions
      where member_id = auth.uid() and status = 'pending' and payment_method = 'available_balance')
    or exists (select 1 from public.timeline_requests
      where member_id = auth.uid() and status = 'pending' and payment_method = 'available_balance') then
    raise exception 'Finish pending balance requests before transferring matrix earnings.' using errcode = '22023';
  end if;

  if p_plan_id = 'budget-plan' then
    select coalesce(sum(amount - transferred_amount), 0) into available
    from public.budget_plan_passive_income
    where member_id = auth.uid() and due_at <= now();
  else
    select coalesce(sum(amount - withdrawn_amount), 0) into available
    from public.reward_ledger
    where member_id = auth.uid() and plan_id = p_plan_id
      and status = 'due' and due_at <= now();
  end if;
  if available < p_amount then
    raise exception 'The selected matrix does not have enough available income.' using errcode = '22023';
  end if;

  insert into public.member_reward_transfers(member_id, plan_id, amount)
  values (auth.uid(), p_plan_id, p_amount) returning * into transfer;
  if p_plan_id = 'budget-plan' then
    for budget_row in select * from public.budget_plan_passive_income
      where member_id = auth.uid() and due_at <= now() and transferred_amount < amount
      order by due_at, created_at, id for update loop
      exit when remaining <= 0;
      applied := least(budget_row.amount - budget_row.transferred_amount, remaining);
      update public.budget_plan_passive_income
      set transferred_amount = transferred_amount + applied where id = budget_row.id;
      insert into public.member_budget_reward_transfer_lines(transfer_id, income_id, amount)
      values (transfer.id, budget_row.id, applied);
      remaining := remaining - applied;
    end loop;
  else
    for reward_row in select * from public.reward_ledger
      where member_id = auth.uid() and plan_id = p_plan_id
        and status = 'due' and due_at <= now()
      order by due_at, created_at, id for update loop
      exit when remaining <= 0;
      applied := least(reward_row.amount - reward_row.withdrawn_amount, remaining);
      if applied <= 0 then continue; end if;
      update public.reward_ledger
      set withdrawn_amount = withdrawn_amount + applied,
          transferred_amount = transferred_amount + applied,
          status = case when withdrawn_amount + applied >= amount
            then 'paid'::public.ledger_status else status end
      where id = reward_row.id;
      insert into public.member_reward_transfer_lines(transfer_id, reward_id, amount)
      values (transfer.id, reward_row.id, applied);
      remaining := remaining - applied;
    end loop;
  end if;
  if remaining > 0 then raise exception 'Transfer balance changed; please retry.' using errcode = '40001'; end if;
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values (auth.uid(), 'main', p_amount, 'matrix_income_transfer', transfer.id, p_plan_id || ' income');
  return to_jsonb(transfer);
end;
$$;

create function public.transfer_main_to_investment(p_amount numeric)
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
  if public.member_fund_balance(auth.uid(), 'main') < p_amount then
    raise exception 'Main Funds balance is not enough.' using errcode = '22023';
  end if;
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values
    (auth.uid(), 'main', -p_amount, 'main_to_investment', transfer_id, 'Transfer to Investment Funds'),
    (auth.uid(), 'investment', p_amount, 'main_to_investment', transfer_id, 'Transfer from Main Funds');
  return jsonb_build_object('id', transfer_id, 'amount', p_amount);
end;
$$;

revoke all on function public.transfer_matrix_income_to_main(text,numeric),
  public.transfer_main_to_investment(numeric) from public, anon;
grant execute on function public.transfer_matrix_income_to_main(text,numeric),
  public.transfer_main_to_investment(numeric) to authenticated;
