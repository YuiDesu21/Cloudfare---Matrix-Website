create or replace function public.get_my_budget_plan_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with credit as (
    select public.budget_plan_qualification_total(auth.uid()) as total
  ), position as (
    select * from public.matrix_positions
    where member_id = auth.uid() and plan_id = 'budget-plan'
  )
  select jsonb_build_object(
    'isActive', exists(select 1 from position),
    'position', (select jsonb_build_object('id', id, 'parentMemberId', parent_member_id,
      'placedAt', placed_at) from position),
    'rank', public.budget_plan_rank_for(auth.uid()),
    'qualificationValue', (select total from credit),
    'entryCredit', least((select total from credit), 150),
    'investmentCredit', least(greatest((select total from credit) - 150, 0), 300),
    'canInvest', public.budget_plan_rank_for(auth.uid()) >= 1
      and (select total from credit) >= 450,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
      'rank', rule.rank_number, 'name', rule.rank_name,
      'monthlyPassive', rule.monthly_passive, 'passiveMonths', rule.passive_months,
      'investmentAmount', rule.investment_amount,
      'investmentMonths', rule.investment_months,
      'contractMonths', rule.contract_months,
      'reachedAt', progress.reached_at
    ) order by rule.rank_number), '[]'::jsonb)
    from public.budget_plan_rank_rules rule
    left join public.budget_plan_rank_progress progress
      on progress.member_id = auth.uid() and progress.rank_number = rule.rank_number),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object(
      'orderId', credit.order_id, 'category', credit.category,
      'productAmount', credit.product_amount,
      'qualificationCredit', credit.qualification_credit,
      'creditedAt', credit.credited_at
    ) order by credit.credited_at desc), '[]'::jsonb)
    from public.budget_plan_purchase_credits credit where credit.member_id = auth.uid()),
    'passiveIncome', (select coalesce(jsonb_agg(jsonb_build_object(
      'amount', income.amount, 'transferredAmount', income.transferred_amount,
      'sourceLabel', 'Budget Plan ' || rule.rank_name,
      'dueAt', income.due_at,
      'status', case when income.due_at > now() then 'scheduled'
        when income.transferred_amount >= income.amount then 'transferred' else 'available' end
    ) order by income.due_at), '[]'::jsonb)
    from public.budget_plan_passive_income income
    join public.budget_plan_rank_rules rule on rule.rank_number = income.rank_number
    where income.member_id = auth.uid())
  );
$$;
