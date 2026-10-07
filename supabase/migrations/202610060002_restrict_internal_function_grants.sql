revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.enforce_matrix_position_plan() from public, anon, authenticated;
