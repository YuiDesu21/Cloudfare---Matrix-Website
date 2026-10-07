-- Trigger helpers are internal; members only call the request RPCs.
revoke all on function public.default_patronizing_entry_plan() from public, anon, authenticated;
revoke all on function public.prevent_mixed_patronizing_token_entry() from public, anon, authenticated;
revoke all on function public.prevent_mixed_patronizing_product_entry() from public, anon, authenticated;
