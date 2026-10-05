alter table public.commerce_orders drop constraint commerce_orders_order_purpose_check;
alter table public.commerce_orders add constraint commerce_orders_order_purpose_check
  check (order_purpose in ('standard', 'patronizing_entry_product',
    'patronizing_monthly_requirement', 'patronizing_exit_discount', 'budget_qualification'));

create function public.request_budget_plan_product_order(
  p_shipping_address_id uuid,
  p_items jsonb,
  p_member_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  requested jsonb;
  saved_order public.commerce_orders%rowtype;
  item jsonb;
  product public.commerce_products%rowtype;
  snapshot_items jsonb := '[]'::jsonb;
  percent numeric;
begin
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'Add Budget Plan products to the cart.' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into product from public.commerce_products
    where id = nullif(item ->> 'productId', '')::uuid
      and product_type = 'product_plus_requirement' and is_active;
    if product.id is null or product.budget_category is null then
      raise exception 'Choose products with a Budget Plan category.' using errcode = '22023';
    end if;
  end loop;

  requested := public.request_commerce_product_order(
    'product_plus_requirement', p_shipping_address_id, p_items, p_member_notes);
  select * into saved_order from public.commerce_orders
  where id = (requested ->> 'id')::uuid for update;

  for item in select * from jsonb_array_elements(saved_order.package_snapshot -> 'items') loop
    select * into product from public.commerce_products
    where id = (item ->> 'productId')::uuid;
    select qualification_percent into percent from public.budget_plan_categories
    where category = product.budget_category;
    if percent is null then
      raise exception 'A Budget Plan product category changed during checkout.' using errcode = '22023';
    end if;
    snapshot_items := snapshot_items || jsonb_build_array(item || jsonb_build_object(
      'budgetCategory', product.budget_category,
      'qualificationPercent', percent));
  end loop;

  update public.commerce_orders
  set order_purpose = 'budget_qualification',
      package_snapshot = jsonb_set(
        jsonb_set(saved_order.package_snapshot, '{items}', snapshot_items),
        '{packageName}', to_jsonb('Budget Plan Products'::text))
  where id = saved_order.id
  returning * into saved_order;

  return public.commerce_order_json(saved_order);
end;
$$;

-- Keep all existing order benefits intact, but Budget purchases have their own credit.
alter function public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
  rename to apply_commerce_order_benefit_existing;

create function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_order.order_purpose = 'budget_qualification' then
    return jsonb_build_object('type', 'budget_qualification', 'orderId', p_order.id);
  end if;
  return public.apply_commerce_order_benefit_existing(p_order, p_activation_time);
end;
$$;

create function public.credit_budget_plan_approved_order()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  item_number integer := 0;
  percent numeric;
  line_amount numeric;
  line_credit numeric;
begin
  if new.order_purpose <> 'budget_qualification' or new.status <> 'payment_approved'
    or old.status = 'payment_approved' then
    return new;
  end if;
  if new.voucher_amount <> 0 or new.discount_amount <> 0 then
    raise exception 'Voucher and discount payments cannot qualify for Budget Plan.' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(new.package_snapshot -> 'items') loop
    item_number := item_number + 1;
    percent := (item ->> 'qualificationPercent')::numeric;
    line_amount := (item ->> 'price')::numeric * (item ->> 'quantity')::integer;
    line_credit := round(line_amount * percent / 100, 2);
    if line_credit > 0 then
      insert into public.budget_plan_purchase_credits
        (order_id, line_number, member_id, product_id, category,
         product_amount, qualification_percent, qualification_credit, credited_at)
      values (new.id, item_number, new.member_id, (item ->> 'productId')::uuid,
        item ->> 'budgetCategory', line_amount, percent, line_credit,
        now())
      on conflict (order_id, line_number) do nothing;
    end if;
  end loop;
  perform public.activate_budget_plan_member(new.member_id, now());
  return new;
end;
$$;

create trigger credit_budget_plan_on_payment_approval
  after update of status on public.commerce_orders
  for each row execute function public.credit_budget_plan_approved_order();

revoke all on function public.request_budget_plan_product_order(uuid,jsonb,text)
  from public, anon;
grant execute on function public.request_budget_plan_product_order(uuid,jsonb,text)
  to authenticated;
revoke all on function public.apply_commerce_order_benefit_existing(public.commerce_orders,timestamptz),
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz),
  public.credit_budget_plan_approved_order()
  from public, anon, authenticated;
