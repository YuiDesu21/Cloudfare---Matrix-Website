-- Keep the existing reward and allocation rules; only new Premium entry prices change.
create or replace function public.product_entry_target(p_entry_type text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case p_entry_type
    when 'matrix_1200_entry' then 1500::numeric
    when 'timeline_entry' then 693::numeric
    when 'patronizing_entry_product' then 5818::numeric
    when 'patronizing_entry_package' then 2800::numeric
    else null::numeric
  end;
$$;

create or replace function public.request_entry_activation(
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
  set amount = 1500, payment_method_id = method.id,
      payment_method_snapshot = public.payment_method_json(method)
  where id = request_id and member_id = auth.uid() and status = 'pending';
  if not found then raise exception 'The Premium entry request could not be saved.'; end if;
  return public.get_my_entry_requests();
end;
$$;
