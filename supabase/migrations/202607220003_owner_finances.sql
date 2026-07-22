-- Owner-only financial overview. Values are operational totals, not formal accounting statements.
create or replace function public.owner_get_finance_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_owner() then raise exception 'Only the Owner can view organization finances.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generatedAt', now(),
    'members', jsonb_build_object(
      'registered', (select count(*) from public.profiles),
      'active', (select count(*) from public.profiles where status='active')
    ),
    'entry', jsonb_build_object(
      'approvedCount', (select count(*) from public.upgrade_requests where status='approved'),
      'cashReceived', (select coalesce(sum(amount),0) from public.upgrade_requests where status='approved'),
      'pendingAmount', (select coalesce(sum(amount),0) from public.upgrade_requests where status='pending'),
      'tokenHoldingAllocation', (select count(*) * 900 from public.upgrade_requests where status='approved'),
      'matrixAllocation', (select count(*) * 300 from public.upgrade_requests where status='approved'),
      'cashExitEntitlement', (select coalesce(sum(amount),0) from public.reward_ledger where status <> 'void' and source_type='entry')
    ),
    'exits', jsonb_build_object(
      'approvedCount', (select count(*) from public.exit_actions where status='approved'),
      'externalPayments', (select coalesce(sum(action_amount),0) from public.exit_actions where status='approved' and coalesce(payment_method,'') <> 'available_balance'),
      'balanceReinvestments', (select coalesce(sum(action_amount),0) from public.exit_actions where status='approved' and payment_method='available_balance'),
      'pendingExternalPayments', (select coalesce(sum(action_amount),0) from public.exit_actions where status='pending' and coalesce(payment_method,'') <> 'available_balance')
    ),
    'rewards', jsonb_build_object(
      'totalScheduled', (select coalesce(sum(amount),0) from public.reward_ledger where status <> 'void'),
      'entryScheduled', (select coalesce(sum(amount),0) from public.reward_ledger where status <> 'void' and source_type='entry'),
      'exitPassiveScheduled', (select coalesce(sum(amount),0) from public.reward_ledger where status <> 'void' and source_type='exit'),
      'matrixScheduled', (select coalesce(sum(amount),0) from public.reward_ledger where status <> 'void' and source_type='matrix'),
      'settledOrReinvested', (select coalesce(sum(withdrawn_amount),0) from public.reward_ledger where status <> 'void'),
      'outstandingDue', (select coalesce(sum(greatest(amount-withdrawn_amount,0)),0) from public.reward_ledger where status <> 'void' and due_at <= now()),
      'outstandingFuture', (select coalesce(sum(greatest(amount-withdrawn_amount,0)),0) from public.reward_ledger where status <> 'void' and due_at > now())
    ),
    'withdrawals', jsonb_build_object(
      'approvedPaid', (select coalesce(sum(amount),0) from public.withdrawal_requests where status='approved'),
      'pending', (select coalesce(sum(amount),0) from public.withdrawal_requests where status='pending'),
      'rejected', (select coalesce(sum(amount),0) from public.withdrawal_requests where status='rejected')
    ),
    'productsPlus', jsonb_build_object(
      'configuredProductAllocation', (select coalesce(sum(rule.product_spend * rule.product_months),0) from public.exit_actions action join public.matrix_exit_rules rule on rule.exit_number=action.exit_number where action.status='approved'),
      'configuredMaximumVoucherBonus', (select coalesce(sum(rule.product_spend * rule.product_months * rule.product_bonus_percent / 100),0) from public.exit_actions action join public.matrix_exit_rules rule on rule.exit_number=action.exit_number where action.status='approved'),
      'approvedPurchaseAmount', (select coalesce(sum(spend_amount),0) from public.product_plus_claims where status='approved'),
      'pendingPurchaseAmount', (select coalesce(sum(spend_amount),0) from public.product_plus_claims where status='pending'),
      'voucherAllocated', (select coalesce(sum(amount),0) from public.voucher_ledger where entry_type='credit'),
      'voucherRedeemed', (select coalesce(-sum(amount),0) from public.voucher_ledger where entry_type='redemption'),
      'voucherOutstanding', (select coalesce(sum(amount),0) from public.voucher_ledger)
    ),
    'cash', jsonb_build_object(
      'grossExternalInflows', (select coalesce(sum(amount),0) from public.upgrade_requests where status='approved') + (select coalesce(sum(action_amount),0) from public.exit_actions where status='approved' and coalesce(payment_method,'') <> 'available_balance'),
      'approvedCashWithdrawals', (select coalesce(sum(amount),0) from public.withdrawal_requests where status='approved')
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.owner_get_finance_summary() from public, anon;
grant execute on function public.owner_get_finance_summary() to authenticated;
