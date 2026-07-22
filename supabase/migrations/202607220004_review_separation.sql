-- An administrator must not approve or reject a request belonging to the same account.
create or replace function public.prevent_self_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='pending' and new.status in ('approved','rejected') and old.member_id=auth.uid() then
    raise exception 'Administrators cannot review requests from their own member account.' using errcode='42501';
  end if;
  return new;
end; $$;

drop trigger if exists prevent_self_review_upgrade on public.upgrade_requests;
create trigger prevent_self_review_upgrade before update of status on public.upgrade_requests for each row execute function public.prevent_self_review();
drop trigger if exists prevent_self_review_exit on public.exit_actions;
create trigger prevent_self_review_exit before update of status on public.exit_actions for each row execute function public.prevent_self_review();
drop trigger if exists prevent_self_review_withdrawal on public.withdrawal_requests;
create trigger prevent_self_review_withdrawal before update of status on public.withdrawal_requests for each row execute function public.prevent_self_review();
drop trigger if exists prevent_self_review_product on public.product_plus_claims;
create trigger prevent_self_review_product before update of status on public.product_plus_claims for each row execute function public.prevent_self_review();
