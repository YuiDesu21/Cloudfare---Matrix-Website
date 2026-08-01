-- Timeline Matrix foundation. This migration is additive except for changing
-- matrix position uniqueness from one position per member to one per plan.

alter table public.matrix_positions drop constraint if exists matrix_positions_member_id_key;
drop index if exists public.matrix_positions_member_id_key;
create unique index if not exists one_matrix_position_per_member_plan
  on public.matrix_positions(member_id, plan_id);

create table public.timeline_exit_rules (
  exit_number smallint primary key check (exit_number between 1 and 13),
  required_downline_exit smallint not null default 0,
  product_spend numeric(12,2) not null check (product_spend >= 0),
  product_bonus_amount numeric(12,2) not null check (product_bonus_amount >= 0),
  product_months integer not null check (product_months >= 0),
  matrix_income numeric(12,2) not null check (matrix_income >= 0),
  matrix_months integer not null check (matrix_months >= 0)
);

insert into public.timeline_exit_rules(exit_number, required_downline_exit, product_spend, product_bonus_amount, product_months, matrix_income, matrix_months) values
  (1,0,856,185,1,100,3),(2,1,1633,404,1,195,3),(3,2,1838,525,1,236,4),
  (4,3,1607.65,470,2,324,5),(5,4,2143,626,3,607,6),(6,5,2481,747,6,729,10),
  (7,6,2437,818,10,1166,15),(8,7,2815,974,20,2296,20),(9,8,4079,1451,30,3936,30),
  (10,9,4634,1721,50,5904,60),(11,10,4312,1695,75,8857,100),(12,11,6467,2542,100,14171,150),
  (13,12,9700,3814,300,15943,300)
on conflict (exit_number) do update set
  required_downline_exit=excluded.required_downline_exit, product_spend=excluded.product_spend,
  product_bonus_amount=excluded.product_bonus_amount, product_months=excluded.product_months,
  matrix_income=excluded.matrix_income, matrix_months=excluded.matrix_months;

create table public.timeline_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(12,2) not null default 693 check (amount = 693),
  payment_method text not null check (payment_method in ('gcash','available_balance')),
  gcash_name text not null default '',
  gcash_number text not null default '',
  reference_number text not null default '' check (reference_number = '' or reference_number ~ '^[A-Z0-9-]{6,40}$'),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(), approved_at timestamptz, rejected_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict, decision_note text
);
create unique index one_pending_timeline_request_per_member on public.timeline_requests(member_id) where status='pending';
create unique index one_timeline_reference on public.timeline_requests(reference_number) where reference_number <> '' and status <> 'rejected';

create table public.timeline_exit_progress (
  member_id uuid not null references public.profiles(id) on delete restrict,
  exit_number smallint not null references public.timeline_exit_rules(exit_number),
  status text not null default 'active' check (status = 'active'),
  approved_at timestamptz not null default now(),
  primary key(member_id, exit_number)
);

alter table public.upgrade_requests add column if not exists reviewed_by uuid references public.profiles(id) on delete restrict;
alter table public.upgrade_requests add column if not exists decision_note text;
alter table public.exit_actions add column if not exists reviewed_by uuid references public.profiles(id) on delete restrict;
alter table public.exit_actions add column if not exists decision_note text;
alter table public.withdrawal_requests add column if not exists reviewed_by uuid references public.profiles(id) on delete restrict;
alter table public.withdrawal_requests add column if not exists decision_note text;

alter table public.timeline_exit_rules enable row level security;
alter table public.timeline_requests enable row level security;
alter table public.timeline_exit_progress enable row level security;
create policy timeline_rules_read_authenticated on public.timeline_exit_rules for select to authenticated using (true);
create policy timeline_requests_read_self on public.timeline_requests for select to authenticated using (member_id=auth.uid() or public.is_admin());
create policy timeline_progress_read_self on public.timeline_exit_progress for select to authenticated using (member_id=auth.uid() or public.is_admin());
