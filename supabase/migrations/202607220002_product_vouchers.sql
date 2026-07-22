-- Approved Products Plus bonuses become non-expiring, partially redeemable vouchers.
alter table public.product_plus_claims
  add column purchase_reference text,
  add column purchase_notes text,
  add column reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.product_plus_claims
  add constraint product_claim_reference_format check (purchase_reference ~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$'),
  add constraint product_claim_notes_length check (char_length(coalesce(purchase_notes, '')) <= 240);

create table public.voucher_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  claim_id uuid references public.product_plus_claims(id) on delete restrict,
  entry_type text not null check (entry_type in ('credit', 'redemption', 'adjustment')),
  amount numeric(12,2) not null check (amount <> 0),
  reference text not null check (char_length(reference) between 3 and 60),
  notes text not null default '' check (char_length(notes) <= 240),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((entry_type = 'credit' and amount > 0) or (entry_type <> 'credit' and amount < 0))
);
create unique index one_voucher_credit_per_claim on public.voucher_ledger(claim_id) where entry_type = 'credit';
create index voucher_ledger_member_created_idx on public.voucher_ledger(member_id, created_at desc);
alter table public.voucher_ledger enable row level security;
create policy voucher_ledger_read_self on public.voucher_ledger for select to authenticated using (member_id = auth.uid() or public.is_admin());

create or replace function public.get_my_vouchers() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'balance', coalesce(sum(amount), 0),
    'history', coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', entry_type, 'amount', amount, 'reference', reference, 'notes', notes, 'createdAt', created_at) order by created_at desc), '[]'::jsonb)
  ) from public.voucher_ledger where member_id = auth.uid();
$$;

create or replace function public.get_my_product_plus()
returns jsonb language sql stable security definer set search_path = '' as $$
  with entitlements as (
    select rule.*, action.approved_at,
      case when action.id is null then 0 else (
        select count(*) from generate_series(1, rule.product_months) as months(month_number)
        where date_trunc('month', action.approved_at) + (months.month_number + 1) * interval '1 month' - interval '1 second' <= now()
      ) end::integer as vested_months
    from public.matrix_exit_rules rule
    left join public.exit_actions action on action.member_id=auth.uid() and action.exit_number=rule.exit_number and action.status='approved'
    where rule.product_spend > 0 and rule.product_months > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'exit', item.exit_number, 'active', item.approved_at is not null,
    'productBaseSpend', item.product_spend, 'productBonusPercent', item.product_bonus_percent,
    'productMonths', item.product_months, 'vestedMonths', item.vested_months,
    'totalSpend', item.product_spend * item.product_months,
    'totalBonus', item.product_spend * item.product_months * item.product_bonus_percent / 100,
    'vestedSpend', item.product_spend * item.vested_months,
    'approvedSpend', coalesce((select sum(spend_amount) from public.product_plus_claims where member_id=auth.uid() and exit_number=item.exit_number and status='approved'),0),
    'pendingSpend', coalesce((select sum(spend_amount) from public.product_plus_claims where member_id=auth.uid() and exit_number=item.exit_number and status='pending'),0),
    'availableVestedSpend', greatest(item.product_spend * item.vested_months - coalesce((select sum(spend_amount) from public.product_plus_claims where member_id=auth.uid() and exit_number=item.exit_number and status in ('approved','pending')),0),0),
    'nextUnlockAt', case when item.approved_at is not null and item.vested_months < item.product_months then date_trunc('month', item.approved_at) + (item.vested_months + 2) * interval '1 month' - interval '1 second' else null end,
    'status', case when item.approved_at is null then 'locked' else 'active' end
  ) order by item.exit_number), '[]'::jsonb) from entitlements item;
$$;

