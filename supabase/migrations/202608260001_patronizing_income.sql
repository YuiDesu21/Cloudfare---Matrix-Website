-- Patronizing Income timeline matrix, entries, monthly unlocks, and exit discounts.

alter table public.reward_ledger drop constraint if exists reward_ledger_source_type_check;
alter table public.reward_ledger
  add constraint reward_ledger_source_type_check
  check (source_type in ('entry', 'exit', 'matrix', 'timeline_matrix', 'patronizing_income'));

alter table public.commerce_orders
  add column if not exists order_purpose text not null default 'standard',
  add column if not exists patronizing_exit_number smallint,
  add column if not exists discount_percent numeric(5,2) not null default 0,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists discount_source text not null default '';

alter table public.commerce_orders drop constraint if exists commerce_orders_order_purpose_check;
alter table public.commerce_orders
  add constraint commerce_orders_order_purpose_check
  check (order_purpose in ('standard', 'patronizing_entry_product', 'patronizing_monthly_requirement', 'patronizing_exit_discount'));

alter table public.commerce_orders drop constraint if exists commerce_orders_discount_check;
alter table public.commerce_orders
  add constraint commerce_orders_discount_check
  check (discount_percent between 0 and 100 and discount_amount >= 0);

create index if not exists commerce_orders_purpose_member_idx
  on public.commerce_orders(order_purpose, member_id, status, created_at desc);

create table if not exists public.patronizing_token_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  payment_method_snapshot jsonb not null default '{}'::jsonb,
  wallet_address text not null,
  amount numeric(12,2) not null default 2100 check (amount = 2100),
  f3_tokens numeric(12,2) not null default 35 check (f3_tokens = 35),
  reference_number text not null unique check (reference_number ~ '^[A-Z0-9][A-Z0-9 _./#-]{2,59}$'),
  notes text not null default '' check (char_length(notes) <= 240),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  decision_note text not null default '' check (char_length(decision_note) <= 240)
);

create unique index if not exists one_pending_patronizing_token_request
  on public.patronizing_token_requests(member_id)
  where status = 'pending';

