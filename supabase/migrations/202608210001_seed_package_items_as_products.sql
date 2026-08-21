-- Seed Product Plus products from the individual items already used in packages.
-- This copies each unique package item into both Buy Requirement and Voucher Products.

with ranked_items as (
  select
    lower(trim(item.item_name)) as normalized_name,
    trim(item.item_name) as product_name,
    item.price,
    coalesce(item.photo_data, '') as photo_data,
    row_number() over (
      partition by lower(trim(item.item_name))
      order by
        case when coalesce(item.photo_data, '') <> '' then 0 else 1 end,
        package.is_active desc,
        item.sort_order,
        item.created_at
    ) as pick_order
  from public.commerce_package_items item
  join public.commerce_packages package on package.id = item.package_id
  where trim(item.item_name) <> ''
    and item.price > 0
), source_items as (
  select normalized_name, product_name, price, photo_data
  from ranked_items
  where pick_order = 1
), typed_items as (
  select
    product_type,
    source_items.normalized_name,
    source_items.product_name,
    source_items.price,
    source_items.photo_data,
    row_number() over (partition by product_type order by source_items.product_name) * 10 as sort_order
  from source_items
  cross join (values
    ('product_plus_requirement'::text),
    ('product_plus_voucher'::text)
  ) as product_types(product_type)
)
insert into public.commerce_products (
  product_type,
  product_name,
  description,
  price,
  photo_data,
  sort_order,
  is_active
)
select
  typed_items.product_type,
  typed_items.product_name,
  '',
  typed_items.price,
  typed_items.photo_data,
  typed_items.sort_order,
  true
from typed_items
where not exists (
  select 1
  from public.commerce_products existing
  where existing.product_type = typed_items.product_type
    and lower(trim(existing.product_name)) = typed_items.normalized_name
);
