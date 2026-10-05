-- Apply the owner-only self-review exception to the new payment workflows.
create trigger prevent_self_review_main_topup
  before update of status on public.member_fund_topups
  for each row execute function public.prevent_self_review();

create trigger prevent_self_review_budget_token
  before update of status on public.budget_plan_token_requests
  for each row execute function public.prevent_self_review();

-- Approval checks must cover every payment workflow, including the older ones.
-- VOLATILE ensures a waiting approval sees payments committed by the first reviewer.
alter function public.approved_payment_reference_used(text) volatile;

create function public.prevent_reused_payment_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized_reference text;
begin
  if new.status::text <> 'approved' or old.status::text = 'approved' then
    return new;
  end if;

  normalized_reference := upper(trim(new.reference_number));
  perform pg_advisory_xact_lock(hashtextextended('payment-ref-' || normalized_reference, 0));
  if public.approved_payment_reference_used(normalized_reference) then
    raise exception 'This payment reference was already approved for another request.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger prevent_reused_main_topup_reference
  before update of status on public.member_fund_topups
  for each row execute function public.prevent_reused_payment_reference();

create trigger prevent_reused_budget_token_reference
  before update of status on public.budget_plan_token_requests
  for each row execute function public.prevent_reused_payment_reference();

create trigger prevent_reused_commerce_reference
  before update of status on public.commerce_order_payments
  for each row execute function public.prevent_reused_payment_reference();

create trigger prevent_reused_patronizing_reference
  before update of status on public.patronizing_token_requests
  for each row execute function public.prevent_reused_payment_reference();

revoke all on function public.prevent_reused_payment_reference() from public, anon, authenticated;
