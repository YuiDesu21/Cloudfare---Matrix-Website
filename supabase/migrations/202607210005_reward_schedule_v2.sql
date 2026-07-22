-- Updated plan values, calculated Products Plus bonuses, and monthly Matrix Income.

alter table public.matrix_exit_rules add column if not exists matrix_income numeric(12,2) not null default 0;
alter table public.matrix_exit_rules add column if not exists matrix_months integer not null default 0;
alter table public.reward_ledger drop constraint if exists reward_ledger_source_type_check;
alter table public.reward_ledger add constraint reward_ledger_source_type_check check (source_type in ('entry', 'exit', 'matrix'));

update public.upgrade_requests set amount = 1200 where status = 'pending';

create or replace function public.request_entry_activation(p_reference_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles%rowtype; normalized_reference text := upper(trim(p_reference_number));
  created_request public.upgrade_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile not found.'; end if;
  if caller.status = 'active' then raise exception 'Entry is already active.'; end if;
  if normalized_reference !~ '^[A-Z0-9-]{6,40}$' then raise exception 'Enter a valid GCash reference number.'; end if;
  if exists (select 1 from public.upgrade_requests where reference_number = normalized_reference) then raise exception 'This reference number is already in use.'; end if;
  if exists (select 1 from public.upgrade_requests where member_id = caller.id and status = 'pending') then raise exception 'You already have a pending Entry request.'; end if;
  insert into public.upgrade_requests (member_id, plan_id, amount, reference_number)
  values (caller.id, 'power3-passive', 1200, normalized_reference) returning * into created_request;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (caller.id, 'upgrade-request', caller.full_name || ' requested Entry activation.', jsonb_build_object('requestId', created_request.id));
  return to_jsonb(created_request);
end; $$;
revoke all on function public.request_entry_activation(text) from public, anon;
grant execute on function public.request_entry_activation(text) to authenticated;

update public.matrix_exit_rules rule set
  action_label = values.action_label, action_amount = values.action_amount,
  passive_income = values.passive_income, passive_months = 3,
  product_spend = values.product_spend, product_bonus_percent = values.product_bonus_percent,
  product_months = values.product_months, matrix_income = values.matrix_income, matrix_months = values.matrix_months
from (values
  (1, 'Re-Stake F3-900', 900::numeric, 297::numeric, 0::numeric, 0::numeric, 0, 100::numeric, 3),
  (2, 'Buy 1K', 1000, 330, 1020, 15, 2, 225, 3),
  (3, 'Re-Stake 1K', 1000, 330, 1687, 20, 2, 236, 4),
  (4, 'Buy 1.5K', 1500, 495, 1260, 25, 3, 243, 5),
  (5, 'Re-Stake 1.5K F3', 1500, 495, 1012, 30, 4, 405, 6),
  (6, 'Buy 3K', 3000, 990, 1388, 35, 5, 510, 10),
  (7, 'Re-Stake 3K', 3000, 1003, 1275, 40, 10, 729, 15),
  (8, 'Buy 5K', 5000, 1650, 1620, 45, 15, 1312, 20),
  (9, 'Re-Stake 5K F3', 5000, 2310, 1312, 50, 40, 2624, 30),
  (10, 'Buy 10K', 10000, 4620, 1908, 55, 75, 3936, 45),
  (11, 'Re-Stake 10K F3', 10000, 5049, 1968, 60, 150, 4723, 75),
  (12, 'Buy 20K', 20000, 11550, 2180, 65, 250, 7085, 150),
  (13, 'Re-Stake 20K F3', 20000, 11880, 4338, 70, 350, 9110, 350)
) as values(exit_number, action_label, action_amount, passive_income, product_spend, product_bonus_percent, product_months, matrix_income, matrix_months)
where rule.exit_number = values.exit_number;

create or replace function public.admin_approve_exit(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.exit_actions%rowtype; rule public.matrix_exit_rules%rowtype;
  member_name text; approval_time timestamptz := now(); ledger_row record;
  remaining numeric; applied numeric; due_balance numeric; other_reserved numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select * into target from public.exit_actions where id = p_request_id for update;
  if target.id is null or target.status <> 'pending' then raise exception 'Exit request is no longer pending.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.member_id::text, 0));
  select * into rule from public.matrix_exit_rules where exit_number = target.exit_number;
  select full_name into member_name from public.profiles where id = target.member_id;

  if target.payment_method = 'available_balance' then
    select coalesce(sum(greatest(amount - withdrawn_amount, 0)), 0) into due_balance
    from public.reward_ledger where member_id = target.member_id and status = 'due' and due_at <= approval_time;
    select
      coalesce((select sum(amount) from public.withdrawal_requests where member_id = target.member_id and status = 'pending'), 0) +
      coalesce((select sum(action_amount) from public.exit_actions where member_id = target.member_id and status = 'pending' and payment_method = 'available_balance' and id <> target.id), 0)
    into other_reserved;
    if due_balance - other_reserved < target.action_amount then raise exception 'Not enough available balance.'; end if;
    remaining := target.action_amount;
    for ledger_row in
      select id, amount, withdrawn_amount from public.reward_ledger
      where member_id = target.member_id and status = 'due' and due_at <= approval_time order by due_at for update
    loop
      exit when remaining <= 0;
      applied := least(greatest(ledger_row.amount - ledger_row.withdrawn_amount, 0), remaining);
      if applied > 0 then
        update public.reward_ledger set withdrawn_amount = withdrawn_amount + applied,
          status = case when withdrawn_amount + applied >= amount then 'paid'::public.ledger_status else status end,
          paid_at = case when withdrawn_amount + applied >= amount then approval_time else paid_at end
        where id = ledger_row.id;
        remaining := remaining - applied;
      end if;
    end loop;
  end if;

  update public.exit_actions set status = 'approved', approved_at = approval_time where id = target.id;
  if not exists (select 1 from public.reward_ledger where member_id = target.member_id and source_type = 'exit' and exit_number = target.exit_number) then
    insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
    select target.member_id, 'exit', 'Exit ' || target.exit_number || ' Passive Income', target.exit_number, rule.passive_income,
      date_trunc('month', approval_time) + (months.month_number + 1) * interval '1 month' - interval '1 second', 'due', approval_time
    from generate_series(1, rule.passive_months) as months(month_number);
  end if;
  if rule.matrix_income > 0 and not exists (select 1 from public.reward_ledger where member_id = target.member_id and source_type = 'matrix' and exit_number = target.exit_number) then
    insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
    select target.member_id, 'matrix', 'Exit ' || target.exit_number || ' Matrix Income', target.exit_number, rule.matrix_income,
      date_trunc('month', approval_time) + (months.month_number + 1) * interval '1 month' - interval '1 second', 'due', approval_time
    from generate_series(1, rule.matrix_months) as months(month_number);
  end if;
  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (auth.uid(), 'exit-approval', 'Approved Exit ' || target.exit_number || ' for ' || member_name || '.', jsonb_build_object('requestId', target.id, 'memberId', target.member_id, 'exit', target.exit_number));
  return jsonb_build_object('id', target.id, 'status', 'approved', 'memberId', target.member_id, 'exit', target.exit_number);
end; $$;

revoke all on function public.admin_approve_exit(uuid) from public, anon;
grant execute on function public.admin_approve_exit(uuid) to authenticated;

create or replace function public.get_my_reward_schedule()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(rule.exit_number::text, jsonb_build_object(
    'productSpend', rule.product_spend,
    'productBonusPercent', rule.product_bonus_percent,
    'productMonths', rule.product_months,
    'matrixIncome', rule.matrix_income,
    'matrixMonths', rule.matrix_months
  )), '{}'::jsonb)
  from public.matrix_exit_rules rule;
$$;
revoke all on function public.get_my_reward_schedule() from public, anon;
grant execute on function public.get_my_reward_schedule() to authenticated;

-- Backfill Matrix Income for Exits that were approved before this schedule update.
insert into public.reward_ledger (member_id, source_type, source_label, exit_number, amount, due_at, status, created_at)
select action.member_id, 'matrix', 'Exit ' || action.exit_number || ' Matrix Income', action.exit_number, rule.matrix_income,
  date_trunc('month', action.approved_at) + (months.month_number + 1) * interval '1 month' - interval '1 second', 'due', action.approved_at
from public.exit_actions action
join public.matrix_exit_rules rule on rule.exit_number = action.exit_number
cross join lateral generate_series(1, rule.matrix_months) as months(month_number)
where action.status = 'approved' and rule.matrix_income > 0
  and not exists (select 1 from public.reward_ledger existing where existing.member_id = action.member_id and existing.source_type = 'matrix' and existing.exit_number = action.exit_number);
