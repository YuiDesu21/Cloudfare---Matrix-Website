-- Give administrators the member F3 wallet needed to verify Entry payment.
-- This remains admin-only; the public/member matrix explorer does not expose it.
create or replace function public.admin_get_entry_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code,
    'walletAddress', member.wallet_address,
    'referenceNumber', request.reference_number, 'amount', request.amount,
    'status', request.status, 'createdAt', request.created_at,
    'sponsorId', sponsor.id, 'sponsorName', sponsor.full_name, 'sponsorCode', sponsor.account_code
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.upgrade_requests request
  join public.profiles member on member.id = request.member_id
  left join public.profiles sponsor on sponsor.id = member.sponsor_id;
  return result;
end;
$$;

revoke all on function public.admin_get_entry_requests() from public, anon;
grant execute on function public.admin_get_entry_requests() to authenticated;
