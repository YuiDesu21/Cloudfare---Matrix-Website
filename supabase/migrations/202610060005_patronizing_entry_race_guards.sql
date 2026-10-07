-- Serialize Patronizing path selection and activation for each member.

create or replace function public.prevent_mixed_patronizing_token_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('patronizing-entry-' || new.member_id::text, 0));
  if exists (
    select 1 from public.commerce_orders
    where member_id = new.member_id
      and order_purpose in ('patronizing_entry_product', 'patronizing_entry_package')
      and status not in ('rejected', 'cancelled')
  ) then raise exception 'Your Patronizing product entry is already in progress.' using errcode = '22023'; end if;
  return new;
end;
$$;

create or replace function public.prevent_mixed_patronizing_product_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.order_purpose not in ('patronizing_entry_product', 'patronizing_entry_package') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('patronizing-entry-' || new.member_id::text, 0));
  if exists (select 1 from public.patronizing_entries where member_id = new.member_id) then
    raise exception 'Your Patronizing entry is already active.' using errcode = '22023';
  end if;
  if exists (select 1 from public.patronizing_token_requests where member_id = new.member_id and status = 'pending') then
    raise exception 'You already have a pending F3 Token entry request.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.commerce_orders
    where member_id = new.member_id
      and order_purpose in ('patronizing_entry_product', 'patronizing_entry_package')
      and order_purpose <> new.order_purpose
      and status not in ('rejected', 'cancelled')
  ) then raise exception 'Finish your current Patronizing product entry path first.' using errcode = '22023'; end if;
  return new;
end;
$$;

create or replace function public.activate_patronizing_entry(
  p_member_id uuid,
  p_entry_type text,
  p_source_token_request_id uuid default null,
  p_source_order_id uuid default null,
  p_activation_time timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  config jsonb := public.patronizing_entry_config(p_entry_type);
  activation jsonb;
  new_entry_id uuid;
begin
  if config is null then raise exception 'Choose a valid Patronizing entry.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('patronizing-entry-' || p_member_id::text, 0));
  activation := public.activate_patronizing_entry_legacy(
    p_member_id, config ->> 'entryType', p_source_token_request_id,
    p_source_order_id, p_activation_time
  );
  new_entry_id := (activation ->> 'entryId')::uuid;
  update public.patronizing_entries
  set plan_code = p_entry_type,
      entry_amount = (config ->> 'entryAmount')::numeric,
      f3_tokens = (config ->> 'f3Tokens')::numeric,
      monthly_requirement = (config ->> 'monthlyRequirement')::numeric,
      monthly_income = (config ->> 'monthlyIncome')::numeric
  where id = new_entry_id;
  update public.patronizing_monthly_income
  set income_amount = (config ->> 'monthlyIncome')::numeric,
      required_purchase = (config ->> 'monthlyRequirement')::numeric
  where entry_id = new_entry_id;
  return activation || jsonb_build_object('planCode', p_entry_type);
end;
$$;

create or replace function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  approved_total numeric;
  target_amount numeric := public.product_entry_target('patronizing_entry_package');
  activation jsonb;
begin
  if p_order.order_purpose in ('patronizing_entry_product', 'patronizing_entry_package') then
    perform pg_advisory_xact_lock(hashtextextended('patronizing-entry-' || p_order.member_id::text, 0));
  end if;
  if p_order.order_purpose <> 'patronizing_entry_package' then
    return public.apply_commerce_order_benefit_legacy(p_order, p_activation_time);
  end if;
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_order.package_type <> 'timeline_entry' then raise exception 'Invalid Patronizing package type.' using errcode = '22023'; end if;
  if exists (select 1 from public.patronizing_entries where member_id = p_order.member_id) then
    raise exception 'This member already has a Patronizing entry.' using errcode = '22023';
  end if;
  select coalesce(sum(package_total), 0) into approved_total
  from public.commerce_orders
  where member_id = p_order.member_id
    and order_purpose = 'patronizing_entry_package'
    and status in ('payment_approved','shipped','received')
    and id <> p_order.id;
  approved_total := round(approved_total + p_order.package_total, 2);
  if approved_total < target_amount then
    return jsonb_build_object('type', 'patronizing_entry_package_progress', 'approvedAmount', approved_total, 'targetAmount', target_amount, 'remainingAmount', target_amount - approved_total);
  end if;
  activation := public.activate_patronizing_entry(p_order.member_id, 'products_2800', null, p_order.id, p_activation_time);
  return jsonb_build_object('type', 'patronizing_entry_package', 'activation', activation, 'approvedAmount', approved_total, 'targetAmount', target_amount);
end;
$$;
