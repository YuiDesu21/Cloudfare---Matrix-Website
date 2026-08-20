-- Individual Product Plus products and cart checkout.

create table if not exists public.commerce_products (
  id uuid primary key default extensions.gen_random_uuid(),
  product_type text not null check (product_type in ('product_plus_requirement', 'product_plus_voucher')),
  product_name text not null check (char_length(trim(product_name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 420),
  price numeric(12,2) not null check (price >= 0 and price <= 1000000),
  photo_data text not null default '' check (char_length(photo_data) <= 1500000),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_products_type_sort_idx
  on public.commerce_products(product_type, is_active, sort_order, product_name);

alter table public.commerce_products enable row level security;

drop policy if exists commerce_products_read_active_or_admin on public.commerce_products;
create policy commerce_products_read_active_or_admin
  on public.commerce_products for select to authenticated
  using (is_active or public.is_admin());

create or replace function public.commerce_product_json(p_product public.commerce_products)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$$;

create or replace function public.get_active_commerce_products(p_product_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_product_type is not null and p_product_type not in ('product_plus_requirement', 'product_plus_voucher') then
    raise exception 'Unknown product type.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(public.commerce_product_json(product) order by product.product_type, product.sort_order, product.product_name), '[]'::jsonb)
  into result
  from public.commerce_products product
  where product.is_active = true
    and (p_product_type is null or product.product_type = p_product_type);

  return result;
end;
$$;

create or replace function public.admin_get_commerce_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(public.commerce_product_json(product) order by product.product_type, product.sort_order, product.product_name), '[]'::jsonb)
  into result
  from public.commerce_products product;

  return result;
end;
$$;

create or replace function public.admin_save_commerce_product(
  p_product_id uuid,
  p_product_type text,
  p_product_name text,
  p_description text default '',
  p_price numeric default 0,
  p_photo_data text default '',
  p_is_active boolean default true,
  p_sort_order integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_product public.commerce_products;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_product_type not in ('product_plus_requirement', 'product_plus_voucher') then
    raise exception 'Choose a valid Product Plus product type.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_product_name, ''))) not between 2 and 100 then
    raise exception 'Product name must be 2-100 characters.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_description, ''))) > 420 then
    raise exception 'Description must be 420 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_price, 0) <= 0 or coalesce(p_price, 0) > 1000000 then
    raise exception 'Product price must be between PHP 0.01 and PHP 1,000,000.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_photo_data, '')) > 1500000 then
    raise exception 'Product photo is too large. Use a smaller image.' using errcode = '22023';
  end if;
  if coalesce(p_sort_order, 100) < 0 or coalesce(p_sort_order, 100) > 9999 then
    raise exception 'Sort order must be between 0 and 9999.' using errcode = '22023';
  end if;

  if p_product_id is null then
    insert into public.commerce_products(product_type, product_name, description, price, photo_data, is_active, sort_order, created_by, updated_by)
    values (p_product_type, trim(p_product_name), trim(coalesce(p_description, '')), round(p_price, 2), coalesce(p_photo_data, ''), coalesce(p_is_active, true), coalesce(p_sort_order, 100), auth.uid(), auth.uid())
    returning * into saved_product;
  else
    update public.commerce_products
    set product_type = p_product_type,
        product_name = trim(p_product_name),
        description = trim(coalesce(p_description, '')),
        price = round(p_price, 2),
        photo_data = coalesce(p_photo_data, ''),
        is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 100),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_product_id
    returning * into saved_product;

    if saved_product.id is null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  end if;

  return public.commerce_product_json(saved_product);
end;
$$;

create or replace function public.admin_delete_commerce_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  delete from public.commerce_products where id = p_product_id;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.request_commerce_product_order(
  p_product_type text,
  p_shipping_address_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_member_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  address public.shipping_addresses;
  order_row public.commerce_orders;
  product public.commerce_products;
  item jsonb;
  item_index integer := 0;
  product_id uuid;
  product_quantity integer;
  cart_items jsonb := '[]'::jsonb;
  cart_snapshot jsonb;
  package_total numeric := 0;
  current_voucher_balance numeric;
  reserved_voucher_balance numeric;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if p_product_type not in ('product_plus_requirement', 'product_plus_voucher') then raise exception 'Choose a valid Product Plus order type.' using errcode = '22023'; end if;
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
      and product_row.product_type = p_product_type
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

  if p_product_type = 'product_plus_voucher' then
    select coalesce(sum(amount), 0) into current_voucher_balance
    from public.voucher_ledger
    where member_id = auth.uid();

    select coalesce(sum(voucher_amount), 0) into reserved_voucher_balance
    from public.commerce_orders
    where member_id = auth.uid()
      and package_type = 'product_plus_voucher'
      and status = 'pending_shipping_fee';

    if current_voucher_balance - reserved_voucher_balance < package_total then
      raise exception 'Voucher balance is not enough for this cart.' using errcode = '22023';
    end if;
  end if;

  cart_snapshot := jsonb_build_object(
    'packageName', case when p_product_type = 'product_plus_voucher' then 'Product Plus Voucher Cart' else 'Product Plus Buy Cart' end,
    'packageType', p_product_type,
    'packageTypeLabel', public.commerce_package_type_label(p_product_type),
    'description', 'Individual Product Plus checkout',
    'totalPrice', round(package_total, 2),
    'items', cart_items
  );

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), null, p_product_type, cart_snapshot,
    address.id, public.shipping_address_json(address), round(package_total, 2),
    case when p_product_type = 'product_plus_voucher' then round(package_total, 2) else 0 end,
    case when p_product_type = 'product_plus_voucher' then 0 else round(package_total, 2) end,
    trim(coalesce(p_member_notes, ''))
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-product-cart-requested', 'Member requested an individual Product Plus cart order.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'productType', p_product_type, 'itemCount', jsonb_array_length(cart_items)));

  return public.commerce_order_json(order_row);
end;
$$;

revoke all on function
  public.commerce_product_json(public.commerce_products),
  public.get_active_commerce_products(text),
  public.admin_get_commerce_products(),
  public.admin_save_commerce_product(uuid,text,text,text,numeric,text,boolean,integer),
  public.admin_delete_commerce_product(uuid),
  public.request_commerce_product_order(text,uuid,jsonb,text)
from public, anon;

grant execute on function
  public.get_active_commerce_products(text),
  public.admin_get_commerce_products(),
  public.admin_save_commerce_product(uuid,text,text,text,numeric,text,boolean,integer),
  public.admin_delete_commerce_product(uuid),
  public.request_commerce_product_order(text,uuid,jsonb,text)
to authenticated;
