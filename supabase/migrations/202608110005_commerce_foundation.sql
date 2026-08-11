-- Commerce foundation: member shipping addresses and admin payment methods.

create table if not exists public.shipping_addresses (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text not null check (phone ~ '^([+]?63|0)9[0-9]{9}$'),
  region text not null check (char_length(trim(region)) between 2 and 80),
  province text not null check (char_length(trim(province)) between 2 and 80),
  city text not null check (char_length(trim(city)) between 2 and 80),
  barangay text not null check (char_length(trim(barangay)) between 2 and 80),
  street_address text not null check (char_length(trim(street_address)) between 4 and 180),
  postal_code text not null check (postal_code ~ '^[0-9]{4}$'),
  notes text not null default '' check (char_length(notes) <= 240),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_addresses_member_idx on public.shipping_addresses(member_id, created_at desc);
create unique index if not exists one_default_shipping_address_per_member
  on public.shipping_addresses(member_id)
  where is_default;

alter table public.shipping_addresses enable row level security;
drop policy if exists shipping_addresses_read_self_or_admin on public.shipping_addresses;
create policy shipping_addresses_read_self_or_admin
  on public.shipping_addresses for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

create table if not exists public.payment_methods (
  id uuid primary key default extensions.gen_random_uuid(),
  method_name text not null check (char_length(trim(method_name)) between 2 and 60),
  account_name text not null check (char_length(trim(account_name)) between 2 and 120),
  account_number text not null check (char_length(trim(account_number)) between 3 and 80),
  qr_image_data text not null default '' check (char_length(qr_image_data) <= 1500000),
  instructions text not null default '' check (char_length(instructions) <= 320),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_methods_active_sort_idx on public.payment_methods(is_active, sort_order, method_name);

alter table public.payment_methods enable row level security;
drop policy if exists payment_methods_read_active_or_admin on public.payment_methods;
create policy payment_methods_read_active_or_admin
  on public.payment_methods for select to authenticated
  using (is_active or public.is_admin());

create or replace function public.normalize_shipping_address_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(trim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
$$;

create or replace function public.shipping_address_json(address public.shipping_addresses)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', address.id,
    'memberId', address.member_id,
    'fullName', address.full_name,
    'phone', address.phone,
    'region', address.region,
    'province', address.province,
    'city', address.city,
    'barangay', address.barangay,
    'streetAddress', address.street_address,
    'postalCode', address.postal_code,
    'notes', address.notes,
    'isDefault', address.is_default,
    'createdAt', address.created_at,
    'updatedAt', address.updated_at
  );
$$;

create or replace function public.payment_method_json(method public.payment_methods)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', method.id,
    'methodName', method.method_name,
    'accountName', method.account_name,
    'accountNumber', method.account_number,
    'qrImageData', method.qr_image_data,
    'instructions', method.instructions,
    'sortOrder', method.sort_order,
    'isActive', method.is_active,
    'createdAt', method.created_at,
    'updatedAt', method.updated_at
  );
$$;

create or replace function public.get_my_shipping_addresses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.shipping_address_json(address) order by address.is_default desc, address.created_at desc), '[]'::jsonb)
  from public.shipping_addresses address
  where address.member_id = auth.uid();
$$;

create or replace function public.save_my_shipping_address(
  p_address_id uuid,
  p_full_name text,
  p_phone text,
  p_region text,
  p_province text,
  p_city text,
  p_barangay text,
  p_street_address text,
  p_postal_code text,
  p_notes text default '',
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shipping_addresses;
  normalized_phone text := public.normalize_shipping_address_phone(p_phone);
  should_default boolean := coalesce(p_is_default, false);
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if normalized_phone !~ '^([+]?63|0)9[0-9]{9}$' then raise exception 'Enter a valid Philippine mobile number.' using errcode = '22023'; end if;
  if trim(coalesce(p_postal_code, '')) !~ '^[0-9]{4}$' then raise exception 'Postal code must be 4 digits.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_notes, ''))) > 240 then raise exception 'Address notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  if not exists (select 1 from public.shipping_addresses where member_id = auth.uid()) then
    should_default := true;
  end if;

  if should_default then
    update public.shipping_addresses
    set is_default = false, updated_at = now()
    where member_id = auth.uid()
      and (p_address_id is null or id <> p_address_id);
  end if;

  if p_address_id is null then
    insert into public.shipping_addresses(
      member_id, full_name, phone, region, province, city, barangay,
      street_address, postal_code, notes, is_default
    )
    values (
      auth.uid(), trim(p_full_name), normalized_phone, trim(p_region), trim(p_province),
      trim(p_city), trim(p_barangay), trim(p_street_address), trim(p_postal_code),
      trim(coalesce(p_notes, '')), should_default
    )
    returning * into target;
  else
    update public.shipping_addresses
    set full_name = trim(p_full_name),
        phone = normalized_phone,
        region = trim(p_region),
        province = trim(p_province),
        city = trim(p_city),
        barangay = trim(p_barangay),
        street_address = trim(p_street_address),
        postal_code = trim(p_postal_code),
        notes = trim(coalesce(p_notes, '')),
        is_default = should_default,
        updated_at = now()
    where id = p_address_id
      and member_id = auth.uid()
    returning * into target;

    if target.id is null then raise exception 'Shipping address not found.' using errcode = 'P0002'; end if;
  end if;

  return public.shipping_address_json(target);
end;
$$;

create or replace function public.delete_my_shipping_address(p_address_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_default boolean;
  fallback_id uuid;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;

  delete from public.shipping_addresses
  where id = p_address_id
    and member_id = auth.uid()
  returning is_default into was_default;

  if was_default is null then raise exception 'Shipping address not found.' using errcode = 'P0002'; end if;

  if was_default then
    select id into fallback_id
    from public.shipping_addresses
    where member_id = auth.uid()
    order by created_at desc
    limit 1;

    if fallback_id is not null then
      update public.shipping_addresses set is_default = true, updated_at = now() where id = fallback_id;
    end if;
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.get_active_payment_methods()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.payment_method_json(method) order by method.sort_order, method.method_name), '[]'::jsonb)
  from public.payment_methods method
  where method.is_active = true;
