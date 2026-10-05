create function public.request_budget_token_purchase(
  p_quantity integer, p_payment_method_id uuid, p_reference_number text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member public.profiles%rowtype;
  method public.payment_methods%rowtype;
  price numeric;
  token_request public.budget_plan_token_requests%rowtype;
  normalized_reference text := upper(trim(coalesce(p_reference_number, '')));
begin
  if auth.uid() is null then raise exception 'Sign in to request F3 tokens.' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'Choose between 1 and 10,000 F3 tokens.' using errcode = '22023';
  end if;
  if normalized_reference !~ '^[A-Z0-9-]{6,80}$' then
    raise exception 'Enter a valid payment reference (6-80 letters, numbers, or hyphens).' using errcode = '22023';
  end if;
  select * into method from public.payment_methods
  where id = p_payment_method_id and is_active;
  if method.id is null then
    raise exception 'Choose an active payment method.' using errcode = '22023';
  end if;
  select * into member from public.profiles where id = auth.uid();
  if member.id is null or trim(coalesce(member.wallet_address, '')) = '' then
    raise exception 'Add your F3 wallet address in Profile first.' using errcode = '22023';
  end if;
  select unit_price into price from public.budget_plan_token_settings where id = 1;
  if price is null then raise exception 'F3 token price is unavailable.' using errcode = 'P0002'; end if;
  if price * p_quantity > 1000000 then
    raise exception 'Token purchase exceeds PHP 1,000,000.' using errcode = '22023';
  end if;
  insert into public.budget_plan_token_requests
    (member_id, payment_method_id, payment_method_snapshot, quantity, unit_price, amount,
     wallet_address, reference_number)
  values (auth.uid(), p_payment_method_id, public.payment_method_json(method), p_quantity, price,
    round(price * p_quantity, 2), member.wallet_address, normalized_reference)
  returning * into token_request;
  return to_jsonb(token_request);
end;
$$;

create function public.admin_set_budget_token_price(p_unit_price numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare updated public.budget_plan_token_settings%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 10000
    or p_unit_price <> round(p_unit_price, 2) then
    raise exception 'Enter a token price between PHP 0.01 and PHP 10,000.' using errcode = '22023';
  end if;
  update public.budget_plan_token_settings
  set unit_price = p_unit_price, updated_at = now()
  where id = 1 returning * into updated;
  return to_jsonb(updated);
end;
$$;

create function public.admin_get_budget_token_requests()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'memberId', request.member_id, 'memberName', profile.full_name,
    'quantity', request.quantity, 'unitPrice', request.unit_price, 'amount', request.amount,
    'walletAddress', request.wallet_address, 'referenceNumber', request.reference_number,
    'methodName', request.payment_method_snapshot ->> 'methodName',
    'methodAccount', request.payment_method_snapshot ->> 'accountNumber',
    'status', request.status, 'deliveryReference', request.delivery_reference,
    'createdAt', request.created_at, 'reviewedAt', request.reviewed_at
  ) order by request.created_at desc), '[]'::jsonb) into result
  from public.budget_plan_token_requests request
  join public.profiles profile on profile.id = request.member_id;
  return result;
end;
$$;

create function public.admin_review_budget_token_purchase(
  p_request_id uuid, p_approve boolean, p_admin_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare token_request public.budget_plan_token_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(coalesce(p_admin_note, '')) > 320 then
    raise exception 'Admin note is too long.' using errcode = '22023';
  end if;
  select * into token_request from public.budget_plan_token_requests
  where id = p_request_id for update;
  if token_request.id is null or token_request.status <> 'pending' then
    raise exception 'F3 token request is not pending.' using errcode = '22023';
  end if;
  if p_approve then
    perform pg_advisory_xact_lock(hashtextextended('payment-ref-' || token_request.reference_number, 0));
    if public.approved_payment_reference_used(token_request.reference_number) then
      raise exception 'This payment reference was already approved for another request.' using errcode = '22023';
    end if;
  end if;
  update public.budget_plan_token_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = auth.uid(),
      admin_note = trim(coalesce(p_admin_note, ''))
  where id = token_request.id returning * into token_request;
  if p_approve then
    insert into public.budget_plan_token_credits
      (request_id, member_id, purchase_amount, qualification_credit, credited_at)
    values (token_request.id, token_request.member_id, token_request.amount,
      round(token_request.amount * 0.80, 2), now());
    perform public.activate_budget_plan_member(token_request.member_id, now());
  end if;
  return to_jsonb(token_request);
end;
$$;

create function public.admin_mark_budget_tokens_delivered(
  p_request_id uuid, p_delivery_reference text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare token_request public.budget_plan_token_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_delivery_reference, ''))) < 6
    or char_length(trim(p_delivery_reference)) > 120 then
    raise exception 'Enter the F3 transfer reference (6-120 characters).' using errcode = '22023';
  end if;
  update public.budget_plan_token_requests
  set status = 'delivered', delivery_reference = trim(p_delivery_reference),
      delivered_at = now()
  where id = p_request_id and status = 'approved'
  returning * into token_request;
  if token_request.id is null then
    raise exception 'Approve the token payment before recording delivery.' using errcode = '22023';
  end if;
  return to_jsonb(token_request);
end;
$$;

revoke all on function public.request_budget_token_purchase(integer,uuid,text),
  public.admin_set_budget_token_price(numeric),
  public.admin_get_budget_token_requests(),
  public.admin_review_budget_token_purchase(uuid,boolean,text),
  public.admin_mark_budget_tokens_delivered(uuid,text) from public, anon;
grant execute on function public.request_budget_token_purchase(integer,uuid,text),
  public.admin_set_budget_token_price(numeric),
  public.admin_get_budget_token_requests(),
  public.admin_review_budget_token_purchase(uuid,boolean,text),
  public.admin_mark_budget_tokens_delivered(uuid,text) to authenticated;
