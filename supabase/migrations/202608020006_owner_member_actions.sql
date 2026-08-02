-- Owner-only member actions used by the member directory action menu.

create or replace function public.owner_delete_registered_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_owner() then raise exception 'Only the Owner can delete members.' using errcode = '42501'; end if;
  if p_member_id = auth.uid() then raise exception 'The Owner account cannot be deleted.' using errcode = '22023'; end if;

  select * into target from public.profiles where id = p_member_id for update;
  if target.id is null then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if target.status <> 'registered' then raise exception 'Only registered members with no active matrix placement can be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.organization_owners where user_id = p_member_id) then raise exception 'Owner accounts cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.matrix_positions where member_id = p_member_id or parent_member_id = p_member_id) then raise exception 'Members with matrix placement history cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles child where child.sponsor_id = p_member_id) then raise exception 'Members with sponsored referrals cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.upgrade_requests where member_id = p_member_id and status = 'approved') then raise exception 'Members with approved Entry requests cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.exit_actions where member_id = p_member_id) then raise exception 'Members with Exit history cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.reward_ledger where member_id = p_member_id) then raise exception 'Members with reward history cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.withdrawal_requests where member_id = p_member_id) then raise exception 'Members with withdrawal history cannot be deleted.' using errcode = '22023'; end if;
  if exists (select 1 from public.product_plus_claims where member_id = p_member_id) then raise exception 'Members with Products Plus history cannot be deleted.' using errcode = '22023'; end if;

  delete from public.admin_invitations where recipient_id = p_member_id and accepted_at is null;
  delete from public.upgrade_requests where member_id = p_member_id and status <> 'approved';
  delete from public.user_roles where user_id = p_member_id;
  delete from public.profiles where id = p_member_id;
  delete from auth.users where id = p_member_id;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'member-deleted', 'Owner deleted a registered member account.', jsonb_build_object('memberId', p_member_id, 'accountCode', target.account_code, 'username', target.username));

  return jsonb_build_object('deleted', true, 'memberId', p_member_id);
end;
$$;

revoke all on function public.owner_delete_registered_member(uuid) from public, anon;
grant execute on function public.owner_delete_registered_member(uuid) to authenticated;

revoke all on function public.owner_invite_admin(uuid), public.accept_admin_invitation(text), public.owner_remove_admin(uuid), public.admin_get_member_roles(), public.owner_delete_registered_member(uuid) from public, anon;
grant execute on function public.owner_invite_admin(uuid), public.accept_admin_invitation(text), public.owner_remove_admin(uuid), public.admin_get_member_roles(), public.owner_delete_registered_member(uuid) to authenticated;
