-- Owner-controlled, one-time administrator invitations for existing members.
create table public.organization_owners (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Preserve the existing bootstrap convention: the earliest administrator is the owner.
insert into public.organization_owners (user_id)
select user_id from public.user_roles where role = 'admin' order by created_at, user_id limit 1
on conflict do nothing;

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index admin_invitations_recipient_idx on public.admin_invitations(recipient_id, created_at desc);
create unique index one_open_admin_invitation_per_member on public.admin_invitations(recipient_id)
  where accepted_at is null and revoked_at is null;

alter table public.organization_owners enable row level security;
alter table public.admin_invitations enable row level security;

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_owners where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.owner_invite_admin(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare raw_token text := encode(gen_random_bytes(24), 'hex'); invitation public.admin_invitations;
begin
  if not public.is_owner() then raise exception 'Only the Owner can invite administrators.' using errcode = '42501'; end if;
  if p_member_id = auth.uid() then raise exception 'The Owner already has administrator access.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.user_roles where user_id = p_member_id and role = 'admin') then raise exception 'This member is already an administrator.' using errcode = '23505'; end if;
  update public.admin_invitations set revoked_at = now() where recipient_id = p_member_id and accepted_at is null and revoked_at is null;
  insert into public.admin_invitations(recipient_id, token_hash, invited_by, expires_at)
  values (p_member_id, encode(digest(raw_token, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days') returning * into invitation;
  insert into public.activity_logs(actor_id, event_type, message, metadata) values
    (auth.uid(), 'admin-invitation-created', 'Owner invited a member to become an administrator.', jsonb_build_object('recipientId', p_member_id, 'invitationId', invitation.id));
  return jsonb_build_object('token', raw_token, 'expiresAt', invitation.expires_at);
end;
$$;

create or replace function public.accept_admin_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.admin_invitations;
begin
  if auth.uid() is null then raise exception 'Sign in before accepting this invitation.' using errcode = '42501'; end if;
  if p_token !~ '^[a-f0-9]{48}$' then raise exception 'Invalid administrator invitation.' using errcode = '22023'; end if;
  select * into invitation from public.admin_invitations
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and accepted_at is null and revoked_at is null and expires_at > now()
   for update;
  if invitation.id is null then raise exception 'This invitation is invalid, expired, or already used.' using errcode = '22023'; end if;
  if invitation.recipient_id <> auth.uid() then raise exception 'This invitation belongs to a different member account.' using errcode = '42501'; end if;
  update public.user_roles set role = 'admin', created_at = now() where user_id = auth.uid();
  update public.admin_invitations set accepted_at = now() where id = invitation.id;
  insert into public.activity_logs(actor_id, event_type, message, metadata) values
    (auth.uid(), 'admin-invitation-accepted', 'Member accepted an administrator invitation.', jsonb_build_object('invitationId', invitation.id));
  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.owner_remove_admin(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the Owner can remove administrators.' using errcode = '42501'; end if;
  if exists (select 1 from public.organization_owners where user_id = p_member_id) then raise exception 'The Owner role cannot be removed.' using errcode = '22023'; end if;
  update public.user_roles set role = 'member', created_at = now() where user_id = p_member_id and role = 'admin';
  if not found then raise exception 'This member is not an administrator.' using errcode = 'P0002'; end if;
  insert into public.activity_logs(actor_id, event_type, message, metadata) values
    (auth.uid(), 'admin-access-removed', 'Owner removed administrator access.', jsonb_build_object('memberId', p_member_id));
  return jsonb_build_object('removed', true);
end;
$$;

create or replace function public.admin_get_member_roles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('memberId', role.user_id, 'role', role.role, 'isOwner', owner.user_id is not null)), '[]'::jsonb)
    into result from public.user_roles role left join public.organization_owners owner on owner.user_id = role.user_id;
  return result;
end;
$$;

revoke all on function public.owner_invite_admin(uuid), public.accept_admin_invitation(text), public.owner_remove_admin(uuid), public.admin_get_member_roles() from public, anon;
grant execute on function public.owner_invite_admin(uuid), public.accept_admin_invitation(text), public.owner_remove_admin(uuid), public.admin_get_member_roles() to authenticated;