$$;

create or replace function public.admin_get_payment_methods()
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
  select coalesce(jsonb_agg(public.payment_method_json(method) order by method.sort_order, method.method_name), '[]'::jsonb)
  into result
  from public.payment_methods method;
  return result;
end;
$$;

create or replace function public.admin_save_payment_method(
  p_method_id uuid,
  p_method_name text,
  p_account_name text,
  p_account_number text,
  p_qr_image_data text default '',
  p_instructions text default '',
  p_sort_order integer default 100,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  method public.payment_methods;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_method_name, ''))) not between 2 and 60 then raise exception 'Payment method name must be 2-60 characters.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_account_name, ''))) not between 2 and 120 then raise exception 'Account name must be 2-120 characters.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_account_number, ''))) not between 3 and 80 then raise exception 'Account number must be 3-80 characters.' using errcode = '22023'; end if;
  if char_length(coalesce(p_qr_image_data, '')) > 1500000 then raise exception 'QR image is too large. Use a smaller image.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_instructions, ''))) > 320 then raise exception 'Instructions must be 320 characters or fewer.' using errcode = '22023'; end if;
  if coalesce(p_sort_order, 100) < 0 or coalesce(p_sort_order, 100) > 9999 then raise exception 'Sort order must be between 0 and 9999.' using errcode = '22023'; end if;

  if p_method_id is null then
    insert into public.payment_methods(
      method_name, account_name, account_number, qr_image_data, instructions,
      sort_order, is_active, created_by, updated_by
    )
    values (
      trim(p_method_name), trim(p_account_name), trim(p_account_number), coalesce(p_qr_image_data, ''),
      trim(coalesce(p_instructions, '')), coalesce(p_sort_order, 100), coalesce(p_is_active, true), auth.uid(), auth.uid()
    )
    returning * into method;
  else
    update public.payment_methods
    set method_name = trim(p_method_name),
        account_name = trim(p_account_name),
        account_number = trim(p_account_number),
        qr_image_data = coalesce(p_qr_image_data, ''),
        instructions = trim(coalesce(p_instructions, '')),
        sort_order = coalesce(p_sort_order, 100),
        is_active = coalesce(p_is_active, true),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_method_id
    returning * into method;

    if method.id is null then raise exception 'Payment method not found.' using errcode = 'P0002'; end if;
  end if;

  return public.payment_method_json(method);
end;
$$;

create or replace function public.admin_delete_payment_method(p_method_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  delete from public.payment_methods where id = p_method_id;
  if not found then raise exception 'Payment method not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function
  public.normalize_shipping_address_phone(text),
  public.shipping_address_json(public.shipping_addresses),
  public.payment_method_json(public.payment_methods),
  public.get_my_shipping_addresses(),
  public.save_my_shipping_address(uuid,text,text,text,text,text,text,text,text,text,boolean),
  public.delete_my_shipping_address(uuid),
  public.get_active_payment_methods(),
  public.admin_get_payment_methods(),
  public.admin_save_payment_method(uuid,text,text,text,text,text,integer,boolean),
  public.admin_delete_payment_method(uuid)
from public, anon;

grant execute on function
  public.get_my_shipping_addresses(),
  public.save_my_shipping_address(uuid,text,text,text,text,text,text,text,text,text,boolean),
  public.delete_my_shipping_address(uuid),
  public.get_active_payment_methods(),
  public.admin_get_payment_methods(),
  public.admin_save_payment_method(uuid,text,text,text,text,text,integer,boolean),
  public.admin_delete_payment_method(uuid)
to authenticated;
