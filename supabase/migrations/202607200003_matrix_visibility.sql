-- Privacy-safe matrix explorer RPC.
-- Authenticated members may inspect only their own node and descendants. The
-- result intentionally excludes email, phone, wallet, payout, and balance data.

create or replace function public.matrix_stage_for(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_exit smallint;
  selected_status text;
begin
  select r.exit_number
  into selected_exit
  from public.matrix_exit_rules r
  where (
    select count(*)
    from public.matrix_positions child_position
    where child_position.parent_member_id = p_member_id
      and coalesce((
        select max(action.exit_number)
        from public.exit_actions action
        where action.member_id = child_position.member_id
          and action.status = 'approved'
      ), 0) >= r.required_downline_exit
  ) >= 3
  order by r.exit_number desc
  limit 1;

  if selected_exit is null then
    return jsonb_build_object('label', 'Entry', 'status', 'active', 'exit', 0);
  end if;

  select case action.status::text
    when 'approved' then 'active'
    when 'pending' then 'pending'
    else 'qualified'
  end
  into selected_status
  from public.exit_actions action
  where action.member_id = p_member_id
    and action.exit_number = selected_exit
    and action.status in ('pending', 'approved')
  order by case action.status when 'approved' then 1 else 2 end
  limit 1;

  selected_status := coalesce(selected_status, 'qualified');
  return jsonb_build_object(
    'label', 'Exit ' || selected_exit,
    'status', selected_status,
    'exit', selected_exit
  );
end;
$$;

revoke all on function public.matrix_stage_for(uuid) from public, anon, authenticated;

create or replace function public.get_matrix_level(p_root_member_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  root_id uuid := coalesce(p_root_member_id, auth.uid());
  result jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.is_admin() and not exists (
    with recursive descendants(member_id) as (
      select caller_id
      union all
      select child.member_id
      from public.matrix_positions child
      join descendants parent on child.parent_member_id = parent.member_id
    )
    select 1 from descendants where member_id = root_id
  ) then
    raise exception 'You may only view your own matrix descendants.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', root_profile.id,
    'fullName', root_profile.full_name,
    'username', root_profile.username,
    'accountCode', root_profile.account_code,
    'planId', root_position.plan_id,
    'matrixStage', public.matrix_stage_for(root_profile.id),
    'children', coalesce((
      select jsonb_agg(child_record.data order by child_record.sort_time, child_record.sort_name)
      from (
        select
          child_position.placed_at as sort_time,
          child_profile.full_name as sort_name,
          jsonb_build_object(
            'id', child_profile.id,
            'fullName', child_profile.full_name,
            'username', child_profile.username,
            'accountCode', child_profile.account_code,
            'matrixStage', public.matrix_stage_for(child_profile.id),
            'isReferralPending', false
          ) as data
        from public.matrix_positions child_position
        join public.profiles child_profile on child_profile.id = child_position.member_id
        where child_position.parent_member_id = root_profile.id
          and child_position.plan_id = root_position.plan_id

        union all

        select
          referred.created_at as sort_time,
          referred.full_name as sort_name,
          jsonb_build_object(
            'id', referred.id,
            'fullName', referred.full_name,
            'username', referred.username,
            'accountCode', referred.account_code,
            'matrixStage', jsonb_build_object('label', 'Registered', 'status', 'registered', 'exit', 0),
            'isReferralPending', true
          ) as data
        from public.profiles referred
        where referred.sponsor_id = root_profile.id
          and not exists (
            select 1 from public.matrix_positions positioned
            where positioned.member_id = referred.id
          )
      ) child_record
    ), '[]'::jsonb)
  )
  into result
  from public.profiles root_profile
  join public.matrix_positions root_position on root_position.member_id = root_profile.id
  where root_profile.id = root_id;

  if result is null then
    raise exception 'The requested member is not placed in the matrix.';
  end if;

  return result;
end;
$$;

revoke all on function public.get_matrix_level(uuid) from public, anon;
grant execute on function public.get_matrix_level(uuid) to authenticated;
