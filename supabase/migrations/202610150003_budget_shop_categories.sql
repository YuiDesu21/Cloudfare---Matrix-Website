-- Classify the existing shared catalog for Budget Plan checkout.
-- Groceries remain an admin-selected category for future products.
update public.commerce_products
set budget_category = case
  when lower(trim(product_name)) like 'pc %' then 'pc'
  else 'lifestyle'
end
where product_type = 'product_plus_requirement'
  and is_active = true
  and budget_category is null;
