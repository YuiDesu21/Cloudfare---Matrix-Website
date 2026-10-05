create table public.budget_plan_purchase_credits (
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  member_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid references public.commerce_products(id) on delete set null,
  category text not null references public.budget_plan_categories(category),
  product_amount numeric(12,2) not null check (product_amount > 0),
  qualification_percent numeric(5,2) not null check (qualification_percent > 0),
  qualification_credit numeric(12,2) not null check (qualification_credit > 0),
  credited_at timestamptz not null default now(),
  primary key (order_id, line_number)
);
create index budget_plan_credits_member_idx
  on public.budget_plan_purchase_credits(member_id, credited_at);
alter table public.budget_plan_purchase_credits enable row level security;
create policy budget_plan_purchase_credits_read on public.budget_plan_purchase_credits
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

create table public.budget_plan_token_settings (
  id smallint primary key default 1 check (id = 1),
  unit_price numeric(12,2) not null check (unit_price > 0),
  updated_at timestamptz not null default now()
);
insert into public.budget_plan_token_settings(id, unit_price) values (1, 60);
alter table public.budget_plan_token_settings enable row level security;
create policy budget_plan_token_settings_read on public.budget_plan_token_settings
  for select to authenticated using (true);
grant select on public.budget_plan_token_settings to authenticated;

create table public.budget_plan_token_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  payment_method_snapshot jsonb not null,
  quantity integer not null check (quantity between 1 and 10000),
  unit_price numeric(12,2) not null check (unit_price > 0),
  amount numeric(12,2) not null check (amount > 0),
  wallet_address text not null check (char_length(trim(wallet_address)) between 1 and 120),
  reference_number text not null unique check (reference_number ~ '^[A-Z0-9-]{6,80}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'delivered', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  delivery_reference text not null default '' check (char_length(delivery_reference) <= 120),
  delivered_at timestamptz,
  admin_note text not null default '' check (char_length(admin_note) <= 320)
);
alter table public.budget_plan_token_requests enable row level security;
create policy budget_plan_token_requests_read on public.budget_plan_token_requests
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.budget_plan_token_requests to authenticated;

create table public.budget_plan_token_credits (
  request_id uuid primary key references public.budget_plan_token_requests(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  purchase_amount numeric(12,2) not null check (purchase_amount > 0),
  qualification_credit numeric(12,2) not null check (qualification_credit > 0),
  credited_at timestamptz not null default now()
);
alter table public.budget_plan_token_credits enable row level security;
create policy budget_plan_token_credits_read on public.budget_plan_token_credits
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

create function public.budget_plan_qualification_total(p_member_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(qualification_credit) from public.budget_plan_purchase_credits
    where member_id = p_member_id), 0)
    + coalesce((select sum(qualification_credit) from public.budget_plan_token_credits
      where member_id = p_member_id), 0);
$$;

create function public.activate_budget_plan_member(p_member_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  qualifying_total numeric;
  selected_parent uuid;
  inserted_position public.matrix_positions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('budget-plan-placement', 0));
  qualifying_total := public.budget_plan_qualification_total(p_member_id);
  if qualifying_total < 150 then
    return jsonb_build_object('activated', false, 'qualifyingValue', qualifying_total);
  end if;
  if exists (select 1 from public.matrix_positions
    where member_id = p_member_id and plan_id = 'budget-plan') then
    return jsonb_build_object('activated', true, 'qualifyingValue', qualifying_total);
  end if;

  select position.member_id into selected_parent
  from public.matrix_positions position
  where position.plan_id = 'budget-plan'
    and (select count(*) from public.matrix_positions child
      where child.plan_id = 'budget-plan'
        and child.parent_member_id = position.member_id) < 3
  order by position.placed_at, position.id
  limit 1;
  if selected_parent is null then
    raise exception 'Budget Plan root is not available.' using errcode = 'P0002';
  end if;

  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (p_member_id, 'budget-plan', selected_parent, p_at)
  returning * into inserted_position;
  insert into public.budget_plan_rank_progress(member_id, rank_number, reached_at)
  values (p_member_id, 0, p_at);
  perform public.refresh_budget_plan_ancestors(p_member_id, p_at);
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'budget-plan-activated', 'Activated Budget Plan from approved purchases.',
    jsonb_build_object('memberId', p_member_id, 'parentMemberId', selected_parent, 'qualifyingValue', qualifying_total));
  return jsonb_build_object('activated', true, 'positionId', inserted_position.id,
    'parentMemberId', selected_parent, 'qualifyingValue', qualifying_total);
end;
$$;

create function public.get_my_budget_plan_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with credit as (
    select public.budget_plan_qualification_total(auth.uid()) as total
  ), position as (
    select * from public.matrix_positions
    where member_id = auth.uid() and plan_id = 'budget-plan'
  )
  select jsonb_build_object(
    'isActive', exists(select 1 from position),
    'position', (select jsonb_build_object('id', id, 'parentMemberId', parent_member_id,
      'placedAt', placed_at) from position),
    'rank', public.budget_plan_rank_for(auth.uid()),
    'qualificationValue', (select total from credit),
    'entryCredit', least((select total from credit), 150),
    'investmentCredit', least(greatest((select total from credit) - 150, 0), 300),
    'canInvest', public.budget_plan_rank_for(auth.uid()) >= 1
      and (select total from credit) >= 450,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
      'rank', rule.rank_number, 'name', rule.rank_name,
      'monthlyPassive', rule.monthly_passive, 'passiveMonths', rule.passive_months,
      'investmentAmount', rule.investment_amount,
      'investmentMonths', rule.investment_months,
      'contractMonths', rule.contract_months,
      'reachedAt', progress.reached_at
    ) order by rule.rank_number), '[]'::jsonb)
    from public.budget_plan_rank_rules rule
    left join public.budget_plan_rank_progress progress
      on progress.member_id = auth.uid() and progress.rank_number = rule.rank_number),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object(
      'orderId', credit.order_id, 'category', credit.category,
      'productAmount', credit.product_amount,
      'qualificationCredit', credit.qualification_credit,
      'creditedAt', credit.credited_at
    ) order by credit.credited_at desc), '[]'::jsonb)
    from public.budget_plan_purchase_credits credit where credit.member_id = auth.uid()),
    'passiveIncome', (select coalesce(jsonb_agg(jsonb_build_object(
      'amount', income.amount, 'sourceLabel', 'Budget Plan ' || rule.rank_name,
      'dueAt', income.due_at,
      'status', case when income.due_at > now() then 'scheduled'
        when income.transferred_amount >= income.amount then 'transferred' else 'available' end
    ) order by income.due_at), '[]'::jsonb)
    from public.budget_plan_passive_income income
    join public.budget_plan_rank_rules rule on rule.rank_number = income.rank_number
    where income.member_id = auth.uid())
  );
$$;

revoke all on function public.activate_budget_plan_member(uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.budget_plan_qualification_total(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_budget_plan_dashboard() from public, anon;
grant execute on function public.get_my_budget_plan_dashboard() to authenticated;
