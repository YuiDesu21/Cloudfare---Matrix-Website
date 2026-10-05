-- Provisional terms; keep outside deployable migrations until confirmed.
create table public.timeline_investment_rules (
  exit_number smallint primary key references public.timeline_exit_rules(exit_number),
  investment_amount numeric(12,2) not null check (investment_amount > 0),
  investment_months smallint not null check (investment_months > 0),
  monthly_rate numeric(5,2) not null default 30 check (monthly_rate = 30)
);

insert into public.timeline_investment_rules (exit_number, investment_amount, investment_months) values
  (2, 600, 1),
  (3, 1200, 1),
  (4, 1688, 2),
  (5, 3240, 3),
  (6, 6075, 6),
  (7, 8100, 10),
  (8, 14580, 20),
  (9, 17496, 30),
  (10, 32805, 50),
  (11, 36906, 75),
  (12, 88574, 100),
  (13, 88574, 300);

alter table public.timeline_investment_rules enable row level security;
create policy timeline_investment_rules_read_authenticated
  on public.timeline_investment_rules for select to authenticated using (true);

grant select on public.timeline_investment_rules to authenticated;
