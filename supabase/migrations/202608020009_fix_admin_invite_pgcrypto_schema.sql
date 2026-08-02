-- Supabase installs pgcrypto in the extensions schema on this project.

create or replace function public.owner_invite_admin(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(24), 'hex');
  invitation public.admin_invitations;
begin
  if not public.is_owner() then raise exception 'Only the Owner can invite administrators.' using errcode = '42501'; end if;
  if p_member_id = auth.uid() then raise exception 'The Owner already has administrator access.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.organization_owners where user_id = p_member_id) then raise exception 'The Owner already has administrator access.' using errcode = '22023'; end if;
  if exists (select 1 from public.user_roles where user_id = p_member_id and role = 'admin') then raise exception 'This member is already an administrator.' using errcode = '23505'; end if;

  delete from public.admin_invitations
  where recipient_id = p_member_id
    and accepted_at is null;

  insert into public.admin_invitations(recipient_id, token_hash, invited_by, expires_at)
  values (p_member_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days')
  returning * into invitation;

  insert into public.activity_logs(actor_id, event_type, message, metadata) values
    (auth.uid(), 'admin-invitation-created', 'Owner invited a member to become an administrator.', jsonb_build_object('recipientId', p_member_id, 'invitationId', invitation.id));

  return jsonb_build_object('token', raw_token, 'expiresAt', invitation.expires_at);
end;
$$;

revoke all on function public.owner_invite_admin(uuid) from public, anon;
grant execute on function public.owner_invite_admin(uuid) to authenticated;
