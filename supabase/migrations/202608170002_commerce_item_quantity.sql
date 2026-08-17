alter table public.commerce_package_items
  add column if not exists quantity integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'commerce_package_items_quantity_check'
      and conrelid = 'public.commerce_package_items'::regclass
  ) then
    alter table public.commerce_package_items
      add constraint commerce_package_items_quantity_check check (quantity between 1 and 999);
  end if;
end $$;

create or replace function public.commerce_package_json(p_package public.commerce_packages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_package.id,
    'packageType', p_package.package_type,
    'packageTypeLabel', public.commerce_package_type_label(p_package.package_type),
    'packageName', p_package.package_name,
    'description', p_package.description,
    'sortOrder', p_package.sort_order,
    'isActive', p_package.is_active,
    'totalPrice', coalesce((select sum(item.price * item.quantity) from public.commerce_package_items item where item.package_id = p_package.id), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'itemName', item.item_name,
        'price', item.price,
        'quantity', item.quantity,
        'photoData', item.photo_data,
        'sortOrder', item.sort_order
      ) order by item.sort_order, item.item_name)
      from public.commerce_package_items item
      where item.package_id = p_package.id
    ), '[]'::jsonb),
    'createdAt', p_package.created_at,
    'updatedAt', p_package.updated_at
  );
$$;

create or replace function public.admin_save_commerce_package(
  p_package_id uuid,
  p_package_type text,
  p_package_name text,
  p_description text default '',
  p_is_active boolean default true,
  p_sort_order integer default 100,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_package public.commerce_packages;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  item jsonb;
  item_index integer := 0;
  item_name text;
  item_price numeric;
  item_quantity integer;
  item_photo text;
  item_sort integer;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_package_type not in ('timeline_entry', 'matrix_1200_entry', 'product_plus_requirement', 'product_plus_voucher') then
    raise exception 'Choose a valid package type.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_package_name, ''))) not between 2 and 100 then
    raise exception 'Package name must be 2-100 characters.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_description, ''))) > 420 then
    raise exception 'Description must be 420 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_sort_order, 100) < 0 or coalesce(p_sort_order, 100) > 9999 then
    raise exception 'Sort order must be between 0 and 9999.' using errcode = '22023';
  end if;
  if jsonb_typeof(normalized_items) <> 'array' then raise exception 'Package items must be an array.' using errcode = '22023'; end if;
  if jsonb_array_length(normalized_items) = 0 then raise exception 'Add at least one item to the package.' using errcode = '22023'; end if;
  if jsonb_array_length(normalized_items) > 20 then raise exception 'A package can have up to 20 items.' using errcode = '22023'; end if;

  if p_package_id is null then
    insert into public.commerce_packages(package_type, package_name, description, is_active, sort_order, created_by, updated_by)
    values (p_package_type, trim(p_package_name), trim(coalesce(p_description, '')), coalesce(p_is_active, true), coalesce(p_sort_order, 100), auth.uid(), auth.uid())
    returning * into saved_package;
  else
    update public.commerce_packages
    set package_type = p_package_type,
        package_name = trim(p_package_name),
        description = trim(coalesce(p_description, '')),
        is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 100),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_package_id
    returning * into saved_package;

    if saved_package.id is null then raise exception 'Package not found.' using errcode = 'P0002'; end if;
    delete from public.commerce_package_items where package_id = saved_package.id;
  end if;

  for item in select * from jsonb_array_elements(normalized_items)
  loop
    item_index := item_index + 1;
    item_name := trim(coalesce(item ->> 'itemName', ''));
    item_price := coalesce(nullif(item ->> 'price', '')::numeric, 0);
    item_quantity := coalesce(nullif(item ->> 'quantity', '')::integer, 1);
    item_photo := coalesce(item ->> 'photoData', '');
    item_sort := coalesce(nullif(item ->> 'sortOrder', '')::integer, item_index * 10);

    if char_length(item_name) not between 2 and 100 then raise exception 'Each item needs a 2-100 character name.' using errcode = '22023'; end if;
    if item_price < 0 or item_price > 1000000 then raise exception 'Each item price must be between PHP 0 and PHP 1,000,000.' using errcode = '22023'; end if;
    if item_quantity < 1 or item_quantity > 999 then raise exception 'Each item quantity must be between 1 and 999.' using errcode = '22023'; end if;
    if char_length(item_photo) > 1500000 then raise exception 'One item photo is too large. Use a smaller image.' using errcode = '22023'; end if;
    if item_sort < 0 or item_sort > 9999 then raise exception 'Item sort order must be between 0 and 9999.' using errcode = '22023'; end if;

    insert into public.commerce_package_items(package_id, item_name, price, quantity, photo_data, sort_order)
    values (saved_package.id, item_name, round(item_price, 2), item_quantity, item_photo, item_sort);
  end loop;

  select * into saved_package from public.commerce_packages where id = saved_package.id;
  return public.commerce_package_json(saved_package);
end;
$$;

revoke all on function
  public.commerce_package_json(public.commerce_packages),
  public.admin_save_commerce_package(uuid,text,text,text,boolean,integer,jsonb)
from public, anon;

grant execute on function
  public.admin_save_commerce_package(uuid,text,text,text,boolean,integer,jsonb)
to authenticated;
