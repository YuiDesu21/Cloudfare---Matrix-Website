-- Disposable staging-only Patronizing exit-discount UI fixture.
begin;

do $$
declare
  qa_id constant uuid := 'a48beb8e-9014-4d61-9b29-a3b69617151a';
  owner_id constant uuid := '353ba65a-4dc4-4e11-bce2-780eb6151432';
begin
  if (select email from public.profiles where id = qa_id) is distinct from 'qa-release-final2-20261007@example.invalid'
    or (select full_name from public.profiles where id = qa_id) is distinct from 'RELEASE FINAL QA'
    or not exists (select 1 from public.organization_owners where user_id = owner_id)
    or exists (select 1 from public.patronizing_entries where member_id = qa_id)
    or exists (select 1 from public.patronizing_exit_progress where member_id = qa_id)
    or exists (select 1 from public.commerce_products where id = '90b66af9-0d5f-4190-b490-9f69822f3b66')
    or exists (select 1 from public.payment_methods where id = '36d4df27-f92c-4ba6-9b2c-dbd0821a3a49')
    or exists (select 1 from public.shipping_addresses where id = 'eb4ed85e-8c09-4886-8109-95e81f5ce088')
  then
    raise exception 'Final UI QA fixture identities or slots changed.';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.activate_patronizing_entry(qa_id, 'f3_token_12');
  insert into public.patronizing_exit_progress(member_id, exit_number, status, approved_at)
  values (qa_id, 1, 'active', now());
  insert into public.commerce_products(id, product_type, product_name, description, price, sort_order, budget_category)
  values ('90b66af9-0d5f-4190-b490-9f69822f3b66', 'product_plus_requirement',
    'RELEASE QA DISCOUNT PRODUCT - DO NOT SHIP', 'Staging-only fictional product.', 400, 9900, 'pc');
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values ('36d4df27-f92c-4ba6-9b2c-dbd0821a3a49',
    'RELEASE QA ONLY - NO PAYMENT', 'DO NOT PAY', 'QA-NOT-A-REAL-ACCOUNT');
  insert into public.shipping_addresses(id, member_id, full_name, phone, region,
    province, city, barangay, street_address, postal_code, notes)
  values ('eb4ed85e-8c09-4886-8109-95e81f5ce088', qa_id,
    'RELEASE QA ONLY', '09000000000', 'Test Region', 'Test Province', 'Test City',
    'Test Barangay', '123 QA Street - DO NOT SHIP', '1000', 'STAGING QA ONLY. DO NOT SHIP.');
end;
$$;

commit;