create table if not exists public.patronizing_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null unique references public.profiles(id) on delete restrict,
  entry_type text not null check (entry_type in ('f3_token', 'products')),
  entry_amount numeric(12,2) not null check (entry_amount > 0),
  f3_tokens numeric(12,2) not null default 0 check (f3_tokens >= 0),
  monthly_requirement numeric(12,2) not null check (monthly_requirement > 0),
  monthly_income numeric(12,2) not null check (monthly_income > 0),
  duration_months smallint not null default 24 check (duration_months = 24),
  source_token_request_id uuid references public.patronizing_token_requests(id) on delete restrict,
  source_order_id uuid references public.commerce_orders(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.patronizing_monthly_income (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null references public.patronizing_entries(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  month_number smallint not null check (month_number between 1 and 24),
  income_amount numeric(12,2) not null check (income_amount > 0),
  required_purchase numeric(12,2) not null check (required_purchase > 0),
  due_at timestamptz not null,
  status text not null default 'reflected' check (status in ('reflected', 'unlocked')),
  unlocked_at timestamptz,
  reward_ledger_id uuid references public.reward_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(entry_id, month_number)
);

create index if not exists patronizing_monthly_member_due_idx
  on public.patronizing_monthly_income(member_id, due_at, status);

create table if not exists public.patronizing_exit_rules (
  exit_number smallint primary key check (exit_number between 1 and 13),
  required_downline_exit smallint not null default 0 check (required_downline_exit between 0 and 12),
  max_purchase numeric(12,2) not null check (max_purchase > 0),
  discount_percent numeric(5,2) not null check (discount_percent between 0 and 100)
);

insert into public.patronizing_exit_rules(exit_number, required_downline_exit, max_purchase, discount_percent) values
  (1, 0, 1700.00, 15),
  (2, 1, 2475.00, 20),
  (3, 2, 3780.00, 25),
  (4, 3, 5400.00, 30),
  (5, 4, 10414.29, 35),
  (6, 5, 18225.00, 40),
  (7, 6, 38880.00, 45),
  (8, 7, 91854.00, 50),
  (9, 8, 178936.36, 55),
  (10, 9, 393660.00, 60),
  (11, 10, 817601.54, 65),
  (12, 11, 1518402.86, 70),
  (13, 12, 4251528.00, 75)
on conflict (exit_number) do update set
  required_downline_exit = excluded.required_downline_exit,
  max_purchase = excluded.max_purchase,
  discount_percent = excluded.discount_percent;

create table if not exists public.patronizing_exit_progress (
  member_id uuid not null references public.profiles(id) on delete restrict,
  exit_number smallint not null references public.patronizing_exit_rules(exit_number),
  status text not null default 'active' check (status in ('active')),
  approved_at timestamptz not null default now(),
  primary key(member_id, exit_number)
);

alter table public.patronizing_token_requests enable row level security;
alter table public.patronizing_entries enable row level security;
alter table public.patronizing_monthly_income enable row level security;
alter table public.patronizing_exit_rules enable row level security;
alter table public.patronizing_exit_progress enable row level security;

drop policy if exists patronizing_token_requests_read_self on public.patronizing_token_requests;
create policy patronizing_token_requests_read_self on public.patronizing_token_requests
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

drop policy if exists patronizing_entries_read_self on public.patronizing_entries;
create policy patronizing_entries_read_self on public.patronizing_entries
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

drop policy if exists patronizing_monthly_read_self on public.patronizing_monthly_income;
create policy patronizing_monthly_read_self on public.patronizing_monthly_income
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

drop policy if exists patronizing_exit_rules_read on public.patronizing_exit_rules;
create policy patronizing_exit_rules_read on public.patronizing_exit_rules
  for select to authenticated using (true);

drop policy if exists patronizing_exit_progress_read_self on public.patronizing_exit_progress;
create policy patronizing_exit_progress_read_self on public.patronizing_exit_progress
  for select to authenticated using (member_id = auth.uid() or public.is_admin());

create or replace function public.patronizing_entry_config(p_entry_type text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case p_entry_type
    when 'f3_token' then jsonb_build_object('entryType', 'f3_token', 'entryLabel', 'F3 Token Entry', 'entryAmount', 2100, 'f3Tokens', 35, 'monthlyRequirement', 1000, 'monthlyIncome', 200, 'durationMonths', 24)
    when 'products' then jsonb_build_object('entryType', 'products', 'entryLabel', 'Product Entry', 'entryAmount', 5818, 'f3Tokens', 0, 'monthlyRequirement', 1250, 'monthlyIncome', 250, 'durationMonths', 24)
    else null::jsonb
  end;
$$;

create or replace function public.patronizing_exit_for(p_member_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(progress.exit_number), 0)::smallint
  from public.patronizing_exit_progress progress
  where progress.member_id = p_member_id;
$$;

create or replace function public.refresh_patronizing_progress(p_member_id uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.patronizing_exit_rules%rowtype;
  qualified_downlines integer;
  highest smallint := 0;
  unlocked_at timestamptz := now();
begin
  if not exists (
    select 1 from public.matrix_positions position
    where position.member_id = p_member_id and position.plan_id = 'patronizing-income'
  ) then
    return 0;
  end if;

  for rule in select * from public.patronizing_exit_rules order by exit_number loop
    if exists (
      select 1 from public.patronizing_exit_progress progress
      where progress.member_id = p_member_id and progress.exit_number = rule.exit_number
    ) then
      continue;
    end if;

    if rule.exit_number > 1 and not exists (
      select 1 from public.patronizing_exit_progress progress
      where progress.member_id = p_member_id and progress.exit_number = rule.exit_number - 1
    ) then
      exit;
    end if;

    select count(*)::integer into qualified_downlines
    from public.matrix_positions child
    where child.parent_member_id = p_member_id
      and child.plan_id = 'patronizing-income'
      and public.patronizing_exit_for(child.member_id) >= rule.required_downline_exit;

    exit when qualified_downlines < 3;

    insert into public.patronizing_exit_progress(member_id, exit_number, status, approved_at)
    values (p_member_id, rule.exit_number, 'active', unlocked_at)
    on conflict (member_id, exit_number) do nothing;
  end loop;

  select public.patronizing_exit_for(p_member_id) into highest;
  return highest;
end;
$$;

create or replace function public.refresh_patronizing_ancestor_progress(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_member_id uuid := p_member_id;
  parent_id uuid;
  guard_count integer := 0;
begin
  loop
    guard_count := guard_count + 1;
    exit when current_member_id is null or guard_count > 100;
    perform public.refresh_patronizing_progress(current_member_id);
    select position.parent_member_id into parent_id
    from public.matrix_positions position
    where position.member_id = current_member_id and position.plan_id = 'patronizing-income';
    current_member_id := parent_id;
  end loop;
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.profiles%rowtype;
  config jsonb := public.patronizing_entry_config(p_entry_type);
  entry_row public.patronizing_entries%rowtype;
  selected_parent uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if config is null then raise exception 'Choose a valid Patronizing entry type.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('patronizing-income-placement', 0));

  select * into target_member from public.profiles where id = p_member_id for update;
  if target_member.id is null then raise exception 'Member profile was not found.' using errcode = 'P0002'; end if;
  if target_member.status = 'suspended' then raise exception 'Suspended members cannot enter Patronizing Income.' using errcode = '42501'; end if;
  if exists (select 1 from public.patronizing_entries where member_id = target_member.id and status = 'active') then
    raise exception 'This member already has an active Patronizing Income entry.' using errcode = '22023';
  end if;
  if exists (select 1 from public.matrix_positions where member_id = target_member.id and plan_id = 'patronizing-income') then
    raise exception 'This member is already placed in the Patronizing Income matrix.' using errcode = '22023';
  end if;

  select position.member_id into selected_parent
  from public.matrix_positions position
  where position.plan_id = 'patronizing-income'
    and (
      select count(*)
      from public.matrix_positions child
      where child.plan_id = 'patronizing-income'
        and child.parent_member_id = position.member_id
    ) < 3
  order by position.placed_at, position.id
  limit 1;

  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (target_member.id, 'patronizing-income', selected_parent, p_activation_time);

  insert into public.patronizing_entries(
    member_id, entry_type, entry_amount, f3_tokens, monthly_requirement, monthly_income,
    duration_months, source_token_request_id, source_order_id, status, activated_at
  )
  values (
    target_member.id,
    p_entry_type,
    (config ->> 'entryAmount')::numeric,
    (config ->> 'f3Tokens')::numeric,
    (config ->> 'monthlyRequirement')::numeric,
    (config ->> 'monthlyIncome')::numeric,
    24,
    p_source_token_request_id,
    p_source_order_id,
    'active',
    p_activation_time
  )
  returning * into entry_row;

  insert into public.patronizing_monthly_income(entry_id, member_id, month_number, income_amount, required_purchase, due_at)
  select entry_row.id, target_member.id, month_number::smallint, entry_row.monthly_income, entry_row.monthly_requirement,
    p_activation_time + month_number * interval '1 month'
  from generate_series(1, 24) as months(month_number);

  perform public.refresh_patronizing_ancestor_progress(target_member.id);

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'patronizing-entry-activated', 'Activated Patronizing Income for ' || target_member.full_name || '.', jsonb_build_object('memberId', target_member.id, 'entryType', p_entry_type, 'parentMemberId', selected_parent));

  return jsonb_build_object('entryId', entry_row.id, 'planId', 'patronizing-income', 'parentMemberId', selected_parent, 'entryType', p_entry_type);
end;
$$;

create or replace function public.apply_patronizing_monthly_unlocks(
  p_member_id uuid,
  p_unlock_time timestamptz default now(),
  p_extra_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.patronizing_entries%rowtype;
  income_row public.patronizing_monthly_income%rowtype;
  approved_purchase_total numeric := 0;
  ledger_id uuid;
  unlocked_count integer := 0;
begin
  select * into entry_row
  from public.patronizing_entries
  where member_id = p_member_id and status = 'active'
  order by activated_at desc
  limit 1;

  if entry_row.id is null then return jsonb_build_object('unlocked', 0, 'approvedPurchaseTotal', 0); end if;

  select coalesce(sum(order_row.package_total), 0) into approved_purchase_total
  from public.commerce_orders order_row
  where order_row.member_id = p_member_id
    and order_row.order_purpose = 'patronizing_monthly_requirement'
    and (order_row.status in ('payment_approved','shipped','received') or order_row.id = p_extra_order_id);

  for income_row in
    select *
    from public.patronizing_monthly_income income
    where income.entry_id = entry_row.id
      and income.status = 'reflected'
      and income.due_at <= p_unlock_time
      and approved_purchase_total >= income.required_purchase * income.month_number
    order by income.month_number
  loop
    insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
    values (p_member_id, 'patronizing-income', 'patronizing_income', 'Patronizing Income Month ' || income_row.month_number, income_row.income_amount, income_row.due_at, 'due', p_unlock_time)
    returning id into ledger_id;

    update public.patronizing_monthly_income
    set status = 'unlocked',
        unlocked_at = p_unlock_time,
        reward_ledger_id = ledger_id
    where id = income_row.id;

    unlocked_count := unlocked_count + 1;
  end loop;

  return jsonb_build_object('unlocked', unlocked_count, 'approvedPurchaseTotal', approved_purchase_total);
end;
$$;

create or replace function public.request_patronizing_token_entry(
  p_payment_method_id uuid,
  p_reference_number text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  method public.payment_methods%rowtype;
  created_request public.patronizing_token_requests%rowtype;
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if normalized_reference !~ '^[A-Z0-9][A-Z0-9 _./#-]{2,59}$' then raise exception 'Reference number must be 3-60 letters, numbers, spaces, or . / # -.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_notes, ''))) > 240 then raise exception 'Notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile was not found.' using errcode = 'P0002'; end if;
  if trim(coalesce(caller.wallet_address, '')) = '' then raise exception 'Add your F3 wallet address before requesting Patronizing Income.' using errcode = '22023'; end if;
  if exists (select 1 from public.patronizing_entries where member_id = caller.id and status = 'active') then raise exception 'Your Patronizing Income entry is already active.' using errcode = '22023'; end if;
  if exists (select 1 from public.patronizing_token_requests where member_id = caller.id and status = 'pending') then raise exception 'You already have a pending Patronizing F3 Token entry request.' using errcode = '23505'; end if;
  if exists (select 1 from public.patronizing_token_requests where reference_number = normalized_reference and status <> 'rejected')
    or exists (select 1 from public.commerce_order_payments where reference_number = normalized_reference and status <> 'rejected') then
    raise exception 'This reference number is already in use.' using errcode = '23505';
  end if;

  select * into method from public.payment_methods where id = p_payment_method_id and is_active = true;
  if method.id is null then raise exception 'Choose an active payment method.' using errcode = 'P0002'; end if;

  insert into public.patronizing_token_requests(member_id, payment_method_id, payment_method_snapshot, wallet_address, reference_number, notes)
  values (caller.id, method.id, public.payment_method_json(method), caller.wallet_address, normalized_reference, trim(coalesce(p_notes, '')))
  returning * into created_request;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (caller.id, 'patronizing-token-entry-requested', 'Member requested Patronizing Income F3 Token entry.', jsonb_build_object('requestId', created_request.id));

  return public.get_my_patronizing_dashboard();
end;
$$;

create or replace function public.request_patronizing_product_order(
  p_order_purpose text,
  p_shipping_address_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_member_notes text default '',
  p_exit_number smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  address public.shipping_addresses%rowtype;
  order_row public.commerce_orders%rowtype;
  product public.commerce_products%rowtype;
  item jsonb;
  item_index integer := 0;
  product_id uuid;
  product_quantity integer;
  cart_items jsonb := '[]'::jsonb;
  cart_snapshot jsonb;
  package_total numeric := 0;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  exit_rule public.patronizing_exit_rules%rowtype;
  used_exit_total numeric := 0;
  discount_value numeric := 0;
  purpose_label text;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if p_order_purpose not in ('patronizing_entry_product', 'patronizing_monthly_requirement', 'patronizing_exit_discount') then
    raise exception 'Choose a valid Patronizing checkout type.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;
  if jsonb_typeof(normalized_items) <> 'array' then raise exception 'Cart items must be an array.' using errcode = '22023'; end if;
  if jsonb_array_length(normalized_items) = 0 then raise exception 'Add at least one product to the cart.' using errcode = '22023'; end if;
  if jsonb_array_length(normalized_items) > 40 then raise exception 'A cart can have up to 40 lines.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));

  select * into address
  from public.shipping_addresses
  where id = p_shipping_address_id
    and member_id = auth.uid();
  if address.id is null then raise exception 'Choose one of your saved shipping addresses.' using errcode = 'P0002'; end if;

  for item in select * from jsonb_array_elements(normalized_items)
  loop
    item_index := item_index + 1;
    product_id := nullif(item ->> 'productId', '')::uuid;
    product_quantity := coalesce(nullif(item ->> 'quantity', '')::integer, 1);
    if product_quantity < 1 or product_quantity > 999 then raise exception 'Product quantity must be between 1 and 999.' using errcode = '22023'; end if;

    select * into product
    from public.commerce_products product_row
    where product_row.id = product_id
      and product_row.product_type = 'product_plus_requirement'
      and product_row.is_active = true;
    if product.id is null then raise exception 'One product in your cart is no longer available.' using errcode = 'P0002'; end if;

    package_total := package_total + (product.price * product_quantity);
    cart_items := cart_items || jsonb_build_array(jsonb_build_object(
      'id', product.id,
      'productId', product.id,
      'itemName', product.product_name,
      'price', product.price,
      'quantity', product_quantity,
      'photoData', product.photo_data,
      'sortOrder', item_index * 10
    ));
  end loop;

  if package_total <= 0 then raise exception 'Cart total must be greater than zero.' using errcode = '22023'; end if;

  if p_order_purpose = 'patronizing_entry_product' then
    if exists (select 1 from public.patronizing_entries where member_id = auth.uid() and status = 'active') then raise exception 'Your Patronizing Income entry is already active.' using errcode = '22023'; end if;
    if package_total < 5818 then raise exception 'Product entry requires at least PHP 5,818 in products.' using errcode = '22023'; end if;
    if exists (
      select 1 from public.commerce_orders existing
      where existing.member_id = auth.uid()
        and existing.order_purpose = 'patronizing_entry_product'
        and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
    ) then raise exception 'You already have an active Patronizing product entry order.' using errcode = '23505'; end if;
    purpose_label := 'Patronizing Product Entry';
  elsif p_order_purpose = 'patronizing_monthly_requirement' then
    if not exists (select 1 from public.patronizing_entries where member_id = auth.uid() and status = 'active') then raise exception 'Activate Patronizing Income before buying monthly requirement products.' using errcode = '22023'; end if;
    purpose_label := 'Patronizing Monthly Requirement';
  else
    if p_exit_number is null then raise exception 'Choose the Patronizing exit discount to use.' using errcode = '22023'; end if;
    select * into exit_rule from public.patronizing_exit_rules where exit_number = p_exit_number;
    if exit_rule.exit_number is null then raise exception 'Patronizing exit rule not found.' using errcode = 'P0002'; end if;
    if not exists (select 1 from public.patronizing_exit_progress where member_id = auth.uid() and exit_number = p_exit_number) then
      raise exception 'This Patronizing exit discount is not unlocked yet.' using errcode = '22023';
    end if;
    select coalesce(sum(existing.package_total), 0) into used_exit_total
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.order_purpose = 'patronizing_exit_discount'
      and existing.patronizing_exit_number = p_exit_number
      and existing.status not in ('rejected','cancelled');
    if used_exit_total + package_total > exit_rule.max_purchase then
      raise exception 'This cart exceeds your remaining Patronizing exit discount balance.' using errcode = '22023';
    end if;
    discount_value := round(package_total * exit_rule.discount_percent / 100, 2);
    purpose_label := 'Patronizing Exit ' || p_exit_number || ' Discount';
  end if;

  cart_snapshot := jsonb_build_object(
    'packageName', purpose_label || ' Cart',
    'packageType', 'product_plus_requirement',
    'packageTypeLabel', purpose_label,
    'description', 'Individual product checkout',
    'totalPrice', round(package_total, 2),
    'items', cart_items
  );

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, order_purpose,
    patronizing_exit_number, discount_percent, discount_amount, discount_source
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), null, 'product_plus_requirement', cart_snapshot,
    address.id, public.shipping_address_json(address), round(package_total, 2),
    0, greatest(round(package_total - discount_value, 2), 0), trim(coalesce(p_member_notes, '')), p_order_purpose,
    case when p_order_purpose = 'patronizing_exit_discount' then p_exit_number else null end,
    case when p_order_purpose = 'patronizing_exit_discount' then exit_rule.discount_percent else 0 end,
    discount_value,
    case when p_order_purpose = 'patronizing_exit_discount' then 'Patronizing Exit ' || p_exit_number else '' end
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'patronizing-product-order-requested', 'Member requested a Patronizing product checkout.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'purpose', p_order_purpose, 'exit', p_exit_number, 'discount', discount_value));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.admin_get_patronizing_token_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'memberId', request.member_id,
    'fullName', profile.full_name,
    'username', profile.username,
    'accountCode', profile.account_code,
    'walletAddress', request.wallet_address,
    'amount', request.amount,
    'f3Tokens', request.f3_tokens,
    'referenceNumber', request.reference_number,
    'paymentMethod', request.payment_method_snapshot,
    'notes', request.notes,
    'status', request.status,
    'createdAt', request.created_at,
    'approvedAt', request.approved_at,
    'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.patronizing_token_requests request
  join public.profiles profile on profile.id = request.member_id;

  return result;
end;
$$;

create or replace function public.admin_approve_patronizing_token_request(
  p_request_id uuid,
  p_decision_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.patronizing_token_requests%rowtype;
  approval_time timestamptz := now();
  activation jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_decision_note, ''))) > 240 then raise exception 'Decision note must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into target from public.patronizing_token_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Patronizing token request is no longer pending.' using errcode = '22023'; end if;
  if target.member_id = auth.uid() then raise exception 'You cannot approve your own Patronizing entry.' using errcode = '42501'; end if;

  activation := public.activate_patronizing_entry(target.member_id, 'f3_token', target.id, null, approval_time);

  update public.patronizing_token_requests
  set status = 'approved',
      approved_at = approval_time,
      reviewed_by = auth.uid(),
      decision_note = trim(coalesce(p_decision_note, ''))
  where id = target.id;

  return jsonb_build_object('status', 'approved', 'requestId', target.id, 'activation', activation);
end;
$$;

create or replace function public.admin_reject_patronizing_token_request(
  p_request_id uuid,
  p_decision_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.patronizing_token_requests%rowtype;
  normalized_note text := trim(coalesce(p_decision_note, ''));
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_note) < 3 or char_length(normalized_note) > 240 then raise exception 'Rejection note must be 3-240 characters.' using errcode = '22023'; end if;

  select * into target from public.patronizing_token_requests where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Patronizing token request is no longer pending.' using errcode = '22023'; end if;
  if target.member_id = auth.uid() then raise exception 'You cannot reject your own Patronizing entry.' using errcode = '42501'; end if;

  update public.patronizing_token_requests
  set status = 'rejected',
      rejected_at = now(),
      reviewed_by = auth.uid(),
      decision_note = normalized_note
  where id = target.id;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'patronizing-token-entry-rejected', 'Admin rejected a Patronizing F3 Token entry request.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id));

  return jsonb_build_object('status', 'rejected', 'requestId', target.id);
end;
$$;

create or replace function public.commerce_order_json(p_order public.commerce_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'orderCode', p_order.order_code,
    'memberId', p_order.member_id,
    'packageId', p_order.package_id,
    'packageType', p_order.package_type,
    'packageTypeLabel', case
      when p_order.order_purpose = 'patronizing_entry_product' then 'Patronizing Product Entry'
      when p_order.order_purpose = 'patronizing_monthly_requirement' then 'Patronizing Monthly Requirement'
      when p_order.order_purpose = 'patronizing_exit_discount' then 'Patronizing Exit ' || p_order.patronizing_exit_number || ' Discount'
      else public.commerce_package_type_label(p_order.package_type)
    end,
    'orderPurpose', p_order.order_purpose,
    'patronizingExit', p_order.patronizing_exit_number,
    'discountPercent', p_order.discount_percent,
    'discountAmount', p_order.discount_amount,
    'discountSource', p_order.discount_source,
    'packageSnapshot', p_order.package_snapshot,
    'shippingAddressId', p_order.shipping_address_id,
    'shippingAddressSnapshot', p_order.shipping_address_snapshot,
    'packageTotal', p_order.package_total,
    'shippingFee', p_order.shipping_fee,
    'voucherAmount', p_order.voucher_amount,
    'amountDue', p_order.amount_due,
    'status', p_order.status,
    'matrixUplineMemberId', p_order.matrix_upline_member_id,
    'matrixUplineCode', p_order.matrix_upline_code,
    'matrixUpline', (select jsonb_build_object('id', upline.id, 'fullName', upline.full_name, 'username', upline.username, 'accountCode', upline.account_code)
      from public.profiles upline where upline.id = p_order.matrix_upline_member_id),
    'memberNotes', p_order.member_notes,
    'adminNotes', p_order.admin_notes,
    'courierName', p_order.courier_name,
    'trackingNumber', p_order.tracking_number,
    'shippingNotes', p_order.shipping_notes,
    'latestPayment', (
      select public.commerce_order_payment_json(payment)
      from public.commerce_order_payments payment
      where payment.order_id = p_order.id
      order by payment.created_at desc
      limit 1
    ),
    'createdAt', p_order.created_at,
    'updatedAt', p_order.updated_at,
    'approvedAt', p_order.approved_at,
    'rejectedAt', p_order.rejected_at,
    'shippedAt', p_order.shipped_at,
    'receivedAt', p_order.received_at
  );
$$;

create or replace function public.admin_approve_commerce_order_fee(
  p_order_id uuid,
  p_shipping_fee numeric,
  p_admin_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.commerce_orders%rowtype;
  normalized_fee numeric := round(coalesce(p_shipping_fee, 0), 2);
  voucher_balance numeric;
  next_status text;
  next_amount_due numeric;
  discounted_subtotal numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if normalized_fee < 0 or normalized_fee > 100000 then raise exception 'Shipping fee must be between PHP 0 and PHP 100,000.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_admin_notes, ''))) > 320 then raise exception 'Admin notes must be 320 characters or fewer.' using errcode = '22023'; end if;

  select * into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.status <> 'pending_shipping_fee' then raise exception 'Only orders waiting for shipping fee can be approved.' using errcode = '22023'; end if;
  if order_row.member_id = auth.uid() then raise exception 'Administrators cannot approve their own orders.' using errcode = '42501'; end if;

  if order_row.package_type = 'product_plus_voucher' and order_row.order_purpose = 'standard' then
    perform pg_advisory_xact_lock(hashtext(order_row.member_id::text));
    select coalesce(sum(amount), 0) into voucher_balance
    from public.voucher_ledger
    where member_id = order_row.member_id;

    if voucher_balance < order_row.package_total then
      raise exception 'Member voucher balance is no longer enough for this order.' using errcode = '22023';
    end if;

    insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
    values (order_row.member_id, order_row.id, 'redemption', -order_row.package_total, order_row.order_code, 'Product Plus voucher package approved', auth.uid());

    next_amount_due := normalized_fee;
  else
    discounted_subtotal := greatest(order_row.package_total - coalesce(order_row.discount_amount, 0), 0);
    next_amount_due := round(discounted_subtotal + normalized_fee, 2);
  end if;

  next_status := case when next_amount_due = 0 then 'payment_approved' else 'approved_for_payment' end;

  update public.commerce_orders
  set shipping_fee = normalized_fee,
      amount_due = next_amount_due,
      status = next_status,
      admin_notes = trim(coalesce(p_admin_notes, '')),
      approved_at = now(),
      updated_at = now()
  where id = order_row.id
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-fee-approved', 'Admin approved an order shipping fee.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'shippingFee', normalized_fee, 'amountDue', next_amount_due, 'discountAmount', order_row.discount_amount));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.profiles%rowtype;
  selected_parent uuid;
  voucher_credit numeric;
  patronizing_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select * into target_member
  from public.profiles
  where id = p_order.member_id
  for update;

  if target_member.id is null then raise exception 'Order member not found.' using errcode = 'P0002'; end if;
  if target_member.status = 'suspended' then raise exception 'Suspended members cannot receive package benefits.' using errcode = '42501'; end if;

  if p_order.order_purpose = 'patronizing_entry_product' then
    patronizing_result := public.activate_patronizing_entry(target_member.id, 'products', null, p_order.id, p_activation_time);
    return jsonb_build_object('type', 'patronizing_entry_product', 'activation', patronizing_result);
  end if;

  if p_order.order_purpose = 'patronizing_monthly_requirement' then
    patronizing_result := public.apply_patronizing_monthly_unlocks(target_member.id, p_activation_time, p_order.id);
    return jsonb_build_object('type', 'patronizing_monthly_requirement', 'unlock', patronizing_result);
  end if;

  if p_order.order_purpose = 'patronizing_exit_discount' then
    return jsonb_build_object('type', 'patronizing_exit_discount', 'exit', p_order.patronizing_exit_number, 'discountAmount', p_order.discount_amount);
  end if;

  if p_order.package_type = 'matrix_1200_entry' then
    perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'power3-passive'
    ) then
      raise exception 'This member is already active in the PHP 1,200 Matrix.' using errcode = '22023';
    end if;

    if p_order.matrix_upline_code is null or p_order.matrix_upline_member_id is null then
      raise exception 'This order has no 1200 Matrix upline code. Ask the member to submit a new order request.' using errcode = '22023';
    end if;

    selected_parent := public.resolve_1200_matrix_upline(p_order.matrix_upline_code, target_member.id);

    update public.profiles
    set status = 'active',
        approved_at = coalesce(approved_at, p_activation_time),
        cumulative_f3_tokens = greatest(cumulative_f3_tokens, 20)
    where id = target_member.id;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'power3-passive', selected_parent, p_activation_time);

    insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
    select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, p_activation_time + month_number * interval '1 month', 'due', p_activation_time
    from generate_series(1, 3) as months(month_number);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-main-matrix-activation', 'Activated PHP 1,200 Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent, 'uplineCode', p_order.matrix_upline_code));

    return jsonb_build_object('type', 'matrix_1200_entry', 'planId', 'power3-passive', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'timeline_entry' then
    perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Timeline Matrix is already active for this account.' using errcode = '22023';
    end if;

    select position.member_id into selected_parent
    from public.matrix_positions position
    where position.plan_id = 'timeline-power3'
      and (
        select count(*)
        from public.matrix_positions child
        where child.plan_id = 'timeline-power3'
          and child.parent_member_id = position.member_id
      ) < 3
    order by position.placed_at, position.id
    limit 1;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'timeline-power3', selected_parent, p_activation_time);

    perform public.refresh_timeline_ancestor_progress(target_member.id);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-timeline-activation', 'Activated Timeline Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent));

    return jsonb_build_object('type', 'timeline_entry', 'planId', 'timeline-power3', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'product_plus_requirement' then
    voucher_credit := round(p_order.package_total, 2);
    if voucher_credit <= 0 then raise exception 'Product Plus voucher credit must be greater than zero.' using errcode = '22023'; end if;

    if not exists (
      select 1 from public.voucher_ledger
      where commerce_order_id = p_order.id
        and entry_type = 'credit'
    ) then
      insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
      values (target_member.id, p_order.id, 'credit', voucher_credit, p_order.order_code, 'Product Plus package purchase completed', auth.uid());
    end if;

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-product-plus-credit', 'Credited Product Plus vouchers from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'voucherCredit', voucher_credit));

    return jsonb_build_object('type', 'product_plus_requirement', 'voucherCredit', voucher_credit);
  end if;

  return jsonb_build_object('type', p_order.package_type, 'status', 'no_matrix_or_voucher_benefit');
