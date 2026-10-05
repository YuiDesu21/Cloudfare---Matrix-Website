create table public.budget_plan_rank_rules (
  rank_number smallint primary key check (rank_number between 0 and 13),
  rank_name text not null unique,
  monthly_passive numeric(12,2) not null default 0 check (monthly_passive >= 0),
  passive_months smallint not null default 0 check (passive_months >= 0),
  investment_amount numeric(12,2) not null default 0 check (investment_amount >= 0),
  investment_months smallint not null default 0 check (investment_months >= 0),
  contract_months smallint not null default 0 check (contract_months >= 0),
  check ((investment_amount = 0 and investment_months = 0 and contract_months = 0)
    or (investment_amount > 0 and investment_months >= contract_months and contract_months > 0))
);

insert into public.budget_plan_rank_rules
  (rank_number, rank_name, monthly_passive, passive_months,
   investment_amount, investment_months, contract_months)
values
  (0, 'Challenger', 0, 0, 0, 0, 0),
  (1, 'Overcomer', 0, 0, 500, 2, 2),
  (2, 'Promoter', 100, 4, 500, 3, 3),
  (3, 'Dedicated', 135, 5, 630, 5, 5),
  (4, 'Gentleness', 229.50, 6, 1125, 6, 2),
  (5, 'Faithfulness', 364.50, 8, 1350, 9, 3),
  (6, 'Self-Control', 567, 9, 2025, 12, 4),
  (7, 'Goodness', 911.25, 12, 3880, 15, 5),
  (8, 'Kindness', 1749.60, 15, 8500, 18, 6),
  (9, 'Patience', 2952.45, 20, 18740, 21, 7),
  (10, 'Peace', 3936.60, 30, 36450, 27, 9),
  (11, 'Joy', 7873.20, 45, 65610, 36, 12),
  (12, 'Perseverance', 13286.03, 60, 118090, 45, 15),
  (13, 'Love', 18756.74, 85, 177140, 60, 20);

create table public.budget_plan_categories (
  category text primary key check (category in ('pc', 'groceries', 'lifestyle', 'f3_token')),
  qualification_percent numeric(5,2) not null check (qualification_percent between 0 and 100)
);

insert into public.budget_plan_categories (category, qualification_percent) values
  ('pc', 25), ('groceries', 10), ('lifestyle', 25), ('f3_token', 80);

alter table public.budget_plan_rank_rules enable row level security;
alter table public.budget_plan_categories enable row level security;
create policy budget_plan_rank_rules_read on public.budget_plan_rank_rules
  for select to authenticated using (true);
create policy budget_plan_categories_read on public.budget_plan_categories
  for select to authenticated using (true);
grant select on public.budget_plan_rank_rules, public.budget_plan_categories to authenticated;
