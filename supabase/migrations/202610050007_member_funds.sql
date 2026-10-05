create table public.member_fund_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  account text not null check (account in ('main', 'investment')),
  amount numeric(12,2) not null check (amount <> 0),
  source_type text not null,
  source_id uuid not null,
  note text not null default '',
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_type, source_id, account)
);
create index member_fund_ledger_member_idx
  on public.member_fund_ledger(member_id, account, available_at);
alter table public.member_fund_ledger enable row level security;
create policy member_fund_ledger_read on public.member_fund_ledger
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.member_fund_ledger to authenticated;

create table public.member_fund_topups (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  payment_method_snapshot jsonb not null,
  amount numeric(12,2) not null check (amount >= 1 and amount <= 1000000),
  reference_number text not null unique check (reference_number ~ '^[A-Z0-9-]{6,80}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  admin_note text not null default '' check (char_length(admin_note) <= 320)
);
create index member_fund_topups_member_idx
  on public.member_fund_topups(member_id, created_at desc);
alter table public.member_fund_topups enable row level security;
create policy member_fund_topups_read on public.member_fund_topups
  for select to authenticated using (member_id = auth.uid() or public.is_admin());
grant select on public.member_fund_topups to authenticated;

create function public.member_fund_balance(p_member_id uuid, p_account text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount), 0)
  from public.member_fund_ledger
  where member_id = p_member_id and account = p_account and available_at <= now();
$$;

create function public.approved_payment_reference_used(p_reference text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.member_fund_topups
    where status = 'approved' and reference_number = upper(trim(p_reference)))
    or exists (select 1 from public.budget_plan_token_requests
      where status in ('approved', 'delivered') and reference_number = upper(trim(p_reference)))
    or exists (select 1 from public.commerce_order_payments
      where status = 'approved' and upper(trim(reference_number)) = upper(trim(p_reference)))
    or exists (select 1 from public.patronizing_token_requests
      where status = 'approved' and upper(trim(reference_number)) = upper(trim(p_reference)));
$$;

create function public.request_member_fund_topup(
  p_amount numeric, p_payment_method_id uuid, p_reference_number text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  topup public.member_fund_topups%rowtype;
  method public.payment_methods%rowtype;
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
begin
  if auth.uid() is null then raise exception 'Sign in to request a top-up.' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a top-up between PHP 1 and PHP 1,000,000.' using errcode = '22023';
  end if;
  if normalized_reference !~ '^[A-Z0-9-]{6,80}$' then
    raise exception 'Enter a valid payment reference (6-80 letters, numbers, or hyphens).' using errcode = '22023';
  end if;
  select * into method from public.payment_methods where id = p_payment_method_id and is_active;
  if method.id is null then
    raise exception 'Choose an active payment method.' using errcode = '22023';
  end if;
  insert into public.member_fund_topups
    (member_id, payment_method_id, payment_method_snapshot, amount, reference_number)
  values (auth.uid(), p_payment_method_id, public.payment_method_json(method), p_amount, normalized_reference)
  returning * into topup;
  return to_jsonb(topup);
end;
$$;

create function public.admin_get_member_fund_topups()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', topup.id, 'memberId', topup.member_id, 'memberName', profile.full_name,
    'amount', topup.amount, 'referenceNumber', topup.reference_number,
    'paymentMethod', topup.payment_method_snapshot ->> 'methodName',
    'paymentAccount', topup.payment_method_snapshot ->> 'accountNumber',
    'status', topup.status, 'createdAt', topup.created_at, 'reviewedAt', topup.reviewed_at
  ) order by topup.created_at desc), '[]'::jsonb) into result
  from public.member_fund_topups topup
  join public.profiles profile on profile.id = topup.member_id;
  return result;
end;
$$;

create function public.admin_review_member_fund_topup(
  p_topup_id uuid, p_approve boolean, p_admin_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare topup public.member_fund_topups%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(coalesce(p_admin_note, '')) > 320 then
    raise exception 'Admin note is too long.' using errcode = '22023';
  end if;
  select * into topup from public.member_fund_topups where id = p_topup_id for update;
  if topup.id is null or topup.status <> 'pending' then
    raise exception 'Top-up is not pending.' using errcode = '22023';
  end if;
  if p_approve then
    perform pg_advisory_xact_lock(hashtextextended('payment-ref-' || topup.reference_number, 0));
    if public.approved_payment_reference_used(topup.reference_number) then
      raise exception 'This payment reference was already approved for another request.' using errcode = '22023';
    end if;
  end if;
  update public.member_fund_topups
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = auth.uid(), admin_note = trim(coalesce(p_admin_note, ''))
  where id = topup.id returning * into topup;
  if p_approve then
    insert into public.member_fund_ledger
      (member_id, account, amount, source_type, source_id, note)
    values (topup.member_id, 'main', topup.amount, 'verified_topup', topup.id,
      'Verified payment reference ' || topup.reference_number);
  end if;
  return to_jsonb(topup);
end;
$$;

revoke all on function public.member_fund_balance(uuid,text) from public, anon, authenticated;
revoke all on function public.approved_payment_reference_used(text) from public, anon, authenticated;
revoke all on function public.request_member_fund_topup(numeric,uuid,text),
  public.admin_get_member_fund_topups(),
  public.admin_review_member_fund_topup(uuid,boolean,text) from public, anon;
grant execute on function public.request_member_fund_topup(numeric,uuid,text),
  public.admin_get_member_fund_topups(),
  public.admin_review_member_fund_topup(uuid,boolean,text) to authenticated;
