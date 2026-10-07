-- Remove the disposable confirmed Auth user that could not sign in for final UI QA.
begin;

do $$
declare
  qa_id constant uuid := '4cbe2e1a-a8f2-44b2-b9ed-3ee37dd2be40';
  dependency record;
  dependency_count bigint;
begin
  if (select email from auth.users where id = qa_id) is distinct from 'qa-release-final-20261007@example.invalid'
    or (select email from public.profiles where id = qa_id) is distinct from 'qa-release-final-20261007@example.invalid'
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE FINAL QA'
    or (select count(*) from auth.identities where user_id = qa_id and provider = 'email') <> 1
    or (select count(*) from public.user_roles where user_id = qa_id and role = 'member') <> 1
    or exists (select 1 from public.activity_logs where actor_id = qa_id or metadata ->> 'memberId' = qa_id::text)
    or exists (select 1 from public.profiles where sponsor_id = qa_id)
  then
    raise exception 'Final QA account changed; cleanup cancelled.';
  end if;

  for dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in ('public.user_roles'::regclass, 'public.profiles'::regclass)
  loop
    execute format('select count(*) from %s where %I = $1', dependency.table_name, dependency.column_name)
      into dependency_count using qa_id;
    if dependency_count <> 0 then
      raise exception 'QA account has % unexpected rows in %.%', dependency_count, dependency.table_name, dependency.column_name;
    end if;
  end loop;

  delete from auth.identities where user_id = qa_id;
  delete from public.user_roles where user_id = qa_id;
  delete from public.profiles where id = qa_id;
  delete from auth.users where id = qa_id;
end;
$$;

commit;
