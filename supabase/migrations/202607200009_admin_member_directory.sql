-- Paginated administrator member directory.
-- Personal details are returned only after the caller passes the admin check.
create or replace function public.admin_get_members(
  p_search text default '', p_status text default 'all',
  p_page integer default 1, p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := trim(coalesce(p_search, ''));
  normalized_status text := lower(trim(coalesce(p_status, 'all')));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if normalized_status not in ('all', 'registered', 'active', 'suspended') then
    raise exception 'Invalid member status filter.' using errcode = '22023';
  end if;

  with filtered as (
    select profile.*, sponsor.full_name as sponsor_name, sponsor.account_code as sponsor_code
    from public.profiles profile
    left join public.profiles sponsor on sponsor.id = profile.sponsor_id
    where (normalized_status = 'all' or profile.status::text = normalized_status)
      and (normalized_search = ''
        or profile.full_name ilike '%' || normalized_search || '%'
        or profile.username ilike '%' || normalized_search || '%'
        or profile.email ilike '%' || normalized_search || '%'
        or profile.account_code ilike '%' || normalized_search || '%')
  ), counted as (
    select count(*)::integer as total from filtered
  ), page_rows as (
    select filtered.* from filtered
    order by filtered.created_at desc, filtered.full_name
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', member.id, 'accountCode', member.account_code,
      'fullName', member.full_name, 'username', member.username,
      'email', member.email, 'phone', member.phone,
      'sponsorId', member.sponsor_id, 'sponsorName', member.sponsor_name,
      'sponsorCode', member.sponsor_code, 'status', member.status,
      'createdAt', member.created_at, 'approvedAt', member.approved_at,
      'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id),
      'referralCount', (select count(*) from public.profiles referral where referral.sponsor_id = member.id),
      'currentExit', coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = member.id and action.status = 'approved'), 0)
    ) order by member.created_at desc, member.full_name) from page_rows member), '[]'::jsonb),
    'total', (select total from counted), 'page', safe_page, 'pageSize', safe_page_size,
    'totalPages', greatest(ceil((select total from counted)::numeric / safe_page_size)::integer, 1)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_get_members(text, text, integer, integer) from public, anon;
grant execute on function public.admin_get_members(text, text, integer, integer) to authenticated;
