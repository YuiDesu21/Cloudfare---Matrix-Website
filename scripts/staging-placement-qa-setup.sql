-- Temporary, clearly marked staging fixtures for the signed-in release rehearsal.
begin;

do $$
declare
  root_id constant uuid := 'e2da258a-25f0-494f-9e65-d5a0ff68a29e';
  qa_member_id constant uuid := 'f3989814-aa2b-4413-8669-b5374aeee209';
begin
  if (select email from public.profiles where id = root_id)
      is distinct from 'qa-release-root-20261007@example.invalid'
    or (select full_name from public.profiles where id = root_id)
      is distinct from 'RELEASE QA ROOT'
    or (select email from public.profiles where id = qa_member_id)
      is distinct from 'qa-release-member-20261007@example.invalid'
    or (select full_name from public.profiles where id = qa_member_id)
      is distinct from 'RELEASE QA MEMBER'
    or exists (select 1 from public.matrix_positions where member_id in (root_id, qa_member_id))
    or exists (select 1 from public.commerce_packages where id in
      ('0373ea76-a207-460e-a79c-7278972a83ae', '14ae81ca-19ee-4f90-b589-4e0fad97cdf9'))
  then
    raise exception 'Staging QA setup identities or fixture slots changed.';
  end if;

  update public.profiles set status = 'active' where id = root_id;
  insert into public.matrix_positions(member_id, plan_id, parent_member_id)
  values (root_id, 'power3-passive', null);

  insert into public.commerce_packages(id, package_type, package_name, description, sort_order)
  values
    ('0373ea76-a207-460e-a79c-7278972a83ae', 'matrix_1200_entry',
      'RELEASE QA PREMIUM - DO NOT ORDER', 'Staging-only fictional package. No product or payment.', 9900),
    ('14ae81ca-19ee-4f90-b589-4e0fad97cdf9', 'timeline_entry',
      'RELEASE QA STANDARD - DO NOT ORDER', 'Staging-only fictional package. No product or payment.', 9901);
  insert into public.commerce_package_items(package_id, item_name, price)
  values
    ('0373ea76-a207-460e-a79c-7278972a83ae', 'QA Premium placeholder - no delivery', 1200),
    ('14ae81ca-19ee-4f90-b589-4e0fad97cdf9', 'QA Standard placeholder - no delivery', 693);
  insert into public.payment_methods(id, method_name, account_name, account_number)
  values ('9107a9c4-20bc-4106-b9c7-40b3376ab867',
    'RELEASE QA ONLY - NO PAYMENT', 'DO NOT PAY', 'QA-NOT-A-REAL-ACCOUNT');
  insert into public.shipping_addresses(id, member_id, full_name, phone, region,
    province, city, barangay, street_address, postal_code, notes)
  values ('c7ae3910-c343-4fc6-a842-3f16bef28d98', qa_member_id,
    'RELEASE QA ONLY', '09000000000', 'Test Region', 'Test Province', 'Test City',
    'Test Barangay', '123 QA Street - DO NOT SHIP', '1000', 'STAGING QA ONLY. DO NOT SHIP.');
end;
$$;

commit;
