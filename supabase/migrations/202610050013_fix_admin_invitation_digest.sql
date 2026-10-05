create or replace function public.accept_admin_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.admin_invitations;
begin
  if auth.uid() is null then raise exception 'Sign in before accepting this invitation.' using errcode = '42501'; end if;
  if p_token !~ '^[a-f0-9]{48}$' then raise exception 'Invalid administrator invitation.' using errcode = '22023'; end if;
  select * into invitation from public.admin_invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and accepted_at is null and revoked_at is null and expires_at > now()
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

revoke all on function public.accept_admin_invitation(text) from public, anon;
grant execute on function public.accept_admin_invitation(text) to authenticated;
