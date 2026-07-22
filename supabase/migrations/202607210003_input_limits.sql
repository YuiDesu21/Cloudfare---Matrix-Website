-- Enforce limits for future writes without rewriting existing records.
create or replace function public.validate_profile_input() returns trigger language plpgsql set search_path = '' as $$
begin
  if char_length(trim(new.full_name)) not between 1 and 30 then raise exception 'Full name must not exceed 30 characters.'; end if;
  if new.full_name !~ '^[A-Za-zÀ-ÿÑñ .''-]+$' then raise exception 'Full name may only contain letters and normal name punctuation.'; end if;
  if char_length(trim(new.username)) not between 1 and 30 then raise exception 'Username must not exceed 30 characters.'; end if;
  if char_length(trim(new.email)) > 254 then raise exception 'Email must not exceed 254 characters.'; end if;
  if char_length(trim(new.wallet_address)) not between 1 and 52 then raise exception 'F3 wallet must not exceed 52 characters.'; end if;
  if new.wallet_address !~ '^[A-Za-z0-9:_-]+$' then raise exception 'F3 wallet contains unsupported characters.'; end if;
  if new.phone !~ '^09[0-9]{9}$' then raise exception 'Phone number must contain exactly 11 digits and start with 09.'; end if;
  return new;
end; $$;
drop trigger if exists validate_profile_input_trigger on public.profiles;
create trigger validate_profile_input_trigger before insert or update of full_name, username, email, phone, wallet_address on public.profiles for each row execute function public.validate_profile_input();

create or replace function public.validate_exit_payment_input() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_method = 'f3_wallet' and (new.f3_wallet is null or char_length(trim(new.f3_wallet)) not between 1 and 52) then raise exception 'F3 wallet must not exceed 52 characters.'; end if;
  if new.payment_method = 'f3_wallet' and new.f3_wallet !~ '^[A-Za-z0-9:_-]+$' then raise exception 'F3 wallet contains unsupported characters.'; end if;
  if new.payment_method = 'gcash' then
    if new.gcash_name is null or char_length(trim(new.gcash_name)) not between 1 and 30 then raise exception 'GCash name must not exceed 30 characters.'; end if;
    if new.gcash_name !~ '^[A-Za-zÀ-ÿÑñ .''-]+$' then raise exception 'GCash name may only contain letters and normal name punctuation.'; end if;
    if new.gcash_number !~ '^09[0-9]{9}$' then raise exception 'GCash number must contain exactly 11 digits and start with 09.'; end if;
    if new.reference_number !~ '^[A-Za-z0-9-]{6,40}$' then raise exception 'GCash reference must contain 6–40 letters, numbers, or hyphens.'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists validate_exit_payment_input_trigger on public.exit_actions;
create trigger validate_exit_payment_input_trigger before insert or update of payment_method, f3_wallet, gcash_name, gcash_number, reference_number on public.exit_actions for each row execute function public.validate_exit_payment_input();

create or replace function public.validate_withdrawal_input() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_name is null or char_length(trim(new.account_name)) not between 1 and 30 then raise exception 'GCash account name must not exceed 30 characters.'; end if;
  if new.account_name !~ '^[A-Za-zÀ-ÿÑñ .''-]+$' then raise exception 'GCash account name may only contain letters and normal name punctuation.'; end if;
  if new.gcash_number !~ '^09[0-9]{9}$' then raise exception 'GCash number must contain exactly 11 digits and start with 09.'; end if;
  if char_length(coalesce(new.payout_details, '')) > 240 then raise exception 'Notes must not exceed 240 characters.'; end if;
  return new;
end; $$;
drop trigger if exists validate_withdrawal_input_trigger on public.withdrawal_requests;
create trigger validate_withdrawal_input_trigger before insert or update of account_name, gcash_number, payout_details on public.withdrawal_requests for each row execute function public.validate_withdrawal_input();
