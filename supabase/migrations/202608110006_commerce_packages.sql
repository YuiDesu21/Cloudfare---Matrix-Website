-- Admin-managed commerce packages and package items.

create table if not exists public.commerce_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  package_type text not null check (package_type in ('timeline_entry', 'matrix_1200_entry', 'product_plus_requirement', 'product_plus_voucher')),
  package_name text not null check (char_length(trim(package_name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 420),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_packages_type_sort_idx on public.commerce_packages(package_type, is_active, sort_order, package_name);

create table if not exists public.commerce_package_items (
  id uuid primary key default extensions.gen_random_uuid(),
  package_id uuid not null references public.commerce_packages(id) on delete cascade,
  item_name text not null check (char_length(trim(item_name)) between 2 and 100),
  price numeric(12,2) not null check (price >= 0 and price <= 1000000),
  photo_data text not null default '' check (char_length(photo_data) <= 1500000),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_package_items_package_sort_idx on public.commerce_package_items(package_id, sort_order, item_name);

alter table public.commerce_packages enable row level security;
alter table public.commerce_package_items enable row level security;

drop policy if exists commerce_packages_read_active_or_admin on public.commerce_packages;
create policy commerce_packages_read_active_or_admin
  on public.commerce_packages for select to authenticated
  using (is_active or public.is_admin());

drop policy if exists commerce_package_items_read_active_or_admin on public.commerce_package_items;
create policy commerce_package_items_read_active_or_admin
  on public.commerce_package_items for select to authenticated
  using (
    exists (
      select 1
      from public.commerce_packages package
      where package.id = package_id
        and (package.is_active or public.is_admin())
    )
  );

create or replace function public.commerce_package_type_label(p_package_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_package_type
    when 'timeline_entry' then 'Timeline Matrix Package Entry'
    when 'matrix_1200_entry' then 'PHP 1,200 Matrix Package Entry'
    when 'product_plus_requirement' then 'Product Plus Buy Requirement'
    when 'product_plus_voucher' then 'Product Plus Voucher Package'
    else p_package_type
  end;
$$;

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
    'totalPrice', coalesce((select sum(item.price) from public.commerce_package_items item where item.package_id = p_package.id), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'itemName', item.item_name,
        'price', item.price,
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

create or replace function public.get_active_commerce_packages(p_package_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_package_type is not null and p_package_type not in ('timeline_entry', 'matrix_1200_entry', 'product_plus_requirement', 'product_plus_voucher') then
    raise exception 'Unknown package type.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(public.commerce_package_json(package) order by package.package_type, package.sort_order, package.package_name), '[]'::jsonb)
  into result
  from public.commerce_packages package
  where package.is_active = true
    and (p_package_type is null or package.package_type = p_package_type);

  return result;
end;
$$;

create or replace function public.admin_get_commerce_packages()
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

  select coalesce(jsonb_agg(public.commerce_package_json(package) order by package.package_type, package.sort_order, package.package_name), '[]'::jsonb)
  into result
  from public.commerce_packages package;

  return result;
end;
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
    item_photo := coalesce(item ->> 'photoData', '');
    item_sort := coalesce(nullif(item ->> 'sortOrder', '')::integer, item_index * 10);

    if char_length(item_name) not between 2 and 100 then raise exception 'Each item needs a 2-100 character name.' using errcode = '22023'; end if;
    if item_price < 0 or item_price > 1000000 then raise exception 'Each item price must be between PHP 0 and PHP 1,000,000.' using errcode = '22023'; end if;
    if char_length(item_photo) > 1500000 then raise exception 'One item photo is too large. Use a smaller image.' using errcode = '22023'; end if;
    if item_sort < 0 or item_sort > 9999 then raise exception 'Item sort order must be between 0 and 9999.' using errcode = '22023'; end if;

    insert into public.commerce_package_items(package_id, item_name, price, photo_data, sort_order)
    values (saved_package.id, item_name, round(item_price, 2), item_photo, item_sort);
  end loop;

  select * into saved_package from public.commerce_packages where id = saved_package.id;
  return public.commerce_package_json(saved_package);
end;
$$;

create or replace function public.admin_delete_commerce_package(p_package_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  delete from public.commerce_packages where id = p_package_id;
  if not found then raise exception 'Package not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function
  public.commerce_package_type_label(text),
  public.commerce_package_json(public.commerce_packages),
  public.get_active_commerce_packages(text),
  public.admin_get_commerce_packages(),
  public.admin_save_commerce_package(uuid,text,text,text,boolean,integer,jsonb),
  public.admin_delete_commerce_package(uuid)
from public, anon;

grant execute on function
  public.get_active_commerce_packages(text),
  public.admin_get_commerce_packages(),
  public.admin_save_commerce_package(uuid,text,text,text,boolean,integer,jsonb),
  public.admin_delete_commerce_package(uuid)
to authenticated;
