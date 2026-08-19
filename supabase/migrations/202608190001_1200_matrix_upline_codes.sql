-- Move 1200 Matrix placement from account signup referrals to entry-time upline codes.

alter table public.profiles
  add column if not exists matrix_upline_code text unique;

alter table public.upgrade_requests
  add column if not exists matrix_upline_member_id uuid references public.profiles(id) on delete restrict,
  add column if not exists matrix_upline_code text;

alter table public.commerce_orders
  add column if not exists matrix_upline_member_id uuid references public.profiles(id) on delete restrict,
  add column if not exists matrix_upline_code text;

drop function if exists public.request_entry_activation(text);
drop function if exists public.request_commerce_order(uuid, uuid, text);

create index if not exists upgrade_requests_matrix_upline_idx
  on public.upgrade_requests(matrix_upline_member_id);

create index if not exists commerce_orders_matrix_upline_idx
  on public.commerce_orders(matrix_upline_member_id);

create or replace function public.generate_1200_matrix_upline_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := 'M1200-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.profiles profile
      where upper(profile.matrix_upline_code) = candidate
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.ensure_1200_matrix_upline_code(p_member_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_code text;
  candidate text;
begin
  select profile.matrix_upline_code into existing_code
  from public.profiles profile
  where profile.id = p_member_id
  for update;

  if existing_code is not null and trim(existing_code) <> '' then
    return existing_code;
  end if;

  loop
    candidate := public.generate_1200_matrix_upline_code();
    begin
      update public.profiles
      set matrix_upline_code = candidate
      where id = p_member_id
      returning matrix_upline_code into existing_code;
      return existing_code;
    exception when unique_violation then
      -- Rare collision; try another code.
    end;
  end loop;
end;
$$;

do $$
declare
  profile_row record;
begin
  for profile_row in
    select id
    from public.profiles
    where matrix_upline_code is null or trim(matrix_upline_code) = ''
    order by created_at, id
  loop
    perform public.ensure_1200_matrix_upline_code(profile_row.id);
  end loop;
end;
$$;

create or replace function public.resolve_1200_matrix_upline(
  p_code text,
  p_member_id uuid default auth.uid()
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(trim(coalesce(p_code, '')));
  target public.profiles%rowtype;
  direct_count integer;
begin
  if normalized_code = '' then
    raise exception 'Enter a 1200 Matrix upline code before requesting entry.' using errcode = '22023';
  end if;

  select * into target
  from public.profiles profile
  where upper(profile.matrix_upline_code) = normalized_code
  limit 1;

  if target.id is null then
    raise exception '1200 Matrix upline code was not found.' using errcode = 'P0002';
  end if;

  if target.id = p_member_id then
    raise exception 'Use a teammate''s 1200 Matrix upline code, not your own.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.matrix_positions position
    where position.member_id = target.id
      and position.plan_id = 'power3-passive'
  ) then
    raise exception 'This code belongs to a member who is not active in the 1200 Matrix yet.' using errcode = '22023';
  end if;

  select count(*)::integer into direct_count
  from public.matrix_positions child
  where child.parent_member_id = target.id
    and child.plan_id = 'power3-passive';

  if direct_count >= 3 then
    raise exception 'This upline already has 3 direct 1200 Matrix downlines. Ask the team for another open code.' using errcode = '22023';
  end if;

  return target.id;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_code text;
  generated_upline_code text;
begin
  generated_code := 'MCS-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  generated_upline_code := public.generate_1200_matrix_upline_code();

  insert into public.profiles (
    id, account_code, matrix_upline_code, full_name, username, email, phone, wallet_address,
    sponsor_id, status, cumulative_f3_tokens
  ) values (
    new.id,
    generated_code,
    generated_upline_code,
    trim(new.raw_user_meta_data ->> 'full_name'),
    trim(new.raw_user_meta_data ->> 'username'),
    coalesce(new.email, ''),
    trim(new.raw_user_meta_data ->> 'phone'),
    trim(new.raw_user_meta_data ->> 'wallet_address'),
    null,
    'registered',
    0
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.get_my_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (select profile.* from public.profiles profile where profile.id = auth.uid()),
  exit_statuses as (
    select rule.*,
      (select count(*) from public.matrix_positions child where child.parent_member_id = auth.uid() and child.plan_id = 'power3-passive' and coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = child.member_id and action.status = 'approved'), 0) >= rule.required_downline_exit)::integer as qualified_downlines,
      (select action.status::text from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status in ('pending','approved') order by case action.status when 'approved' then 1 else 2 end limit 1) as action_status,
      (select action.approved_at from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'approved' limit 1) as approved_at,
      (select action.created_at from public.exit_actions action where action.member_id = auth.uid() and action.exit_number = rule.exit_number and action.status = 'pending' limit 1) as requested_at
    from public.matrix_exit_rules rule
  ), balances as (
    select coalesce(sum(greatest(ledger.amount - ledger.withdrawn_amount, 0)) filter (where ledger.status = 'due' and ledger.due_at <= now()), 0) as earned,
      coalesce((select sum(request.amount) from public.withdrawal_requests request where request.member_id = auth.uid() and request.status = 'pending'), 0) as pending
    from public.reward_ledger ledger where ledger.member_id = auth.uid()
  ) select jsonb_build_object(
    'member', (select jsonb_build_object('id', caller.id, 'accountCode', caller.account_code, 'matrixUplineCode', caller.matrix_upline_code, 'fullName', caller.full_name, 'username', caller.username, 'email', caller.email, 'phone', caller.phone, 'walletAddress', caller.wallet_address, 'sponsorId', caller.sponsor_id, 'status', caller.status, 'cumulativeF3Tokens', caller.cumulative_f3_tokens, 'createdAt', caller.created_at, 'approvedAt', caller.approved_at) from caller),
    'isAdmin', public.is_admin(), 'referralCount', (select count(*) from public.matrix_positions where parent_member_id = auth.uid() and plan_id = 'power3-passive'),
    'directChildrenCount', (select count(*) from public.matrix_positions where parent_member_id = auth.uid() and plan_id = 'power3-passive'),
    'position', (select jsonb_build_object('id', position.id, 'memberId', position.member_id, 'planId', position.plan_id, 'parentMemberId', position.parent_member_id, 'placedAt', position.placed_at) from public.matrix_positions position where position.member_id = auth.uid() and position.plan_id = 'power3-passive'),
    'rules', jsonb_build_object('programName', 'Matrix Power of Three Passive Income', 'matrixId', 'power3-passive', 'matrixName', 'Power of Three Passive Income', 'maxDirectDownlines', 3, 'entry', jsonb_build_object('name', 'Entry', 'holdF3', 20, 'holdPesoValue', 1200, 'passiveIncome', 231, 'passiveMonths', 3)),
    'exits', coalesce((select jsonb_agg(jsonb_build_object('exit', status.exit_number, 'requirementRank', status.requirement_rank, 'requiredDownlineExit', status.required_downline_exit, 'actionType', status.action_type, 'actionLabel', status.action_label, 'actionAmount', status.action_amount, 'passiveIncome', status.passive_income, 'passiveMonths', status.passive_months, 'productSpend', status.product_spend, 'productBonusPercent', status.product_bonus_percent, 'productMonths', status.product_months, 'qualifiedDownlines', status.qualified_downlines, 'requiredDownlines', 3, 'status', case when status.action_status = 'approved' then 'active' when status.action_status = 'pending' then 'pending' when status.qualified_downlines >= 3 then 'qualified' else 'locked' end, 'approvedAt', status.approved_at, 'requestedAt', status.requested_at) order by status.exit_number) from exit_statuses status), '[]'::jsonb),
    'rewardLedger', coalesce((select jsonb_agg(jsonb_build_object('id', ledger.id, 'memberId', ledger.member_id, 'planId', ledger.plan_id, 'sourceType', ledger.source_type, 'sourceLabel', ledger.source_label, 'exit', ledger.exit_number, 'amount', ledger.amount, 'withdrawnAmount', ledger.withdrawn_amount, 'dueAt', ledger.due_at, 'status', ledger.status, 'paidAt', ledger.paid_at) order by ledger.due_at) from public.reward_ledger ledger where ledger.member_id = auth.uid()), '[]'::jsonb),
    'earnedBalance', (select earned from balances), 'pendingWithdrawal', (select pending from balances),
    'productPlusClaims', coalesce((select jsonb_agg(to_jsonb(claim)) from public.product_plus_claims claim where claim.member_id = auth.uid()), '[]'::jsonb), 'productPlusEntitlements', '[]'::jsonb
  );
