-- Create Matrix profiles automatically after a successful Supabase Auth signup.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral_code text := nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '');
  sponsor uuid;
  generated_code text;
begin
  if referral_code is not null then
    select id into sponsor
    from public.profiles
    where upper(account_code) = upper(referral_code)
    limit 1;

    if sponsor is null then
      raise exception 'The referral account ID was not found.';
    end if;
  end if;

  generated_code := 'MCS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.profiles (
    id, account_code, full_name, username, email, phone, wallet_address,
    sponsor_id, status, cumulative_f3_tokens
  ) values (
    new.id,
    generated_code,
    trim(new.raw_user_meta_data ->> 'full_name'),
    trim(new.raw_user_meta_data ->> 'username'),
    coalesce(new.email, ''),
    trim(new.raw_user_meta_data ->> 'phone'),
    trim(new.raw_user_meta_data ->> 'wallet_address'),
    sponsor,
    'registered',
    0
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Establish the previously bootstrapped owner as the first matrix root.
insert into public.matrix_positions (member_id, plan_id, parent_member_id, placed_at)
select profile.id, 'power3-passive', null, coalesce(profile.approved_at, now())
from public.profiles profile
where lower(profile.email) = lower('juneljameslariba@gmail.com')
on conflict (member_id) do nothing;
