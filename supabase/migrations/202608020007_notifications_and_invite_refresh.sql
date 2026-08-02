-- Member notifications and more reliable owner admin invitations.

create or replace function public.owner_invite_admin(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := encode(gen_random_bytes(24), 'hex');
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
  values (p_member_id, encode(digest(raw_token, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days')
  returning * into invitation;

  insert into public.activity_logs(actor_id, event_type, message, metadata) values
    (auth.uid(), 'admin-invitation-created', 'Owner invited a member to become an administrator.', jsonb_build_object('recipientId', p_member_id, 'invitationId', invitation.id));

  return jsonb_build_object('token', raw_token, 'expiresAt', invitation.expires_at);
end;
$$;

create or replace function public.get_my_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with notices as (
    select 'passive-income'::text as type, 'Passive income available'::text as title,
      'PHP ' || to_char(coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)), 0), 'FM999,999,999,990.00') || ' is available for withdrawal.' as message,
      max(ledger.due_at) as created_at, 'high'::text as priority
    from public.reward_ledger ledger
    where ledger.member_id = auth.uid() and ledger.status = 'due' and ledger.due_at <= now()
    having coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)), 0) > 0

    union all
    select 'exit-eligibility', 'Exit ' || rule.exit_number || ' eligible',
      'You have 3 qualified direct downlines for Exit ' || rule.exit_number || '. You can submit the required action.',
      now(), 'high'
    from public.matrix_exit_rules rule
    where (select count(*) from public.matrix_positions child
      where child.parent_member_id = auth.uid()
        and child.plan_id = 'power3-passive'
        and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit
    ) >= 3
    and not exists (select 1 from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status in ('pending', 'approved'))

    union all
    select 'admin-invitation', 'Admin invitation ready',
      'You have an active administrator invitation. Open the invite link from the owner to accept it.',
      invitation.created_at, 'high'
    from public.admin_invitations invitation
    where invitation.recipient_id = auth.uid()
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()

    union all
    select 'withdrawal-' || request.status::text, 'Withdrawal ' || request.status::text,
      'Withdrawal ' || request.withdrawal_code || ' for PHP ' || to_char(request.amount, 'FM999,999,999,990.00') || ' was ' || request.status::text || '.',
      coalesce(request.approved_at, request.rejected_at, request.created_at), case when request.status = 'pending' then 'normal' else 'high' end
    from public.withdrawal_requests request
    where request.member_id = auth.uid()
      and request.status in ('pending', 'approved', 'rejected')
      and coalesce(request.approved_at, request.rejected_at, request.created_at) >= now() - interval '45 days'

    union all
    select 'deposit-' || request.status::text, 'Entry deposit ' || request.status::text,
      'Your PHP ' || to_char(request.amount, 'FM999,999,999,990.00') || ' Entry deposit is ' || request.status::text || '.',
      coalesce(request.approved_at, request.rejected_at, request.created_at), case when request.status = 'pending' then 'normal' else 'high' end
    from public.upgrade_requests request
    where request.member_id = auth.uid()
      and request.status in ('pending', 'approved', 'rejected')
      and coalesce(request.approved_at, request.rejected_at, request.created_at) >= now() - interval '45 days'

    union all
    select 'products-plus-' || claim.status::text, 'Products Plus ' || claim.status::text,
      'Exit ' || claim.exit_number || ' Products Plus claim for PHP ' || to_char(claim.spend_amount, 'FM999,999,999,990.00') || ' is ' || claim.status::text || '.',
      coalesce(claim.approved_at, claim.rejected_at, claim.created_at), case when claim.status = 'pending' then 'normal' else 'high' end
    from public.product_plus_claims claim
    where claim.member_id = auth.uid()
      and claim.status in ('pending', 'approved', 'rejected')
      and coalesce(claim.approved_at, claim.rejected_at, claim.created_at) >= now() - interval '45 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', type, 'title', title, 'message', message, 'createdAt', created_at, 'priority', priority
  ) order by case priority when 'high' then 1 else 2 end, created_at desc), '[]'::jsonb)
  from notices;
$$;

revoke all on function public.owner_invite_admin(uuid), public.get_my_notifications() from public, anon;
grant execute on function public.owner_invite_admin(uuid), public.get_my_notifications() to authenticated;
