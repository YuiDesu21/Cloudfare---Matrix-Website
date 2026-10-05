alter table public.commerce_products
  add column budget_category text references public.budget_plan_categories(category);

alter table public.commerce_products
  add constraint commerce_products_budget_category_type_check
  check (budget_category is null or
    (product_type = 'product_plus_requirement' and budget_category <> 'f3_token'));

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
    'budgetCategory', p_product.budget_category,
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$$;

create function public.admin_save_commerce_product(
  p_product_id uuid,
  p_product_type text,
  p_product_name text,
  p_description text,
  p_price numeric,
  p_photo_data text,
  p_is_active boolean,
  p_sort_order integer,
  p_budget_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved jsonb;
  saved_product public.commerce_products;
begin
  if p_budget_category is not null and not exists (
    select 1 from public.budget_plan_categories where category = p_budget_category
  ) then
    raise exception 'Choose a valid Budget Plan category.' using errcode = '22023';
  end if;
  if p_budget_category is not null and p_product_type <> 'product_plus_requirement' then
    raise exception 'Voucher products cannot count toward Budget Plan.' using errcode = '22023';
  end if;
  if p_budget_category = 'f3_token' then
    raise exception 'F3 tokens use the separate Budget wallet checkout.' using errcode = '22023';
  end if;

  saved := public.admin_save_commerce_product(
    p_product_id, p_product_type, p_product_name, p_description,
    p_price, p_photo_data, p_is_active, p_sort_order
  );
  update public.commerce_products
  set budget_category = p_budget_category
  where id = (saved ->> 'id')::uuid
  returning * into saved_product;

  return public.commerce_product_json(saved_product);
end;
$$;

revoke all on function public.admin_save_commerce_product(uuid,text,text,text,numeric,text,boolean,integer,text) from public, anon;
grant execute on function public.admin_save_commerce_product(uuid,text,text,text,numeric,text,boolean,integer,text) to authenticated;
