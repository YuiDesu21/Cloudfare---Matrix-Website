begin;

do $$
declare
  owner_id uuid := extensions.gen_random_uuid();
  admin_id uuid := extensions.gen_random_uuid();
  owner_order_id uuid;
  admin_order_id uuid;
  blocked boolean := false;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (owner_id, 'order-reject-owner-' || owner_id || '@example.invalid',
      jsonb_build_object('full_name', 'Order Reject Owner', 'username', 'reject_owner_' || left(replace(owner_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || owner_id)),
    (admin_id, 'order-reject-admin-' || admin_id || '@example.invalid',
      jsonb_build_object('full_name', 'Order Reject Admin', 'username', 'reject_admin_' || left(replace(admin_id::text, '-', ''), 8), 'phone', '09000000000', 'wallet_address', 'F3-' || admin_id));
  update public.user_roles set role = 'admin' where user_id in (owner_id, admin_id);
  insert into public.organization_owners(user_id) values (owner_id);

  insert into public.commerce_orders
    (order_code, member_id, package_type, package_snapshot, shipping_address_snapshot,
     package_total, shipping_fee, amount_due, status)
  values
    ('QA-' || replace(owner_id::text, '-', ''), owner_id, 'product_plus_requirement', '{}'::jsonb, '{}'::jsonb,
     100, 0, 100, 'payment_submitted')
  returning id into owner_order_id;
  insert into public.commerce_order_payments
    (order_id, member_id, payment_method_snapshot, amount, reference_number)
  values (owner_order_id, owner_id, '{}'::jsonb, 100, 'QA-' || replace(owner_id::text, '-', ''));

  insert into public.commerce_orders
    (order_code, member_id, package_type, package_snapshot, shipping_address_snapshot,
     package_total, shipping_fee, amount_due, status)
  values
    ('QA-' || replace(admin_id::text, '-', ''), admin_id, 'product_plus_requirement', '{}'::jsonb, '{}'::jsonb,
     100, 0, 100, 'payment_submitted')
  returning id into admin_order_id;
  insert into public.commerce_order_payments
    (order_id, member_id, payment_method_snapshot, amount, reference_number)
  values (admin_order_id, admin_id, '{}'::jsonb, 100, 'QA-' || replace(admin_id::text, '-', ''));

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  begin
    perform public.admin_reject_commerce_order_payment(admin_order_id, 'Test rejection');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'Regular admin rejected own payment'; end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.admin_reject_commerce_order_payment(owner_order_id, 'Test rejection');
  if not exists (select 1 from public.commerce_orders where id = owner_order_id and status = 'approved_for_payment') then
    raise exception 'Owner order did not return to payment step';
  end if;
  if not exists (select 1 from public.commerce_order_payments where order_id = owner_order_id and status = 'rejected') then
    raise exception 'Owner payment reference was not rejected';
  end if;
end;
$$;

rollback;
