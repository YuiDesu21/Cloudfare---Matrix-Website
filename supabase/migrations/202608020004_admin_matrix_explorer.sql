-- Administrator-only data contracts for the compact directory and global
-- Matrix Explorer. Member-facing privacy rules are unchanged.

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
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if normalized_status not in ('all', 'registered', 'active', 'suspended') then raise exception 'Invalid member status filter.' using errcode = '22023'; end if;

  with filtered as (
    select profile.*, sponsor.full_name as sponsor_name, sponsor.account_code as sponsor_code
    from public.profiles profile
    left join public.profiles sponsor on sponsor.id = profile.sponsor_id
    where (normalized_status = 'all' or profile.status::text = normalized_status)
      and (normalized_search = ''
        or profile.full_name ilike '%' || normalized_search || '%'
        or profile.username ilike '%' || normalized_search || '%'
        or profile.email ilike '%' || normalized_search || '%'
        or profile.account_code ilike '%' || normalized_search || '%'
        or profile.wallet_address ilike '%' || normalized_search || '%')
  ), counted as (
    select count(*)::integer as total from filtered
  ), page_rows as (
    select * from filtered order by created_at desc, full_name
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', member.id, 'accountCode', member.account_code, 'fullName', member.full_name,
      'username', member.username, 'email', member.email, 'phone', member.phone,
      'walletAddress', member.wallet_address, 'sponsorId', member.sponsor_id,
      'sponsorName', member.sponsor_name, 'sponsorCode', member.sponsor_code,
      'status', member.status, 'createdAt', member.created_at, 'approvedAt', member.approved_at,
      'mainPosition', (select jsonb_build_object('planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'parentUsername', parent.username, 'placedAt', position.placed_at)
        from public.matrix_positions position left join public.profiles parent on parent.id = position.parent_member_id
        where position.member_id = member.id and position.plan_id = 'power3-passive'),
      'timelinePosition', (select jsonb_build_object('planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'parentUsername', parent.username, 'placedAt', position.placed_at)
        from public.matrix_positions position left join public.profiles parent on parent.id = position.parent_member_id
        where position.member_id = member.id and position.plan_id = 'timeline-power3'),
      'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = 'power3-passive'),
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

create or replace function public.admin_get_matrix_explorer(p_plan_id text default 'power3-passive')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_plan_id not in ('power3-passive', 'timeline-power3') then raise exception 'Invalid matrix plan.' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.id, 'fullName', member.full_name, 'username', member.username,
    'accountCode', member.account_code, 'email', member.email, 'phone', member.phone,
    'walletAddress', member.wallet_address, 'sponsorId', member.sponsor_id,
    'sponsorUsername', sponsor.username, 'parentMemberId', position.parent_member_id,
    'parentUsername', parent.username, 'placedAt', position.placed_at,
    'directChildrenCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = p_plan_id),
    'matrixStage', case when p_plan_id = 'timeline-power3' then jsonb_build_object(
      'label', case when public.timeline_exit_for(member.id) > 0 then 'Exit ' || public.timeline_exit_for(member.id) else 'Entry' end,
      'status', 'active', 'exit', public.timeline_exit_for(member.id)
    ) else public.matrix_stage_for(member.id) end
  ) order by position.placed_at, position.id), '[]'::jsonb) into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  left join public.profiles parent on parent.id = position.parent_member_id
  left join public.profiles sponsor on sponsor.id = member.sponsor_id
  where position.plan_id = p_plan_id;
  return result;
end;
$$;
revoke all on function public.admin_get_matrix_explorer(text) from public, anon;
grant execute on function public.admin_get_matrix_explorer(text) to authenticated;
