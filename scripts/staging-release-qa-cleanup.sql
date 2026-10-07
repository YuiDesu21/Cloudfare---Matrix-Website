-- Remove only the disposable checkout records created for the October 7 staging rehearsal.
begin;

do $$
declare
  qa_order public.commerce_orders;
begin
  select * into qa_order
  from public.commerce_orders
  where id = '2c1d21ed-2608-47d6-a970-75705b738392'
    and order_code = 'ORD-AD6A859840'
    and status = 'approved_for_payment'
    and member_notes = 'STAGING RELEASE QA ONLY. Do not deliver or charge.'
    and package_id = '8eb1f71d-889a-490c-9f68-01873f77828f'
    and shipping_address_id = '66fd4cbb-34b4-4d33-82af-2ab53a65f0b1'
  for update;

  if qa_order.id is null
    or (select count(*) from public.commerce_order_payments where order_id = qa_order.id and status = 'rejected') <> 1
    or exists (select 1 from public.patronizing_entries where source_order_id = qa_order.id)
    or exists (select 1 from public.budget_plan_purchase_credits where order_id = qa_order.id)
    or (select count(*) from public.commerce_orders where package_id = qa_order.package_id) <> 1
    or (select count(*) from public.commerce_orders where shipping_address_id = qa_order.shipping_address_id) <> 1
    or (select package_name from public.commerce_packages where id = qa_order.package_id) <> 'RELEASE QA Standard Package'
    or (select full_name from public.shipping_addresses where id = qa_order.shipping_address_id) <> 'RELEASE QA ONLY'
  then
    raise exception 'Staging QA records changed; no cleanup was performed.';
  end if;

  delete from public.commerce_order_payments where order_id = qa_order.id;
  delete from public.commerce_orders where id = qa_order.id;
  delete from public.commerce_packages where id = qa_order.package_id;
  delete from public.shipping_addresses where id = qa_order.shipping_address_id;
end;
$$;

commit;
