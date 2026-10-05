create or replace function public.admin_get_matrix_explorer(p_plan_id text default 'power3-passive')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_plan_id not in ('power3-passive', 'timeline-power3', 'patronizing-income', 'budget-plan') then
    raise exception 'Invalid matrix plan.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.id, 'memberId', member.id,
    'accountCode', member.account_code, 'fullName', member.full_name,
    'username', member.username, 'walletAddress', member.wallet_address,
    'planId', position.plan_id, 'parentMemberId', position.parent_member_id,
    'placedAt', position.placed_at,
    'directChildrenCount', (select count(*) from public.matrix_positions child
      where child.parent_member_id = member.id and child.plan_id = p_plan_id),
    'matrixStage', case
      when p_plan_id = 'timeline-power3' then jsonb_build_object('label',
        case when public.timeline_exit_for(member.id) > 0 then 'Exit ' || public.timeline_exit_for(member.id) else 'Entry' end,
        'status', 'active', 'exit', public.timeline_exit_for(member.id))
      when p_plan_id = 'patronizing-income' then jsonb_build_object('label',
        case when public.patronizing_exit_for(member.id) > 0 then 'Exit ' || public.patronizing_exit_for(member.id) else 'Entry' end,
        'status', 'active', 'exit', public.patronizing_exit_for(member.id))
      when p_plan_id = 'budget-plan' then jsonb_build_object('label',
        (select rank_name from public.budget_plan_rank_rules
          where rank_number = public.budget_plan_rank_for(member.id)),
        'status', 'active', 'exit', public.budget_plan_rank_for(member.id))
      else public.matrix_stage_for(member.id)
    end,
    'parentName', parent.full_name, 'parentUsername', parent.username
  ) order by position.parent_member_id nulls first, position.placed_at, position.id), '[]'::jsonb)
  into result
  from public.matrix_positions position
  join public.profiles member on member.id = position.member_id
  left join public.profiles parent on parent.id = position.parent_member_id
  where position.plan_id = p_plan_id;
  return result;
end;
$$;
