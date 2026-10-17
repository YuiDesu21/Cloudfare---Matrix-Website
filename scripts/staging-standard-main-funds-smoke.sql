-- All synthetic users, balances, requests, and placements are rolled back.
begin;

do $$
#variable_conflict use_variable
declare
  member_id uuid := extensions.gen_random_uuid();
  admin_id uuid := extensions.gen_random_uuid();
  external_member_id uuid := extensions.gen_random_uuid();
  method_id uuid := extensions.gen_random_uuid();
  deposit_id uuid := extensions.gen_random_uuid();
  reward_id uuid := extensions.gen_random_uuid();
  request_id uuid;
  result jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data)
  values
    (member_id, 'standard-main-' || member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Standard Main Smoke',
        'username', 'smoke_' || left(replace(member_id::text, '-', ''), 12),
        'phone', '09000000000', 'wallet_address', 'F3-' || member_id)),
    (admin_id, 'standard-admin-' || admin_id || '@example.invalid',
      jsonb_build_object('full_name', 'Standard Admin Smoke',
        'username', 'smoke_' || left(replace(admin_id::text, '-', ''), 12),
        'phone', '09000000000', 'wallet_address', 'F3-' || admin_id)),
    (external_member_id, 'standard-external-' || external_member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Standard External Smoke',
        'username', 'smoke_' || left(replace(external_member_id::text, '-', ''), 12),
        'phone', '09000000000', 'wallet_address', 'F3-' || external_member_id));
  update public.user_roles set role = 'admin' where user_id = admin_id;
  insert into public.reward_ledger
    (id, member_id, source_type, source_label, amount, due_at, plan_id)
  values (reward_id, member_id, 'entry', 'Rollback-only Premium income', 859,
    now() - interval '1 day', 'power3-passive');

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  begin
    perform public.request_timeline_activation('main_funds', null::uuid, '');
    raise exception 'Main Funds activation accepted an empty wallet';
  exception when sqlstate '22023' then
    if sqlerrm not like 'Main Funds needs at least PHP 693%' then raise; end if;
  end;

  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values (member_id, 'main', 1000, 'smoke_deposit', deposit_id, 'Rollback-only balance');
  result := public.request_timeline_activation('main_funds', null::uuid, '');
  request_id := (result->>'id')::uuid;
  if public.member_main_available(member_id) <> 307 then
    raise exception 'Pending activation did not reserve PHP 693';
  end if;
  begin
    perform public.transfer_wallet_funds('main', 308, extensions.gen_random_uuid());
    raise exception 'Reserved Main Funds could be transferred';
  exception when sqlstate '22023' then
    if sqlerrm not like 'Available funds are not enough%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.admin_reject_timeline_request(request_id, 'Rollback-only rejection test');
  if public.member_main_available(member_id) <> 1000
    or exists (select 1 from public.member_fund_ledger
      where source_type = 'timeline_activation' and source_id = request_id) then
    raise exception 'Rejected activation did not release the reservation';
  end if;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  result := public.request_timeline_activation('main_funds', null::uuid, '');
  request_id := (result->>'id')::uuid;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.admin_approve_timeline_request(request_id, 'Rollback-only approval test');
  if public.member_fund_balance(member_id, 'main') <> 307
    or public.member_main_available(member_id) <> 307
    or (select withdrawn_amount from public.reward_ledger where id = reward_id) <> 0
    or (select count(*) from public.member_fund_ledger
      where source_type = 'timeline_activation' and source_id = request_id
        and account = 'main' and amount = -693) <> 1
    or not exists (select 1 from public.matrix_positions position
      where position.member_id = member_id and position.plan_id = 'timeline-power3') then
    raise exception 'Approved activation did not debit once and place the member';
  end if;

  insert into public.payment_methods
    (id, method_name, account_name, account_number, qr_image_data, instructions, sort_order, is_active)
  values (method_id, 'GCash', 'Smoke Test', '09900000000', '', '', 999, true);
  perform set_config('request.jwt.claim.sub', external_member_id::text, true);
  result := public.request_timeline_activation('external', method_id, 'SMOKE-' || left(replace(external_member_id::text, '-', ''), 12));
  request_id := (result->>'id')::uuid;
  if not exists (select 1 from public.timeline_requests
    where id = request_id and payment_method = 'external' and payment_method_id = method_id) then
    raise exception 'External payment method was not saved';
  end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.admin_approve_timeline_request(request_id, 'Rollback-only external approval');
  if public.member_fund_balance(external_member_id, 'main') <> 0
    or not exists (select 1 from public.matrix_positions position
      where position.member_id = external_member_id and position.plan_id = 'timeline-power3') then
    raise exception 'External approval changed Main Funds or failed placement';
  end if;
  raise notice 'Standard Main Funds activation smoke test passed; all changes will roll back';
end;
$$;

rollback;
