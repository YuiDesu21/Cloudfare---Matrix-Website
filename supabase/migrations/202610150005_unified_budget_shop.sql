-- Regular Shop orders can contribute to one-time Budget entry without becoming
-- Product Plus purchases. Voucher-paid orders never receive Budget credit.
create function public.request_budget_shop_order(
  p_shipping_address_id uuid,
  p_items jsonb,
  p_voucher_amount numeric default 0,
  p_member_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requested jsonb;
  saved_order public.commerce_orders;
  item jsonb;
  product public.commerce_products;
  percent numeric;
  snapshot_items jsonb := '[]'::jsonb;
begin
  if coalesce(p_voucher_amount, 0) <> 0 then
    raise exception 'Voucher orders do not qualify for Budget Plan.' using errcode = '22023';
  end if;
  requested := public.request_shop_order(
    p_shipping_address_id, p_items, 0, p_member_notes);
  select * into saved_order from public.commerce_orders
  where id = (requested ->> 'id')::uuid for update;

  for item in select * from jsonb_array_elements(saved_order.package_snapshot -> 'items') loop
    select * into product from public.commerce_products
    where id = (item ->> 'productId')::uuid;
    select qualification_percent into percent from public.budget_plan_categories
    where category = product.budget_category;
    snapshot_items := snapshot_items || jsonb_build_array(item || jsonb_build_object(
      'budgetCategory', product.budget_category,
      'qualificationPercent', coalesce(percent, 0)));
  end loop;

  update public.commerce_orders
  set package_snapshot = jsonb_set(
    jsonb_set(saved_order.package_snapshot, '{items}', snapshot_items),
    '{budgetShop}', 'true'::jsonb)
  where id = saved_order.id returning * into saved_order;
  return public.commerce_order_json(saved_order);
end;
$$;

create function public.credit_budget_shop_approved_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_number integer := 0;
  percent numeric;
  line_amount numeric;
  line_credit numeric;
begin
  if new.order_purpose <> 'shop' or new.status <> 'payment_approved'
    or old.status = 'payment_approved'
    or new.package_snapshot ->> 'budgetShop' is distinct from 'true' then
    return new;
  end if;
  if new.voucher_amount <> 0 or new.discount_amount <> 0 then
    raise exception 'Voucher and discount payments cannot qualify for Budget Plan.' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(new.package_snapshot -> 'items') loop
    item_number := item_number + 1;
    percent := coalesce((item ->> 'qualificationPercent')::numeric, 0);
    if percent <= 0 then continue; end if;
    line_amount := (item ->> 'price')::numeric * (item ->> 'quantity')::integer;
    line_credit := round(line_amount * percent / 100, 2);
    if line_credit > 0 then
      insert into public.budget_plan_purchase_credits
        (order_id, line_number, member_id, product_id, category,
         product_amount, qualification_percent, qualification_credit, credited_at)
      values (new.id, item_number, new.member_id, (item ->> 'productId')::uuid,
        item ->> 'budgetCategory', line_amount, percent, line_credit, now())
      on conflict (order_id, line_number) do nothing;
    end if;
  end loop;
  perform public.activate_budget_plan_member(new.member_id, now());
  return new;
end;
$$;

create trigger credit_budget_shop_on_payment_approval
  after update of status on public.commerce_orders
  for each row execute function public.credit_budget_shop_approved_order();

revoke all on function public.request_budget_shop_order(uuid,jsonb,numeric,text)
  from public, anon;
grant execute on function public.request_budget_shop_order(uuid,jsonb,numeric,text)
  to authenticated;
revoke all on function public.credit_budget_shop_approved_order()
  from public, anon, authenticated;
