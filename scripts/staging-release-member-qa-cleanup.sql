-- Remove only the disposable member and fictional funds from the October 7 staging rehearsal.
begin;

do $$
declare
  qa_id constant uuid := '0475d9d1-8ffd-4dae-a93c-1418c6679811';
  qa_email constant text := 'release.qa.885475583534@example.invalid';
  dependency record;
  dependency_count bigint;
begin
  if (select email from auth.users where id = qa_id) is distinct from qa_email
    or (select email from public.profiles where id = qa_id) is distinct from qa_email
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE QA Member'
    or (select count(*) from public.member_fund_topups where member_id = qa_id
        and reference_number = 'QA-NO-PAYMENT-20261007-FUNDS'
        and status = 'approved' and amount = 1000) <> 1
    or (select count(*) from public.member_fund_topups where member_id = qa_id) <> 1
    or (select count(*) from public.withdrawal_requests where member_id = qa_id
        and withdrawal_code = 'WD-B6E77C0AF5'
        and status = 'rejected' and amount = 500) <> 1
    or (select count(*) from public.withdrawal_requests where member_id = qa_id) <> 1
    or (select count(*) from public.member_fund_ledger where member_id = qa_id) <> 5
    or (select coalesce(sum(amount), 0) from public.member_fund_ledger
        where member_id = qa_id and account = 'main') <> 500
    or (select coalesce(sum(amount), 0) from public.member_fund_ledger
        where member_id = qa_id and account = 'investment') <> 500
  then
    raise exception 'QA member or fictional fund records changed; cleanup cancelled.';
  end if;

  -- A new relation means this fixture is no longer disposable without inspection.
  for dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in (
        'public.member_fund_ledger'::regclass,
        'public.member_fund_topups'::regclass,
        'public.withdrawal_requests'::regclass,
        'public.user_roles'::regclass
      )
  loop
    execute format('select count(*) from %s where %I = $1', dependency.table_name, dependency.column_name)
      into dependency_count using qa_id;
    if dependency_count <> 0 then
      raise exception 'QA member has % related rows in %.%',
        dependency_count, dependency.table_name, dependency.column_name;
    end if;
  end loop;

  delete from public.member_fund_ledger where member_id = qa_id;
  delete from public.member_fund_topups where member_id = qa_id;
  delete from public.withdrawal_requests where member_id = qa_id;
  delete from public.profiles where id = qa_id;
  delete from auth.users where id = qa_id;
end;
$$;

commit;