create or replace function public.request_product_plus_claim(p_exit_number smallint, p_spend_amount numeric, p_purchase_reference text, p_purchase_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rule public.matrix_exit_rules; claim public.product_plus_claims; action_approved_at timestamptz; vested_months integer; already_claimed numeric;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if p_spend_amount <= 0 or p_spend_amount > 1000000 then raise exception 'Purchase amount must be between PHP 0.01 and PHP 1,000,000.' using errcode = '22023'; end if;
  if trim(coalesce(p_purchase_reference, '')) !~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$' then raise exception 'Reference must be 3-60 letters, numbers, spaces, or . / # -.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_purchase_notes, ''))) > 240 then raise exception 'Notes must be 240 characters or fewer.' using errcode = '22023'; end if;
  select * into rule from public.matrix_exit_rules where exit_number = p_exit_number;
  if rule.exit_number is null or rule.product_bonus_percent <= 0 then raise exception 'Products Plus is not configured for this Exit.' using errcode = '22023'; end if;
  select approved_at into action_approved_at from public.exit_actions where member_id=auth.uid() and exit_number=p_exit_number and status='approved';
  if action_approved_at is null then raise exception 'This Products Plus Exit is not active.' using errcode = '42501'; end if;
  select count(*) into vested_months from generate_series(1, rule.product_months) as months(month_number)
    where date_trunc('month', action_approved_at) + (months.month_number + 1) * interval '1 month' - interval '1 second' <= now();
  select coalesce(sum(spend_amount),0) into already_claimed from public.product_plus_claims
    where member_id=auth.uid() and exit_number=p_exit_number and status in ('approved','pending');
  if p_spend_amount > greatest(rule.product_spend * vested_months - already_claimed,0) then raise exception 'Claim exceeds the vested Products Plus purchase amount.' using errcode = '22023'; end if;
  insert into public.product_plus_claims(member_id, exit_number, spend_amount, bonus_percent, bonus_amount, purchase_reference, purchase_notes)
  values (auth.uid(), p_exit_number, round(p_spend_amount,2), rule.product_bonus_percent, round(p_spend_amount * rule.product_bonus_percent / 100,2), trim(p_purchase_reference), trim(coalesce(p_purchase_notes,''))) returning * into claim;
  return to_jsonb(claim);
end;
$$;

create or replace function public.admin_get_product_plus_claims()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',claim.id,'memberId',claim.member_id,'fullName',profile.full_name,'username',profile.username,'accountCode',profile.account_code,'exit',claim.exit_number,'spendAmount',claim.spend_amount,'bonusPercent',claim.bonus_percent,'bonusAmount',claim.bonus_amount,'purchaseReference',claim.purchase_reference,'purchaseNotes',claim.purchase_notes,'status',claim.status,'createdAt',claim.created_at) order by claim.created_at), '[]'::jsonb)
  into result from public.product_plus_claims claim join public.profiles profile on profile.id=claim.member_id where claim.status='pending';
  return result;
end; $$;

create or replace function public.admin_reject_product_plus_claim(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claim public.product_plus_claims;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  select * into claim from public.product_plus_claims where id=p_claim_id for update;
  if claim.id is null or claim.status <> 'pending' then raise exception 'Claim is missing or no longer pending.' using errcode='22023'; end if;
  if claim.member_id=auth.uid() then raise exception 'Administrators cannot review their own Products Plus claims.' using errcode='42501'; end if;
  update public.product_plus_claims set status='rejected', rejected_at=now(), reviewed_by=auth.uid() where id=claim.id;
  return jsonb_build_object('rejected',true);
end; $$;

create or replace function public.admin_approve_product_plus_claim(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claim public.product_plus_claims;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into claim from public.product_plus_claims where id = p_claim_id for update;
  if claim.id is null or claim.status <> 'pending' then raise exception 'Claim is missing or no longer pending.' using errcode = '22023'; end if;
  if claim.member_id = auth.uid() then raise exception 'Administrators cannot approve their own Products Plus claims.' using errcode = '42501'; end if;
  update public.product_plus_claims set status='approved', approved_at=now(), reviewed_by=auth.uid() where id=claim.id;
  insert into public.voucher_ledger(member_id, claim_id, entry_type, amount, reference, notes, created_by)
  values (claim.member_id, claim.id, 'credit', claim.bonus_amount, 'Products Plus Exit ' || claim.exit_number, 'Approved purchase bonus', auth.uid());
  return jsonb_build_object('approved', true, 'voucherCredit', claim.bonus_amount);
end;
$$;

create or replace function public.admin_redeem_voucher(p_member_id uuid, p_amount numeric, p_reference text, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare balance numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_member_id=auth.uid() then raise exception 'Administrators cannot redeem vouchers for their own account.' using errcode='42501'; end if;
  if p_amount <= 0 then raise exception 'Redemption amount must be greater than zero.' using errcode = '22023'; end if;
  if trim(coalesce(p_reference,'')) !~ '^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$' or char_length(trim(coalesce(p_notes,''))) > 240 then raise exception 'Check the reference and notes limits.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_member_id::text));
  select coalesce(sum(amount),0) into balance from public.voucher_ledger where member_id=p_member_id;
  if p_amount > balance then raise exception 'Redemption exceeds the available voucher balance.' using errcode = '22023'; end if;
  insert into public.voucher_ledger(member_id, entry_type, amount, reference, notes, created_by)
  values (p_member_id, 'redemption', -round(p_amount,2), trim(p_reference), trim(coalesce(p_notes,'')), auth.uid());
  return jsonb_build_object('redeemed', round(p_amount,2), 'balance', balance-round(p_amount,2));
end;
$$;

revoke all on function public.get_my_vouchers(), public.get_my_product_plus(), public.request_product_plus_claim(smallint,numeric,text,text), public.admin_get_product_plus_claims(), public.admin_approve_product_plus_claim(uuid), public.admin_reject_product_plus_claim(uuid), public.admin_redeem_voucher(uuid,numeric,text,text) from public, anon;
grant execute on function public.get_my_vouchers(), public.get_my_product_plus(), public.request_product_plus_claim(smallint,numeric,text,text), public.admin_get_product_plus_claims(), public.admin_approve_product_plus_claim(uuid), public.admin_reject_product_plus_claim(uuid), public.admin_redeem_voucher(uuid,numeric,text,text) to authenticated;
