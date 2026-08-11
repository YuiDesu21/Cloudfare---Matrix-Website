-- Member package browsing order requests.

create table if not exists public.commerce_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_code text not null unique,
  member_id uuid not null references public.profiles(id) on delete restrict,
  package_id uuid references public.commerce_packages(id) on delete set null,
  package_type text not null check (package_type in ('timeline_entry', 'matrix_1200_entry', 'product_plus_requirement', 'product_plus_voucher')),
  package_snapshot jsonb not null,
  shipping_address_id uuid references public.shipping_addresses(id) on delete set null,
  shipping_address_snapshot jsonb not null,
  package_total numeric(12,2) not null check (package_total >= 0),
  shipping_fee numeric(12,2) check (shipping_fee is null or shipping_fee >= 0),
  voucher_amount numeric(12,2) not null default 0 check (voucher_amount >= 0),
  amount_due numeric(12,2) not null default 0 check (amount_due >= 0),
  status text not null default 'pending_shipping_fee' check (status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped','received','rejected','cancelled')),
  member_notes text not null default '' check (char_length(member_notes) <= 240),
  admin_notes text not null default '' check (char_length(admin_notes) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz
);

create index if not exists commerce_orders_member_created_idx on public.commerce_orders(member_id, created_at desc);
create index if not exists commerce_orders_status_created_idx on public.commerce_orders(status, created_at desc);

alter table public.commerce_orders enable row level security;

drop policy if exists commerce_orders_read_self_or_admin on public.commerce_orders;
create policy commerce_orders_read_self_or_admin
  on public.commerce_orders for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

create or replace function public.commerce_order_json(p_order public.commerce_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'orderCode', p_order.order_code,
    'memberId', p_order.member_id,
    'packageId', p_order.package_id,
    'packageType', p_order.package_type,
    'packageTypeLabel', public.commerce_package_type_label(p_order.package_type),
    'packageSnapshot', p_order.package_snapshot,
    'shippingAddressId', p_order.shipping_address_id,
    'shippingAddressSnapshot', p_order.shipping_address_snapshot,
    'packageTotal', p_order.package_total,
    'shippingFee', p_order.shipping_fee,
    'voucherAmount', p_order.voucher_amount,
    'amountDue', p_order.amount_due,
    'status', p_order.status,
    'memberNotes', p_order.member_notes,
    'adminNotes', p_order.admin_notes,
    'createdAt', p_order.created_at,
    'updatedAt', p_order.updated_at,
    'approvedAt', p_order.approved_at,
    'rejectedAt', p_order.rejected_at,
    'shippedAt', p_order.shipped_at,
    'receivedAt', p_order.received_at
  );
$$;

create or replace function public.get_my_commerce_orders()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.commerce_order_json(order_row) order by order_row.created_at desc), '[]'::jsonb)
  from public.commerce_orders order_row
  where order_row.member_id = auth.uid();
$$;

create or replace function public.request_commerce_order(
  p_package_id uuid,
  p_shipping_address_id uuid,
  p_member_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package public.commerce_packages;
  address public.shipping_addresses;
  order_row public.commerce_orders;
  package_snapshot jsonb;
  address_snapshot jsonb;
  package_total numeric;
  current_voucher_balance numeric;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  select * into package
  from public.commerce_packages
  where id = p_package_id
    and is_active = true;
  if package.id is null then raise exception 'Package is not available.' using errcode = 'P0002'; end if;

  select * into address
  from public.shipping_addresses
  where id = p_shipping_address_id
    and member_id = auth.uid();
  if address.id is null then raise exception 'Choose one of your saved shipping addresses.' using errcode = 'P0002'; end if;

  package_snapshot := public.commerce_package_json(package);
  package_total := coalesce((package_snapshot ->> 'totalPrice')::numeric, 0);
  if jsonb_array_length(coalesce(package_snapshot -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Package has no items yet.' using errcode = '22023';
  end if;

  if package.package_type = 'product_plus_voucher' then
    select coalesce(sum(amount), 0) into current_voucher_balance
    from public.voucher_ledger
    where member_id = auth.uid();
    if current_voucher_balance < package_total then
      raise exception 'Voucher balance is not enough for this package.' using errcode = '22023';
    end if;
  end if;

  address_snapshot := public.shipping_address_json(address);

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), package.id, package.package_type, package_snapshot,
    address.id, address_snapshot, package_total,
    case when package.package_type = 'product_plus_voucher' then package_total else 0 end,
    case when package.package_type = 'product_plus_voucher' then 0 else package_total end,
    trim(coalesce(p_member_notes, ''))
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-requested', 'Member requested a package order.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'packageType', order_row.package_type));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.admin_get_commerce_orders()
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

  select coalesce(jsonb_agg(
    public.commerce_order_json(order_row) ||
    jsonb_build_object(
      'fullName', profile.full_name,
      'username', profile.username,
      'accountCode', profile.account_code,
      'phone', profile.phone,
      'email', profile.email
    )
    order by order_row.created_at desc
  ), '[]'::jsonb)
  into result
  from public.commerce_orders order_row
  join public.profiles profile on profile.id = order_row.member_id;

  return result;
end;
$$;

revoke all on function
  public.commerce_order_json(public.commerce_orders),
  public.get_my_commerce_orders(),
  public.request_commerce_order(uuid,uuid,text),
  public.admin_get_commerce_orders()
from public, anon;

grant execute on function
  public.get_my_commerce_orders(),
  public.request_commerce_order(uuid,uuid,text),
  public.admin_get_commerce_orders()
to authenticated;