end;
$$;

create or replace function public.admin_get_matrix_explorer(p_plan_id text default 'power3-passive')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_plan_id not in ('power3-passive', 'timeline-power3', 'patronizing-income') then raise exception 'Invalid matrix plan.' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.id,
    'memberId', member.id,
    'accountCode', member.account_code,
    'fullName', member.full_name,
    'username', member.username,
    'walletAddress', member.wallet_address,
    'planId', position.plan_id,
    'parentMemberId', position.parent_member_id,
    'placedAt', position.placed_at,
    'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = p_plan_id),
    'matrixStage', case
      when p_plan_id = 'timeline-power3' then jsonb_build_object('label', case when public.timeline_exit_for(member.id) > 0 then 'Exit ' || public.timeline_exit_for(member.id) else 'Entry' end, 'status', 'active', 'exit', public.timeline_exit_for(member.id))
      when p_plan_id = 'patronizing-income' then jsonb_build_object('label', case when public.patronizing_exit_for(member.id) > 0 then 'Exit ' || public.patronizing_exit_for(member.id) else 'Entry' end, 'status', 'active', 'exit', public.patronizing_exit_for(member.id))
      else public.matrix_stage_for(member.id)
    end,
    'parentName', parent.full_name,
    'parentUsername', parent.username
  ) order by position.parent_member_id nulls first, position.placed_at, position.id), '[]'::jsonb)
  into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  left join public.profiles parent on parent.id = position.parent_member_id
  where position.plan_id = p_plan_id;

  return result;
