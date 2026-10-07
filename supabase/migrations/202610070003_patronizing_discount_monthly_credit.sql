-- Discounted exit orders use the merchandise amount actually paid for monthly qualification.
create function public.patronizing_monthly_purchase_credit(
  p_member_id uuid,
  p_extra_order_id uuid default null
)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case
    when order_row.order_purpose = 'patronizing_exit_discount'
      then greatest(order_row.package_total - order_row.discount_amount, 0)
    else order_row.package_total
  end), 0)
  from public.commerce_orders order_row
  where order_row.member_id = p_member_id
    and order_row.order_purpose in ('patronizing_monthly_requirement', 'patronizing_exit_discount')
    and (order_row.status in ('payment_approved', 'shipped', 'received')
      or order_row.id = p_extra_order_id);
$$;
revoke all on function public.patronizing_monthly_purchase_credit(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.apply_patronizing_monthly_unlocks(
  p_member_id uuid,
  p_unlock_time timestamptz default now(),
  p_extra_order_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
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

  approved_purchase_total := public.patronizing_monthly_purchase_credit(p_member_id, p_extra_order_id);

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
    values (p_member_id, 'patronizing-income', 'patronizing_income',
      'Patronizing Income Month ' || income_row.month_number, income_row.income_amount,
      income_row.due_at, 'due', p_unlock_time)
    returning id into ledger_id;

    update public.patronizing_monthly_income
    set status = 'unlocked', unlocked_at = p_unlock_time, reward_ledger_id = ledger_id
    where id = income_row.id;

    unlocked_count := unlocked_count + 1;
  end loop;

  return jsonb_build_object('unlocked', unlocked_count, 'approvedPurchaseTotal', approved_purchase_total);
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
  legacy_result jsonb;
begin
  if p_order.order_purpose in ('patronizing_entry_product', 'patronizing_entry_package') then
    perform pg_advisory_xact_lock(hashtextextended('patronizing-entry-' || p_order.member_id::text, 0));
  end if;
  if p_order.order_purpose <> 'patronizing_entry_package' then
    legacy_result := public.apply_commerce_order_benefit_legacy(p_order, p_activation_time);
    if p_order.order_purpose = 'patronizing_exit_discount' then
      return legacy_result || jsonb_build_object('unlock',
        public.apply_patronizing_monthly_unlocks(p_order.member_id, p_activation_time, p_order.id));
    end if;
    return legacy_result;
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
    return jsonb_build_object('type', 'patronizing_entry_package_progress',
      'approvedAmount', approved_total, 'targetAmount', target_amount,
      'remainingAmount', target_amount - approved_total);
  end if;
  activation := public.activate_patronizing_entry(p_order.member_id, 'products_2800', null,
    p_order.id, p_activation_time);
  return jsonb_build_object('type', 'patronizing_entry_package', 'activation', activation,
    'approvedAmount', approved_total, 'targetAmount', target_amount);
end;
$$;

create or replace function public.get_my_patronizing_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb := public.get_my_patronizing_dashboard_legacy();
  active_plan_code text;
  active_entry jsonb;
  pending_token jsonb;
  pending_product jsonb;
  approved_purchase numeric;
  due_requirement numeric;
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

  approved_purchase := public.patronizing_monthly_purchase_credit(auth.uid());
  due_requirement := coalesce((result #>> '{monthlySummary,dueRequirement}')::numeric, 0);
  result := jsonb_set(result, '{monthlySummary,approvedPurchase}', to_jsonb(approved_purchase));
  result := jsonb_set(result, '{monthlySummary,remainingRequirement}',
    to_jsonb(greatest(due_requirement - approved_purchase, 0)));

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
