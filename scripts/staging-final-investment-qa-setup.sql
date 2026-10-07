-- Disposable Budget investment eligibility and fictional funding for UI QA.
begin;

do $$
declare
  qa_id constant uuid := 'a48beb8e-9014-4d61-9b29-a3b69617151a';
  owner_id constant uuid := '353ba65a-4dc4-4e11-bce2-780eb6151432';
  method_id constant uuid := '36d4df27-f92c-4ba6-9b2c-dbd0821a3a49';
  child_ids constant uuid[] := array[
    '2e998a9a-29b9-4a73-9d6c-ed527ec672d8'::uuid,
    '396a99f2-d728-4e3d-8b7f-84db46d6272f'::uuid,
    '556956d6-4d33-48ce-ac1c-9a3f8d95bdd8'::uuid
  ];
  child_id uuid;
  token_id uuid;
  topup_id uuid;
  i integer;
begin
  if (select email from public.profiles where id = qa_id) is distinct from 'qa-release-final2-20261007@example.invalid'
    or not exists (select 1 from public.organization_owners where user_id = owner_id)
    or not exists (select 1 from public.payment_methods where id = method_id and method_name = 'RELEASE QA ONLY - NO PAYMENT')
    or exists (select 1 from public.matrix_positions where member_id = qa_id and plan_id = 'budget-plan')
    or exists (select 1 from public.budget_plan_token_requests where member_id = qa_id)
    or exists (select 1 from public.member_fund_topups where member_id = qa_id)
    or exists (select 1 from auth.users where id = any(child_ids))
  then
    raise exception 'Investment QA setup identities or fixture slots changed.';
  end if;

  perform set_config('request.jwt.claim.sub', qa_id::text, true);
  token_id := (public.request_budget_token_purchase(11, method_id,
    'QA-NO-PAYMENT-20261007-INVEST-TOKEN') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_budget_token_purchase(token_id, true,
    'STAGING QA FICTIONAL TOKEN PAYMENT ONLY. No money or token sent.');

  for i in 1..3 loop
    child_id := child_ids[i];
    insert into auth.users(id, email, raw_user_meta_data)
    values (child_id, 'qa-invest-child-' || i || '-20261007@example.invalid',
      jsonb_build_object('full_name', 'RELEASE FINAL QA CHILD ' || substring('ABC' from i for 1),
        'username', 'release_final_qa_child_' || i,
        'phone', '09000000000',
        'wallet_address', '0x' || lpad((i + 1)::text, 40, '0')));
    insert into public.matrix_positions(member_id, plan_id, parent_member_id)
    values (child_id, 'budget-plan', qa_id);
    insert into public.budget_plan_rank_progress(member_id, rank_number)
    values (child_id, 0);
  end loop;
  perform public.refresh_budget_plan_rank(qa_id);
  if public.budget_plan_rank_for(qa_id) <> 1 then
    raise exception 'QA member did not reach Overcomer rank.';
  end if;

  perform set_config('request.jwt.claim.sub', qa_id::text, true);
  topup_id := (public.request_member_fund_topup(500, method_id,
    'QA-NO-PAYMENT-20261007-INVEST-TOPUP') ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_review_member_fund_topup(topup_id, true,
    'STAGING QA FICTIONAL TOP-UP ONLY. No money received.');
end;
$$;

commit;
