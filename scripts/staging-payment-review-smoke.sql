begin;

do $$
declare
  owner_id uuid := extensions.gen_random_uuid();
  admin_id uuid := extensions.gen_random_uuid();
  member_id uuid := extensions.gen_random_uuid();
  method_id uuid := extensions.gen_random_uuid();
  own_topup uuid;
  admin_topup uuid;
  reused_topup uuid;
  token_request uuid;
  owner_token_request uuid;
  product_id uuid;
  address_id uuid := extensions.gen_random_uuid();
  owner_order_id uuid;
  duplicate_order_id uuid;
  admin_token_request uuid;
  owner_budget_request uuid;
  admin_investment_request uuid;
  owner_investment_request uuid;
  duplicate_rejected boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (owner_id, 'review-owner-' || owner_id || '@example.invalid',
      jsonb_build_object('full_name', 'Review Test Owner', 'username', 'review_owner_' || left(replace(owner_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || owner_id)),
    (admin_id, 'review-admin-' || admin_id || '@example.invalid',
      jsonb_build_object('full_name', 'Review Test Admin', 'username', 'review_admin_' || left(replace(admin_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || admin_id)),
    (member_id, 'review-member-' || member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Review Test Member', 'username', 'review_member_' || left(replace(member_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || member_id));
  update public.user_roles set role = 'admin' where user_id in (owner_id, admin_id);
  insert into public.organization_owners(user_id) values (owner_id);
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values (method_id, 'Review Test Bank', 'Review Test Owner', 'REVIEW-TEST-001');

  insert into public.member_fund_topups
    (member_id, payment_method_id, payment_method_snapshot, amount, reference_number)
  values (admin_id, method_id, '{}'::jsonb, 500, 'REVIEW-SELF-ADMIN')
  returning id into admin_topup;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  duplicate_rejected := false;
  begin
    perform public.admin_review_member_fund_topup(admin_topup, true, 'Test');
  exception when insufficient_privilege then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Regular admin self-approval was allowed'; end if;
  admin_token_request := (public.request_budget_token_purchase(1, method_id,
    'REVIEW-ADMIN-BUDGET') ->> 'id')::uuid;
  duplicate_rejected := false;
  begin
    perform public.admin_review_budget_token_purchase(admin_token_request, true, 'Test');
  exception when insufficient_privilege then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Regular admin approved own Budget token purchase'; end if;

  insert into public.member_fund_topups
    (member_id, payment_method_id, payment_method_snapshot, amount, reference_number)
  values (owner_id, method_id, '{}'::jsonb, 500, 'REVIEW-SELF-OWNER')
  returning id into own_topup;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_member_fund_topup(own_topup, true, 'Test');
  owner_budget_request := (public.request_budget_token_purchase(4, method_id,
    'REVIEW-OWNER-BUDGET') ->> 'id')::uuid;
  perform public.admin_review_budget_token_purchase(owner_budget_request, true, 'Test');

  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id)
  values
    (admin_id, 'investment', 500, 'review_test', extensions.gen_random_uuid()),
    (owner_id, 'investment', 500, 'review_test', extensions.gen_random_uuid());
  insert into public.budget_investment_requests(member_id, rank_number, amount, months)
  values (admin_id, 1, 500, 2) returning id into admin_investment_request;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  duplicate_rejected := false;
  begin
    perform public.admin_review_budget_investment(admin_investment_request, true, 'Test');
  exception when insufficient_privilege then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Regular admin approved own Budget investment'; end if;
  insert into public.budget_investment_requests(member_id, rank_number, amount, months)
  values (owner_id, 1, 500, 2) returning id into owner_investment_request;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_budget_investment(owner_investment_request, true, 'Test');
  if not exists (select 1 from public.budget_investment_contracts contract
    where contract.request_id = owner_investment_request and contract.member_id = owner_id) then
    raise exception 'Owner self-reviewed Budget investment did not create a contract';
  end if;

  insert into public.member_fund_topups
    (member_id, payment_method_id, payment_method_snapshot, amount, reference_number)
  values (member_id, method_id, '{}'::jsonb, 500, 'REVIEW-CROSS-ONE')
  returning id into reused_topup;
  perform public.admin_review_member_fund_topup(reused_topup, true, 'Test');
  insert into public.patronizing_token_requests
    (member_id, wallet_address, reference_number)
  values (member_id, 'F3-' || member_id, 'REVIEW-CROSS-ONE')
  returning id into token_request;
  duplicate_rejected := false;
  begin
    update public.patronizing_token_requests set status = 'approved' where id = token_request;
  exception when invalid_parameter_value then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Top-up reference was reused for Patronizing'; end if;

  update public.patronizing_token_requests
  set reference_number = 'REVIEW-CROSS-TWO', status = 'approved'
  where id = token_request;
  insert into public.member_fund_topups
    (member_id, payment_method_id, payment_method_snapshot, amount, reference_number)
  values (member_id, method_id, '{}'::jsonb, 500, 'REVIEW-CROSS-TWO')
  returning id into reused_topup;
  duplicate_rejected := false;
  begin
    perform public.admin_review_member_fund_topup(reused_topup, true, 'Test');
  exception when invalid_parameter_value then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Patronizing reference was reused for a top-up'; end if;

  insert into public.patronizing_token_requests
    (member_id, wallet_address, reference_number)
  values (admin_id, 'F3-' || admin_id, 'REVIEW-ADMIN-PATRON')
  returning id into token_request;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  duplicate_rejected := false;
  begin
    perform public.admin_approve_patronizing_token_request(token_request, 'Test');
  exception when insufficient_privilege then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Regular admin approved own Patronizing entry'; end if;

  insert into public.patronizing_token_requests
    (member_id, wallet_address, reference_number)
  values (owner_id, 'F3-' || owner_id, 'REVIEW-OWNER-PATRON')
  returning id into owner_token_request;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_patronizing_token_request(owner_token_request, 'Test');
  if not exists (select 1 from public.patronizing_entries entry
    where entry.member_id = owner_id) then
    raise exception 'Owner Patronizing entry was not activated';
  end if;

  product_id := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Review Test Product', '', 400, '', true, 10,
    'pc') ->> 'id')::uuid;
  insert into public.shipping_addresses
    (id, member_id, full_name, phone, region, province, city, barangay,
     street_address, postal_code)
  values (address_id, owner_id, 'Review Test Owner', '09000000000',
    'Test Region', 'Test Province', 'Test City', 'Test Barangay',
    '123 Test Street', '1000');
  owner_order_id := (public.request_budget_plan_product_order(address_id,
    jsonb_build_array(jsonb_build_object('productId', product_id, 'quantity', 1)),
    '') ->> 'id')::uuid;
  perform public.admin_approve_commerce_order_fee(owner_order_id, 50, 'Test');
  perform public.submit_commerce_order_payment(owner_order_id, method_id,
    'REVIEW-OWNER-ORDER', 'Test');
  perform public.admin_approve_commerce_order_payment(owner_order_id, 'Test');
  if not exists (select 1 from public.commerce_orders
    where id = owner_order_id and status = 'payment_approved') then
    raise exception 'Owner commerce order was not approved';
  end if;
  duplicate_order_id := (public.request_budget_plan_product_order(address_id,
    jsonb_build_array(jsonb_build_object('productId', product_id, 'quantity', 1)),
    '') ->> 'id')::uuid;
  perform public.admin_approve_commerce_order_fee(duplicate_order_id, 50, 'Test');
  perform public.submit_commerce_order_payment(duplicate_order_id, method_id,
    'REVIEW-CROSS-ONE', 'Test');
  duplicate_rejected := false;
  begin
    perform public.admin_approve_commerce_order_payment(duplicate_order_id, 'Test');
  exception when invalid_parameter_value then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then raise exception 'Top-up reference was reused for a commerce order'; end if;
end;
$$;

rollback;
