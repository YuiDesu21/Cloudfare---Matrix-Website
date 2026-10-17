begin;

do $$
declare
  qa_member uuid := extensions.gen_random_uuid();
  qa_address uuid;
  qa_product uuid;
  placed jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (qa_member, 'shop-smoke-' || qa_member || '@example.invalid',
    jsonb_build_object(
      'full_name', 'Shop Smoke Test',
      'username', 'shop_smoke_' || left(replace(qa_member::text, '-', ''), 8),
      'phone', '09170000000',
      'wallet_address', 'QA-' || qa_member));

  insert into public.shipping_addresses
    (member_id, full_name, phone, region, province, city, barangay, street_address, postal_code)
  values
    (qa_member, 'Shop Smoke Test', '09170000000', 'Test Region', 'Test Province',
     'Test City', 'Test Barangay', '123 Test Street', '1000')
  returning id into qa_address;

  select id into qa_product from public.commerce_products
  where is_active = true order by id limit 1;
  if qa_product is null then raise exception 'No active product exists for checkout smoke test'; end if;

  perform set_config('request.jwt.claim.sub', qa_member::text, true);
  placed := public.request_budget_shop_order(
    qa_address,
    jsonb_build_array(jsonb_build_object('productId', qa_product, 'quantity', 1)),
    0, 'Rollback-only checkout test');
  if placed ->> 'status' <> 'pending_shipping_fee' or placed ->> 'orderPurpose' <> 'shop' then
    raise exception 'Unexpected Shop order result: %', placed;
  end if;
  if not exists (select 1 from public.commerce_orders
    where id = (placed ->> 'id')::uuid and member_id = qa_member) then
    raise exception 'Shop order was not created for the synthetic member';
  end if;
  raise notice 'Shop checkout smoke test passed; order will be rolled back';
end;
$$;

rollback;