end;
$$;

create or replace function public.get_my_patronizing_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entry as (
    select *
    from public.patronizing_entries
    where member_id = auth.uid() and status = 'active'
    order by activated_at desc
    limit 1
  ), monthly as (
    select coalesce(sum(required_purchase) filter (where due_at <= now()), 0) as due_requirement,
      coalesce(sum(income_amount) filter (where due_at <= now()), 0) as reflected_income,
      coalesce(sum(income_amount) filter (where status = 'unlocked'), 0) as unlocked_income,
      count(*) filter (where due_at <= now())::integer as due_months,
      count(*) filter (where status = 'unlocked')::integer as unlocked_months
    from public.patronizing_monthly_income income
    where income.entry_id = (select id from entry)
  ), purchases as (
    select coalesce(sum(order_row.package_total), 0) as approved_monthly_purchase
    from public.commerce_orders order_row
    where order_row.member_id = auth.uid()
      and order_row.order_purpose = 'patronizing_monthly_requirement'
      and order_row.status in ('payment_approved','shipped','received')
  )
  select jsonb_build_object(
    'plans', jsonb_build_array(public.patronizing_entry_config('f3_token'), public.patronizing_entry_config('products')),
    'position', (select jsonb_build_object('id', position.id, 'memberId', position.member_id, 'planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'placedAt', position.placed_at)
      from public.matrix_positions position where position.member_id = auth.uid() and position.plan_id = 'patronizing-income'),
    'entry', (select jsonb_build_object('id', entry.id, 'entryType', entry.entry_type, 'entryAmount', entry.entry_amount, 'f3Tokens', entry.f3_tokens, 'monthlyRequirement', entry.monthly_requirement, 'monthlyIncome', entry.monthly_income, 'durationMonths', entry.duration_months, 'activatedAt', entry.activated_at) from entry),
    'pendingTokenRequest', (select jsonb_build_object('id', request.id, 'amount', request.amount, 'f3Tokens', request.f3_tokens, 'referenceNumber', request.reference_number, 'walletAddress', request.wallet_address, 'status', request.status, 'createdAt', request.created_at)
      from public.patronizing_token_requests request where request.member_id = auth.uid() and request.status = 'pending' order by request.created_at desc limit 1),
    'pendingProductEntryOrder', (select public.commerce_order_json(order_row)
      from public.commerce_orders order_row where order_row.member_id = auth.uid() and order_row.order_purpose = 'patronizing_entry_product' and order_row.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped') order by order_row.created_at desc limit 1),
    'monthlySummary', jsonb_build_object(
      'dueRequirement', (select due_requirement from monthly),
      'approvedPurchase', (select approved_monthly_purchase from purchases),
      'remainingRequirement', greatest((select due_requirement from monthly) - (select approved_monthly_purchase from purchases), 0),
      'reflectedIncome', (select reflected_income from monthly),
      'unlockedIncome', (select unlocked_income from monthly),
      'lockedIncome', greatest((select reflected_income from monthly) - (select unlocked_income from monthly), 0),
      'dueMonths', (select due_months from monthly),
      'unlockedMonths', (select unlocked_months from monthly)
    ),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', income.month_number, 'amount', income.income_amount, 'requiredPurchase', income.required_purchase, 'dueAt', income.due_at, 'status', case when income.due_at > now() then 'upcoming' else income.status end, 'unlockedAt', income.unlocked_at) order by income.month_number)
      from public.patronizing_monthly_income income where income.entry_id = (select id from entry)), '[]'::jsonb),
    'exits', coalesce((select jsonb_agg(jsonb_build_object(
      'exit', rule.exit_number,
      'requiredDownlineExit', rule.required_downline_exit,
      'maxPurchase', rule.max_purchase,
      'discountPercent', rule.discount_percent,
      'qualifiedDownlines', (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'patronizing-income' and public.patronizing_exit_for(child.member_id) >= rule.required_downline_exit),
      'usedPurchase', coalesce((select sum(order_row.package_total) from public.commerce_orders order_row where order_row.member_id = auth.uid() and order_row.order_purpose = 'patronizing_exit_discount' and order_row.patronizing_exit_number = rule.exit_number and order_row.status not in ('rejected','cancelled')), 0),
      'status', case when exists(select 1 from public.patronizing_exit_progress progress where progress.member_id = auth.uid() and progress.exit_number = rule.exit_number) then 'active'
        when rule.exit_number > 1 and not exists(select 1 from public.patronizing_exit_progress progress where progress.member_id = auth.uid() and progress.exit_number = rule.exit_number - 1) then 'locked'
        when (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'patronizing-income' and public.patronizing_exit_for(child.member_id) >= rule.required_downline_exit) >= 3 then 'qualified'
        else 'locked' end
    ) order by rule.exit_number) from public.patronizing_exit_rules rule), '[]'::jsonb)
  );
