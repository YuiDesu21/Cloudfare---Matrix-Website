-- Matrix production schema foundation.
-- Apply through the Supabase CLI or SQL editor only after reviewing the
-- business rules and testing in a non-production project.

create extension if not exists pgcrypto;

create type public.member_status as enum ('registered', 'active', 'suspended');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.ledger_status as enum ('due', 'paid', 'void');
create type public.app_role as enum ('member', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  account_code text not null unique,
  full_name text not null check (char_length(full_name) between 2 and 120),
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  email text not null,
  phone text not null,
  wallet_address text not null unique,
  sponsor_id uuid references public.profiles(id) on delete restrict,
  status public.member_status not null default 'registered',
  cumulative_f3_tokens numeric(18, 4) not null default 0 check (cumulative_f3_tokens >= 0),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now()
);

create table public.matrix_positions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.profiles(id) on delete restrict,
  plan_id text not null default 'power3-passive',
  parent_member_id uuid references public.profiles(id) on delete restrict,
  placed_at timestamptz not null default now(),
  check (member_id is distinct from parent_member_id)
);

create unique index one_matrix_root_per_plan on public.matrix_positions(plan_id) where parent_member_id is null;
create index matrix_positions_parent_idx on public.matrix_positions(parent_member_id, plan_id);
create index profiles_sponsor_idx on public.profiles(sponsor_id);

create table public.matrix_exit_rules (
  exit_number smallint primary key check (exit_number between 1 and 99),
  requirement_rank text not null,
  required_downline_exit smallint not null default 0,
  action_type text not null check (action_type in ('invest', 'reinvest')),
  action_label text not null,
  action_amount numeric(12, 2) not null check (action_amount >= 0),
  passive_income numeric(12, 2) not null check (passive_income >= 0),
  passive_months smallint not null check (passive_months >= 0),
  product_spend numeric(12, 2) not null default 0 check (product_spend >= 0),
  product_bonus_percent numeric(5, 2) not null default 0 check (product_bonus_percent between 0 and 100),
  product_months smallint not null default 0 check (product_months >= 0)
);

create table public.upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  plan_id text not null default 'power3-passive',
  amount numeric(12, 2) not null check (amount > 0),
  reference_number text not null unique check (reference_number ~ '^[A-Z0-9-]{6,40}$'),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

create unique index one_pending_upgrade_per_member on public.upgrade_requests(member_id) where status = 'pending';

create table public.exit_actions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  exit_number smallint not null references public.matrix_exit_rules(exit_number),
  action_type text not null check (action_type in ('invest', 'reinvest')),
  action_amount numeric(12, 2) not null check (action_amount > 0),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

create unique index one_open_exit_action on public.exit_actions(member_id, exit_number) where status in ('pending', 'approved');
create index exit_actions_member_idx on public.exit_actions(member_id, exit_number);

create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  source_type text not null check (source_type in ('entry', 'exit')),
  source_label text not null,
  exit_number smallint references public.matrix_exit_rules(exit_number),
  amount numeric(12, 2) not null check (amount > 0),
  withdrawn_amount numeric(12, 2) not null default 0 check (withdrawn_amount >= 0 and withdrawn_amount <= amount),
  due_at timestamptz not null,
  status public.ledger_status not null default 'due',
  paid_withdrawal_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index reward_ledger_member_due_idx on public.reward_ledger(member_id, due_at, status);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  withdrawal_code text not null unique,
  amount numeric(12, 2) not null check (amount > 0),
  payout_method text not null default 'GCash',
  payout_details text not null default '',
  account_name text not null,
  gcash_number text not null check (gcash_number ~ '^([+]?63|0)9[0-9]{9}$'),
  origins jsonb not null default '[]'::jsonb,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

alter table public.reward_ledger
  add constraint reward_ledger_paid_withdrawal_fk foreign key (paid_withdrawal_id) references public.withdrawal_requests(id) on delete restrict;

create index withdrawals_member_created_idx on public.withdrawal_requests(member_id, created_at desc);
create unique index one_pending_withdrawal_code on public.withdrawal_requests(withdrawal_code);

create table public.product_plus_claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  exit_number smallint not null references public.matrix_exit_rules(exit_number),
  spend_amount numeric(12, 2) not null check (spend_amount > 0),
  bonus_percent numeric(5, 2) not null check (bonus_percent between 0 and 100),
  bonus_amount numeric(12, 2) not null check (bonus_amount >= 0),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

create index product_claims_member_exit_idx on public.product_plus_claims(member_id, exit_number);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.matrix_positions enable row level security;
alter table public.matrix_exit_rules enable row level security;
alter table public.upgrade_requests enable row level security;
alter table public.exit_actions enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.product_plus_claims enable row level security;
alter table public.activity_logs enable row level security;

create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy roles_read_self on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy positions_read_authenticated on public.matrix_positions for select to authenticated using (true);
create policy rules_read_authenticated on public.matrix_exit_rules for select to authenticated using (true);
create policy upgrades_read_self on public.upgrade_requests for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy exits_read_self on public.exit_actions for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy ledger_read_self on public.reward_ledger for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy withdrawals_read_self on public.withdrawal_requests for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy claims_read_self on public.product_plus_claims for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy logs_admin_read on public.activity_logs for select to authenticated using (public.is_admin());

-- All writes are intentionally denied through the Data API. Mutations should
-- be implemented as reviewed security-definer RPC functions or Edge Functions.
-- Do not add broad INSERT/UPDATE policies to make the frontend work.
