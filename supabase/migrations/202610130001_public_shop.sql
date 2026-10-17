-- A shared public catalog with a separate, benefit-free shop checkout.
alter table public.commerce_products
  add column if not exists voucher_eligible boolean not null default false;

update public.commerce_products
set voucher_eligible = true
where product_type = 'product_plus_voucher';

alter table public.commerce_orders drop constraint if exists commerce_orders_package_type_check;
alter table public.commerce_orders add constraint commerce_orders_package_type_check
  check (package_type in ('timeline_entry', 'matrix_1200_entry', 'product_plus_requirement', 'product_plus_voucher', 'shop'));

alter table public.commerce_orders drop constraint if exists commerce_orders_order_purpose_check;
alter table public.commerce_orders add constraint commerce_orders_order_purpose_check
  check (order_purpose in (
    'standard', 'shop', 'patronizing_entry_product', 'patronizing_entry_package',
    'patronizing_monthly_requirement', 'patronizing_exit_discount', 'budget_qualification'
  ));

create or replace function public.commerce_package_type_label(p_package_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_package_type
    when 'timeline_entry' then 'Standard Plan Package Entry'
    when 'matrix_1200_entry' then 'Premium Plan Package Entry'
    when 'product_plus_requirement' then 'Product Plus Purchase'
    when 'product_plus_voucher' then 'Legacy Voucher Product'
    when 'shop' then 'Shop Purchase'
    else p_package_type
  end;
$$;

create or replace function public.commerce_product_json(p_product public.commerce_products)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_product.id,
    'productType', p_product.product_type,
    'productTypeLabel', public.commerce_package_type_label(p_product.product_type),
    'productName', p_product.product_name,
    'description', p_product.description,
    'price', p_product.price,
    'photoData', p_product.photo_data,
    'sortOrder', p_product.sort_order,
    'isActive', p_product.is_active,
    'budgetCategory', p_product.budget_category,
    'voucherEligible', p_product.voucher_eligible,
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$$;

create or replace function public.get_public_shop_products()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', product.id,
    'name', product.product_name,
    'description', product.description,
    'price', product.price,
    'photoData', product.photo_data,
    'voucherEligible', product.voucher_eligible
  ) order by product.sort_order, product.product_name), '[]'::jsonb)
  from public.commerce_products product
  where product.is_active = true;
$$;

create function public.admin_save_shop_product(
  p_product_id uuid,
  p_product_type text,
  p_product_name text,
  p_description text,
  p_price numeric,
  p_photo_data text,
  p_is_active boolean,
  p_sort_order integer,
  p_budget_category text,
  p_voucher_eligible boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved jsonb;
  saved_product public.commerce_products;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  saved := public.admin_save_commerce_product(
    p_product_id, p_product_type, p_product_name, p_description,
    p_price, p_photo_data, p_is_active, p_sort_order, p_budget_category
  );
  update public.commerce_products
  set voucher_eligible = coalesce(p_voucher_eligible, false)
  where id = (saved ->> 'id')::uuid
  returning * into saved_product;
  return public.commerce_product_json(saved_product);
end;
$$;

create function public.request_shop_order(
  p_shipping_address_id uuid,
  p_items jsonb,
  p_voucher_amount numeric default 0,
  p_member_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  address public.shipping_addresses;
  product public.commerce_products;
  order_row public.commerce_orders;
  item jsonb;
  product_id uuid;
  quantity integer;
  cart_items jsonb := '[]'::jsonb;
  subtotal numeric := 0;
  eligible_subtotal numeric := 0;
  voucher_amount numeric := round(coalesce(p_voucher_amount, 0), 2);
  voucher_balance numeric;
  reserved_amount numeric;
  item_index integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in before checkout.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status <> 'suspended') then
    raise exception 'This account cannot place orders.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes are too long.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'Choose between 1 and 40 product lines.' using errcode = '22023';
  end if;
  if voucher_amount < 0 or voucher_amount > 1000000 or voucher_amount <> coalesce(p_voucher_amount, 0) then
    raise exception 'Choose a valid voucher amount.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select * into address from public.shipping_addresses
  where id = p_shipping_address_id and member_id = auth.uid();
  if address.id is null then raise exception 'Choose a saved shipping address.' using errcode = 'P0002'; end if;

  for item in select * from jsonb_array_elements(p_items) loop
    item_index := item_index + 1;
    product_id := nullif(item ->> 'productId', '')::uuid;
    quantity := coalesce(nullif(item ->> 'quantity', '')::integer, 1);
    if quantity not between 1 and 999 then raise exception 'Product quantity must be between 1 and 999.' using errcode = '22023'; end if;
    select * into product from public.commerce_products
    where id = product_id and is_active = true;
    if product.id is null then raise exception 'A product is no longer available.' using errcode = 'P0002'; end if;
    subtotal := subtotal + product.price * quantity;
    if product.voucher_eligible then eligible_subtotal := eligible_subtotal + product.price * quantity; end if;
    cart_items := cart_items || jsonb_build_array(jsonb_build_object(
      'id', product.id, 'productId', product.id, 'itemName', product.product_name,
      'price', product.price, 'quantity', quantity, 'photoData', product.photo_data,
      'voucherEligible', product.voucher_eligible, 'sortOrder', item_index * 10
    ));
  end loop;
  if subtotal <= 0 then raise exception 'Cart total must be greater than zero.' using errcode = '22023'; end if;
  if voucher_amount > eligible_subtotal then
    raise exception 'Vouchers can only cover eligible products.' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0) into voucher_balance from public.voucher_ledger where member_id = auth.uid();
  select coalesce(sum(voucher_amount), 0) into reserved_amount from public.commerce_orders
  where member_id = auth.uid() and status = 'pending_shipping_fee'
    and (package_type = 'product_plus_voucher' or order_purpose = 'shop');
  if voucher_amount > voucher_balance - reserved_amount then
    raise exception 'Voucher balance is not enough for this order.' using errcode = '22023';
  end if;

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, order_purpose
  ) values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), null, 'shop', jsonb_build_object(
      'packageName', 'Shop Order', 'packageType', 'shop', 'packageTypeLabel', 'Shop Purchase',
      'description', 'Ordinary product purchase', 'totalPrice', round(subtotal, 2), 'items', cart_items
    ), address.id, public.shipping_address_json(address), round(subtotal, 2),
    voucher_amount, round(subtotal - voucher_amount, 2), trim(coalesce(p_member_notes, '')), 'shop'
  ) returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'shop-order-requested', 'Member requested an ordinary shop order.',
    jsonb_build_object('orderId', order_row.id, 'voucherAmount', voucher_amount));
  return public.commerce_order_json(order_row);