$$;

create or replace function public.admin_get_members(
  p_search text default '', p_status text default 'all',
  p_page integer default 1, p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := trim(coalesce(p_search, ''));
  normalized_status text := lower(trim(coalesce(p_status, 'all')));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if normalized_status not in ('all', 'registered', 'active', 'suspended') then raise exception 'Invalid member status filter.' using errcode = '22023'; end if;

  with filtered as (
    select profile.*, sponsor.full_name as sponsor_name, sponsor.account_code as sponsor_code
    from public.profiles profile
    left join public.profiles sponsor on sponsor.id = profile.sponsor_id
    where (normalized_status = 'all' or profile.status::text = normalized_status)
      and (normalized_search = ''
        or profile.full_name ilike '%' || normalized_search || '%'
        or profile.username ilike '%' || normalized_search || '%'
        or profile.email ilike '%' || normalized_search || '%'
        or profile.account_code ilike '%' || normalized_search || '%'
        or profile.matrix_upline_code ilike '%' || normalized_search || '%'
        or profile.wallet_address ilike '%' || normalized_search || '%')
  ), counted as (
    select count(*)::integer as total from filtered
  ), page_rows as (
    select * from filtered order by created_at desc, full_name
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', member.id, 'accountCode', member.account_code, 'matrixUplineCode', member.matrix_upline_code, 'fullName', member.full_name,
      'username', member.username, 'email', member.email, 'phone', member.phone,
      'walletAddress', member.wallet_address, 'sponsorId', member.sponsor_id,
      'sponsorName', member.sponsor_name, 'sponsorCode', member.sponsor_code,
      'status', member.status, 'createdAt', member.created_at, 'approvedAt', member.approved_at,
      'mainPosition', (select jsonb_build_object('planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'parentUsername', parent.username, 'placedAt', position.placed_at)
        from public.matrix_positions position left join public.profiles parent on parent.id = position.parent_member_id
        where position.member_id = member.id and position.plan_id = 'power3-passive'),
      'timelinePosition', (select jsonb_build_object('planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'parentUsername', parent.username, 'placedAt', position.placed_at)
        from public.matrix_positions position left join public.profiles parent on parent.id = position.parent_member_id
        where position.member_id = member.id and position.plan_id = 'timeline-power3'),
      'patronizingPosition', (select jsonb_build_object('planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'parentUsername', parent.username, 'placedAt', position.placed_at)
        from public.matrix_positions position left join public.profiles parent on parent.id = position.parent_member_id
        where position.member_id = member.id and position.plan_id = 'patronizing-income'),
      'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = 'power3-passive'),
      'referralCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = 'power3-passive'),
      'currentExit', coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = member.id and action.status = 'approved'), 0)
    ) order by member.created_at desc, member.full_name) from page_rows member), '[]'::jsonb),
    'total', (select total from counted), 'page', safe_page, 'pageSize', safe_page_size,
    'totalPages', greatest(ceil((select total from counted)::numeric / safe_page_size)::integer, 1)
  ) into result;
  return result;
