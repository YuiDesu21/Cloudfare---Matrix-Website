-- Keep the established approval/earnings rules while giving each request a
-- retry-safe reference. Existing completed rows retain a null key.
alter table public.withdrawal_requests add column idempotency_key uuid unique;
alter table public.member_reward_transfers add column idempotency_key uuid unique;

create function public.request_main_withdrawal(
  p_amount numeric, p_account_name text, p_gcash_number text,
  p_notes text, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  existing public.withdrawal_requests%rowtype;
  created jsonb;
  normalized_number text := regexp_replace(trim(coalesce(p_gcash_number, '')), '[ -]', '', 'g');
begin
  if member_id is null then raise exception 'Sign in to withdraw.' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'A request reference is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text, 0));
  select * into existing from public.withdrawal_requests where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.member_id <> member_id or existing.amount <> p_amount
      or existing.account_name <> trim(coalesce(p_account_name, ''))
      or existing.gcash_number <> normalized_number
      or existing.payout_details <> left(coalesce(p_notes, ''), 240) then
      raise exception 'This request reference was already used.' using errcode = '22023';
    end if;
    return to_jsonb(existing);
  end if;
  created := public.request_withdrawal(p_amount, p_account_name, p_gcash_number, p_notes);
  update public.withdrawal_requests set idempotency_key = p_idempotency_key
  where id = (created ->> 'id')::uuid returning * into existing;
  return to_jsonb(existing);
end;
$$;

create function public.transfer_matrix_income_to_main_keyed(
  p_plan_id text, p_amount numeric, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  existing public.member_reward_transfers%rowtype;
  created jsonb;
begin
  if member_id is null then raise exception 'Sign in to transfer earnings.' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'A transfer reference is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text, 0));
  select * into existing from public.member_reward_transfers where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.member_id <> member_id or existing.plan_id <> p_plan_id or existing.amount <> p_amount then
      raise exception 'This transfer reference was already used.' using errcode = '22023';
    end if;
    return to_jsonb(existing);
  end if;
  created := public.transfer_matrix_income_to_main(p_plan_id, p_amount);
  update public.member_reward_transfers set idempotency_key = p_idempotency_key
  where id = (created ->> 'id')::uuid returning * into existing;
  return to_jsonb(existing);
end;
$$;

create function public.get_my_funds_action_status(p_kind text, p_idempotency_key uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to check a request.' using errcode = '42501'; end if;
  if p_kind = 'withdrawal' then
    select jsonb_build_object('id', id, 'status', status, 'code', withdrawal_code)
      into result from public.withdrawal_requests
      where member_id = auth.uid() and idempotency_key = p_idempotency_key;
  elsif p_kind = 'matrix' then
    select jsonb_build_object('id', id, 'status', 'completed')
      into result from public.member_reward_transfers
      where member_id = auth.uid() and idempotency_key = p_idempotency_key;
  else
    raise exception 'Unknown request type.' using errcode = '22023';
  end if;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.request_main_withdrawal(numeric,text,text,text,uuid),
  public.transfer_matrix_income_to_main_keyed(text,numeric,uuid),
  public.get_my_funds_action_status(text,uuid) from public, anon;
grant execute on function public.request_main_withdrawal(numeric,text,text,text,uuid),
  public.transfer_matrix_income_to_main_keyed(text,numeric,uuid),
  public.get_my_funds_action_status(text,uuid) to authenticated;
revoke execute on function public.request_withdrawal(numeric,text,text,text),
  public.transfer_matrix_income_to_main(text,numeric) from public, anon, authenticated;
