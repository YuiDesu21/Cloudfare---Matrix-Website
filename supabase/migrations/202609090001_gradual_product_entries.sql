create or replace function public.product_entry_target(p_entry_type text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_entry_type
    when 'matrix_1200_entry' then 1200::numeric
    when 'timeline_entry' then 693::numeric
    when 'patronizing_entry_product' then 5818::numeric
    else null::numeric
  end;
$$;

create or replace function public.product_entry_progress_for(p_member_id uuid, p_entry_type text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select public.product_entry_target(p_entry_type) as amount
  ), orders as (
    select coalesce(sum(order_row.package_total) filter (where order_row.status in ('payment_approved','shipped','received')), 0) as approved_total,
      coalesce(sum(order_row.package_total) filter (where order_row.status in ('pending_shipping_fee','approved_for_payment','payment_submitted')), 0) as pending_total
    from public.commerce_orders order_row
    where order_row.member_id = p_member_id
      and (
        (p_entry_type in ('matrix_1200_entry','timeline_entry') and order_row.package_type = p_entry_type and order_row.order_purpose = 'standard')
        or (p_entry_type = 'patronizing_entry_product' and order_row.order_purpose = 'patronizing_entry_product')
      )
  )
  select jsonb_build_object(
    'entryType', p_entry_type,
    'targetAmount', coalesce((select amount from target), 0),
    'approvedAmount', round((select approved_total from orders), 2),
    'pendingAmount', round((select pending_total from orders), 2),
    'remainingAmount', greatest(coalesce((select amount from target), 0) - (select approved_total from orders), 0),
    'percent', case when coalesce((select amount from target), 0) <= 0 then 0 else least(round((select approved_total from orders) * 100 / (select amount from target), 1), 100) end,
    'isComplete', (select approved_total from orders) >= coalesce((select amount from target), 0)
  );
$$;

create or replace function public.get_my_product_entry_progress(p_entry_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if public.product_entry_target(p_entry_type) is null then raise exception 'Choose a valid product entry type.' using errcode = '22023'; end if;
  return public.product_entry_progress_for(auth.uid(), p_entry_type);
end;
$$;

create or replace function public.request_commerce_order(
  p_package_id uuid,
  p_shipping_address_id uuid,
  p_member_notes text default '',
  p_matrix_upline_code text default ''
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
  reserved_voucher_balance numeric;
  normalized_upline_code text := upper(trim(coalesce(p_matrix_upline_code, '')));
  resolved_upline uuid;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));

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
  if package_total <= 0 then raise exception 'Package total must be greater than zero.' using errcode = '22023'; end if;

  if exists (
    select 1
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.package_id = package.id
      and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then
    raise exception 'You already have an active order for this package.' using errcode = '23505';
  end if;

  if package.package_type = 'matrix_1200_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
    ) then
      raise exception 'Your PHP 1,200 Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.upgrade_requests
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
        and status = 'pending'
    ) then
      raise exception 'You already have a pending PHP 1,200 Matrix entry request.' using errcode = '23505';
    end if;
    resolved_upline := public.resolve_1200_matrix_upline(normalized_upline_code, auth.uid());
  end if;

  if package.package_type = 'timeline_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Your Timeline Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.timeline_requests
      where member_id = auth.uid()
        and status = 'pending'
    ) then
      raise exception 'You already have a pending Timeline Matrix entry request.' using errcode = '23505';
    end if;
  end if;

  if package.package_type = 'product_plus_voucher' then
    select coalesce(sum(amount), 0) into current_voucher_balance
    from public.voucher_ledger
    where member_id = auth.uid();

    select coalesce(sum(voucher_amount), 0) into reserved_voucher_balance
    from public.commerce_orders
    where member_id = auth.uid()
      and package_type = 'product_plus_voucher'
      and status = 'pending_shipping_fee';

    if current_voucher_balance - reserved_voucher_balance < package_total then
      raise exception 'Voucher balance is not enough for this package.' using errcode = '22023';
    end if;
  end if;

  address_snapshot := public.shipping_address_json(address);

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, matrix_upline_member_id, matrix_upline_code
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), package.id, package.package_type, package_snapshot,
    address.id, address_snapshot, package_total,
    case when package.package_type = 'product_plus_voucher' then package_total else 0 end,
    case when package.package_type = 'product_plus_voucher' then 0 else package_total end,
    trim(coalesce(p_member_notes, '')),
    resolved_upline,
    case when package.package_type = 'matrix_1200_entry' then normalized_upline_code else null end
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-requested', 'Member requested a package order.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'packageType', order_row.package_type, 'uplineMemberId', resolved_upline));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.request_patronizing_product_order(
  p_order_purpose text,
  p_shipping_address_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_member_notes text default '',
  p_exit_number smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  address public.shipping_addresses%rowtype;
  order_row public.commerce_orders%rowtype;
  product public.commerce_products%rowtype;
  item jsonb;
  item_index integer := 0;
  product_id uuid;
  product_quantity integer;
  cart_items jsonb := '[]'::jsonb;
  cart_snapshot jsonb;
  package_total numeric := 0;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  exit_rule public.patronizing_exit_rules%rowtype;
  used_exit_total numeric := 0;
  discount_value numeric := 0;
  purpose_label text;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if p_order_purpose not in ('patronizing_entry_product', 'patronizing_monthly_requirement', 'patronizing_exit_discount') then
    raise exception 'Choose a valid Patronizing checkout type.' using errcode = '22023';
  end if;
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
      and product_row.product_type = 'product_plus_requirement'
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

  if p_order_purpose = 'patronizing_entry_product' then
    if exists (select 1 from public.patronizing_entries where member_id = auth.uid() and status = 'active') then raise exception 'Your Patronizing Income entry is already active.' using errcode = '22023'; end if;
    purpose_label := 'Patronizing Product Entry';
  elsif p_order_purpose = 'patronizing_monthly_requirement' then
    if not exists (select 1 from public.patronizing_entries where member_id = auth.uid() and status = 'active') then raise exception 'Activate Patronizing Income before buying monthly requirement products.' using errcode = '22023'; end if;
    purpose_label := 'Patronizing Monthly Requirement';
  else
    if p_exit_number is null then raise exception 'Choose the Patronizing exit discount to use.' using errcode = '22023'; end if;
    select * into exit_rule from public.patronizing_exit_rules where exit_number = p_exit_number;
    if exit_rule.exit_number is null then raise exception 'Patronizing exit rule not found.' using errcode = 'P0002'; end if;
    if not exists (select 1 from public.patronizing_exit_progress where member_id = auth.uid() and exit_number = p_exit_number) then
      raise exception 'This Patronizing exit discount is not unlocked yet.' using errcode = '22023';
    end if;
    select coalesce(sum(existing.package_total), 0) into used_exit_total
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.order_purpose = 'patronizing_exit_discount'
      and existing.patronizing_exit_number = p_exit_number
      and existing.status not in ('rejected','cancelled');
    if used_exit_total + package_total > exit_rule.max_purchase then
      raise exception 'This cart exceeds your remaining Patronizing exit discount balance.' using errcode = '22023';
    end if;
    discount_value := round(package_total * exit_rule.discount_percent / 100, 2);
    purpose_label := 'Patronizing Exit ' || p_exit_number || ' Discount';
  end if;

  cart_snapshot := jsonb_build_object(
    'packageName', purpose_label || ' Cart',
    'packageType', 'product_plus_requirement',
    'packageTypeLabel', purpose_label,
    'description', 'Individual product checkout',
    'totalPrice', round(package_total, 2),
    'items', cart_items
  );

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, order_purpose,
    patronizing_exit_number, discount_percent, discount_amount, discount_source
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), null, 'product_plus_requirement', cart_snapshot,
    address.id, public.shipping_address_json(address), round(package_total, 2),
    0, greatest(round(package_total - discount_value, 2), 0), trim(coalesce(p_member_notes, '')), p_order_purpose,
    case when p_order_purpose = 'patronizing_exit_discount' then p_exit_number else null end,
    case when p_order_purpose = 'patronizing_exit_discount' then exit_rule.discount_percent else 0 end,
    discount_value,
    case when p_order_purpose = 'patronizing_exit_discount' then 'Patronizing Exit ' || p_exit_number else '' end
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'patronizing-product-order-requested', 'Member requested a Patronizing product checkout.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'purpose', p_order_purpose, 'exit', p_exit_number, 'discount', discount_value));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.profiles%rowtype;
  selected_parent uuid;
  voucher_credit numeric;
  patronizing_result jsonb;
  entry_target numeric;
  approved_entry_total numeric;
  entry_key text;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select * into target_member
  from public.profiles
  where id = p_order.member_id
  for update;

  if target_member.id is null then raise exception 'Order member not found.' using errcode = 'P0002'; end if;
  if target_member.status = 'suspended' then raise exception 'Suspended members cannot receive package benefits.' using errcode = '42501'; end if;

  if p_order.order_purpose = 'patronizing_entry_product' then
    entry_key := 'patronizing_entry_product';
    entry_target := public.product_entry_target(entry_key);
    select coalesce(sum(existing.package_total), 0) into approved_entry_total
    from public.commerce_orders existing
    where existing.member_id = target_member.id
      and existing.order_purpose = 'patronizing_entry_product'
      and existing.status in ('payment_approved','shipped','received')
      and existing.id <> p_order.id;
    approved_entry_total := round(approved_entry_total + p_order.package_total, 2);

    if approved_entry_total < entry_target then
      return jsonb_build_object('type', 'patronizing_entry_product_progress', 'approvedAmount', approved_entry_total, 'targetAmount', entry_target, 'remainingAmount', greatest(entry_target - approved_entry_total, 0));
    end if;

    patronizing_result := public.activate_patronizing_entry(target_member.id, 'products', null, p_order.id, p_activation_time);
    return jsonb_build_object('type', 'patronizing_entry_product', 'activation', patronizing_result, 'approvedAmount', approved_entry_total, 'targetAmount', entry_target);
  end if;

  if p_order.order_purpose = 'patronizing_monthly_requirement' then
    patronizing_result := public.apply_patronizing_monthly_unlocks(target_member.id, p_activation_time, p_order.id);
    return jsonb_build_object('type', 'patronizing_monthly_requirement', 'unlock', patronizing_result);
  end if;

  if p_order.order_purpose = 'patronizing_exit_discount' then
    return jsonb_build_object('type', 'patronizing_exit_discount', 'exit', p_order.patronizing_exit_number, 'discountAmount', p_order.discount_amount);
  end if;

  if p_order.package_type = 'matrix_1200_entry' then
    perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'power3-passive'
    ) then
      raise exception 'This member is already active in the PHP 1,200 Matrix.' using errcode = '22023';
    end if;

    if p_order.matrix_upline_code is null or p_order.matrix_upline_member_id is null then
      raise exception 'This order has no 1200 Matrix upline code. Ask the member to submit a new order request.' using errcode = '22023';
    end if;

    entry_target := public.product_entry_target('matrix_1200_entry');
    select coalesce(sum(existing.package_total), 0) into approved_entry_total
    from public.commerce_orders existing
    where existing.member_id = target_member.id
      and existing.package_type = 'matrix_1200_entry'
      and existing.order_purpose = 'standard'
      and existing.status in ('payment_approved','shipped','received')
      and existing.id <> p_order.id;
    approved_entry_total := round(approved_entry_total + p_order.package_total, 2);

    if approved_entry_total < entry_target then
      return jsonb_build_object('type', 'matrix_1200_entry_progress', 'approvedAmount', approved_entry_total, 'targetAmount', entry_target, 'remainingAmount', greatest(entry_target - approved_entry_total, 0));
    end if;

    selected_parent := public.resolve_1200_matrix_upline(p_order.matrix_upline_code, target_member.id);

    update public.profiles
    set status = 'active',
        approved_at = coalesce(approved_at, p_activation_time),
        cumulative_f3_tokens = greatest(cumulative_f3_tokens, 20)
    where id = target_member.id;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'power3-passive', selected_parent, p_activation_time);

    insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
    select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, p_activation_time + month_number * interval '1 month', 'due', p_activation_time
    from generate_series(1, 3) as months(month_number);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-main-matrix-activation', 'Activated PHP 1,200 Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent, 'uplineCode', p_order.matrix_upline_code, 'approvedAmount', approved_entry_total));

    return jsonb_build_object('type', 'matrix_1200_entry', 'planId', 'power3-passive', 'parentMemberId', selected_parent, 'approvedAmount', approved_entry_total, 'targetAmount', entry_target);
  end if;

  if p_order.package_type = 'timeline_entry' then
    perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Timeline Matrix is already active for this account.' using errcode = '22023';
    end if;

    entry_target := public.product_entry_target('timeline_entry');
    select coalesce(sum(existing.package_total), 0) into approved_entry_total
    from public.commerce_orders existing
    where existing.member_id = target_member.id
      and existing.package_type = 'timeline_entry'
      and existing.order_purpose = 'standard'
      and existing.status in ('payment_approved','shipped','received')
      and existing.id <> p_order.id;
    approved_entry_total := round(approved_entry_total + p_order.package_total, 2);

    if approved_entry_total < entry_target then
      return jsonb_build_object('type', 'timeline_entry_progress', 'approvedAmount', approved_entry_total, 'targetAmount', entry_target, 'remainingAmount', greatest(entry_target - approved_entry_total, 0));
    end if;

    select position.member_id into selected_parent
    from public.matrix_positions position
    where position.plan_id = 'timeline-power3'
      and (
        select count(*)
        from public.matrix_positions child
        where child.plan_id = 'timeline-power3'
          and child.parent_member_id = position.member_id
      ) < 3
    order by position.placed_at, position.id
    limit 1;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'timeline-power3', selected_parent, p_activation_time);

    perform public.refresh_timeline_ancestor_progress(target_member.id);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-timeline-activation', 'Activated Timeline Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent, 'approvedAmount', approved_entry_total));

    return jsonb_build_object('type', 'timeline_entry', 'planId', 'timeline-power3', 'parentMemberId', selected_parent, 'approvedAmount', approved_entry_total, 'targetAmount', entry_target);
  end if;

  if p_order.package_type = 'product_plus_requirement' then
    voucher_credit := round(p_order.package_total, 2);
    if voucher_credit <= 0 then raise exception 'Product Plus voucher credit must be greater than zero.' using errcode = '22023'; end if;

    if not exists (
      select 1 from public.voucher_ledger
      where commerce_order_id = p_order.id
        and entry_type = 'credit'
    ) then
      insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
      values (target_member.id, p_order.id, 'credit', voucher_credit, p_order.order_code, 'Product Plus package purchase completed', auth.uid());
    end if;

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-product-plus-credit', 'Credited Product Plus vouchers from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'voucherCredit', voucher_credit));

    return jsonb_build_object('type', 'product_plus_requirement', 'voucherCredit', voucher_credit);
  end if;

  return jsonb_build_object('type', p_order.package_type, 'status', 'no_matrix_or_voucher_benefit');
end;
$$;

revoke all on function
  public.product_entry_target(text),
  public.product_entry_progress_for(uuid,text),
  public.get_my_product_entry_progress(text),
  public.request_commerce_order(uuid,uuid,text,text),
  public.request_patronizing_product_order(text,uuid,jsonb,text,smallint),
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
from public, anon;

grant execute on function
  public.get_my_product_entry_progress(text),
  public.request_commerce_order(uuid,uuid,text,text),
  public.request_patronizing_product_order(text,uuid,jsonb,text,smallint)
to authenticated;

grant execute on function
  public.product_entry_target(text),
  public.product_entry_progress_for(uuid,text),
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz)
to authenticated;
