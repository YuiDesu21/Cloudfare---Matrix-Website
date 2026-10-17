-- Qualify the order column so it cannot conflict with the local voucher_amount variable.
create or replace function public.request_shop_order(
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
  select coalesce(sum(commerce_order.voucher_amount), 0) into reserved_amount
  from public.commerce_orders commerce_order
  where commerce_order.member_id = auth.uid() and commerce_order.status = 'pending_shipping_fee'
    and (commerce_order.package_type = 'product_plus_voucher' or commerce_order.order_purpose = 'shop');
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
