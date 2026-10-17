alter table public.upgrade_requests
  add column if not exists payment_method_id uuid references public.payment_methods(id) on delete set null,
  add column if not exists payment_method_snapshot jsonb not null default '{}'::jsonb;

alter table public.timeline_requests
  add column if not exists payment_method_id uuid references public.payment_methods(id) on delete set null,
  add column if not exists payment_method_snapshot jsonb not null default '{}'::jsonb;

alter table public.timeline_requests drop constraint if exists timeline_requests_payment_method_check;
alter table public.timeline_requests add constraint timeline_requests_payment_method_check
  check (payment_method in ('gcash', 'available_balance', 'external'));

create function public.request_entry_activation(
  p_reference_number text, p_matrix_upline_code text, p_payment_method_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  method public.payment_methods%rowtype;
  requests jsonb;
  request_id uuid;
begin
  select * into method from public.payment_methods where id = p_payment_method_id and is_active;
  if method.id is null then raise exception 'Choose an active payment method.'; end if;
  requests := public.request_entry_activation(p_reference_number, p_matrix_upline_code);
  request_id := (requests->0->>'id')::uuid;
  update public.upgrade_requests
  set payment_method_id = method.id, payment_method_snapshot = public.payment_method_json(method)
  where id = request_id and member_id = auth.uid() and status = 'pending';
  return public.get_my_entry_requests();
end;
$$;
revoke all on function public.request_entry_activation(text, text) from public, anon, authenticated;
revoke all on function public.request_entry_activation(text, text, uuid) from public, anon;
grant execute on function public.request_entry_activation(text, text, uuid) to authenticated;

create function public.request_timeline_activation(
  p_payment_method text, p_payment_method_id uuid, p_reference_number text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  method public.payment_methods%rowtype;
  request_data jsonb;
begin
  if p_payment_method = 'available_balance' then
    if p_payment_method_id is not null then raise exception 'Invalid balance payment method.'; end if;
    return public.request_timeline_activation('available_balance', '', '', '');
  end if;
  if p_payment_method <> 'external' then raise exception 'Choose a payment method.'; end if;
  select * into method from public.payment_methods where id = p_payment_method_id and is_active;
  if method.id is null then raise exception 'Choose an active payment method.'; end if;
  request_data := public.request_timeline_activation('gcash', method.account_name, method.account_number, p_reference_number);
  update public.timeline_requests
  set payment_method = 'external', payment_method_id = method.id,
      payment_method_snapshot = public.payment_method_json(method), gcash_name = '', gcash_number = ''
  where id = (request_data->>'id')::uuid and member_id = auth.uid() and status = 'pending';
  return request_data || jsonb_build_object('paymentMethod', 'external', 'paymentMethodSnapshot', public.payment_method_json(method));
end;
$$;
revoke all on function public.request_timeline_activation(text, text, text, text) from public, anon, authenticated;
revoke all on function public.request_timeline_activation(text, uuid, text) from public, anon;
grant execute on function public.request_timeline_activation(text, uuid, text) to authenticated;

create or replace function public.get_my_entry_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'planId', request.plan_id,
    'amount', request.amount, 'referenceNumber', request.reference_number,
    'paymentMethodSnapshot', request.payment_method_snapshot,
    'matrixUplineMemberId', request.matrix_upline_member_id,
    'matrixUplineCode', request.matrix_upline_code,
    'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at
  ) order by request.created_at desc), '[]'::jsonb)
  from public.upgrade_requests request where request.member_id = auth.uid();
$$;

create or replace function public.admin_get_entry_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code,
    'walletAddress', member.wallet_address,
    'referenceNumber', request.reference_number, 'amount', request.amount,
    'paymentMethodSnapshot', request.payment_method_snapshot,
    'status', request.status, 'createdAt', request.created_at,
    'matrixUplineMemberId', upline.id, 'matrixUplineName', upline.full_name,
    'matrixUplineUsername', upline.username, 'matrixUplineCode', request.matrix_upline_code,
    'matrixUplineSlotsLeft', greatest(3 - coalesce(upline_counts.children_count, 0), 0),
    'sponsorId', null, 'sponsorName', null, 'sponsorCode', null
  ) order by request.created_at desc), '[]'::jsonb) into result
  from public.upgrade_requests request
  join public.profiles member on member.id = request.member_id
  left join public.profiles upline on upline.id = request.matrix_upline_member_id
  left join lateral (
    select count(*)::integer as children_count from public.matrix_positions child
    where child.parent_member_id = upline.id and child.plan_id = 'power3-passive'
  ) upline_counts on true;
  return result;
end;
$$;

create or replace function public.admin_get_timeline_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'fullName', member.full_name,
    'username', member.username, 'accountCode', member.account_code, 'amount', request.amount,
    'paymentMethod', request.payment_method, 'paymentMethodSnapshot', request.payment_method_snapshot,
    'gcashName', request.gcash_name, 'gcashNumber', request.gcash_number,
    'referenceNumber', request.reference_number, 'status', request.status, 'createdAt', request.created_at,
    'approvedAt', request.approved_at, 'rejectedAt', request.rejected_at, 'reviewedBy', request.reviewed_by,
    'decisionNote', request.decision_note
  ) order by request.created_at desc), '[]'::jsonb) into result
  from public.timeline_requests request join public.profiles member on member.id = request.member_id;
  return result;
end;
$$;
