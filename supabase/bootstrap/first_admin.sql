-- One-time owner bootstrap. Run only after this email exists in Auth > Users.
do $$
declare
  owner_id uuid;
begin
  select id into owner_id
  from auth.users
  where lower(email) = lower('juneljameslariba@gmail.com')
  limit 1;

  if owner_id is null then
    raise exception 'Create and confirm juneljameslariba@gmail.com in Authentication > Users first.';
  end if;

  insert into public.profiles (
    id, account_code, full_name, username, email, phone, wallet_address,
    sponsor_id, status, cumulative_f3_tokens, approved_at
  ) values (
    owner_id, 'MATRIX-0001', 'Junel James Lariba', 'James',
    'juneljameslariba@gmail.com', '09550218335', '0x123123',
    null, 'active', 20, now()
  )
  on conflict (id) do update set
    account_code = excluded.account_code,
    full_name = excluded.full_name,
    username = excluded.username,
    email = excluded.email,
    phone = excluded.phone,
    wallet_address = excluded.wallet_address,
    status = excluded.status,
    cumulative_f3_tokens = excluded.cumulative_f3_tokens,
    approved_at = coalesce(public.profiles.approved_at, excluded.approved_at);

  insert into public.user_roles (user_id, role)
  values (owner_id, 'admin')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.organization_owners (user_id)
  values (owner_id)
  on conflict (user_id) do nothing;
end
$$;
