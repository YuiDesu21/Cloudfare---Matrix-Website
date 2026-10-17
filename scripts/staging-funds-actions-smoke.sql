-- Staging only. All fixture balances and requests are rolled back.
begin;

do $$
declare
  v_member_id uuid := extensions.gen_random_uuid();
  matrix_member_id uuid := extensions.gen_random_uuid();
  deposit_id uuid := extensions.gen_random_uuid();
  request_key uuid := extensions.gen_random_uuid();
  transfer_key uuid := extensions.gen_random_uuid();
  first_result jsonb;
  repeated_result jsonb;
  transfer_result jsonb;
  request_count integer;
begin
  insert into auth.users(id, email, raw_user_meta_data)
  values
    (v_member_id, 'funds-action-smoke-' || v_member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Funds Action Smoke',
        'username', 'smoke_' || left(replace(v_member_id::text, '-', ''), 12),
        'phone', '09000000000', 'wallet_address', 'F3-' || v_member_id)),
    (matrix_member_id, 'funds-action-smoke-' || matrix_member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Matrix Action Smoke',
        'username', 'smoke_' || left(replace(matrix_member_id::text, '-', ''), 12),
        'phone', '09000000000', 'wallet_address', 'F3-' || matrix_member_id));
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values (v_member_id, 'main', 1000, 'smoke_deposit', deposit_id, 'Rollback-only test balance');

  perform set_config('request.jwt.claim.sub', v_member_id::text, true);
  first_result := public.request_main_withdrawal(500, 'Funds Action Smoke', '09123456789', '', request_key);
  repeated_result := public.request_main_withdrawal(500, 'Funds Action Smoke', '09123456789', '', request_key);
  if first_result ->> 'id' is null or first_result ->> 'id' <> repeated_result ->> 'id' then
    raise exception 'Withdrawal retry did not return the original request';
  end if;
  select count(*) into request_count from public.withdrawal_requests
    where member_id = v_member_id and idempotency_key = request_key;
  if request_count <> 1 or public.member_main_available(v_member_id) <> 500 then
    raise exception 'Withdrawal retry duplicated a reservation';
  end if;
  if (public.get_my_funds_action_status('withdrawal', request_key) ->> 'id') <> first_result ->> 'id' then
    raise exception 'Withdrawal status lookup failed';
  end if;
  begin
    perform public.request_main_withdrawal(600, 'Funds Action Smoke', '09123456789', '', request_key);
    raise exception 'A changed withdrawal reused the request key';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claim.sub', matrix_member_id::text, true);
  begin
    perform public.transfer_matrix_income_to_main_keyed('budget-plan', 1, extensions.gen_random_uuid());
    raise exception 'Matrix transfer succeeded without due earnings';
  exception when sqlstate '22023' then null;
  end;
  insert into public.budget_plan_passive_income
    (member_id, rank_number, month_number, amount, due_at)
  values (matrix_member_id, 2, 1, 100, now() - interval '1 day');
  transfer_result := public.transfer_matrix_income_to_main_keyed('budget-plan', 60, transfer_key);
  repeated_result := public.transfer_matrix_income_to_main_keyed('budget-plan', 60, transfer_key);
  if transfer_result ->> 'id' is null or transfer_result ->> 'id' <> repeated_result ->> 'id'
    or public.member_main_available(matrix_member_id) <> 60
    or (select transferred_amount from public.budget_plan_passive_income
      where member_id = matrix_member_id and rank_number = 2 and month_number = 1) <> 60
    or (select count(*) from public.member_fund_ledger
      where member_id = matrix_member_id and source_type = 'matrix_income_transfer'
        and source_id = (transfer_result ->> 'id')::uuid) <> 1 then
    raise exception 'Matrix transfer was not atomic or retry-safe';
  end if;
  if (public.get_my_funds_action_status('matrix', transfer_key) ->> 'id') <> transfer_result ->> 'id' then
    raise exception 'Matrix transfer status lookup failed';
  end if;
  insert into public.reward_ledger
    (member_id, plan_id, source_type, source_label, amount, due_at)
  values
    (matrix_member_id, 'timeline-power3', 'timeline_matrix', 'Standard smoke reward', 1250, now() - interval '1 day'),
    (matrix_member_id, 'power3-passive', 'matrix', 'Premium smoke reward', 2000, now() - interval '1 day'),
    (matrix_member_id, 'timeline-power3', 'timeline_matrix', 'Future smoke reward', 99, now() + interval '1 day');
  perform public.transfer_matrix_income_to_main_keyed('timeline-power3', 250, extensions.gen_random_uuid());
  perform public.transfer_matrix_income_to_main_keyed('power3-passive', 1000, extensions.gen_random_uuid());
  if public.member_main_available(matrix_member_id) <> 1310
    or (select sum(amount - withdrawn_amount) from public.reward_ledger
      where member_id = matrix_member_id and plan_id = 'timeline-power3' and due_at <= now()) <> 1000
    or (select sum(amount - withdrawn_amount) from public.reward_ledger
      where member_id = matrix_member_id and plan_id = 'power3-passive' and due_at <= now()) <> 1000
    or (select count(*) from public.member_fund_ledger
      where member_id = matrix_member_id and source_type = 'matrix_income_transfer') <> 3 then
    raise exception 'Plan-specific Matrix balances or ledger records are incorrect';
  end if;
  if (public.get_my_member_funds_dashboard() -> 'matrixBalances' ->> 'timeline-power3')::numeric <> 1000
    or (public.get_my_member_funds_dashboard() -> 'matrixBalances' ->> 'power3-passive')::numeric <> 1000
    or (public.get_my_member_funds_dashboard() -> 'matrixBalances' ->> 'budget-plan')::numeric <> 40 then
    raise exception 'Dashboard Matrix balances do not match plan ledgers';
  end if;
  begin
    perform public.transfer_matrix_income_to_main_keyed('budget-plan', 50, extensions.gen_random_uuid());
    raise exception 'Matrix transfer exceeded due earnings';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

rollback;
