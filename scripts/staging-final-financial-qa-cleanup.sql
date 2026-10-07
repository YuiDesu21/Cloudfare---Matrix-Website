-- Remove only the disposable signed-in Patronizing discount and Budget investment QA run.
begin;

do $$
declare
  qa_id constant uuid := 'a48beb8e-9014-4d61-9b29-a3b69617151a';
  child_ids constant uuid[] := array[
    '2e998a9a-29b9-4a73-9d6c-ed527ec672d8'::uuid,
    '396a99f2-d728-4e3d-8b7f-84db46d6272f'::uuid,
    '556956d6-4d33-48ce-ac1c-9a3f8d95bdd8'::uuid
  ];
  all_ids uuid[];
  dependency record;
  dependency_count bigint;
  i integer;
begin
  all_ids := array_append(child_ids, qa_id);
  if (select email from auth.users where id = qa_id) is distinct from 'qa-release-final2-20261007@example.invalid'
    or (select email from public.profiles where id = qa_id) is distinct from 'qa-release-final2-20261007@example.invalid'
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE FINAL QA'
    or (select count(*) from auth.identities where user_id = qa_id and provider = 'email') <> 1
    or (select count(*) from public.user_roles where user_id = any(all_ids) and role = 'member') <> 4
    or (select count(*) from public.user_roles where user_id = any(all_ids)) <> 4
    or (select count(*) from public.matrix_positions where member_id = any(all_ids)) <> 5
    or (select count(*) from public.matrix_positions where parent_member_id = qa_id and plan_id = 'budget-plan') <> 3
    or (select count(*) from public.budget_plan_rank_progress where member_id = any(all_ids)) <> 5
    or (select count(*) from public.budget_plan_token_requests where member_id = qa_id
      and id = 'd28697fc-1552-4b61-a128-cad09e283912' and quantity = 11
      and reference_number = 'QA-NO-PAYMENT-20261007-INVEST-TOKEN' and status = 'approved') <> 1
    or (select count(*) from public.budget_plan_token_requests where member_id = qa_id) <> 1
    or (select count(*) from public.budget_plan_token_credits where member_id = qa_id and qualification_credit = 528) <> 1
    or (select count(*) from public.budget_plan_token_credits where member_id = qa_id) <> 1
    or (select count(*) from public.patronizing_entries where member_id = qa_id) <> 1
    or (select count(*) from public.patronizing_monthly_income where member_id = qa_id) <> 24
    or (select count(*) from public.patronizing_exit_progress where member_id = qa_id and exit_number = 1 and status = 'active') <> 1
    or (select count(*) from public.patronizing_exit_progress where member_id = qa_id) <> 1
    or (select count(*) from public.commerce_products where id = '90b66af9-0d5f-4190-b490-9f69822f3b66'
      and product_name = 'RELEASE QA DISCOUNT PRODUCT - DO NOT SHIP' and price = 400) <> 1
    or (select count(*) from public.payment_methods where id = '36d4df27-f92c-4ba6-9b2c-dbd0821a3a49'
      and method_name = 'RELEASE QA ONLY - NO PAYMENT') <> 1
    or (select count(*) from public.shipping_addresses where id = 'eb4ed85e-8c09-4886-8109-95e81f5ce088'
      and member_id = qa_id and full_name = 'RELEASE QA ONLY') <> 1
    or (select count(*) from public.shipping_addresses where member_id = qa_id) <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id
      and id = '0d63dee5-ee31-4e29-9114-05bb1e0c7075'
      and order_code = 'ORD-A703DC6625' and status = 'payment_approved'
      and package_total = 400 and discount_amount = 60 and amount_due = 340) <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id) <> 1
    or (select count(*) from public.commerce_order_payments where member_id = qa_id
      and order_id = '0d63dee5-ee31-4e29-9114-05bb1e0c7075'
      and reference_number = 'QA-NO-PAYMENT-20261007-DISCOUNT' and status = 'approved') <> 1
    or (select count(*) from public.commerce_order_payments where member_id = qa_id) <> 1
    or (select count(*) from public.member_fund_topups where member_id = qa_id
      and id = '733981d8-dc06-4282-8838-bf61bef83082'
      and reference_number = 'QA-NO-PAYMENT-20261007-INVEST-TOPUP'
      and status = 'approved' and amount = 500) <> 1
    or (select count(*) from public.member_fund_topups where member_id = qa_id) <> 1
    or (select count(*) from public.member_fund_ledger where member_id = qa_id) <> 7
    or (select coalesce(sum(amount), 0) from public.member_fund_ledger where member_id = qa_id and account = 'main') <> 800
    or (select coalesce(sum(amount), 0) from public.member_fund_ledger where member_id = qa_id and account = 'investment') <> 0
    or (select count(*) from public.budget_investment_requests where member_id = qa_id
      and id = 'da002892-59b4-4c73-bb0a-38cd335489ae'
      and status = 'approved' and rank_number = 1 and amount = 500 and months = 2) <> 1
    or (select count(*) from public.budget_investment_requests where member_id = qa_id) <> 1
    or (select count(*) from public.budget_investment_contracts where member_id = qa_id
      and id = 'd1ec81d1-fdd2-417c-ba58-6e6e35bbb823'
      and request_id = 'da002892-59b4-4c73-bb0a-38cd335489ae'
      and principal = 500 and months = 2 and unlocks_at < now()) <> 1
    or (select count(*) from public.budget_investment_contracts where member_id = qa_id) <> 1
    or (select count(*) from public.budget_investment_income where contract_id = 'd1ec81d1-fdd2-417c-ba58-6e6e35bbb823' and amount = 150) <> 2
    or (select count(*) from public.reward_ledger where member_id = any(all_ids)) <> 0
    or (select count(*) from public.budget_plan_passive_income where member_id = any(all_ids)) <> 0
    or (select count(*) from public.budget_plan_purchase_credits where member_id = any(all_ids)) <> 0
    or (select count(*) from public.voucher_ledger where member_id = any(all_ids)) <> 0
    or (select count(*) from public.activity_logs where id in (337,338,339,340,341,344)) <> 6
    or (select count(*) from public.activity_logs where id in (337,338,339,340,341,344)
      and (actor_id = qa_id or metadata ->> 'memberId' = qa_id::text
        or metadata ->> 'orderId' = '0d63dee5-ee31-4e29-9114-05bb1e0c7075')) <> 6
    or exists (select 1 from public.profiles where sponsor_id = any(all_ids))
  then
    raise exception 'Final financial QA records changed; cleanup cancelled.';
  end if;

  for i in 1..3 loop
    if (select email from auth.users where id = child_ids[i]) is distinct from
        'qa-invest-child-' || i || '-20261007@example.invalid'
      or (select full_name from public.profiles where id = child_ids[i]) is distinct from
        'RELEASE FINAL QA CHILD ' || substring('ABC' from i for 1)
      or (select count(*) from public.matrix_positions where member_id = child_ids[i]
          and parent_member_id = qa_id and plan_id = 'budget-plan') <> 1
    then
      raise exception 'QA child % changed; cleanup cancelled.', i;
    end if;
  end loop;

  for dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in (
        'public.matrix_positions'::regclass, 'public.budget_plan_rank_progress'::regclass,
        'public.budget_plan_token_requests'::regclass, 'public.budget_plan_token_credits'::regclass,
        'public.budget_investment_requests'::regclass, 'public.budget_investment_contracts'::regclass,
        'public.patronizing_entries'::regclass, 'public.patronizing_monthly_income'::regclass,
        'public.patronizing_exit_progress'::regclass, 'public.commerce_orders'::regclass,
        'public.commerce_order_payments'::regclass, 'public.member_fund_topups'::regclass,
        'public.member_fund_ledger'::regclass, 'public.shipping_addresses'::regclass,
        'public.user_roles'::regclass, 'public.profiles'::regclass
      )
  loop
    execute format('select count(*) from %s where %I = any($1)', dependency.table_name, dependency.column_name)
      into dependency_count using all_ids;
    if dependency_count <> 0 then
      raise exception 'QA accounts have % unexpected rows in %.%', dependency_count, dependency.table_name, dependency.column_name;
    end if;
  end loop;

  delete from public.activity_logs where id in (337,338,339,340,341,344);
  delete from public.commerce_order_payments where member_id = qa_id;
  delete from public.commerce_orders where member_id = qa_id;
  delete from public.commerce_products where id = '90b66af9-0d5f-4190-b490-9f69822f3b66';
  delete from public.patronizing_monthly_income where member_id = qa_id;
  delete from public.patronizing_exit_progress where member_id = qa_id;
  delete from public.patronizing_entries where member_id = qa_id;
  delete from public.member_fund_ledger where member_id = qa_id;
  delete from public.budget_investment_income where contract_id = 'd1ec81d1-fdd2-417c-ba58-6e6e35bbb823';
  delete from public.budget_investment_contracts where member_id = qa_id;
  delete from public.budget_investment_requests where member_id = qa_id;
  delete from public.member_fund_topups where member_id = qa_id;
  delete from public.budget_plan_token_credits where member_id = qa_id;
  delete from public.budget_plan_rank_progress where member_id = any(all_ids);
  delete from public.budget_plan_token_requests where member_id = qa_id;
  delete from public.matrix_positions where member_id = any(child_ids);
  delete from public.matrix_positions where member_id = qa_id;
  delete from public.shipping_addresses where member_id = qa_id;
  delete from public.payment_methods where id = '36d4df27-f92c-4ba6-9b2c-dbd0821a3a49';
  delete from public.user_roles where user_id = any(all_ids);
  delete from auth.identities where user_id = qa_id;
  delete from public.profiles where id = any(all_ids);
  delete from auth.users where id = any(all_ids);
end;
$$;

commit;
