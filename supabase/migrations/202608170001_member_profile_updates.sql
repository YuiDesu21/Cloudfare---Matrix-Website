-- Member and admin profile detail updates.

create or replace function public.member_profile_json(p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_profile.id,
    'accountCode', p_profile.account_code,
    'fullName', p_profile.full_name,
    'username', p_profile.username,
    'email', p_profile.email,
    'phone', p_profile.phone,
    'walletAddress', p_profile.wallet_address,
    'sponsorId', p_profile.sponsor_id,
    'status', p_profile.status,
    'cumulativeF3Tokens', p_profile.cumulative_f3_tokens,
    'createdAt', p_profile.created_at,
    'approvedAt', p_profile.approved_at
  );
$$;

create or replace function public.update_my_profile_details(
  p_full_name text,
  p_username text,
  p_phone text,
  p_wallet_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
  normalized_full_name text := trim(coalesce(p_full_name, ''));
  normalized_username text := trim(coalesce(p_username, ''));
  normalized_phone text := regexp_replace(trim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
  normalized_wallet text := trim(coalesce(p_wallet_address, ''));
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(normalized_full_name) not between 1 and 30 or normalized_full_name !~ '^[A-Za-z .''-]+$' then raise exception 'Full name must be 1-30 letters or normal name punctuation.' using errcode = '22023'; end if;
  if normalized_username !~ '^[A-Za-z0-9_]{3,30}$' then raise exception 'Username must be 3-30 letters, numbers, or underscores.' using errcode = '22023'; end if;
  if normalized_phone !~ '^09[0-9]{9}$' then raise exception 'Phone number must be 11 digits and start with 09.' using errcode = '22023'; end if;
  if normalized_wallet !~ '^[A-Za-z0-9:_-]{1,52}$' then raise exception 'F3 wallet must be 1-52 supported characters.' using errcode = '22023'; end if;

  if exists (select 1 from public.profiles where lower(username) = lower(normalized_username) and id <> auth.uid()) then
    raise exception 'Username is already taken.' using errcode = '23505';
  end if;
  if exists (select 1 from public.profiles where wallet_address = normalized_wallet and id <> auth.uid()) then
    raise exception 'Wallet address is already used by another member.' using errcode = '23505';
  end if;

  update public.profiles
  set full_name = normalized_full_name,
      username = normalized_username,
      phone = normalized_phone,
      wallet_address = normalized_wallet
  where id = auth.uid()
  returning * into target;

  if target.id is null then raise exception 'Member profile not found.' using errcode = 'P0002'; end if;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'member-profile-updated', 'Member updated profile details.', jsonb_build_object('memberId', target.id));

  return public.member_profile_json(target);
end;
$$;

create or replace function public.admin_update_member_details(
  p_member_id uuid,
  p_full_name text,
  p_username text,
  p_phone text,
  p_wallet_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
  normalized_full_name text := trim(coalesce(p_full_name, ''));
  normalized_username text := trim(coalesce(p_username, ''));
  normalized_phone text := regexp_replace(trim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
  normalized_wallet text := trim(coalesce(p_wallet_address, ''));
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(normalized_full_name) not between 1 and 30 or normalized_full_name !~ '^[A-Za-z .''-]+$' then raise exception 'Full name must be 1-30 letters or normal name punctuation.' using errcode = '22023'; end if;
  if normalized_username !~ '^[A-Za-z0-9_]{3,30}$' then raise exception 'Username must be 3-30 letters, numbers, or underscores.' using errcode = '22023'; end if;
  if normalized_phone !~ '^09[0-9]{9}$' then raise exception 'Phone number must be 11 digits and start with 09.' using errcode = '22023'; end if;
  if normalized_wallet !~ '^[A-Za-z0-9:_-]{1,52}$' then raise exception 'F3 wallet must be 1-52 supported characters.' using errcode = '22023'; end if;

  if exists (select 1 from public.profiles where lower(username) = lower(normalized_username) and id <> p_member_id) then
    raise exception 'Username is already taken.' using errcode = '23505';
  end if;
  if exists (select 1 from public.profiles where wallet_address = normalized_wallet and id <> p_member_id) then
    raise exception 'Wallet address is already used by another member.' using errcode = '23505';
  end if;

  update public.profiles
  set full_name = normalized_full_name,
      username = normalized_username,
      phone = normalized_phone,
      wallet_address = normalized_wallet
  where id = p_member_id
  returning * into target;

  if target.id is null then raise exception 'Member profile not found.' using errcode = 'P0002'; end if;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'admin-member-details-updated', 'Admin updated member profile details.', jsonb_build_object('memberId', target.id));

  return public.member_profile_json(target);
end;
$$;

revoke all on function
  public.member_profile_json(public.profiles),
  public.update_my_profile_details(text,text,text,text),
  public.admin_update_member_details(uuid,text,text,text,text)
from public, anon;

grant execute on function
  public.update_my_profile_details(text,text,text,text),
  public.admin_update_member_details(uuid,text,text,text,text)
to authenticated;