end;
$$;

revoke all on function
  public.patronizing_entry_config(text),
  public.patronizing_exit_for(uuid),
  public.refresh_patronizing_progress(uuid),
  public.refresh_patronizing_ancestor_progress(uuid),
  public.activate_patronizing_entry(uuid,text,uuid,uuid,timestamptz),
  public.apply_patronizing_monthly_unlocks(uuid,timestamptz,uuid),
  public.request_patronizing_token_entry(uuid,text,text),
  public.request_patronizing_product_order(text,uuid,jsonb,text,smallint),
  public.admin_get_patronizing_token_requests(),
  public.admin_approve_patronizing_token_request(uuid,text),
  public.admin_reject_patronizing_token_request(uuid,text),
  public.commerce_order_json(public.commerce_orders),
  public.admin_approve_commerce_order_fee(uuid,numeric,text),
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz),
  public.admin_get_matrix_explorer(text),
  public.admin_get_members(text,text,integer,integer),
  public.get_my_patronizing_dashboard()
from public, anon;

grant execute on function
  public.request_patronizing_token_entry(uuid,text,text),
  public.request_patronizing_product_order(text,uuid,jsonb,text,smallint),
  public.get_my_patronizing_dashboard(),
  public.admin_get_patronizing_token_requests(),
  public.admin_approve_patronizing_token_request(uuid,text),
  public.admin_reject_patronizing_token_request(uuid,text),
  public.admin_approve_commerce_order_fee(uuid,numeric,text),
  public.admin_get_matrix_explorer(text),
  public.admin_get_members(text,text,integer,integer)
to authenticated;
