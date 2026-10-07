-- Keep the original two entries intact while adding the smaller token and package paths.

alter table public.patronizing_token_requests
  add column plan_code text not null default 'f3_token';
alter table public.patronizing_token_requests
  drop constraint if exists patronizing_token_requests_amount_check,
  drop constraint if exists patronizing_token_requests_f3_tokens_check;
alter table public.patronizing_token_requests
  add constraint patronizing_token_request_plan_check check (
    (plan_code = 'f3_token' and amount = 2100 and f3_tokens = 35)
    or (plan_code = 'f3_token_12' and amount = 720 and f3_tokens = 12)
  );

alter table public.patronizing_entries add column plan_code text;
update public.patronizing_entries set plan_code = entry_type where plan_code is null;
alter table public.patronizing_entries alter column plan_code set not null;
alter table public.patronizing_entries
  add constraint patronizing_entry_plan_check check (
    (entry_type = 'f3_token' and plan_code in ('f3_token', 'f3_token_12'))
    or (entry_type = 'products' and plan_code in ('products', 'products_2800'))
  );

create function public.default_patronizing_entry_plan()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.plan_code is null then new.plan_code := new.entry_type; end if;
  return new;
end;
$$;
create trigger patronizing_entry_plan_default
  before insert on public.patronizing_entries
  for each row execute function public.default_patronizing_entry_plan();

alter table public.commerce_orders drop constraint if exists commerce_orders_order_purpose_check;
alter table public.commerce_orders add constraint commerce_orders_order_purpose_check
  check (order_purpose in (
    'standard', 'patronizing_entry_product', 'patronizing_entry_package',
    'patronizing_monthly_requirement', 'patronizing_exit_discount', 'budget_qualification'
  ));

create or replace function public.patronizing_entry_config(p_entry_type text)
returns jsonb
language sql stable set search_path = ''
as $$
  select case p_entry_type
    when 'f3_token' then jsonb_build_object('planCode', 'f3_token', 'entryType', 'f3_token', 'entryLabel', 'F3 Token Entry', 'entryAmount', 2100, 'f3Tokens', 35, 'monthlyRequirement', 1000, 'monthlyIncome', 200, 'durationMonths', 24)
    when 'f3_token_12' then jsonb_build_object('planCode', 'f3_token_12', 'entryType', 'f3_token', 'entryLabel', 'F3 Token Entry', 'entryAmount', 720, 'f3Tokens', 12, 'monthlyRequirement', 500, 'monthlyIncome', 100, 'durationMonths', 24)
    when 'products' then jsonb_build_object('planCode', 'products', 'entryType', 'products', 'entryLabel', 'Product Entry', 'entryAmount', 5818, 'f3Tokens', 0, 'monthlyRequirement', 1250, 'monthlyIncome', 250, 'durationMonths', 24)
    when 'products_2800' then jsonb_build_object('planCode', 'products_2800', 'entryType', 'products', 'entryLabel', 'Timeline Package Entry', 'entryAmount', 2800, 'f3Tokens', 0, 'monthlyRequirement', 750, 'monthlyIncome', 150, 'durationMonths', 24)
    else null::jsonb
  end;
$$;

-- The legacy activation owns placement and 24-row scheduling. Adjust the new
-- tier's amounts in the same transaction, after its usual duplicate checks.
alter function public.activate_patronizing_entry(uuid,text,uuid,uuid,timestamptz)
  rename to activate_patronizing_entry_legacy;
revoke all on function public.activate_patronizing_entry_legacy(uuid,text,uuid,uuid,timestamptz) from public, anon, authenticated;

