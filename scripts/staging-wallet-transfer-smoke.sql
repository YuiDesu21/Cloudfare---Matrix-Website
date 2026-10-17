-- Run only in staging after 202610160001_wallet_transfer_idempotency.sql.
-- Everything in this file is rolled back.
begin;

do $$
#variable_conflict use_variable
declare
  member_id uuid := extensions.gen_random_uuid();
  other_id uuid := extensions.gen_random_uuid();
  deposit_id uuid := extensions.gen_random_uuid();
  first_key uuid := extensions.gen_random_uuid();
  second_key uuid := extensions.gen_random_uuid();
  result jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data)
  values
    (member_id, 'wallet-smoke-' || member_id || '@example.invalid',
      jsonb_build_object('full_name', 'Wallet Smoke', 'username', 'smoke_' || left(replace(member_id::text, '-', ''), 12), 'phone', '09000000000', 'wallet_address', 'F3-' || member_id)),
    (other_id, 'wallet-smoke-' || other_id || '@example.invalid',
      jsonb_build_object('full_name', 'Other Wallet Smoke', 'username', 'smoke_' || left(replace(other_id::text, '-', ''), 12), 'phone', '09000000000', 'wallet_address', 'F3-' || other_id));
  insert into public.member_fund_ledger(member_id, account, amount, source_type, source_id, note)
  values (member_id, 'main', 500, 'smoke_deposit', deposit_id, 'Smoke test deposit');

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  result := public.transfer_wallet_funds('main', 500, first_key);
  if (result ->> 'id')::uuid <> first_key
    or public.member_main_available(member_id) <> 0
    or public.member_investment_available(member_id) <> 500 then
    raise exception 'Exact-balance Main to Investment transfer failed';
  end if;
  perform public.transfer_wallet_funds('main', 500, first_key);
  if (select count(*) from public.member_fund_ledger where source_type = 'wallet_transfer' and source_id = first_key) <> 2 then
    raise exception 'Idempotent retry created extra ledger entries';
  end if;

  begin
    perform public.transfer_wallet_funds('main', 1, extensions.gen_random_uuid());
    raise exception 'Insufficient balance was accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.member_fund_ledger ledger where ledger.member_id = member_id) <> 3 then
    raise exception 'Failed transfer left a ledger entry behind';
  end if;
  begin
    perform public.request_withdrawal(500, 'Wallet Smoke', '09123456789', '');
    raise exception 'Investment Funds were withdrawn directly';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.transfer_wallet_funds('investment', 0, extensions.gen_random_uuid());
    raise exception 'Zero amount was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.transfer_wallet_funds('investment', -1, extensions.gen_random_uuid());
    raise exception 'Negative amount was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.transfer_wallet_funds('investment', 0.001, extensions.gen_random_uuid());
    raise exception 'Excess precision was accepted';
  exception when sqlstate '22023' then null;
  end;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  begin
    perform public.transfer_wallet_funds('main', 500, first_key);
    raise exception 'Another member reused a transfer reference';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform public.transfer_wallet_funds('investment', 500, second_key);
  if public.member_main_available(member_id) <> 500
    or public.member_investment_available(member_id) <> 0 then
    raise exception 'Investment to Main transfer failed';
  end if;
  if (select count(*) from public.member_fund_ledger where source_type = 'wallet_transfer' and source_id = second_key) <> 2 then
    raise exception 'Transfer ledger pair is incomplete';
  end if;
end;
$$;

rollback;
