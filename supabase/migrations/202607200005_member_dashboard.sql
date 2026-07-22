-- Authenticated member dashboard bundle. Returns only the caller's financial
-- data and aggregate downline counts; private descendant fields are excluded.

create or replace function public.get_my_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select profile.*
    from public.profiles profile
    where profile.id = auth.uid()
  ), exit_statuses as (
    select
      rule.*,
      (
        select count(*)
        from public.matrix_positions child
        where child.parent_member_id = auth.uid()
          and coalesce((
            select max(action.exit_number)
            from public.exit_actions action
            where action.member_id = child.member_id and action.status = 'approved'
          ), 0) >= rule.required_downline_exit
      )::integer as qualified_downlines,
      (
        select action.status::text
        from public.exit_actions action
        where action.member_id = auth.uid() and action.exit_number = rule.exit_number
          and action.status in ('pending', 'approved')
        order by case action.status when 'approved' then 1 else 2 end
        limit 1
      ) as action_status,
      (
        select action.approved_at
        from public.exit_actions action
        where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'approved'
        limit 1
      ) as approved_at,
      (
        select action.created_at
        from public.exit_actions action
        where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'pending'
        limit 1
      ) as requested_at
    from public.matrix_exit_rules rule
  ), balances as (
    select
      coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (
        where ledger.status = 'due' and ledger.due_at <= now()
      ), 0) as earned,
      coalesce((
        select sum(request.amount) from public.withdrawal_requests request
        where request.member_id = auth.uid() and request.status = 'pending'
      ), 0) as pending
    from public.reward_ledger ledger
    where ledger.member_id = auth.uid()
  )
  select jsonb_build_object(
    'member', (select jsonb_build_object(
      'id', caller.id,
      'accountCode', caller.account_code,
      'fullName', caller.full_name,
      'username', caller.username,
      'email', caller.email,
      'phone', caller.phone,
      'walletAddress', caller.wallet_address,
      'sponsorId', caller.sponsor_id,
      'status', caller.status,
      'cumulativeF3Tokens', caller.cumulative_f3_tokens,
      'createdAt', caller.created_at,
      'approvedAt', caller.approved_at
    ) from caller),
    'isAdmin', public.is_admin(),
    'referralCount', (select count(*) from public.profiles where sponsor_id = auth.uid()),
    'directChildrenCount', (select count(*) from public.matrix_positions where parent_member_id = auth.uid()),
    'position', (select jsonb_build_object(
      'id', position.id,
      'memberId', position.member_id,
      'planId', position.plan_id,
      'parentMemberId', position.parent_member_id,
      'placedAt', position.placed_at
    ) from public.matrix_positions position where position.member_id = auth.uid()),
    'rules', jsonb_build_object(
      'programName', 'Matrix Power of Three Passive Income',
      'matrixId', 'power3-passive',
      'matrixName', 'Power of Three Passive Income',
      'maxDirectDownlines', 3,
      'entry', jsonb_build_object(
        'name', 'Entry', 'holdF3', 20, 'holdPesoValue', 1200,
        'passiveIncome', 231, 'passiveMonths', 3
      )
    ),
    'exits', coalesce((select jsonb_agg(jsonb_build_object(
      'exit', status.exit_number,
      'requirementRank', status.requirement_rank,
      'requiredDownlineExit', status.required_downline_exit,
      'actionType', status.action_type,
      'actionLabel', status.action_label,
      'actionAmount', status.action_amount,
      'passiveIncome', status.passive_income,
      'passiveMonths', status.passive_months,
      'productSpend', status.product_spend,
      'productBonusPercent', status.product_bonus_percent,
      'productMonths', status.product_months,
      'qualifiedDownlines', status.qualified_downlines,
      'requiredDownlines', 3,
      'status', case
        when status.action_status = 'approved' then 'active'
        when status.action_status = 'pending' then 'pending'
        when status.qualified_downlines >= 3 then 'qualified'
        else 'locked'
      end,
      'approvedAt', status.approved_at,
      'requestedAt', status.requested_at
    ) order by status.exit_number) from exit_statuses status), '[]'::jsonb),
    'rewardLedger', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ledger.id,
      'memberId', ledger.member_id,
      'sourceType', ledger.source_type,
      'sourceLabel', ledger.source_label,
      'exit', ledger.exit_number,
      'amount', ledger.amount,
      'withdrawnAmount', ledger.withdrawn_amount,
      'dueAt', ledger.due_at,
      'status', ledger.status,
      'paidAt', ledger.paid_at
    ) order by ledger.due_at) from public.reward_ledger ledger where ledger.member_id = auth.uid()), '[]'::jsonb),
    'earnedBalance', (select earned from balances),
    'pendingWithdrawal', (select pending from balances),
    'productPlusClaims', coalesce((select jsonb_agg(to_jsonb(claim)) from public.product_plus_claims claim where claim.member_id = auth.uid()), '[]'::jsonb),
    'productPlusEntitlements', '[]'::jsonb
  );
$$;

revoke all on function public.get_my_dashboard() from public, anon;
grant execute on function public.get_my_dashboard() to authenticated;

-- Seed the standard three Entry ledger months for the bootstrapped owner once.
insert into public.reward_ledger (
  member_id, source_type, source_label, amount, due_at, status, created_at
)
select
  profile.id,
  'entry',
  'Entry Passive Income',
  231,
  coalesce(profile.approved_at, now()) + series.month_number * interval '1 month',
  'due',
  now()
from public.profiles profile
cross join generate_series(1, 3) as series(month_number)
where lower(profile.email) = lower('juneljameslariba@gmail.com')
  and not exists (
    select 1 from public.reward_ledger existing
    where existing.member_id = profile.id and existing.source_type = 'entry'
  );