create function public.activate_patronizing_entry(
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
revoke all on function public.activate_patronizing_entry(uuid,text,uuid,uuid,timestamptz) from public, anon, authenticated;

create function public.request_patronizing_token_entry_plan(
  p_plan_code text,
  p_payment_method_id uuid,
  p_reference_number text,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  method public.payment_methods%rowtype;
  config jsonb := public.patronizing_entry_config(p_plan_code);
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if p_plan_code not in ('f3_token', 'f3_token_12') then raise exception 'Choose an F3 Token entry.' using errcode = '22023'; end if;
  if normalized_reference !~ '^[A-Z0-9][A-Z0-9 _./#-]{2,59}$' then raise exception 'Reference number must be 3-60 valid characters.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_notes, ''))) > 240 then raise exception 'Notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile was not found.' using errcode = 'P0002'; end if;
  if trim(coalesce(caller.wallet_address, '')) = '' then raise exception 'Add your F3 wallet address first.' using errcode = '22023'; end if;
  if exists (select 1 from public.patronizing_entries where member_id = caller.id) then raise exception 'Your Patronizing entry is already active.' using errcode = '22023'; end if;
  if exists (select 1 from public.patronizing_token_requests where member_id = caller.id and status = 'pending') then raise exception 'You already have a pending F3 Token entry request.' using errcode = '23505'; end if;
  if exists (select 1 from public.commerce_orders where member_id = caller.id and order_purpose in ('patronizing_entry_product', 'patronizing_entry_package') and status not in ('rejected', 'cancelled')) then
    raise exception 'Your Patronizing product entry is already in progress.' using errcode = '22023';
  end if;
  if exists (select 1 from public.patronizing_token_requests where reference_number = normalized_reference and status <> 'rejected')
    or exists (select 1 from public.commerce_order_payments where reference_number = normalized_reference and status <> 'rejected') then
    raise exception 'This reference number is already in use.' using errcode = '23505';
  end if;
  select * into method from public.payment_methods where id = p_payment_method_id and is_active = true;
  if method.id is null then raise exception 'Choose an active payment method.' using errcode = 'P0002'; end if;

  insert into public.patronizing_token_requests(
    member_id, payment_method_id, payment_method_snapshot, wallet_address,
    amount, f3_tokens, plan_code, reference_number, notes
  ) values (
    caller.id, method.id, public.payment_method_json(method), caller.wallet_address,
    (config ->> 'entryAmount')::numeric, (config ->> 'f3Tokens')::numeric,
    p_plan_code, normalized_reference, trim(coalesce(p_notes, ''))
  );
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (caller.id, 'patronizing-token-entry-requested', 'Member requested Patronizing Income F3 Token entry.', jsonb_build_object('planCode', p_plan_code));
  return public.get_my_patronizing_dashboard();
end;
$$;
revoke all on function public.request_patronizing_token_entry_plan(text,uuid,text,text) from public, anon;
grant execute on function public.request_patronizing_token_entry_plan(text,uuid,text,text) to authenticated;

-- Keep the old RPC working but reject a token request after product progress.
create function public.prevent_mixed_patronizing_token_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.commerce_orders
    where member_id = new.member_id
      and order_purpose in ('patronizing_entry_product', 'patronizing_entry_package')
      and status not in ('rejected', 'cancelled')
  ) then raise exception 'Your Patronizing product entry is already in progress.' using errcode = '22023'; end if;
  return new;
end;
$$;
create trigger patronizing_token_entry_path_guard
  before insert on public.patronizing_token_requests
  for each row execute function public.prevent_mixed_patronizing_token_entry();

create function public.prevent_mixed_patronizing_product_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.order_purpose not in ('patronizing_entry_product', 'patronizing_entry_package') then return new; end if;
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
create trigger patronizing_product_entry_path_guard
  before insert on public.commerce_orders
  for each row execute function public.prevent_mixed_patronizing_product_entry();

create or replace function public.product_entry_target(p_entry_type text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case p_entry_type
    when 'matrix_1200_entry' then 1200::numeric
    when 'timeline_entry' then 693::numeric
    when 'patronizing_entry_product' then 5818::numeric
    when 'patronizing_entry_package' then 2800::numeric
    else null::numeric
  end;
$$;

create or replace function public.product_entry_progress_for(p_member_id uuid, p_entry_type text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with target as (
    select public.product_entry_target(p_entry_type) as amount
  ), orders as (
    select coalesce(sum(order_row.package_total) filter (where order_row.status in ('payment_approved','shipped','received')), 0) as approved_total,
      coalesce(sum(order_row.package_total) filter (where order_row.status in ('pending_shipping_fee','approved_for_payment','payment_submitted')), 0) as pending_total
    from public.commerce_orders order_row
    where order_row.member_id = p_member_id
      and (
        (p_entry_type in ('matrix_1200_entry','timeline_entry') and order_row.package_type = p_entry_type and order_row.order_purpose = 'standard')
        or (p_entry_type in ('patronizing_entry_product','patronizing_entry_package') and order_row.order_purpose = p_entry_type)
      )
  )
  select jsonb_build_object(
    'entryType', p_entry_type,
    'targetAmount', coalesce((select amount from target), 0),
    'approvedAmount', round((select approved_total from orders), 2),
    'pendingAmount', round((select pending_total from orders), 2),
    'remainingAmount', greatest(coalesce((select amount from target), 0) - (select approved_total from orders), 0),
    'percent', case when coalesce((select amount from target), 0) <= 0 then 0 else least(round((select approved_total from orders) * 100 / (select amount from target), 1), 100) end,
    'isComplete', (select approved_total from orders) >= coalesce((select amount from target), 0)
  );
$$;

create function public.request_patronizing_package_order(
  p_package_id uuid,
  p_shipping_address_id uuid,
  p_member_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  package public.commerce_packages%rowtype;
  address public.shipping_addresses%rowtype;
  snapshot jsonb;
  package_total numeric;
  order_row public.commerce_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));

  select * into package from public.commerce_packages
  where id = p_package_id and package_type = 'timeline_entry' and is_active = true;
  if package.id is null then raise exception 'Choose an active Timeline Matrix package.' using errcode = 'P0002'; end if;
  select * into address from public.shipping_addresses
  where id = p_shipping_address_id and member_id = auth.uid();
  if address.id is null then raise exception 'Choose one of your saved shipping addresses.' using errcode = 'P0002'; end if;
  snapshot := public.commerce_package_json(package);
  package_total := coalesce((snapshot ->> 'totalPrice')::numeric, 0);
  if package_total <= 0 or jsonb_array_length(coalesce(snapshot -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'This package has no payable items.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.commerce_orders
    where member_id = auth.uid() and package_id = package.id
      and order_purpose = 'patronizing_entry_package'
      and status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then raise exception 'You already have an active Patronizing order for this package.' using errcode = '23505'; end if;

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, order_purpose
  ) values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), package.id, 'timeline_entry', snapshot,
    address.id, public.shipping_address_json(address), round(package_total, 2),
    0, round(package_total, 2), trim(coalesce(p_member_notes, '')), 'patronizing_entry_package'
  ) returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'patronizing-package-entry-requested', 'Member requested a Patronizing package entry.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code));
  return public.commerce_order_json(order_row);
end;
$$;
revoke all on function public.request_patronizing_package_order(uuid,uuid,text) from public, anon;
grant execute on function public.request_patronizing_package_order(uuid,uuid,text) to authenticated;

alter function public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
  rename to apply_commerce_order_benefit_legacy;
revoke all on function public.apply_commerce_order_benefit_legacy(public.commerce_orders,timestamptz) from public, anon, authenticated;

create function public.apply_commerce_order_benefit(
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
revoke all on function public.apply_commerce_order_benefit(public.commerce_orders,timestamptz) from public, anon, authenticated;

alter function public.commerce_order_json(public.commerce_orders)
  rename to commerce_order_json_legacy;
create function public.commerce_order_json(p_order public.commerce_orders)
returns jsonb
language sql stable set search_path = ''
as $$
  select public.commerce_order_json_legacy(p_order)
    || case when p_order.order_purpose = 'patronizing_entry_package'
      then jsonb_build_object('packageTypeLabel', 'Patronizing Package Entry')
      else '{}'::jsonb end;
$$;

alter function public.get_my_patronizing_dashboard()
  rename to get_my_patronizing_dashboard_legacy;
revoke all on function public.get_my_patronizing_dashboard_legacy() from public, anon, authenticated;

create function public.get_my_patronizing_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb := public.get_my_patronizing_dashboard_legacy();
  active_plan_code text;
  active_entry jsonb;
  pending_token jsonb;
  pending_product jsonb;
begin
  select plan_code into active_plan_code
  from public.patronizing_entries
  where member_id = auth.uid() and status = 'active'
  order by activated_at desc limit 1;
  active_entry := case when result -> 'entry' = 'null'::jsonb then 'null'::jsonb
    else (result -> 'entry') || jsonb_build_object('planCode', active_plan_code) end;
  select jsonb_build_object(
    'id', request.id, 'amount', request.amount, 'f3Tokens', request.f3_tokens,
    'planCode', request.plan_code, 'referenceNumber', request.reference_number,
    'walletAddress', request.wallet_address, 'status', request.status, 'createdAt', request.created_at
  ) into pending_token
  from public.patronizing_token_requests request
  where member_id = auth.uid() and status = 'pending'
  order by created_at desc limit 1;
  select public.commerce_order_json(order_row) into pending_product
  from public.commerce_orders order_row
  where member_id = auth.uid()
    and order_purpose in ('patronizing_entry_product', 'patronizing_entry_package')
    and status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  order by created_at desc limit 1;
  return result || jsonb_build_object(
    'plans', jsonb_build_array(
      public.patronizing_entry_config('f3_token'),
      public.patronizing_entry_config('f3_token_12'),
      public.patronizing_entry_config('products'),
      public.patronizing_entry_config('products_2800')
    ),
    'entry', active_entry,
    'pendingTokenRequest', pending_token,
    'pendingProductEntryOrder', pending_product
  );
end;
$$;
revoke all on function public.get_my_patronizing_dashboard() from public, anon;
grant execute on function public.get_my_patronizing_dashboard() to authenticated;

create or replace function public.admin_approve_patronizing_token_request(
  p_request_id uuid,
  p_decision_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
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
  if target.member_id = auth.uid() and not public.is_owner() then
    raise exception 'You cannot approve your own Patronizing entry.' using errcode = '42501';
  end if;
  activation := public.activate_patronizing_entry(target.member_id, target.plan_code, target.id, null, approval_time);
  update public.patronizing_token_requests
  set status = 'approved', approved_at = approval_time,
      reviewed_by = auth.uid(), decision_note = trim(coalesce(p_decision_note, ''))
  where id = target.id;
  return jsonb_build_object('status', 'approved', 'requestId', target.id, 'activation', activation);
end;
$$;
