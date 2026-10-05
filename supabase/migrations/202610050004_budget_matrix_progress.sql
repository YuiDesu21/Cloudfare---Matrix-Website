create table public.budget_plan_rank_progress (
  member_id uuid not null references public.profiles(id) on delete restrict,
  rank_number smallint not null references public.budget_plan_rank_rules(rank_number),
  reached_at timestamptz not null default now(),
  primary key (member_id, rank_number)
);

alter table public.budget_plan_rank_progress enable row level security;
create policy budget_plan_rank_progress_read on public.budget_plan_rank_progress
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

create table public.budget_plan_passive_income (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  rank_number smallint not null references public.budget_plan_rank_rules(rank_number),
  month_number smallint not null check (month_number > 0),
  amount numeric(12,2) not null check (amount > 0),
  transferred_amount numeric(12,2) not null default 0
    check (transferred_amount >= 0 and transferred_amount <= amount),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (member_id, rank_number, month_number)
);
create index budget_plan_passive_member_due_idx
  on public.budget_plan_passive_income(member_id, due_at);
alter table public.budget_plan_passive_income enable row level security;
create policy budget_plan_passive_income_read on public.budget_plan_passive_income
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.budget_plan_passive_income to authenticated;

create function public.budget_plan_rank_for(p_member_id uuid)
returns smallint
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(rank_number), -1)::smallint
  from public.budget_plan_rank_progress where member_id = p_member_id;
$$;

create function public.refresh_budget_plan_rank(p_member_id uuid, p_at timestamptz default now())
returns smallint
language plpgsql security definer set search_path = ''
as $$
declare
  rule public.budget_plan_rank_rules%rowtype;
  qualified_children integer;
begin
  if not exists (select 1 from public.matrix_positions
    where member_id = p_member_id and plan_id = 'budget-plan') then
    return -1;
  end if;

  for rule in select * from public.budget_plan_rank_rules
    where rank_number > 0 order by rank_number loop
    if exists (select 1 from public.budget_plan_rank_progress
      where member_id = p_member_id and rank_number = rule.rank_number) then
      continue;
    end if;
    if not exists (select 1 from public.budget_plan_rank_progress
      where member_id = p_member_id and rank_number = rule.rank_number - 1) then
      exit;
    end if;

    select count(*) into qualified_children
    from public.matrix_positions child
    where child.parent_member_id = p_member_id
      and child.plan_id = 'budget-plan'
      and public.budget_plan_rank_for(child.member_id) >= rule.rank_number - 1;
    exit when qualified_children < 3;

    insert into public.budget_plan_rank_progress(member_id, rank_number, reached_at)
    values (p_member_id, rule.rank_number, p_at)
    on conflict do nothing;

    if rule.monthly_passive > 0 then
      insert into public.budget_plan_passive_income
        (member_id, rank_number, month_number, amount, due_at)
      select p_member_id, rule.rank_number, month_number,
        rule.monthly_passive, p_at + month_number * interval '1 month'
      from generate_series(1, rule.passive_months) as month_number;
    end if;
  end loop;

  return public.budget_plan_rank_for(p_member_id);
end;
$$;

create function public.refresh_budget_plan_ancestors(p_member_id uuid, p_at timestamptz default now())
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_id uuid := p_member_id;
  parent_id uuid;
begin
  while current_id is not null loop
    perform public.refresh_budget_plan_rank(current_id, p_at);
    select parent_member_id into parent_id from public.matrix_positions
    where member_id = current_id and plan_id = 'budget-plan';
    current_id := parent_id;
  end loop;
end;
$$;

-- The owner is the stable root; later paid activations fill its oldest open slots.
insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
select owner.user_id, 'budget-plan', null, now()
from public.organization_owners owner
where not exists (select 1 from public.matrix_positions where plan_id = 'budget-plan')
on conflict do nothing;

insert into public.budget_plan_rank_progress(member_id, rank_number)
select position.member_id, 0 from public.matrix_positions position
where position.plan_id = 'budget-plan'
on conflict do nothing;

revoke all on function public.budget_plan_rank_for(uuid),
  public.refresh_budget_plan_rank(uuid,timestamptz),
  public.refresh_budget_plan_ancestors(uuid,timestamptz)
from public, anon, authenticated;
