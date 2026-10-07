-- Remove only the two disposable October 7 signed-in placement/funds QA accounts.
begin;

do $$
declare
  root_id constant uuid := 'e2da258a-25f0-494f-9e65-d5a0ff68a29e';
  qa_id constant uuid := 'f3989814-aa2b-4413-8669-b5374aeee209';
  premium_id constant uuid := '0373ea76-a207-460e-a79c-7278972a83ae';
  standard_id constant uuid := '14ae81ca-19ee-4f90-b589-4e0fad97cdf9';
  payment_id constant uuid := '9107a9c4-20bc-4106-b9c7-40b3376ab867';
  address_id constant uuid := 'c7ae3910-c343-4fc6-a842-3f16bef28d98';
  dependency record;
  dependency_count bigint;
begin
  if (select email from auth.users where id = root_id) is distinct from 'qa-release-root-20261007@example.invalid'
    or (select email from public.profiles where id = root_id) is distinct from 'qa-release-root-20261007@example.invalid'
    or (select full_name from public.profiles where id = root_id) is distinct from 'RELEASE QA ROOT'
    or (select email from auth.users where id = qa_id) is distinct from 'qa-release-member-20261007@example.invalid'
    or (select email from public.profiles where id = qa_id) is distinct from 'qa-release-member-20261007@example.invalid'
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE QA MEMBER'
    or (select count(*) from public.matrix_positions where member_id = root_id and plan_id = 'power3-passive' and parent_member_id is null) <> 1
    or (select count(*) from public.matrix_positions where member_id = qa_id and plan_id = 'power3-passive' and parent_member_id = root_id) <> 1
    or (select count(*) from public.matrix_positions where member_id = qa_id and plan_id = 'timeline-power3' and parent_member_id is null) <> 1
    or (select count(*) from public.matrix_positions where member_id in (root_id, qa_id)) <> 3
    or (select count(*) from public.matrix_positions where parent_member_id in (root_id, qa_id)) <> 1
    or (select count(*) from public.commerce_packages where id = premium_id and package_name = 'RELEASE QA PREMIUM - DO NOT ORDER') <> 1
    or (select count(*) from public.commerce_packages where id = standard_id and package_name = 'RELEASE QA STANDARD - DO NOT ORDER') <> 1
    or (select count(*) from public.commerce_package_items where package_id in (premium_id, standard_id)) <> 2
    or (select count(*) from public.payment_methods where id = payment_id and method_name = 'RELEASE QA ONLY - NO PAYMENT') <> 1
    or (select count(*) from public.shipping_addresses where id = address_id and member_id = qa_id and full_name = 'RELEASE QA ONLY') <> 1
    or (select count(*) from public.shipping_addresses where member_id = qa_id) <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id) <> 2
    or (select count(*) from public.commerce_orders where member_id = qa_id and id = 'b627acca-d730-46dd-ab10-bb84a7632c1a' and order_code = 'ORD-25F4E67A52' and package_id = standard_id and status = 'payment_approved' and package_total = 693) <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id and id = '3b025b02-529f-4090-81d3-768c1a3fd19f' and order_code = 'ORD-5B77E4514E' and package_id = premium_id and status = 'payment_approved' and package_total = 1200) <> 1
    or (select count(*) from public.commerce_order_payments where member_id = qa_id and status = 'approved' and payment_method_id = payment_id and reference_number in ('QA-NO-PAYMENT-20261007-STANDARD', 'QA-NO-PAYMENT-20261007-PREMIUM')) <> 2
    or (select count(*) from public.commerce_order_payments where member_id = qa_id) <> 2
    or (select count(*) from public.member_fund_topups where member_id = qa_id and payment_method_id = payment_id and reference_number = 'QA-NO-PAYMENT-20261007-TOPUP2' and status = 'approved' and amount = 500) <> 1
    or (select count(*) from public.member_fund_topups where member_id = qa_id) <> 1
    or (select count(*) from public.member_fund_ledger where member_id = qa_id and account = 'main' and source_type = 'verified_topup' and amount = 500) <> 1
    or (select count(*) from public.member_fund_ledger where member_id = qa_id and account = 'main' and source_type = 'main_withdrawal' and amount = -500) <> 1
    or (select count(*) from public.member_fund_ledger where member_id = qa_id) <> 2
    or (select count(*) from public.withdrawal_requests where member_id = qa_id and id = 'd744792a-8a83-4375-bd8a-583c1d2eed02' and withdrawal_code = 'WD-4671A613A9' and status = 'approved' and amount = 500 and fund_source = 'main') <> 1
    or (select count(*) from public.withdrawal_requests where member_id = qa_id) <> 1
    or (select count(*) from public.reward_ledger where member_id = qa_id and plan_id = 'power3-passive' and source_type = 'entry' and amount = 231 and transferred_amount = 0) <> 3
    or (select count(*) from public.reward_ledger where member_id in (root_id, qa_id)) <> 3
    or (select count(*) from public.user_roles where user_id in (root_id, qa_id) and role = 'member') <> 2
    or (select count(*) from public.user_roles where user_id in (root_id, qa_id)) <> 2
    or (select count(*) from public.activity_logs where id between 322 and 332) <> 11
    or (select count(*) from public.activity_logs where id between 322 and 332 and
      (actor_id in (root_id, qa_id) or metadata ->> 'memberId' = qa_id::text or metadata ->> 'orderId' in ('b627acca-d730-46dd-ab10-bb84a7632c1a', '3b025b02-529f-4090-81d3-768c1a3fd19f'))) <> 11
    or exists (select 1 from public.profiles where sponsor_id in (root_id, qa_id))
  then
    raise exception 'Staging release QA records changed; cleanup cancelled.';
  end if;

  for dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in (
        'public.matrix_positions'::regclass, 'public.commerce_orders'::regclass,
        'public.commerce_order_payments'::regclass, 'public.member_fund_topups'::regclass,
        'public.member_fund_ledger'::regclass, 'public.withdrawal_requests'::regclass,
        'public.reward_ledger'::regclass, 'public.shipping_addresses'::regclass,
        'public.user_roles'::regclass, 'public.profiles'::regclass
      )
  loop
    execute format('select count(*) from %s where %I in ($1, $2)', dependency.table_name, dependency.column_name)
      into dependency_count using root_id, qa_id;
    if dependency_count <> 0 then
      raise exception 'QA accounts have % unexpected rows in %.%', dependency_count, dependency.table_name, dependency.column_name;
    end if;
  end loop;

  delete from public.activity_logs where id between 322 and 332;
  delete from public.commerce_order_payments where member_id = qa_id;
  delete from public.reward_ledger where member_id = qa_id;
  delete from public.member_fund_ledger where member_id = qa_id;
  delete from public.withdrawal_requests where member_id = qa_id;
  delete from public.member_fund_topups where member_id = qa_id;
  delete from public.commerce_orders where member_id = qa_id;
  delete from public.shipping_addresses where id = address_id;
  delete from public.commerce_package_items where package_id in (premium_id, standard_id);
  delete from public.commerce_packages where id in (premium_id, standard_id);
  delete from public.payment_methods where id = payment_id;
  delete from public.matrix_positions where member_id = qa_id;
  delete from public.matrix_positions where member_id = root_id;
  delete from public.user_roles where user_id in (root_id, qa_id);
  delete from public.profiles where id in (root_id, qa_id);
  delete from auth.users where id in (root_id, qa_id);
end;
$$;

commit;
