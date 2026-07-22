-- Change Entry activation from PHP 900 to PHP 1,200.
-- Exit 1's separate PHP 900 reinvestment rule is intentionally unchanged.

update public.upgrade_requests
set amount = 1200
where status = 'pending';

create or replace function public.request_entry_activation(p_reference_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.profiles%rowtype;
  normalized_reference text := upper(trim(p_reference_number));
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
  values (caller.id, 'power3-passive', 1200, normalized_reference)
  returning * into created_request;

  insert into public.activity_logs (actor_id, event_type, message, metadata)
  values (caller.id, 'upgrade-request', caller.full_name || ' requested Entry activation.', jsonb_build_object('requestId', created_request.id));
  return to_jsonb(created_request);
end;
$$;

revoke all on function public.request_entry_activation(text) from public, anon;
grant execute on function public.request_entry_activation(text) to authenticated;
