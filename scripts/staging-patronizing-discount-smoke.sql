begin;

do $$
<<qa>>
declare
  owner_id uuid := extensions.gen_random_uuid();
  member_id uuid := extensions.gen_random_uuid();
  method_id uuid := extensions.gen_random_uuid();
  address_id uuid := extensions.gen_random_uuid();
  product_400 uuid;
  product_200 uuid;
  product_1100 uuid;
  order_id uuid;
  approval jsonb;
  blocked boolean := false;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (owner_id, 'discount-owner-' || owner_id || '@example.invalid',
      jsonb_build_object('full_name', 'Discount Test Owner',
        'username', 'discount_owner_' || left(replace(owner_id::text, '-', ''), 8),
        'phone', '09000000000', 'wallet_address', 'F3-' || owner_id)),
    (member_id, 'discount-member-' || member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Discount Test Member',
        'username', 'discount_member_' || left(replace(member_id::text, '-', ''), 8),
        'phone', '09000000000', 'wallet_address', 'F3-' || member_id));
  update public.user_roles set role = 'admin' where user_id = owner_id;
  insert into public.organization_owners(user_id) values (owner_id);
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values (method_id, 'Discount Test Bank', 'Discount Test Owner', 'DISCOUNT-TEST-001');
  insert into public.shipping_addresses(id, member_id, full_name, phone, region,
    province, city, barangay, street_address, postal_code)
  values (address_id, member_id, 'Discount Test Member', '09000000000',
    'Test Region', 'Test Province', 'Test City', 'Test Barangay', '123 Test Street', '1000');

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.activate_patronizing_entry(member_id, 'f3_token_12');
  update public.patronizing_monthly_income
  set due_at = now() - interval '1 day', status = 'reflected'
  where public.patronizing_monthly_income.member_id = qa.member_id and month_number = 1;
  insert into public.patronizing_exit_progress(member_id, exit_number, status, approved_at)
  values (member_id, 1, 'active', now());
  product_400 := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Discount Test 400', '', 400, '', true, 10,
    'pc') ->> 'id')::uuid;
  product_200 := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Discount Test 200', '', 200, '', true, 20,
    'pc') ->> 'id')::uuid;
  product_1100 := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Discount Test 1100', '', 1100, '', true, 30,
    'pc') ->> 'id')::uuid;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  order_id := (public.request_patronizing_product_order('patronizing_exit_discount',
    address_id, jsonb_build_array(jsonb_build_object('productId', product_400,
      'quantity', 1)), 'Rollback-only test', 1::smallint) ->> 'id')::uuid;
  if not exists (select 1 from public.commerce_orders where id = order_id
    and package_total = 400 and discount_amount = 60 and amount_due = 340) then
    raise exception 'Exit 1 did not apply its 15 percent discount to PHP 400';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_fee(order_id, 50, 'Rollback-only test');
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform public.submit_commerce_order_payment(order_id, method_id,
    'DISCOUNT-FIRST-' || left(replace(member_id::text, '-', ''), 8), 'Rollback-only test');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  approval := public.admin_approve_commerce_order_payment(order_id, 'Rollback-only test');
  if (approval #>> '{benefit,unlock,approvedPurchaseTotal}')::numeric <> 340
    or (approval #>> '{benefit,unlock,unlocked}')::integer <> 0 then
    raise exception 'Discounted PHP 400 order should credit only PHP 340 and not unlock';
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  order_id := (public.request_patronizing_product_order('patronizing_exit_discount',
    address_id, jsonb_build_array(jsonb_build_object('productId', product_200,
      'quantity', 1)), 'Rollback-only test', 1::smallint) ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_commerce_order_fee(order_id, 0, 'Rollback-only test');
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform public.submit_commerce_order_payment(order_id, method_id,
    'DISCOUNT-SECOND-' || left(replace(member_id::text, '-', ''), 8), 'Rollback-only test');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  approval := public.admin_approve_commerce_order_payment(order_id, 'Rollback-only test');
  if (approval #>> '{benefit,unlock,approvedPurchaseTotal}')::numeric <> 510
    or (approval #>> '{benefit,unlock,unlocked}')::integer <> 1
    or (select count(*) from public.reward_ledger
      where public.reward_ledger.member_id = qa.member_id
      and source_type = 'patronizing_income' and amount = 100) <> 1 then
    raise exception 'Discounted orders did not unlock exactly one PHP 100 month at PHP 510 paid';
  end if;
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  if (public.get_my_patronizing_dashboard() #>> '{monthlySummary,approvedPurchase}')::numeric <> 510
    or (public.get_my_patronizing_dashboard() #>> '{monthlySummary,remainingRequirement}')::numeric <> 0
    or (public.get_my_patronizing_dashboard() #>> '{exits,0,usedPurchase}')::numeric <> 600 then
    raise exception 'Member dashboard mixed listed exit allowance with discounted monthly credit';
  end if;

  perform public.request_patronizing_product_order('patronizing_exit_discount',
    address_id, jsonb_build_array(jsonb_build_object('productId', product_1100,
      'quantity', 1)), 'Rollback-only test', 1::smallint);
  begin
    perform public.request_patronizing_product_order('patronizing_exit_discount',
      address_id, jsonb_build_array(jsonb_build_object('productId', product_200,
        'quantity', 1)), 'Rollback-only test', 1::smallint);
  exception when invalid_parameter_value then blocked := true;
  end;
  if not blocked then raise exception 'Exit cap allowed more than PHP 1,700 of listed products'; end if;
end;
$$;

rollback;
