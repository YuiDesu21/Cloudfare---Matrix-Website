-- Allow the organization owner/root account to review their own requests.
-- Regular administrators are still blocked from reviewing their own account.

create or replace function public.prevent_self_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending'
    and new.status in ('approved', 'rejected')
    and old.member_id = auth.uid()
    and not public.is_owner()
  then
    raise exception 'Administrators cannot review requests from their own member account.' using errcode = '42501';
  end if;
  return new;
end;
$$;
