// Local preview only. The static deployment still copies runtime-config.js.
window.MATRIX_CONFIG = Object.freeze({
  dataBackend: "supabase",
  staging: true,
  features: Object.freeze({
    entryActivation: true,
    withdrawals: true,
    passiveIncomeHistory: true,
    productsPlus: true,
    adminPortal: true
  }),
  supabaseUrl: "https://sssfvmyukpmzbktdlybg.supabase.co",
  supabasePublishableKey: "sb_publishable_S3oyzD0z-54xMYuwt8UnLA_lpzIn5wh"
});
