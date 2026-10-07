-- Investment approval follows the same Owner-only self-review exception as payments.
create trigger prevent_self_review_budget_investment
  before update of status on public.budget_investment_requests
  for each row execute function public.prevent_self_review();
