-- These SECURITY DEFINER helpers run only inside trusted request, approval, and
-- dashboard functions. Direct member execution bypasses those entry-point checks.
revoke all on function public.generate_1200_matrix_upline_code() from public, anon, authenticated;
revoke all on function public.ensure_1200_matrix_upline_code(uuid) from public, anon, authenticated;
revoke all on function public.resolve_1200_matrix_upline(text,uuid) from public, anon, authenticated;
revoke all on function public.find_open_main_matrix_parent(uuid) from public, anon, authenticated;
revoke all on function public.matrix_stage_for(uuid) from public, anon, authenticated;
revoke all on function public.timeline_exit_for(uuid) from public, anon, authenticated;
revoke all on function public.patronizing_exit_for(uuid) from public, anon, authenticated;
revoke all on function public.refresh_patronizing_progress(uuid) from public, anon, authenticated;
revoke all on function public.refresh_patronizing_ancestor_progress(uuid) from public, anon, authenticated;
revoke all on function public.apply_patronizing_monthly_unlocks(uuid,timestamptz,uuid) from public, anon, authenticated;