end;
$$;

alter function public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
  rename to apply_commerce_order_benefit_before_shop;
revoke all on function public.apply_commerce_order_benefit_before_shop(public.commerce_orders,timestamptz)
  from public, anon, authenticated;

create function public.apply_commerce_order_benefit(
  p_order public.commerce_orders, p_activation_time timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_order.order_purpose = 'shop' then
    return jsonb_build_object('type', 'shop', 'status', 'no_matrix_benefit');
  end if;
  return public.apply_commerce_order_benefit_before_shop(p_order, p_activation_time);
end;
$$;
revoke all on function public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
  from public, anon, authenticated;

alter function public.admin_approve_commerce_order_fee(uuid,numeric,text)
  rename to admin_approve_commerce_order_fee_before_shop;
revoke all on function public.admin_approve_commerce_order_fee_before_shop(uuid,numeric,text)
  from public, anon, authenticated;

create function public.admin_approve_commerce_order_fee(
  p_order_id uuid, p_shipping_fee numeric, p_admin_notes text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  order_row public.commerce_orders;
  fee numeric := round(coalesce(p_shipping_fee, 0), 2);
  balance numeric;
  other_reservations numeric;
  next_due numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into order_row from public.commerce_orders where id = p_order_id for update;
  if order_row.id is null then raise exception 'Order request not found.' using errcode = 'P0002'; end if;
  if order_row.order_purpose <> 'shop' then
    return public.admin_approve_commerce_order_fee_before_shop(p_order_id, p_shipping_fee, p_admin_notes);
  end if;
  if order_row.member_id = auth.uid() and not public.is_owner() then
    raise exception 'Administrators cannot approve their own orders.' using errcode = '42501';
  end if;
  if order_row.status <> 'pending_shipping_fee' then raise exception 'Only orders waiting for shipping fee can be approved.' using errcode = '22023'; end if;
  if fee < 0 or fee > 100000 then raise exception 'Shipping fee is out of range.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_admin_notes, ''))) > 320 then raise exception 'Admin notes are too long.' using errcode = '22023'; end if;
  if order_row.voucher_amount > 0 then
    perform pg_advisory_xact_lock(hashtext(order_row.member_id::text));
    select coalesce(sum(amount), 0) into balance from public.voucher_ledger
    where member_id = order_row.member_id;
    select coalesce(sum(voucher_amount), 0) into other_reservations
    from public.commerce_orders
    where member_id = order_row.member_id and id <> order_row.id
      and status = 'pending_shipping_fee'
      and (package_type = 'product_plus_voucher' or order_purpose = 'shop');
    if order_row.voucher_amount > balance - other_reservations then
      raise exception 'Member voucher balance is no longer enough for this order.' using errcode = '22023';
    end if;
    insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
    values (order_row.member_id, order_row.id, 'redemption', -order_row.voucher_amount,
      order_row.order_code, 'Shop order voucher redemption', auth.uid());
  end if;
  next_due := round(order_row.package_total - order_row.voucher_amount + fee, 2);
  update public.commerce_orders
  set shipping_fee = fee, amount_due = next_due,
      status = case when next_due = 0 then 'payment_approved' else 'approved_for_payment' end,
      admin_notes = trim(coalesce(p_admin_notes, '')), approved_at = now(), updated_at = now()
  where id = order_row.id returning * into order_row;
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'shop-order-fee-approved', 'Admin approved shop order shipping.',
    jsonb_build_object('orderId', order_row.id, 'shippingFee', fee, 'voucherAmount', order_row.voucher_amount));
  return public.commerce_order_json(order_row);
end;
$$;

revoke all on function public.get_public_shop_products(),
  public.admin_save_shop_product(uuid,text,text,text,numeric,text,boolean,integer,text,boolean),
  public.request_shop_order(uuid,jsonb,numeric,text),
  public.admin_approve_commerce_order_fee(uuid,numeric,text)
from public, anon;
grant execute on function public.get_public_shop_products() to anon, authenticated;
grant execute on function public.admin_save_shop_product(uuid,text,text,text,numeric,text,boolean,integer,text,boolean),
  public.request_shop_order(uuid,jsonb,numeric,text),
  public.admin_approve_commerce_order_fee(uuid,numeric,text)
to authenticated;
