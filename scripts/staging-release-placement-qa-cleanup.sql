-- Remove only the disposable October 7 placement and purchase rehearsal from staging.
begin;

do $$
declare
  qa_id constant uuid := '170eac1e-488c-4f17-8f74-60f4571d19c7';
  qa_email constant text := 'release-placement-9a082de33a@example.invalid';
  qa_order_id constant uuid := '2a196064-95fd-4c18-8319-c0fd52ebac1c';
  dependency record;
  dependency_count bigint;
begin
  if (select email from auth.users where id = qa_id) is distinct from qa_email
    or (select email from public.profiles where id = qa_id) is distinct from qa_email
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE PLACEMENT QA'
    or (select count(*) from public.matrix_positions where member_id = qa_id) <> 2
    or (select count(*) from public.matrix_positions where parent_member_id = qa_id) <> 0
    or (select count(*) from public.profiles where sponsor_id = qa_id) <> 0
    or (select count(*) from public.budget_plan_token_requests where member_id = qa_id
        and reference_number = 'QA-NO-PAYMENT-20261007-BUDGET' and status = 'approved') <> 1
    or (select count(*) from public.budget_plan_token_requests where member_id = qa_id) <> 1
    or (select count(*) from public.budget_plan_token_credits where member_id = qa_id
        and qualification_credit = 192) <> 1
    or (select count(*) from public.budget_plan_rank_progress where member_id = qa_id) <> 1
    or (select count(*) from public.patronizing_token_requests where member_id = qa_id
        and reference_number = 'QA-NO-PAYMENT-20261007-PATRON12' and status = 'approved') <> 1
    or (select count(*) from public.patronizing_token_requests where member_id = qa_id) <> 1
    or (select count(*) from public.patronizing_entries where member_id = qa_id) <> 1
    or (select count(*) from public.patronizing_monthly_income where member_id = qa_id) <> 24
    or (select count(*) from public.patronizing_monthly_income where member_id = qa_id
        and status = 'unlocked') <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id
        and id = qa_order_id and order_code = 'ORD-CA78DF6A0F'
        and status = 'payment_approved' and package_total = 800) <> 1
    or (select count(*) from public.commerce_orders where member_id = qa_id) <> 1
    or (select count(*) from public.commerce_order_payments where member_id = qa_id
        and order_id = qa_order_id
        and reference_number = 'QA-NO-PAYMENT-20261007-MONTHLY'
        and status = 'approved') <> 1
    or (select count(*) from public.commerce_order_payments where member_id = qa_id) <> 1
    or (select count(*) from public.shipping_addresses where member_id = qa_id
        and full_name = 'RELEASE QA ONLY') <> 1
    or (select count(*) from public.shipping_addresses where member_id = qa_id) <> 1
    or (select count(*) from public.user_roles where user_id = qa_id and role = 'member') <> 1
    or (select count(*) from public.budget_plan_purchase_credits where member_id = qa_id) <> 0
    or (select count(*) from public.member_fund_ledger where member_id = qa_id) <> 0
    or (select count(*) from public.reward_ledger where member_id = qa_id
        and id = '8627060c-8b3c-4723-8faf-cbf426b2274d'
        and plan_id = 'patronizing-income' and source_type = 'patronizing_income'
        and status = 'due' and amount = 100 and transferred_amount = 0) <> 1
    or (select count(*) from public.activity_logs where id between 250 and 256) <> 7
    or (select count(*) from public.activity_logs where id between 250 and 256
        and (actor_id = qa_id
          or metadata ->> 'memberId' = qa_id::text
          or metadata ->> 'orderCode' = 'ORD-CA78DF6A0F')) <> 7
  then
    raise exception 'Staging placement QA records changed; cleanup cancelled.';
  end if;

  for dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in (
        'public.matrix_positions'::regclass,
        'public.budget_plan_token_requests'::regclass,
        'public.budget_plan_token_credits'::regclass,
        'public.budget_plan_rank_progress'::regclass,
        'public.patronizing_token_requests'::regclass,
        'public.patronizing_entries'::regclass,
        'public.patronizing_monthly_income'::regclass,
        'public.commerce_orders'::regclass,
        'public.commerce_order_payments'::regclass,
        'public.shipping_addresses'::regclass,
        'public.user_roles'::regclass,
        'public.reward_ledger'::regclass
      )
  loop
    execute format('select count(*) from %s where %I = $1', dependency.table_name, dependency.column_name)
      into dependency_count using qa_id;
    if dependency_count <> 0 then
      raise exception 'QA member has % unexpected rows in %.%',
        dependency_count, dependency.table_name, dependency.column_name;
    end if;
  end loop;

  delete from public.activity_logs where id between 250 and 256;
  delete from public.commerce_order_payments where member_id = qa_id;
  delete from public.commerce_orders where member_id = qa_id;
  delete from public.shipping_addresses where member_id = qa_id;
  delete from public.patronizing_monthly_income where member_id = qa_id;
  delete from public.reward_ledger where member_id = qa_id;
  delete from public.patronizing_entries where member_id = qa_id;
  delete from public.patronizing_token_requests where member_id = qa_id;
  delete from public.budget_plan_token_credits where member_id = qa_id;
  delete from public.budget_plan_rank_progress where member_id = qa_id;
  delete from public.budget_plan_token_requests where member_id = qa_id;
  delete from public.matrix_positions where member_id = qa_id;
  delete from public.user_roles where user_id = qa_id;
  delete from public.profiles where id = qa_id;
  delete from auth.users where id = qa_id;
end;
$$;

commit;
