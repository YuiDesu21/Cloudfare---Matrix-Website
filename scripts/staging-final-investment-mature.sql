-- Time-shift only the disposable QA contract to rehearse maturity on screen.
begin;

do $$
declare
  qa_id constant uuid := 'a48beb8e-9014-4d61-9b29-a3b69617151a';
  qa_contract_id constant uuid := 'd1ec81d1-fdd2-417c-ba58-6e6e35bbb823';
begin
  if (select email from public.profiles where id = qa_id) is distinct from 'qa-release-final2-20261007@example.invalid'
    or (select count(*) from public.budget_investment_contracts where id = qa_contract_id
      and member_id = qa_id and request_id = 'da002892-59b4-4c73-bb0a-38cd335489ae'
      and rank_number = 1 and principal = 500 and months = 2 and unlocks_at > now()) <> 1
    or (select count(*) from public.budget_investment_income where contract_id = qa_contract_id and amount = 150) <> 2
    or (select count(*) from public.member_fund_ledger l
      join public.budget_investment_income i on i.id = l.source_id
      where i.contract_id = qa_contract_id and l.member_id = qa_id
        and l.source_type = 'budget_investment_income' and l.amount = 150) <> 2
  then
    raise exception 'QA contract changed; maturity rehearsal cancelled.';
  end if;

  update public.budget_investment_contracts
  set started_at = now() - interval '3 months', unlocks_at = now() - interval '1 month'
  where id = qa_contract_id;
  update public.budget_investment_income
  set due_at = now() - interval '1 day'
  where contract_id = qa_contract_id;
  update public.member_fund_ledger l
  set available_at = now() - interval '1 day'
  from public.budget_investment_income i
  where i.contract_id = qa_contract_id and l.source_id = i.id
    and l.member_id = qa_id and l.source_type = 'budget_investment_income';
end;
$$;

commit;
