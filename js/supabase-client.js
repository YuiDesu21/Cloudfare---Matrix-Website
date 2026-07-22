(function initializeSupabaseClient() {
  const config = window.MATRIX_CONFIG || {};
  if (config.dataBackend !== "supabase") return;
  if (!window.supabase || !config.supabaseUrl || !config.supabasePublishableKey) {
    console.error("Supabase browser configuration is incomplete.");
    return;
  }

  window.matrixSupabase = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