$$;

create or replace function public.get_my_entry_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'planId', request.plan_id,
    'amount', request.amount, 'referenceNumber', request.reference_number,
    'matrixUplineMemberId', request.matrix_upline_member_id,
    'matrixUplineCode', request.matrix_upline_code,
    'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  from public.upgrade_requests request where request.member_id = auth.uid();
$$;

create or replace function public.request_entry_activation(
  p_reference_number text,
  p_matrix_upline_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  created_request public.upgrade_requests%rowtype;
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
  normalized_upline_code text := upper(trim(coalesce(p_matrix_upline_code, '')));
  resolved_upline uuid;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  select * into caller from public.profiles where id = auth.uid() for update;
  if caller.id is null then raise exception 'Member profile was not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.matrix_positions where member_id = caller.id and plan_id = 'power3-passive') then raise exception 'Your Entry is already active.'; end if;
  if normalized_reference !~ '^[A-Z0-9-]{6,40}$' then raise exception 'Reference number must be 6-40 letters, numbers, or hyphens.'; end if;
  if exists (select 1 from public.upgrade_requests where reference_number = normalized_reference) then raise exception 'This reference number is already in use.'; end if;
  if exists (select 1 from public.upgrade_requests where member_id = caller.id and status = 'pending') then raise exception 'You already have a pending Entry request.'; end if;

  resolved_upline := public.resolve_1200_matrix_upline(normalized_upline_code, caller.id);

  insert into public.upgrade_requests (member_id, plan_id, amount, reference_number, matrix_upline_member_id, matrix_upline_code)
  values (caller.id, 'power3-passive', 1200, normalized_reference, resolved_upline, normalized_upline_code)
  returning * into created_request;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (caller.id, 'upgrade-request', 'Requested Entry activation with a 1200 Matrix upline code.', jsonb_build_object('requestId', created_request.id, 'uplineMemberId', resolved_upline, 'uplineCode', normalized_upline_code));

  return public.get_my_entry_requests();
end;
$$;

create or replace function public.admin_get_entry_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code,
    'walletAddress', member.wallet_address,
    'referenceNumber', request.reference_number, 'amount', request.amount,
    'status', request.status, 'createdAt', request.created_at,
    'matrixUplineMemberId', upline.id, 'matrixUplineName', upline.full_name,
    'matrixUplineUsername', upline.username, 'matrixUplineCode', request.matrix_upline_code,
    'matrixUplineSlotsLeft', greatest(3 - coalesce(upline_counts.children_count, 0), 0),
    'sponsorId', null, 'sponsorName', null, 'sponsorCode', null
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.upgrade_requests request
  join public.profiles member on member.id = request.member_id
  left join public.profiles upline on upline.id = request.matrix_upline_member_id
  left join lateral (
    select count(*)::integer as children_count
    from public.matrix_positions child
    where child.parent_member_id = upline.id
      and child.plan_id = 'power3-passive'
  ) upline_counts on true;
  return result;
end;
$$;

create or replace function public.admin_approve_entry(p_request_id uuid, p_parent_member_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.upgrade_requests%rowtype;
  target_member public.profiles%rowtype;
  selected_parent uuid;
  approval_time timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

  select * into target_request from public.upgrade_requests where id = p_request_id for update;
  if target_request.id is null or target_request.status <> 'pending' then raise exception 'Entry request is no longer pending.'; end if;
  if target_request.plan_id <> 'power3-passive' then raise exception 'Unsupported Entry plan.'; end if;
  if target_request.matrix_upline_member_id is null or target_request.matrix_upline_code is null then
    raise exception 'This Entry request has no 1200 Matrix upline code. Ask the member to submit a new request.' using errcode = '22023';
  end if;

  select * into target_member from public.profiles where id = target_request.member_id for update;
  if target_member.status = 'active' then raise exception 'Member Entry is already active.'; end if;
  if exists (select 1 from public.matrix_positions where member_id = target_member.id and plan_id = 'power3-passive') then raise exception 'Member is already placed in this matrix.'; end if;

  selected_parent := public.resolve_1200_matrix_upline(target_request.matrix_upline_code, target_member.id);

  update public.profiles set status = 'active', approved_at = approval_time, cumulative_f3_tokens = 20 where id = target_member.id;
  insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
  values (target_member.id, 'power3-passive', selected_parent, approval_time);
  update public.upgrade_requests set status = 'approved', approved_at = approval_time where id = target_request.id;
  insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
  select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, approval_time + month_number * interval '1 month', 'due', approval_time
  from generate_series(1, 3) as months(month_number);
  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'upgrade-approval', 'Approved Entry for ' || target_member.full_name, jsonb_build_object('requestId', target_request.id, 'memberId', target_member.id, 'parentMemberId', selected_parent, 'uplineCode', target_request.matrix_upline_code));
  return jsonb_build_object('id', target_request.id, 'status', 'approved', 'memberId', target_member.id, 'parentMemberId', selected_parent);
end;
$$;

create or replace function public.commerce_order_json(p_order public.commerce_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'orderCode', p_order.order_code,
    'memberId', p_order.member_id,
    'packageId', p_order.package_id,
    'packageType', p_order.package_type,
    'packageTypeLabel', public.commerce_package_type_label(p_order.package_type),
    'packageSnapshot', p_order.package_snapshot,
    'shippingAddressId', p_order.shipping_address_id,
    'shippingAddressSnapshot', p_order.shipping_address_snapshot,
    'packageTotal', p_order.package_total,
    'shippingFee', p_order.shipping_fee,
    'voucherAmount', p_order.voucher_amount,
    'amountDue', p_order.amount_due,
    'status', p_order.status,
    'matrixUplineMemberId', p_order.matrix_upline_member_id,
    'matrixUplineCode', p_order.matrix_upline_code,
    'matrixUpline', (select jsonb_build_object('id', upline.id, 'fullName', upline.full_name, 'username', upline.username, 'accountCode', upline.account_code)
      from public.profiles upline where upline.id = p_order.matrix_upline_member_id),
    'memberNotes', p_order.member_notes,
    'adminNotes', p_order.admin_notes,
    'courierName', p_order.courier_name,
    'trackingNumber', p_order.tracking_number,
    'shippingNotes', p_order.shipping_notes,
    'latestPayment', (
      select public.commerce_order_payment_json(payment)
      from public.commerce_order_payments payment
      where payment.order_id = p_order.id
      order by payment.created_at desc
      limit 1
    ),
    'createdAt', p_order.created_at,
    'updatedAt', p_order.updated_at,
    'approvedAt', p_order.approved_at,
    'rejectedAt', p_order.rejected_at,
    'shippedAt', p_order.shipped_at,
    'receivedAt', p_order.received_at
  );
$$;

create or replace function public.request_commerce_order(
  p_package_id uuid,
  p_shipping_address_id uuid,
  p_member_notes text default '',
  p_matrix_upline_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package public.commerce_packages;
  address public.shipping_addresses;
  order_row public.commerce_orders;
  package_snapshot jsonb;
  address_snapshot jsonb;
  package_total numeric;
  current_voucher_balance numeric;
  reserved_voucher_balance numeric;
  normalized_upline_code text := upper(trim(coalesce(p_matrix_upline_code, '')));
  resolved_upline uuid;
begin
  if auth.uid() is null then raise exception 'Member authentication is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_member_notes, ''))) > 240 then raise exception 'Order notes must be 240 characters or fewer.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce-order-' || auth.uid()::text, 0));

  select * into package
  from public.commerce_packages
  where id = p_package_id
    and is_active = true;
  if package.id is null then raise exception 'Package is not available.' using errcode = 'P0002'; end if;

  select * into address
  from public.shipping_addresses
  where id = p_shipping_address_id
    and member_id = auth.uid();
  if address.id is null then raise exception 'Choose one of your saved shipping addresses.' using errcode = 'P0002'; end if;

  package_snapshot := public.commerce_package_json(package);
  package_total := coalesce((package_snapshot ->> 'totalPrice')::numeric, 0);
  if jsonb_array_length(coalesce(package_snapshot -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Package has no items yet.' using errcode = '22023';
  end if;
  if package_total <= 0 then raise exception 'Package total must be greater than zero.' using errcode = '22023'; end if;

  if exists (
    select 1
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.package_id = package.id
      and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then
    raise exception 'You already have an active order for this package.' using errcode = '23505';
  end if;

  if package.package_type = 'matrix_1200_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
    ) then
      raise exception 'Your PHP 1,200 Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.upgrade_requests
      where member_id = auth.uid()
        and plan_id = 'power3-passive'
        and status = 'pending'
    ) then
      raise exception 'You already have a pending PHP 1,200 Matrix entry request.' using errcode = '23505';
    end if;
    resolved_upline := public.resolve_1200_matrix_upline(normalized_upline_code, auth.uid());
  end if;

  if package.package_type = 'timeline_entry' then
    if exists (
      select 1 from public.matrix_positions
      where member_id = auth.uid()
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Your Timeline Matrix is already active.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.timeline_requests
      where member_id = auth.uid()
        and status = 'pending'
    ) then
      raise exception 'You already have a pending Timeline Matrix entry request.' using errcode = '23505';
    end if;
  end if;

  if package.package_type in ('matrix_1200_entry','timeline_entry') and exists (
    select 1
    from public.commerce_orders existing
    where existing.member_id = auth.uid()
      and existing.package_type = package.package_type
      and existing.status in ('pending_shipping_fee','approved_for_payment','payment_submitted','payment_approved','shipped')
  ) then
    raise exception 'You already have an active request for this entry type.' using errcode = '23505';
  end if;

  if package.package_type = 'product_plus_voucher' then
    select coalesce(sum(amount), 0) into current_voucher_balance
    from public.voucher_ledger
    where member_id = auth.uid();

    select coalesce(sum(voucher_amount), 0) into reserved_voucher_balance
    from public.commerce_orders
    where member_id = auth.uid()
      and package_type = 'product_plus_voucher'
      and status = 'pending_shipping_fee';

    if current_voucher_balance - reserved_voucher_balance < package_total then
      raise exception 'Voucher balance is not enough for this package.' using errcode = '22023';
    end if;
  end if;

  address_snapshot := public.shipping_address_json(address);

  insert into public.commerce_orders(
    order_code, member_id, package_id, package_type, package_snapshot,
    shipping_address_id, shipping_address_snapshot, package_total,
    voucher_amount, amount_due, member_notes, matrix_upline_member_id, matrix_upline_code
  )
  values (
    'ORD-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), package.id, package.package_type, package_snapshot,
    address.id, address_snapshot, package_total,
    case when package.package_type = 'product_plus_voucher' then package_total else 0 end,
    case when package.package_type = 'product_plus_voucher' then 0 else package_total end,
    trim(coalesce(p_member_notes, '')),
    resolved_upline,
    case when package.package_type = 'matrix_1200_entry' then normalized_upline_code else null end
  )
  returning * into order_row;

  insert into public.activity_logs(actor_id, event_type, message, metadata)
  values (auth.uid(), 'commerce-order-requested', 'Member requested a package order.', jsonb_build_object('orderId', order_row.id, 'orderCode', order_row.order_code, 'packageType', order_row.package_type, 'uplineMemberId', resolved_upline));

  return public.commerce_order_json(order_row);
end;
$$;

create or replace function public.apply_commerce_order_benefit(
  p_order public.commerce_orders,
  p_activation_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.profiles%rowtype;
  selected_parent uuid;
  voucher_credit numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;

  select * into target_member
  from public.profiles
  where id = p_order.member_id
  for update;

  if target_member.id is null then raise exception 'Order member not found.' using errcode = 'P0002'; end if;
  if target_member.status = 'suspended' then raise exception 'Suspended members cannot receive package benefits.' using errcode = '42501'; end if;

  if p_order.package_type = 'matrix_1200_entry' then
    perform pg_advisory_xact_lock(hashtextextended('power3-passive-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'power3-passive'
    ) then
      raise exception 'This member is already active in the PHP 1,200 Matrix.' using errcode = '22023';
    end if;

    if p_order.matrix_upline_code is null or p_order.matrix_upline_member_id is null then
      raise exception 'This order has no 1200 Matrix upline code. Ask the member to submit a new order request.' using errcode = '22023';
    end if;

    selected_parent := public.resolve_1200_matrix_upline(p_order.matrix_upline_code, target_member.id);

    update public.profiles
    set status = 'active',
        approved_at = coalesce(approved_at, p_activation_time),
        cumulative_f3_tokens = greatest(cumulative_f3_tokens, 20)
    where id = target_member.id;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'power3-passive', selected_parent, p_activation_time);

    insert into public.reward_ledger(member_id, plan_id, source_type, source_label, amount, due_at, status, created_at)
    select target_member.id, 'power3-passive', 'entry', 'Entry Passive Income', 231, p_activation_time + month_number * interval '1 month', 'due', p_activation_time
    from generate_series(1, 3) as months(month_number);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-main-matrix-activation', 'Activated PHP 1,200 Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent, 'uplineCode', p_order.matrix_upline_code));

    return jsonb_build_object('type', 'matrix_1200_entry', 'planId', 'power3-passive', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'timeline_entry' then
    perform pg_advisory_xact_lock(hashtextextended('timeline-power3-placement', 0));

    if exists (
      select 1 from public.matrix_positions
      where member_id = target_member.id
        and plan_id = 'timeline-power3'
    ) then
      raise exception 'Timeline Matrix is already active for this account.' using errcode = '22023';
    end if;

    select position.member_id into selected_parent
    from public.matrix_positions position
    where position.plan_id = 'timeline-power3'
      and (
        select count(*)
        from public.matrix_positions child
        where child.plan_id = 'timeline-power3'
          and child.parent_member_id = position.member_id
      ) < 3
    order by position.placed_at, position.id
    limit 1;

    insert into public.matrix_positions(member_id, plan_id, parent_member_id, placed_at)
    values (target_member.id, 'timeline-power3', selected_parent, p_activation_time);

    perform public.refresh_timeline_ancestor_progress(target_member.id);

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-timeline-activation', 'Activated Timeline Matrix from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'parentMemberId', selected_parent));

    return jsonb_build_object('type', 'timeline_entry', 'planId', 'timeline-power3', 'parentMemberId', selected_parent);
  end if;

  if p_order.package_type = 'product_plus_requirement' then
    voucher_credit := round(p_order.package_total, 2);
    if voucher_credit <= 0 then raise exception 'Product Plus voucher credit must be greater than zero.' using errcode = '22023'; end if;

    if not exists (
      select 1 from public.voucher_ledger
      where commerce_order_id = p_order.id
        and entry_type = 'credit'
    ) then
      insert into public.voucher_ledger(member_id, commerce_order_id, entry_type, amount, reference, notes, created_by)
      values (target_member.id, p_order.id, 'credit', voucher_credit, p_order.order_code, 'Product Plus package purchase completed', auth.uid());
    end if;

    insert into public.activity_logs(actor_id, event_type, message, metadata)
    values (auth.uid(), 'commerce-product-plus-credit', 'Credited Product Plus vouchers from package order.', jsonb_build_object('orderId', p_order.id, 'orderCode', p_order.order_code, 'memberId', target_member.id, 'voucherCredit', voucher_credit));

    return jsonb_build_object('type', 'product_plus_requirement', 'voucherCredit', voucher_credit);
  end if;

  return jsonb_build_object('type', p_order.package_type, 'status', 'no_matrix_or_voucher_benefit');
end;
$$;

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
        or profile.matrix_upline_code ilike '%' || normalized_search || '%'
        or profile.wallet_address ilike '%' || normalized_search || '%')
  ), counted as (
    select count(*)::integer as total from filtered
  ), page_rows as (
    select * from filtered order by created_at desc, full_name
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', member.id, 'accountCode', member.account_code, 'matrixUplineCode', member.matrix_upline_code, 'fullName', member.full_name,
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
      'referralCount', (select count(*) from public.matrix_positions child where child.parent_member_id = member.id and child.plan_id = 'power3-passive'),
      'currentExit', coalesce((select max(action.exit_number) from public.exit_actions action where action.member_id = member.id and action.status = 'approved'), 0)
    ) order by member.created_at desc, member.full_name) from page_rows member), '[]'::jsonb),
    'total', (select total from counted), 'page', safe_page, 'pageSize', safe_page_size,
    'totalPages', greatest(ceil((select total from counted)::numeric / safe_page_size)::integer, 1)
  ) into result;
  return result;
end;
$$;

revoke all on function
  public.generate_1200_matrix_upline_code(),
  public.ensure_1200_matrix_upline_code(uuid),
  public.resolve_1200_matrix_upline(text,uuid),
  public.handle_new_auth_user(),
  public.get_my_dashboard(),
  public.get_my_entry_requests(),
  public.request_entry_activation(text,text),
  public.admin_get_entry_requests(),
  public.admin_approve_entry(uuid,uuid),
  public.commerce_order_json(public.commerce_orders),
  public.request_commerce_order(uuid,uuid,text,text),
  public.apply_commerce_order_benefit(public.commerce_orders,timestamptz),
  public.admin_get_members(text,text,integer,integer)
from public, anon;

grant execute on function
  public.get_my_dashboard(),
  public.get_my_entry_requests(),
  public.request_entry_activation(text,text),
  public.admin_get_entry_requests(),
  public.admin_approve_entry(uuid,uuid),
  public.request_commerce_order(uuid,uuid,text,text),
  public.admin_get_members(text,text,integer,integer)
to authenticated;
