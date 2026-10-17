-- Restore the existing product selection to staging without duplicating live rows.
with catalog(product_name, price, photo_data, sort_order) as (
  values
    ('Cardio Life', 1800.00, 'assets/products/cardio-life.jpg', 10),
    ('Cleopatra Whitening', 200.00, 'assets/products/cleopatra-whitening.jpg', 20),
    ('Fiber Life', 1800.00, 'assets/products/fiber-life.jpg', 30),
    ('Intra Juice', 1800.00, 'assets/products/intra-juice.jpg', 40),
    ('Nutria', 1500.00, 'assets/products/nutria.jpg', 50),
    ('Nutria/Fiber Life', 1500.00, '', 60),
    ('PC Alert Tooth Paste', 318.00, 'assets/products/pc-alert-tooth-paste.jpg', 70),
    ('PC Check Soap (Papaya)', 64.00, 'assets/products/pc-check-soap-papaya.jpg', 80),
    ('PC Dishwashing', 99.00, 'assets/products/pc-dishwashing.png', 90),
    ('PC Fabric Conditioner', 285.00, 'assets/products/pc-fabric-conditioner.jpg', 100),
    ('PC Tuff Bowl Cleaner', 285.00, 'assets/products/pc-tuff-bowl-cleaner.jpg', 110),
    ('PC Tuff Detergent', 189.00, 'assets/products/pc-tuff-detergent.jpg', 120)
)
insert into public.commerce_products(
  product_type, product_name, description, price, photo_data,
  sort_order, is_active, voucher_eligible
)
select 'product_plus_requirement', catalog.product_name, '', catalog.price,
  catalog.photo_data, catalog.sort_order, true, true
from catalog
where not exists (
  select 1 from public.commerce_products existing
  where existing.product_type = 'product_plus_requirement'
    and lower(trim(existing.product_name)) = lower(catalog.product_name)
    and existing.price = catalog.price
);

-- The older catalog has a second row per product solely for voucher checkout.
-- Preserve those rows and historical orders, but expose one listing in Shop.
update public.commerce_products product
set voucher_eligible = true
where product.product_type = 'product_plus_requirement'
  and exists (
    select 1 from public.commerce_products voucher
    where voucher.product_type = 'product_plus_voucher'
      and lower(trim(voucher.product_name)) = lower(trim(product.product_name))
      and voucher.price = product.price
  );

create or replace function public.get_public_shop_products()
returns jsonb language sql stable security definer set search_path = '' as $$
  with listings as (
    select product.*,
      case when product.product_type = 'shop_only' then product.id::text
        else lower(trim(product.product_name)) || '|' || product.price::text end as listing_key
    from public.commerce_products product
    where product.is_active = true
  ), ranked as (
    select product.*,
      row_number() over (
        partition by product.listing_key
        order by case product.product_type
          when 'product_plus_requirement' then 0
          when 'shop_only' then 1
          else 2 end, product.updated_at desc, product.id
      ) as listing_rank,
      bool_or(product.voucher_eligible or product.product_type = 'product_plus_voucher') over (
        partition by product.listing_key
      ) as can_use_vouchers
    from listings product
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', product.id,
    'name', product.product_name,
    'description', product.description,
    'price', product.price,
    'photoData', product.photo_data,
    'voucherEligible', product.can_use_vouchers
  ) order by product.sort_order, product.product_name), '[]'::jsonb)
  from ranked product
  where product.listing_rank = 1;
$$;
