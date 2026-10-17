-- One Product Plus catalog supports cash purchases and voucher redemption.
-- Historical voucher-only products and orders remain untouched.
update public.commerce_products
set voucher_eligible = true
where product_type = 'product_plus_requirement'
  and is_active = true
  and voucher_eligible = false;

create or replace function public.keep_product_plus_voucher_eligible()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.product_type = 'product_plus_requirement' then
    new.voucher_eligible := true;
  end if;
  return new;
end;
$$;

create trigger keep_product_plus_voucher_eligible
before insert or update on public.commerce_products
for each row execute function public.keep_product_plus_voucher_eligible();
