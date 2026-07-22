// Public browser configuration. Supabase publishable keys are intended for
// client applications and remain protected by Row Level Security policies.
window.MATRIX_CONFIG = Object.freeze({
  dataBackend: "supabase",
  features: Object.freeze({
    entryActivation: true,
    withdrawals: true,
    passiveIncomeHistory: true,
    productsPlus: true,
    adminPortal: true
  }),
  supabaseUrl: "https://rvylugnfclguwhdvxprn.supabase.co",
  supabasePublishableKey: "sb_publishable_CWH1EXtSFAGHOXEoWGaeMw_bRMFa4el"
});
