-- Confirmed schedule, still non-deployable until contract and payout rules are finalized.
create table public.timeline_investment_rules (
  exit_number smallint primary key references public.timeline_exit_rules(exit_number),
  investment_amount numeric(12,2) not null check (investment_amount > 0),
  investment_months smallint not null check (investment_months > 0),
  contract_months smallint not null check (contract_months > 0),
  monthly_rate numeric(5,2) not null default 30 check (monthly_rate = 30),
  check ((exit_number between 2 and 5 and investment_months = contract_months)
    or (exit_number between 6 and 13 and investment_months = 3 * contract_months))
);

insert into public.timeline_investment_rules (exit_number, investment_amount, investment_months, contract_months) values
  (2, 600, 2, 2),
  (3, 1200, 3, 3),
  (4, 1688, 4, 4),
  (5, 3240, 5, 5),
  (6, 6075, 6, 2),
  (7, 8100, 9, 3),
  (8, 14580, 12, 4),
  (9, 17496, 15, 5),
  (10, 32805, 18, 6),
  (11, 36906, 24, 8),
  (12, 88574, 30, 10),
  (13, 88574, 45, 15);

alter table public.timeline_investment_rules enable row level security;
create policy timeline_investment_rules_read_authenticated
  on public.timeline_investment_rules for select to authenticated using (true);

grant select on public.timeline_investment_rules to authenticated;
