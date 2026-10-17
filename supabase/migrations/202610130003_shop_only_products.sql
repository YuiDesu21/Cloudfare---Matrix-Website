-- Shop-only is the default catalog classification; plans opt in explicitly.
alter table public.commerce_products drop constraint commerce_products_product_type_check;
alter table public.commerce_products add constraint commerce_products_product_type_check
  check (product_type in ('shop_only', 'product_plus_requirement', 'product_plus_voucher'));

create or replace function public.commerce_package_type_label(p_package_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_package_type
    when 'timeline_entry' then 'Standard Plan Package Entry'
    when 'matrix_1200_entry' then 'Premium Plan Package Entry'
    when 'product_plus_requirement' then 'Product Plus Purchase'
    when 'product_plus_voucher' then 'Legacy Voucher Product'
    when 'shop_only' then 'Shop Only'
    when 'shop' then 'Shop Purchase'
    else p_package_type
  end;
$$;

create or replace function public.admin_save_shop_product(
  p_product_id uuid, p_product_type text, p_product_name text,
  p_description text, p_price numeric, p_photo_data text,
  p_is_active boolean, p_sort_order integer, p_budget_category text,
  p_voucher_eligible boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved jsonb;
  saved_product public.commerce_products;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_product_type not in ('shop_only', 'product_plus_requirement', 'product_plus_voucher') then
    raise exception 'Choose a valid product use.' using errcode = '22023';
  end if;
  if p_product_type = 'shop_only' then
    if p_budget_category is not null then raise exception 'Shop-only products cannot qualify for Budget Plan.' using errcode = '22023'; end if;
    if char_length(trim(coalesce(p_product_name, ''))) not between 2 and 100
       or char_length(coalesce(p_description, '')) > 420
       or coalesce(p_price, 0) <= 0 or p_price > 1000000
       or char_length(coalesce(p_photo_data, '')) > 1500000
       or coalesce(p_sort_order, 100) not between 0 and 9999 then
      raise exception 'Check the product name, description, price, photo, and sort order.' using errcode = '22023';
    end if;
    if p_product_id is null then
      insert into public.commerce_products(
        product_type, product_name, description, price, photo_data,
        is_active, sort_order, created_by, updated_by
      ) values (
        'shop_only', trim(p_product_name), trim(coalesce(p_description, '')),
        round(p_price, 2), coalesce(p_photo_data, ''),
        coalesce(p_is_active, true), coalesce(p_sort_order, 100), auth.uid(), auth.uid()
      ) returning * into saved_product;
    else
      update public.commerce_products set
        product_type = 'shop_only', product_name = trim(p_product_name),
        description = trim(coalesce(p_description, '')), price = round(p_price, 2),
        photo_data = coalesce(p_photo_data, ''), is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 100), budget_category = null,
        updated_by = auth.uid(), updated_at = now()
      where id = p_product_id returning * into saved_product;
      if saved_product.id is null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
    end if;
  else
    saved := public.admin_save_commerce_product(
      p_product_id, p_product_type, p_product_name, p_description,
      p_price, p_photo_data, p_is_active, p_sort_order, p_budget_category
    );
    select * into saved_product from public.commerce_products where id = (saved ->> 'id')::uuid;
  end if;
  update public.commerce_products set voucher_eligible = coalesce(p_voucher_eligible, false)
  where id = saved_product.id returning * into saved_product;
  return public.commerce_product_json(saved_product);
end;
$$;
