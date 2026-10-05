begin;

do $$
#variable_conflict use_variable
declare
  member_id uuid := extensions.gen_random_uuid();
  owner_id uuid := extensions.gen_random_uuid();
  child_id uuid;
  payment_method_id uuid := extensions.gen_random_uuid();
  address_id uuid := extensions.gen_random_uuid();
  pc_product_id uuid;
  grocery_product_id uuid;
  budget_order_id uuid;
  token_request_id uuid;
  topup_id uuid;
  withdrawal_id uuid;
  investment_request_id uuid;
  transfer_result jsonb;
  available_main numeric;
  available_investment numeric;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (owner_id, 'staging-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
    jsonb_build_object(
      'full_name', 'Staging Test Owner',
      'username', 'own_' || left(replace(owner_id::text, '-', ''), 12),
      'phone', '09000000000',
      'wallet_address', 'F3-STAGING-' || owner_id::text));
  insert into auth.users (id, email, raw_user_meta_data)
  values (member_id, 'staging-smoke-' || replace(member_id::text, '-', '') || '@example.invalid',
    jsonb_build_object(
      'full_name', 'Staging Funds Test',
      'username', 'test_' || left(replace(member_id::text, '-', ''), 12),
      'phone', '09000000000',
      'wallet_address', 'F3-STAGING-' || member_id::text));

  update public.user_roles set role = 'admin' where user_id = owner_id;
  insert into public.organization_owners(user_id) values (owner_id);
  insert into public.matrix_positions(member_id, plan_id, parent_member_id)
  values (owner_id, 'budget-plan', null);
  insert into public.budget_plan_rank_progress(member_id, rank_number)
  values (owner_id, 0);
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values (payment_method_id, 'Test Bank', 'Staging Test Owner', 'TEST-ACCOUNT-001');

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  token_request_id := (public.request_budget_token_purchase(4, payment_method_id,
    'STAGING-TOKEN-ONE') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_budget_token_purchase(token_request_id, true, 'Smoke test');
  if public.budget_plan_qualification_total(member_id) <> 192 or
    not exists (select 1 from public.matrix_positions position
      where position.member_id = member_id and position.plan_id = 'budget-plan') then
    raise exception 'First token purchase did not activate Budget Plan.';
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  token_request_id := (public.request_budget_token_purchase(7, payment_method_id,
    'STAGING-TOKEN-TWO') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_budget_token_purchase(token_request_id, true, 'Smoke test');
  if public.budget_plan_qualification_total(member_id) <> 528 then
    raise exception 'Token credit did not accumulate to PHP 528.';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  pc_product_id := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Staging PC Product', '', 400, '', true, 10,
    'pc') ->> 'id')::uuid;
  grocery_product_id := (public.admin_save_commerce_product(null,
    'product_plus_requirement', 'Staging Groceries', '', 500, '', true, 20,
    'groceries') ->> 'id')::uuid;
  insert into public.shipping_addresses
    (id, member_id, full_name, phone, region, province, city, barangay,
     street_address, postal_code)
  values (address_id, member_id, 'Staging Funds Test', '09000000000', 'Test Region',
    'Test Province', 'Test City', 'Test Barangay', '123 Test Street', '1000');
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  budget_order_id := (public.request_budget_plan_product_order(address_id,
    jsonb_build_array(
      jsonb_build_object('productId', pc_product_id, 'quantity', 1),
      jsonb_build_object('productId', grocery_product_id, 'quantity', 1)),
    '') ->> 'id')::uuid;
  if not exists (select 1 from public.commerce_orders commerce_order
    where commerce_order.id = budget_order_id
      and commerce_order.order_purpose = 'budget_qualification'
      and commerce_order.voucher_amount = 0
      and commerce_order.discount_amount = 0) then
    raise exception 'Budget checkout did not preserve its separate purpose and no-discount rules.';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if public.apply_commerce_order_benefit(
    (select commerce_order from public.commerce_orders commerce_order
      where commerce_order.id = budget_order_id), now()) ->> 'type' <> 'budget_qualification' then
    raise exception 'Budget order leaked into Product Plus benefit processing.';
  end if;
  update public.commerce_orders set status = 'payment_approved'
  where id = budget_order_id;
  if public.budget_plan_qualification_total(member_id) <> 678 then
    raise exception 'Mixed PC and grocery purchases did not add PHP 150 qualification.';
  end if;

  for child_number in 1..3 loop
    child_id := extensions.gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
    values (child_id, 'staging-child-' || replace(child_id::text, '-', '') || '@example.invalid',
      jsonb_build_object(
        'full_name', 'Staging Test Child',
        'username', 'chd_' || left(replace(child_id::text, '-', ''), 12),
        'phone', '09000000000',
        'wallet_address', 'F3-STAGING-' || child_id::text));
    insert into public.matrix_positions(member_id, plan_id, parent_member_id)
    values (child_id, 'budget-plan', member_id);
    insert into public.budget_plan_rank_progress(member_id, rank_number)
    values (child_id, 0);
  end loop;
  perform public.refresh_budget_plan_rank(member_id);
  if public.budget_plan_rank_for(member_id) <> 1 then
    raise exception 'Three direct Challenger members did not unlock Overcomer.';
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  topup_id := (public.request_member_fund_topup(700, payment_method_id,
    'STAGING-TOPUP-ONE') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_member_fund_topup(topup_id, true, 'Smoke test');
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  transfer_result := public.transfer_main_to_investment(500);
  if transfer_result ->> 'amount' <> '500' then
    raise exception 'Main to Investment transfer returned the wrong amount: %', transfer_result;
  end if;

  available_main := public.member_fund_balance(member_id, 'main');
  available_investment := public.member_investment_available(member_id);
  if available_main <> 200 or available_investment <> 500 then
    raise exception 'Unexpected balances after transfer: main %, investment %',
      available_main, available_investment;
  end if;

  investment_request_id := (public.request_budget_investment(1::smallint) ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_budget_investment(investment_request_id, true, 'Smoke test');
  if (select count(*) from public.budget_investment_income income
      join public.budget_investment_contracts contract on contract.id = income.contract_id
      where contract.request_id = investment_request_id and income.amount = 150) <> 2 then
    raise exception 'Investment did not schedule two PHP 150 monthly payments.';
  end if;
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  if public.member_investment_available(member_id) <> 0 then
    raise exception 'Approved principal was not locked.';
  end if;

  update public.member_fund_ledger
  set available_at = now() - interval '1 minute'
  where source_type = 'budget_investment_income'
    and source_id = (select income.id from public.budget_investment_income income
      join public.budget_investment_contracts contract on contract.id = income.contract_id
      where contract.request_id = investment_request_id and income.month_number = 1);
  if public.member_investment_available(member_id) <> 150 then
    raise exception 'Due monthly income was not available separately from principal.';
  end if;
  perform public.transfer_investment_to_main(150);
  if public.member_investment_available(member_id) <> 0 or
    public.member_fund_balance(member_id, 'main') <> 350 then
    raise exception 'Monthly income transfer changed the locked principal or Main balance.';
  end if;
  if (public.get_my_member_funds_dashboard() ->> 'mainBalance')::numeric <> 350 or
    (public.get_my_member_funds_dashboard() ->> 'investmentLocked')::numeric <> 500 or
    (public.get_my_budget_plan_dashboard() ->> 'qualificationValue')::numeric <> 678 then
    raise exception 'Member dashboard totals do not match the approved transactions.';
  end if;

  topup_id := (public.request_member_fund_topup(500, payment_method_id,
    'STAGING-TOPUP-TWO') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_member_fund_topup(topup_id, true, 'Smoke test');
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  begin
    perform public.request_withdrawal(499, 'Staging Funds Test', '09000000000', '');
    raise exception 'Withdrawal below PHP 500 should be rejected.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%at least PHP 500%' then raise; end if;
  end;
  withdrawal_id := (public.request_withdrawal(500,
    'Staging Funds Test', '09000000000', '') ->> 'id')::uuid;
  if public.member_main_available(member_id) <> 350 then
    raise exception 'Pending withdrawal did not reserve Main Funds.';
  end if;
  begin
    perform public.transfer_main_to_investment(400);
    raise exception 'Transfer should not spend reserved withdrawal funds.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%Available Main Funds are not enough%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_approve_withdrawal(withdrawal_id);
  if public.member_fund_balance(member_id, 'main') <> 350 then
    raise exception 'Approved withdrawal did not deduct Main Funds.';
  end if;
  perform set_config('request.jwt.claim.sub', member_id::text, true);

  begin
    perform public.transfer_investment_to_main(1);
    raise exception 'Investment transfer should reject locked principal.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%Unlocked Investment Funds are not enough%' then
      raise;
    end if;
  end;
end;
$$;

rollback;
