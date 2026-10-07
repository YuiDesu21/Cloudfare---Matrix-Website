begin;

do $$
declare
  owner_id uuid := extensions.gen_random_uuid();
  token_member_id uuid := extensions.gen_random_uuid();
  legacy_member_id uuid := extensions.gen_random_uuid();
  package_member_id uuid := extensions.gen_random_uuid();
  product_member_id uuid := extensions.gen_random_uuid();
  method_id uuid := extensions.gen_random_uuid();
  package_address_id uuid := extensions.gen_random_uuid();
  product_address_id uuid := extensions.gen_random_uuid();
  token_request_id uuid;
  legacy_request_id uuid;
  package_one_id uuid;
  package_two_id uuid;
  package_order_id uuid;
  product_id uuid;
  product_order_id uuid;
  blocked boolean;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (owner_id, 'tier-owner-' || owner_id || '@example.invalid', jsonb_build_object('full_name', 'Tier Test Owner', 'username', 'tier_owner_' || left(replace(owner_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || owner_id)),
    (token_member_id, 'tier-token-' || token_member_id || '@example.invalid', jsonb_build_object('full_name', 'Tier Test Token', 'username', 'tier_token_' || left(replace(token_member_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || token_member_id)),
    (legacy_member_id, 'tier-legacy-' || legacy_member_id || '@example.invalid', jsonb_build_object('full_name', 'Tier Test Legacy', 'username', 'tier_legacy_' || left(replace(legacy_member_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || legacy_member_id)),
    (package_member_id, 'tier-package-' || package_member_id || '@example.invalid', jsonb_build_object('full_name', 'Tier Test Package', 'username', 'tier_package_' || left(replace(package_member_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || package_member_id)),
    (product_member_id, 'tier-product-' || product_member_id || '@example.invalid', jsonb_build_object('full_name', 'Tier Test Product', 'username', 'tier_product_' || left(replace(product_member_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || product_member_id));
  update public.user_roles set role = 'admin' where user_id = owner_id;
  insert into public.organization_owners(user_id) values (owner_id);
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values (method_id, 'Tier Test Bank', 'Tier Test Owner', 'TIER-TEST-001');

  perform set_config('request.jwt.claim.sub', token_member_id::text, true);
  if jsonb_array_length(public.get_my_patronizing_dashboard() -> 'plans') <> 4 then
    raise exception 'Patronizing dashboard did not return four plans';
  end if;
  perform public.request_patronizing_token_entry_plan('f3_token_12', method_id,
    'TIER-TOKEN-' || left(replace(token_member_id::text, '-', ''), 8), 'Test');
  select id into token_request_id from public.patronizing_token_requests
  where member_id = token_member_id and status = 'pending';
  if not exists (select 1 from public.patronizing_token_requests
    where id = token_request_id and amount = 720 and f3_tokens = 12 and plan_code = 'f3_token_12') then
    raise exception 'The 12-token request has the wrong amount';
  end if;
  if public.get_my_patronizing_dashboard() -> 'pendingTokenRequest' ->> 'planCode' <> 'f3_token_12' then
    raise exception 'The pending dashboard lost the selected token tier';
  end if;
  if exists (select 1 from public.patronizing_entries where member_id = token_member_id) then
    raise exception 'The 12-token entry activated before approval';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_patronizing_token_request(token_request_id, 'Test');
  if not exists (select 1 from public.patronizing_entries
    where member_id = token_member_id and plan_code = 'f3_token_12'
      and entry_type = 'f3_token' and entry_amount = 720
      and monthly_income = 100 and monthly_requirement = 500) then
    raise exception 'The approved 12-token entry has the wrong schedule';
  end if;
  if (select count(*) from public.patronizing_monthly_income
    where member_id = token_member_id and income_amount = 100 and required_purchase = 500) <> 24 then
    raise exception 'The 12-token entry did not create 24 correct income rows';
  end if;
  perform set_config('request.jwt.claim.sub', token_member_id::text, true);
  if public.get_my_patronizing_dashboard() -> 'entry' ->> 'planCode' <> 'f3_token_12' then
    raise exception 'The active dashboard lost the selected token tier';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  perform set_config('request.jwt.claim.sub', legacy_member_id::text, true);
  perform public.request_patronizing_token_entry(method_id,
    'TIER-LEGACY-' || left(replace(legacy_member_id::text, '-', ''), 8), 'Test');
  select id into legacy_request_id from public.patronizing_token_requests
  where member_id = legacy_member_id and status = 'pending';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_patronizing_token_request(legacy_request_id, 'Test');
  if not exists (select 1 from public.patronizing_entries
    where member_id = legacy_member_id and plan_code = 'f3_token'
      and entry_amount = 2100 and monthly_income = 200 and monthly_requirement = 1000) then
    raise exception 'The original 35-token entry regressed';
  end if;

  package_one_id := (public.admin_save_commerce_package(null, 'timeline_entry',
    'Tier Test Package One', '', true, 10,
    jsonb_build_array(jsonb_build_object('itemName', 'Tier Product One', 'price', 1000, 'quantity', 1))) ->> 'id')::uuid;
  package_two_id := (public.admin_save_commerce_package(null, 'timeline_entry',
    'Tier Test Package Two', '', true, 20,
    jsonb_build_array(jsonb_build_object('itemName', 'Tier Product Two', 'price', 2000, 'quantity', 1))) ->> 'id')::uuid;
  insert into public.shipping_addresses(id, member_id, full_name, phone, region, province, city, barangay, street_address, postal_code)
  values
    (package_address_id, package_member_id, 'Tier Test Package', '09000000000', 'Test Region', 'Test Province', 'Test City', 'Test Barangay', '123 Test Street', '1000'),
    (product_address_id, product_member_id, 'Tier Test Product', '09000000000', 'Test Region', 'Test Province', 'Test City', 'Test Barangay', '123 Test Street', '1000');

  perform set_config('request.jwt.claim.sub', package_member_id::text, true);
  package_order_id := (public.request_patronizing_package_order(package_one_id, package_address_id, '') ->> 'id')::uuid;
  if (select public.commerce_order_json(order_row) ->> 'packageTypeLabel'
      from public.commerce_orders order_row where id = package_order_id) <> 'Patronizing Package Entry' then
    raise exception 'Patronizing package is mislabeled as Timeline entry';
  end if;
  blocked := false;
  begin
    perform public.request_patronizing_token_entry_plan('f3_token_12', method_id,
      'TIER-MIX-' || left(replace(package_member_id::text, '-', ''), 8), 'Test');
  exception when invalid_parameter_value then blocked := true;
  end;
  if not blocked then raise exception 'Token entry was allowed after package progress'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_fee(package_order_id, 50, 'Test');
  perform set_config('request.jwt.claim.sub', package_member_id::text, true);
  perform public.submit_commerce_order_payment(package_order_id, method_id,
    'TIER-PKG-ONE-' || left(replace(package_member_id::text, '-', ''), 8), 'Test');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_payment(package_order_id, 'Test');
  if exists (select 1 from public.patronizing_entries where member_id = package_member_id) then
    raise exception 'Package entry activated below PHP 2,800';
  end if;
  if exists (select 1 from public.matrix_positions where member_id = package_member_id and plan_id = 'timeline-power3') then
    raise exception 'Patronizing package wrongly activated Timeline Matrix';
  end if;

  perform set_config('request.jwt.claim.sub', package_member_id::text, true);
  package_order_id := (public.request_patronizing_package_order(package_two_id, package_address_id, '') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_fee(package_order_id, 50, 'Test');
  perform set_config('request.jwt.claim.sub', package_member_id::text, true);
  perform public.submit_commerce_order_payment(package_order_id, method_id,
    'TIER-PKG-TWO-' || left(replace(package_member_id::text, '-', ''), 8), 'Test');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_payment(package_order_id, 'Test');
  if not exists (select 1 from public.patronizing_entries
    where member_id = package_member_id and plan_code = 'products_2800'
      and entry_type = 'products' and entry_amount = 2800
      and monthly_income = 150 and monthly_requirement = 750) then
    raise exception 'PHP 2,800 package entry did not activate correctly';
  end if;
  if (select count(*) from public.patronizing_monthly_income
    where member_id = package_member_id and income_amount = 150 and required_purchase = 750) <> 24 then
    raise exception 'PHP 2,800 package entry did not create 24 correct income rows';
  end if;
  perform set_config('request.jwt.claim.sub', package_member_id::text, true);
  if public.get_my_patronizing_dashboard() -> 'entry' ->> 'planCode' <> 'products_2800' then
    raise exception 'The active dashboard lost the package tier';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if exists (select 1 from public.matrix_positions where member_id = package_member_id and plan_id = 'timeline-power3') then
    raise exception 'Patronizing package wrongly activated Timeline Matrix';
  end if;

  product_id := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Tier Test Individual Product', '', 5818, '', true, 10,
    'pc') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', product_member_id::text, true);
  product_order_id := (public.request_patronizing_product_order('patronizing_entry_product',
    product_address_id, jsonb_build_array(jsonb_build_object('productId', product_id, 'quantity', 1)), '', null) ->> 'id')::uuid;
  blocked := false;
  begin
    perform public.request_patronizing_package_order(package_one_id, product_address_id, '');
  exception when invalid_parameter_value then blocked := true;
  end;
  if not blocked then raise exception 'Package path was allowed after individual-product progress'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_fee(product_order_id, 50, 'Test');
  perform set_config('request.jwt.claim.sub', product_member_id::text, true);
  perform public.submit_commerce_order_payment(product_order_id, method_id,
    'TIER-PRODUCT-' || left(replace(product_member_id::text, '-', ''), 8), 'Test');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_payment(product_order_id, 'Test');
  if not exists (select 1 from public.patronizing_entries
    where member_id = product_member_id and plan_code = 'products'
      and entry_amount = 5818 and monthly_income = 250 and monthly_requirement = 1250) then
    raise exception 'The original PHP 5,818 product entry regressed';
  end if;
end;
$$;

rollback;
