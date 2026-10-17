/**
 * Member Portal Controller
 * Manages authentication views, registrations, active sessions, and downline visualizer render.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // DB Initialization
  if (window.MatrixDB) {
    await window.MatrixDB.initializeDatabase();
  } else {
    console.error("Database layer (matrix-db.js) failed to load.");
    return;
  }

  // Session keys
  const SESSION_KEY = "matrix_logged_in_member_id";

  // Elements
  const authSection = document.getElementById("auth-section");
  const loginView = document.getElementById("login-view");
  const registerView = document.getElementById("register-view");
  const successView = document.getElementById("success-view");
  const dashboardSection = document.getElementById("dashboard-section");

  const loginForm = document.getElementById("login-form");
  const loginCredentialInput = document.getElementById("login-credential");
  const loginPasswordInput = document.getElementById("login-password");
  const loginAlert = document.getElementById("login-alert");
  const forgotPasswordView = document.getElementById("forgot-password-view");
  const forgotPasswordForm = document.getElementById("forgot-password-form");
  const forgotPasswordEmail = document.getElementById("forgot-password-email");
  const forgotPasswordAlert = document.getElementById("forgot-password-alert");
  const forgotPasswordSubmit = document.getElementById("forgot-password-submit");
  const resetPasswordView = document.getElementById("reset-password-view");
  const resetPasswordForm = document.getElementById("reset-password-form");
  const resetPasswordNew = document.getElementById("reset-password-new");
  const resetPasswordConfirm = document.getElementById("reset-password-confirm");
  const resetPasswordAlert = document.getElementById("reset-password-alert");
  const resetPasswordSubmit = document.getElementById("reset-password-submit");

  const registerForm = document.getElementById("register-form");
  const regFullName = document.getElementById("reg-fullname");
  const regUsername = document.getElementById("reg-username");
  const regEmail = document.getElementById("reg-email");
  const regPassword = document.getElementById("reg-password");
  const regPasswordConfirm = document.getElementById("reg-password-confirm");
  const regPhone = document.getElementById("reg-phone");
  const regWallet = document.getElementById("reg-wallet");
  const registerAlert = document.getElementById("register-alert");

  const successReqId = document.getElementById("success-req-id");
  const successOkBtn = document.getElementById("success-ok-btn");

  const headerUserStatus = document.getElementById("header-user-status");
  const headerUserName = document.getElementById("header-user-name");
  const headerAvatarLetter = document.getElementById("header-avatar-letter");
  const notificationMenuToggle = document.getElementById("notification-menu-toggle");
  const notificationMenu = document.getElementById("notification-menu");
  const notificationCount = document.getElementById("notification-count");
  const notificationSummary = document.getElementById("notification-summary");
  const notificationList = document.getElementById("notification-list");
  const accountMenuToggle = document.getElementById("account-menu-toggle");
  const accountMenu = document.getElementById("account-menu");
  const logoutBtnHeader = document.getElementById("logout-btn-header");
  const logoutBtnSidebar = document.getElementById("logout-btn-sidebar");
  const profileDrawer = document.getElementById("profile-drawer");
  const profileDrawerClose = document.getElementById("profile-drawer-close");
  const profileDrawerBackdrop = document.getElementById("profile-drawer-backdrop");
  const profileDetailsAlert = document.getElementById("profile-details-alert");
  const profileDetailsForm = document.getElementById("profile-details-form");
  const profileFullName = document.getElementById("profile-full-name");
  const profileUsername = document.getElementById("profile-username");
  const profilePhone = document.getElementById("profile-phone");
  const profileWallet = document.getElementById("profile-wallet");
  const profileDetailsSave = document.getElementById("profile-details-save");
  const shippingAddressCount = document.getElementById("shipping-address-count");
  const shippingAddressAlert = document.getElementById("shipping-address-alert");
  const shippingAddressList = document.getElementById("shipping-address-list");
  const shippingAddressForm = document.getElementById("shipping-address-form");
  const shippingAddressId = document.getElementById("shipping-address-id");
  const shippingFullName = document.getElementById("shipping-full-name");
  const shippingPhone = document.getElementById("shipping-phone");
  const shippingRegion = document.getElementById("shipping-region");
  const shippingProvince = document.getElementById("shipping-province");
  const shippingCity = document.getElementById("shipping-city");
  const shippingBarangay = document.getElementById("shipping-barangay");
  const shippingStreet = document.getElementById("shipping-street");
  const shippingPostal = document.getElementById("shipping-postal");
  const shippingNotes = document.getElementById("shipping-notes");
  const shippingDefault = document.getElementById("shipping-default");
  const shippingSaveBtn = document.getElementById("shipping-save-btn");
  const shippingCancelBtn = document.getElementById("shipping-cancel-btn");

  const dbStatusBadge = document.getElementById("db-status-badge");
  const dbAvatarLetter = document.getElementById("db-avatar-letter");
  const dbFullName = document.getElementById("db-fullname");
  const dbUsername = document.getElementById("db-username");
  const dbWallet = document.getElementById("db-wallet");
  const dbEmail = document.getElementById("db-email");
  const dbPhone = document.getElementById("db-phone");
  const dbJoinDate = document.getElementById("db-joindate");
  const dbSponsor = document.getElementById("db-sponsor");
  const dbAccountId = document.getElementById("db-account-id");

  const referralContainer = document.getElementById("referral-container");
  const refLinkInput = document.getElementById("ref-link-input");
  const copyRefBtn = document.getElementById("copy-ref-btn");
  const copyToast = document.getElementById("copy-toast");

  const dbWelcomeTitle = document.getElementById("db-welcome-title");
  const dbWelcomeDesc = document.getElementById("db-welcome-desc");
  const dashboardWelcomeMeta = document.getElementById("dashboard-welcome-meta");
  const dashboardAccountState = document.getElementById("dashboard-account-state");
  document.getElementById("dashboard-view-profile").addEventListener("click", event => {
    event.preventDefault();
    openProfileDrawer();
  });
  const dashboardContent = document.querySelector(".dashboard-content");
  const dashboardOverview = document.getElementById("dashboard-overview");

  const activeMetricsRow = document.getElementById("active-metrics-row");
  const metricReferrals = document.getElementById("metric-referrals");
  const metricChildren = document.getElementById("metric-children");

  const premiumNextStep = document.getElementById("premium-next-step");
  const premiumNextStepTitle = document.getElementById("premium-next-step-title");
  const premiumNextStepStatus = document.getElementById("premium-next-step-status");
  const premiumNextStepCopy = document.getElementById("premium-next-step-copy");
  const premiumNextStepAction = document.getElementById("premium-next-step-action");
  const premiumActivation = document.getElementById("premium-activation");
  const premiumActivationForm = document.getElementById("premium-activation-form");
  const premiumActivationStatus = document.getElementById("premium-activation-status");
  const premiumActivationAlert = document.getElementById("premium-activation-alert");
  const premiumActivationUpline = document.getElementById("premium-activation-upline");
  const premiumActivationReference = document.getElementById("premium-activation-reference");
  const premiumActivationMethod = document.getElementById("premium-activation-method");
  const premiumActivationMethodDetails = document.getElementById("premium-activation-method-details");
  const premiumActivationPending = document.getElementById("premium-activation-pending");
  const premiumActivationSubmit = document.getElementById("premium-activation-submit");
  let premiumActivationMember = null;
  let premiumActivationLoad = 0;
  const balanceCard = document.getElementById("balance-card");
  const balanceTotalBadge = document.getElementById("balance-total-badge");
  const balanceTotal = document.getElementById("balance-total");
  const requestWithdrawalBtn = document.getElementById("request-withdrawal-btn");
  const productsPlusCard = document.getElementById("products-plus-card");
  const productsPlusBadge = document.getElementById("products-plus-badge");
  const productsPlusTabs = document.getElementById("products-plus-tabs");
  const productsPlusStatus = document.getElementById("products-plus-status");
  const productsPlusAvailable = document.getElementById("products-plus-available");
  const productsPlusSummary = document.getElementById("products-plus-summary");
  const productsPlusMonthly = document.getElementById("products-plus-monthly");
  const productsPlusVested = document.getElementById("products-plus-vested");
  const productsPlusRate = document.getElementById("products-plus-rate");
  const productsPlusUsed = document.getElementById("products-plus-used");
  const productsPlusRequestBtn = document.getElementById("products-plus-request-btn");
  const productsPlusScheduleNote = document.getElementById("products-plus-schedule-note");
  const productsPlusList = document.getElementById("products-plus-list");
  const voucherBalance = document.getElementById("voucher-balance");
  const voucherHistory = document.getElementById("voucher-history");
  const productsPlusClaimModal = document.getElementById("products-plus-claim-modal");
  const productsPlusClaimForm = document.getElementById("products-plus-claim-form");
  const productsPlusClaimAmount = document.getElementById("products-plus-claim-amount");
  const productsPlusClaimReference = document.getElementById("products-plus-claim-reference");
  const productsPlusClaimNotes = document.getElementById("products-plus-claim-notes");
  const productsPlusClaimLimit = document.getElementById("products-plus-claim-limit");
  const productsPlusClaimAlert = document.getElementById("products-plus-claim-alert");
  const productsPlusClaimSubmit = document.getElementById("products-plus-claim-submit");
  let pendingProductClaim = null;

  const pendingDetailsCard = document.getElementById("pending-details-card");
  const pendingCardPlan = document.getElementById("pending-card-plan");
  const pendingCardDate = document.getElementById("pending-card-date");
  const pendingCardPrice = document.getElementById("pending-card-price");

  const activeTreeCard = document.getElementById("active-tree-card");
  const treeVisualizer = document.getElementById("member-tree-visualizer");

  // Navigation handlers
  const goToRegister = document.getElementById("go-to-register");
  const goToLogin = document.getElementById("go-to-login");
  const goToForgotPassword = document.getElementById("go-to-forgot-password");
  const forgotPasswordBack = document.getElementById("forgot-password-back");

  // Form errors
  const errFullName = document.getElementById("err-fullname");
  const errUsername = document.getElementById("err-username");
  const errEmail = document.getElementById("err-email");
  const errPassword = document.getElementById("err-password");
  const errPasswordConfirm = document.getElementById("err-password-confirm");
  const errPhone = document.getElementById("err-phone");
  const errWallet = document.getElementById("err-wallet");

  // Route URL queries
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const premiumViewRequested = params.get("view") === "premium";
  const premiumProductProgress = document.getElementById("premium-product-progress");
  const returnToShop = params.get("returnTo") === "shop.html";
  const FEATURES = (window.MATRIX_CONFIG && window.MATRIX_CONFIG.features) || {};

  accountMenu.querySelectorAll('[data-account-action="withdraw"], [data-account-action="history"]').forEach(button => {
    button.hidden = !FEATURES.withdrawals;
  });
  requestWithdrawalBtn.hidden = !FEATURES.withdrawals;
  const passiveIncomeHistoryLink = document.getElementById("passive-income-history-link");
  if (passiveIncomeHistoryLink) passiveIncomeHistoryLink.hidden = !FEATURES.passiveIncomeHistory;
  const passiveIncomeMenuButton = accountMenu.querySelector('[data-account-action="income"]');
  if (passiveIncomeMenuButton) passiveIncomeMenuButton.hidden = !FEATURES.passiveIncomeHistory;


  regPhone.addEventListener("input", () => { regPhone.value = regPhone.value.replace(/\D/g, "").slice(0, 11); });
  regFullName.addEventListener("input", () => { regFullName.value = regFullName.value.replace(/[^\p{L} .'-]/gu, "").slice(0, 30); });
  regWallet.addEventListener("input", () => { regWallet.value = regWallet.value.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 52); });

  // Initial State Check
  const passwordRecoveryRequested = params.get("mode") === "reset-password" || window.location.hash.includes("type=recovery");
  const sessionRestored = passwordRecoveryRequested ? false : await checkSession();

  if (params.get("mode") === "forgot-password") {
    showForgotPassword();
  } else if (passwordRecoveryRequested) {
    showResetPassword();
  } else if (sessionRestored) {
    if (window.MATRIX_USES_SUPABASE && params.get("admin_invite")) {
      try {
        await MatrixDB.acceptAdminInvitation(params.get("admin_invite"));
        window.history.replaceState({}, document.title, "portal.html");
        window.location.reload();
      } catch (error) {
        window.alert(error.message);
      }
    } else if (returnToShop) {
      window.location.assign("shop.html");
    } else if (window.location.hash === "#profile") {
      openProfileDrawer();
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
  } else if (action === "register") {
    showRegister();
  } else {
    showLogin();
  }

  // Event Listeners
  goToRegister.addEventListener("click", (e) => {
    e.preventDefault();
    showRegister();
  });

  goToLogin.addEventListener("click", (e) => {
    e.preventDefault();
    showLogin();
  });

  goToForgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    showForgotPassword();
  });

  forgotPasswordBack.addEventListener("click", (e) => {
    e.preventDefault();
    showLogin();
  });

  successOkBtn.addEventListener("click", () => {
    successView.style.display = "none";
    showLogin();
  });

  loginForm.addEventListener("submit", handleLogin);
  forgotPasswordForm.addEventListener("submit", handleForgotPassword);
  resetPasswordForm.addEventListener("submit", handleResetPassword);
  registerForm.addEventListener("submit", handleRegister);

  logoutBtnHeader.addEventListener("click", logout);
  logoutBtnSidebar.addEventListener("click", logout);

  accountMenuToggle.addEventListener("click", () => {
    closeNotificationMenu();
    const open = accountMenu.hidden;
    accountMenu.hidden = !open;
    accountMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  notificationMenuToggle.addEventListener("click", () => {
    closeAccountMenu();
    const open = notificationMenu.hidden;
    notificationMenu.hidden = !open;
    notificationMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  function openNotificationsFromLink() {
    if (window.location.hash !== "#notifications" || dashboardSection.style.display === "none") return;
    closeAccountMenu();
    notificationMenu.hidden = false;
    notificationMenuToggle.setAttribute("aria-expanded", "true");
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }
  window.addEventListener("hashchange", openNotificationsFromLink);
  if (sessionRestored) openNotificationsFromLink();

  accountMenu.querySelectorAll("[data-account-action]").forEach(button => {
    button.addEventListener("click", () => {
      closeAccountMenu();
      if (button.dataset.accountAction === "profile") {
        openProfileDrawer();
      } else if (button.dataset.accountAction === "packages") {
        window.location.href = "packages-orders.html";
      } else if (button.dataset.accountAction === "product-plus") {
        window.location.href = "packages-orders.html?type=product_plus_requirement";
      } else if (button.dataset.accountAction === "patronizing") {
        window.location.href = "patronizing-income.html";
      } else if (button.dataset.accountAction === "timeline") {
        window.location.href = "timeline-matrix.html";
      } else if (button.dataset.accountAction === "budget") {
        window.location.href = "budget-plan.html";
      } else if (button.dataset.accountAction === "funds") {
        window.location.href = "main-funds.html";
      } else if (button.dataset.accountAction === "withdraw") {
        window.location.href = "main-funds.html?dialog=withdraw";
      } else if (button.dataset.accountAction === "history") {
        window.location.href = "withdrawal-history.html";
      } else if (button.dataset.accountAction === "income") {
        window.location.href = "passive-income-history.html";
      } else if (button.dataset.accountAction === "entry") {
        window.location.href = "portal.html?view=premium";
      } else if (button.dataset.accountAction === "admin") {
        window.location.href = "admin.html";
      }
    });
  });

  profileDrawerClose.addEventListener("click", closeProfileDrawer);
  profileDrawerBackdrop.addEventListener("click", closeProfileDrawer);
  document.addEventListener("click", (event) => {
    if (!headerUserStatus.contains(event.target)) {
      closeAccountMenu();
      closeNotificationMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAccountMenu();
    closeNotificationMenu();
    closeProfileDrawer();
  });

  copyRefBtn.addEventListener("click", copyReferralLink);
  profileUsername.addEventListener("input", () => { profileUsername.value = profileUsername.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30); });
  profilePhone.addEventListener("input", () => { profilePhone.value = profilePhone.value.replace(/\D/g, "").slice(0, 11); });
  profileWallet.addEventListener("input", () => { profileWallet.value = profileWallet.value.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 52); });
  profileDetailsForm.addEventListener("submit", handleProfileDetailsSubmit);
  shippingPhone.addEventListener("input", () => { shippingPhone.value = shippingPhone.value.replace(/[^\d+]/g, "").slice(0, 13); });
  shippingPostal.addEventListener("input", () => { shippingPostal.value = shippingPostal.value.replace(/\D/g, "").slice(0, 4); });
  shippingCancelBtn.addEventListener("click", () => resetShippingAddressForm());
  shippingAddressForm.addEventListener("submit", handleShippingAddressSubmit);
  premiumActivationForm.addEventListener("submit", handlePremiumActivationSubmit);
  premiumActivationMethod.addEventListener("change", renderPremiumPaymentMethod);
  requestWithdrawalBtn.addEventListener("click", () => {
    window.location.href = "main-funds.html";
  });
  document.getElementById("products-plus-claim-close").addEventListener("click", closeProductClaimModal);
  productsPlusClaimModal.addEventListener("click", event => { if (event.target === productsPlusClaimModal) closeProductClaimModal(); });
  productsPlusClaimNotes.addEventListener("input", () => { document.getElementById("products-plus-notes-count").textContent = productsPlusClaimNotes.value.length; });
  productsPlusClaimForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!pendingProductClaim) return;
    productsPlusClaimAlert.style.display = "none";
    productsPlusClaimSubmit.disabled = true;
    try {
      const memberId = pendingProductClaim.memberId;
      await MatrixDB.requestProductPlusClaim(pendingProductClaim.memberId, pendingProductClaim.exit, Number(productsPlusClaimAmount.value), { reference: productsPlusClaimReference.value.trim(), notes: productsPlusClaimNotes.value.trim() });
      closeProductClaimModal();
      renderDashboard(MatrixDB.getMemberById(memberId));
    } catch (error) {
      productsPlusClaimAlert.className = "alert alert-danger"; productsPlusClaimAlert.textContent = error.message; productsPlusClaimAlert.style.display = "block";
    } finally { productsPlusClaimSubmit.disabled = false; }
  });

  // Helper Functions for View Switching
  function showLogin() {
    loginView.style.display = "block";
    forgotPasswordView.style.display = "none";
    resetPasswordView.style.display = "none";
    registerView.style.display = "none";
    successView.style.display = "none";
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    headerUserStatus.style.display = "none";
    document.dispatchEvent(new Event("matrix:member-signed-out"));
    clearForms();
  }

  function showForgotPassword() {
    loginView.style.display = "none";
    forgotPasswordView.style.display = "block";
    resetPasswordView.style.display = "none";
    registerView.style.display = "none";
    successView.style.display = "none";
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    headerUserStatus.style.display = "none";
    forgotPasswordForm.reset();
    forgotPasswordAlert.style.display = "none";
    if (loginCredentialInput.value.trim()) forgotPasswordEmail.value = loginCredentialInput.value.trim();
  }

  function showResetPassword() {
    loginView.style.display = "none";
    forgotPasswordView.style.display = "none";
    resetPasswordView.style.display = "block";
    registerView.style.display = "none";
    successView.style.display = "none";
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    headerUserStatus.style.display = "none";
    resetPasswordForm.reset();
    resetPasswordAlert.style.display = "none";
  }

  function openProductClaimModal(memberId, exit, available, bonusPercent) {
    pendingProductClaim = { memberId, exit };
    productsPlusClaimForm.reset();
    productsPlusClaimAmount.max = String(available);
    productsPlusClaimAmount.value = String(available);
    productsPlusClaimLimit.textContent = `Exit ${exit}: claim up to PHP ${formatNumber(available)}. Approval credits a ${bonusPercent}% non-expiring voucher.`;
    productsPlusClaimAlert.style.display = "none";
    document.getElementById("products-plus-notes-count").textContent = "0";
    productsPlusClaimModal.style.display = "flex";
    productsPlusClaimAmount.focus();
  }

  function closeProductClaimModal() {
    productsPlusClaimModal.style.display = "none";
    pendingProductClaim = null;
  }

  function showRegister() {
    loginView.style.display = "none";
    forgotPasswordView.style.display = "none";
    resetPasswordView.style.display = "none";
    registerView.style.display = "block";
    successView.style.display = "none";
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    headerUserStatus.style.display = "none";
    clearForms();
  }

  function clearForms() {
    loginForm.reset();
    registerForm.reset();
    loginAlert.style.display = "none";
    registerAlert.style.display = "none";
    document.querySelectorAll(".form-error").forEach(el => el.textContent = "");
  }

  // Handle Login
  async function handleLogin(e) {
    e.preventDefault();
    loginAlert.style.display = "none";
    
    const credential = loginCredentialInput.value.trim();
    const password = loginPasswordInput.value;
    if (!credential || !password) return;

    if (window.MATRIX_USES_SUPABASE) {
      try {
        const member = await MatrixDB.signIn(credential, password);
        if (!member) throw new Error("No Matrix profile is linked to this account.");
        renderDashboard(member);
        if (returnToShop) window.location.assign("shop.html");
      } catch (error) {
        showLoginError(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
      }
      return;
    }

    try {
      const member = MatrixDB.authenticateMember(credential, password);
      if (member.status === "rejected") throw new Error("Your registration request was rejected by the administrator.");
      sessionStorage.setItem(SESSION_KEY, member.id);
      if (member.status === "registered" || member.status === "pending") renderPendingDashboard(member);
      else renderDashboard(member);
      return;
    } catch (error) {
      showLoginError(error.message);
    }
  }

  function showLoginError(msg) {
    loginAlert.className = "alert alert-danger";
    loginAlert.textContent = msg;
    loginAlert.style.display = "block";
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    forgotPasswordAlert.style.display = "none";
    forgotPasswordSubmit.disabled = true;
    try {
      if (!window.MATRIX_USES_SUPABASE || !MatrixDB.requestPasswordReset) {
        throw new Error("Password recovery is only available on the live website.");
      }
      await MatrixDB.requestPasswordReset(forgotPasswordEmail.value.trim());
      forgotPasswordAlert.className = "alert alert-success";
      forgotPasswordAlert.textContent = "If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.";
      forgotPasswordAlert.style.display = "block";
    } catch (error) {
      forgotPasswordAlert.className = "alert alert-danger";
      forgotPasswordAlert.textContent = error.message;
      forgotPasswordAlert.style.display = "block";
    } finally {
      forgotPasswordSubmit.disabled = false;
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    resetPasswordAlert.style.display = "none";
    if (resetPasswordNew.value.length < 10 || !/[A-Za-z]/.test(resetPasswordNew.value) || !/\d/.test(resetPasswordNew.value)) {
      resetPasswordAlert.className = "alert alert-danger";
      resetPasswordAlert.textContent = "Use at least 10 characters with a letter and a number.";
      resetPasswordAlert.style.display = "block";
      return;
    }
    if (resetPasswordNew.value !== resetPasswordConfirm.value) {
      resetPasswordAlert.className = "alert alert-danger";
      resetPasswordAlert.textContent = "The passwords do not match.";
      resetPasswordAlert.style.display = "block";
      return;
    }
    resetPasswordSubmit.disabled = true;
    try {
      const { data, error } = await window.matrixSupabase.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error("This reset link is invalid or has expired. Request a new password reset email.");
      await MatrixDB.updatePassword(resetPasswordNew.value);
      await MatrixDB.signOut();
      window.history.replaceState({}, document.title, "portal.html");
      showLogin();
      loginAlert.className = "alert alert-success";
      loginAlert.textContent = "Your password has been updated. You can now sign in with your new password.";
      loginAlert.style.display = "block";
    } catch (error) {
      resetPasswordAlert.className = "alert alert-danger";
      resetPasswordAlert.textContent = error.message;
      resetPasswordAlert.style.display = "block";
    } finally {
      resetPasswordSubmit.disabled = false;
    }
  }

  // Handle Register
  async function handleRegister(e) {
    e.preventDefault();
    registerAlert.style.display = "none";
    document.querySelectorAll(".form-error").forEach(el => el.textContent = "");

    let hasErrors = false;

    // Local Field Validations
    if (!regFullName.value.trim()) {
      errFullName.textContent = "Full name is required.";
      hasErrors = true;
    } else if (!/^[\p{L} .'-]+$/u.test(regFullName.value.trim()) || regFullName.value.trim().length > 30) {
      errFullName.textContent = "Use letters and normal name punctuation only, up to 30 characters.";
      hasErrors = true;
    }

    const usernameVal = regUsername.value.trim();
    if (!usernameVal) {
      errUsername.textContent = "Username is required.";
      hasErrors = true;
    } else if (!/^[a-zA-Z0-9_-]+$/.test(usernameVal)) {
      errUsername.textContent = "Username can only contain alphanumeric characters, underscores, or hyphens.";
      hasErrors = true;
    }

    const emailVal = regEmail.value.trim();
    if (!emailVal) {
      errEmail.textContent = "Email address is required.";
      hasErrors = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      errEmail.textContent = "Invalid email format.";
      hasErrors = true;
    }

    if (!/^09\d{9}$/.test(regPhone.value.trim())) {
      errPhone.textContent = "Enter an 11-digit Philippine number starting with 09.";
      hasErrors = true;
    }

    if (!regWallet.value.trim()) {
      errWallet.textContent = "Wallet address is required.";
      hasErrors = true;
    } else if (regWallet.value.trim().length > 52) {
      errWallet.textContent = "F3 wallet cannot exceed 52 characters.";
      hasErrors = true;
    }

    if (regPassword.value.length < 10 || !/[A-Za-z]/.test(regPassword.value) || !/\d/.test(regPassword.value)) {
      errPassword.textContent = "Use at least 10 characters with a letter and a number.";
      hasErrors = true;
    }
    if (regPasswordConfirm.value !== regPassword.value) {
      errPasswordConfirm.textContent = "Passwords do not match.";
      hasErrors = true;
    }

    if (hasErrors) return;

    // Proceed to DB registration
    try {
      const data = {
        fullName: regFullName.value,
        username: usernameVal,
        email: emailVal,
        phone: regPhone.value,
        walletAddress: regWallet.value
      };

      if (window.MATRIX_USES_SUPABASE) {
        const result = await MatrixDB.signUp(data, regPassword.value);
        if (result.requiresEmailConfirmation) {
          registerAlert.className = "alert alert-success";
          registerAlert.textContent = "Account created. Check your email to confirm your address, then sign in.";
          registerAlert.style.display = "block";
          registerForm.reset();
          return;
        }
        const member = await MatrixDB.getAuthenticatedMember();
        renderDashboard(member);
        return;
      }

      const result = MatrixDB.registerPending(data, regPassword.value);
      sessionStorage.setItem(SESSION_KEY, result.id);
      renderDashboard(result);

    } catch (err) {
      registerAlert.className = "alert alert-danger";
      registerAlert.textContent = err.message;
      registerAlert.style.display = "block";
    }
  }

  // Session Check
  async function checkSession() {
    if (window.MATRIX_USES_SUPABASE) {
      try {
        const member = await MatrixDB.getAuthenticatedMember();
        if (member) {
          renderDashboard(member);
          return true;
        }
      } catch (error) {
        showLoginError(error.message);
      }
      return false;
    }
    const loggedInId = sessionStorage.getItem(SESSION_KEY);
    if (!loggedInId) return false;

    let member = null;
    try {
      member = MatrixDB.getMemberById(loggedInId);
    } catch (error) {
      logout();
      return false;
    }
    if (member) {
      renderDashboard(member);
      return true;
    }

    logout();
    return false;
  }

  // Render Pending Member Dashboard
  function renderPendingDashboard(pending) {
    authSection.style.display = "none";
    dashboardSection.style.display = "block";

    // Setup Header User Status
    headerUserName.textContent = pending.fullName;
    headerAvatarLetter.textContent = pending.fullName.charAt(0).toUpperCase();
    headerUserStatus.style.display = "flex";
    document.dispatchEvent(new CustomEvent("matrix:member-authenticated", { detail: { member: pending } }));

    // Fill Sidebar Details
    dbStatusBadge.className = "badge badge-pending";
    dbStatusBadge.textContent = "Pending";
    dbAvatarLetter.textContent = pending.fullName.charAt(0).toUpperCase();
    dbFullName.textContent = pending.fullName;
    dbUsername.textContent = `@${pending.username}`;
    dbWallet.textContent = shortenWallet(pending.walletAddress);
    dbEmail.textContent = pending.email;
    dbPhone.textContent = pending.phone;
    dbJoinDate.textContent = formatDate(pending.createdAt);
    dbSponsor.textContent = "Not in Premium Plan yet";
    populateProfileDetailsForm(pending);

    // Hide Premium Plan upline code
    referralContainer.style.display = "none";

    // Fill Dashboard Views
    dbWelcomeTitle.textContent = `Welcome, ${pending.fullName}!`;
    dbWelcomeDesc.textContent = "Your account is currently under manual review by the site administrator.";

    activeMetricsRow.style.display = "none";
    activeTreeCard.style.display = "none";
    premiumNextStep.style.display = "none";
    balanceCard.style.display = "none";
    productsPlusCard.style.display = "none";

    pendingDetailsCard.style.display = "block";
    
    const plan = MatrixDB.MATRIX_PLANS[pending.requestedPlanId];
    pendingCardPlan.textContent = plan ? plan.name : pending.requestedPlanId;
    pendingCardDate.textContent = formatDate(pending.createdAt);
    pendingCardPrice.textContent = plan ? plan.price : "-";
  }

  // Render Approved Active Member Dashboard
  function renderDashboard(member) {
    authSection.style.display = "none";
    dashboardSection.style.display = "block";

    // Setup Header User Status
    headerUserName.textContent = member.fullName;
    headerAvatarLetter.textContent = member.fullName.charAt(0).toUpperCase();
    headerUserStatus.style.display = "flex";
    document.dispatchEvent(new CustomEvent("matrix:member-authenticated", { detail: { member } }));

    const summary = MatrixDB.getMemberMatrixSummary(member.id);
    const adminMenuButton = accountMenu.querySelector('[data-account-action="admin"]');
    if (adminMenuButton) adminMenuButton.hidden = !(FEATURES.adminPortal && summary && summary.isAdmin);

    if (member.status !== "active") {
      renderFreeAccountDashboard(member);
      return;
    }

    // Fill Sidebar Details
    dbStatusBadge.className = "badge badge-active";
    dbStatusBadge.textContent = "Active";
    dbAvatarLetter.textContent = member.fullName.charAt(0).toUpperCase();
    dbFullName.textContent = member.fullName;
    dbUsername.textContent = `@${member.username}`;
    dbWallet.textContent = shortenWallet(member.walletAddress);
    dbEmail.textContent = member.email;
    dbPhone.textContent = member.phone;
    dbJoinDate.textContent = formatDate(member.createdAt);
    dbAccountId.textContent = member.accountCode;
    populateProfileDetailsForm(member);

    dbSponsor.textContent = "Use this code for direct Premium Plan placement";

    // Show Premium Plan upline code panel
    referralContainer.style.display = member.matrixUplineCode ? "block" : "none";
    refLinkInput.value = member.matrixUplineCode || "";

    // Welcome Box details
    dbWelcomeTitle.textContent = premiumViewRequested ? "Premium Plan" : "Overview";
    dbWelcomeDesc.textContent = premiumViewRequested ? "Review your matrix position, exits, income, and Products Plus." : `Welcome back, ${member.fullName.split(/\s+/)[0]}. Here's where your plans and funds stand today.`;
    dashboardWelcomeMeta.hidden = premiumViewRequested;
    dashboardAccountState.textContent = "Account ready";

    // Active components
    pendingDetailsCard.style.display = "none";
    activeMetricsRow.style.display = "grid";
    premiumNextStep.style.display = "flex";
    balanceCard.style.display = "block";
    productsPlusCard.style.display = FEATURES.productsPlus ? "block" : "none";
    activeTreeCard.style.display = "block";

    // Find position detail
    const pos = summary && summary.position ? summary.position : MatrixDB.getPositionByMemberId(member.id);
    const positions = pos ? [pos] : [];
    renderPremiumNextStep(member, summary);
    renderPremiumRules(summary);
    renderBalancePanel(member, summary);
    renderProductsPlusPanel(member, summary);
    renderNotifications(summary);
    renderShippingAddresses(MatrixDB.getShippingAddresses());
    setDashboardView(member);
    renderMemberOverview(member, summary);

    if (pos) {
      // Calculate direct 1200 downlines and total downline children
      metricReferrals.textContent = Number(summary.referralCount || 0);
      metricChildren.textContent = Number(summary.descendantCount || 0);

      // Render matrix tree
      renderDownlineTree(member.id, pos.planId, member);
    } else {
      metricReferrals.textContent = Number(summary.referralCount || 0);
      metricChildren.textContent = "0";
      treeVisualizer.innerHTML = `<div class="empty-state"><p>Matrix position is not established. Contact admin.</p></div>`;
    }
  }

  function setDashboardView(member) {
    dashboardContent.classList.toggle("show-premium", premiumViewRequested);
    document.body.classList.toggle("premium-plan-view", premiumViewRequested);
    dashboardOverview.hidden = premiumViewRequested;
    premiumProductProgress.style.display = premiumViewRequested && member.status !== "active" ? "grid" : "none";
    if (premiumViewRequested && member.status !== "active") renderPremiumProductProgress();
    premiumActivation.style.display = premiumViewRequested && member.status !== "active" && FEATURES.entryActivation ? "block" : "none";
    if (premiumViewRequested && member.status !== "active" && FEATURES.entryActivation) renderPremiumActivation(member);
    else premiumActivationLoad += 1;
  }

  async function renderPremiumActivation(member) {
    const load = ++premiumActivationLoad;
    premiumActivationMember = member;
    premiumActivationForm.hidden = false;
    premiumActivationPending.hidden = true;
    premiumActivationSubmit.disabled = true;
    premiumActivationStatus.textContent = "Checking";
    premiumActivationStatus.className = "benefit-state benefit-state-pending";
    premiumActivationAlert.style.display = "none";
    try {
      const methods = window.MATRIX_USES_SUPABASE
        ? (await window.matrixSupabase.rpc("get_active_payment_methods"))
        : { data: MatrixDB.getPaymentMethods() };
      if (methods.error) throw methods.error;
      if (load !== premiumActivationLoad) return;
      const selected = premiumActivationMethod.value;
      premiumActivationMethod.innerHTML = (methods.data || []).length
        ? methods.data.map(method => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)} - ${escapeHtml(method.accountName)}</option>`).join("")
        : '<option value="">No active payment methods</option>';
      if ((methods.data || []).some(method => method.id === selected)) premiumActivationMethod.value = selected;
      premiumActivationMethod._methods = methods.data || [];
      renderPremiumPaymentMethod();
      let requests;
      if (window.MATRIX_USES_SUPABASE) {
        const { data, error } = await window.matrixSupabase.rpc("get_my_entry_requests");
        if (error) throw error;
        requests = data || [];
      } else {
        requests = MatrixDB.getMemberUpgradeRequests(member.id);
      }
      if (load !== premiumActivationLoad) return;
      const pending = requests.find(request => request.status === "pending");
      if (pending) {
        showPremiumActivationPending(pending);
      } else {
        const rejected = requests.find(request => request.status === "rejected");
        premiumActivationStatus.textContent = rejected ? "Not approved" : "Not submitted";
        premiumActivationStatus.className = "benefit-state benefit-state-locked";
        premiumActivationSubmit.disabled = !premiumActivationMethod.value;
        if (rejected) showPremiumActivationAlert("Your previous request was not approved. Check the details and submit a new reference.", "info");
      }
    } catch (error) {
      if (load !== premiumActivationLoad) return;
      showPremiumActivationAlert(error.message, "danger");
    }
  }

  function renderPremiumPaymentMethod() {
    const method = (premiumActivationMethod._methods || []).find(item => item.id === premiumActivationMethod.value);
    premiumActivationMethodDetails.innerHTML = method ? `${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} payment QR code">` : ""}<div><strong>${escapeHtml(method.methodName)}</strong><p>${escapeHtml(method.accountName)} · ${escapeHtml(method.accountNumber)}</p>${method.instructions ? `<small>${escapeHtml(method.instructions)}</small>` : ""}</div>` : "";
    if (!premiumActivationForm.hidden) premiumActivationSubmit.disabled = !method;
  }

  async function handlePremiumActivationSubmit(event) {
    event.preventDefault();
    if (!premiumActivationMember || premiumActivationMember.status === "active" || premiumActivationSubmit.disabled) return;
    if (!document.getElementById("premium-activation-confirm").checked) {
      showPremiumActivationAlert("Confirm the payment details before submitting.", "danger");
      return;
    }
    const reference = premiumActivationReference.value.trim();
    const uplineCode = premiumActivationUpline.value.trim().toUpperCase();
    const methodId = premiumActivationMethod.value;
    if (!methodId) return showPremiumActivationAlert("Choose a payment method.", "danger");
    premiumActivationSubmit.disabled = true;
    premiumActivationAlert.style.display = "none";
    try {
      let pending;
      if (window.MATRIX_USES_SUPABASE) {
        const { data, error } = await window.matrixSupabase.rpc("request_entry_activation", { p_reference_number: reference, p_matrix_upline_code: uplineCode, p_payment_method_id: methodId });
        if (error) throw error;
        pending = (data || []).find(request => request.status === "pending");
      } else {
        pending = MatrixDB.requestUpgrade(premiumActivationMember.id, reference, uplineCode);
      }
      showPremiumActivationPending(pending || { referenceNumber: reference, matrixUplineCode: uplineCode, paymentMethodSnapshot: (premiumActivationMethod._methods || []).find(item => item.id === methodId) });
      showPremiumActivationAlert("Your Premium Plan activation request was submitted for review.", "success");
    } catch (error) {
      premiumActivationSubmit.disabled = false;
      showPremiumActivationAlert(error.message, "danger");
    }
  }

  function showPremiumActivationPending(request) {
    premiumActivationStatus.textContent = "Pending approval";
    premiumActivationStatus.className = "benefit-state benefit-state-pending";
    premiumActivationForm.hidden = true;
    premiumActivationPending.hidden = false;
    document.getElementById("premium-pending-reference").textContent = request.referenceNumber || "-";
    document.getElementById("premium-pending-method").textContent = request.paymentMethodSnapshot?.methodName || "-";
    document.getElementById("premium-pending-upline").textContent = request.matrixUplineCode || "-";
  }

  function showPremiumActivationAlert(message, type) {
    premiumActivationAlert.className = `alert alert-${type}`;
    premiumActivationAlert.textContent = message;
    premiumActivationAlert.style.display = "block";
  }

  function renderPremiumRules(summary) {
    const rulesCard = document.getElementById("premium-rules-card");
    const exits = summary && summary.exits || [];
    const ledger = summary && summary.rewardLedger || [];
    const entry = summary && summary.rules && summary.rules.entry;
    rulesCard.style.display = premiumViewRequested && (exits.length || entry) ? "block" : "none";
    const incomeRows = [];
    if (entry && Number(entry.passiveMonths) > 0) {
      const eligible = ledger.filter(item => item.sourceType === "entry" && item.status !== "void" && new Date(item.dueAt) <= new Date()).length;
      const active = summary && summary.member && summary.member.status === "active";
      incomeRows.push(`<tr><th scope="row">Entry</th><td>PHP ${formatNumber(entry.passiveIncome)}</td><td>${MatrixBenefits.progress(eligible, entry.passiveMonths)}</td><td>${MatrixBenefits.state(active ? "Active" : "Locked", active ? "active" : "locked")}</td></tr>`);
    }
    exits.filter(exit => Number(exit.passiveMonths) > 0).forEach(exit => {
      const eligible = ledger.filter(item => item.sourceType === "exit" && Number(item.exit) === Number(exit.exit) && item.status !== "void" && new Date(item.dueAt) <= new Date()).length;
      incomeRows.push(`<tr><th scope="row">Exit ${Number(exit.exit)}</th><td>PHP ${formatNumber(exit.passiveIncome)}</td><td>${MatrixBenefits.progress(eligible, exit.passiveMonths)}</td><td>${MatrixBenefits.state(capitalizeStatus(exit.status), exit.status === "active" ? "active" : exit.status === "qualified" || exit.status === "pending" ? "pending" : "locked")}</td></tr>`);
    });
    exits.filter(exit => Number(exit.matrixIncome) > 0 && Number(exit.matrixMonths) > 0).forEach(exit => {
      const eligible = ledger.filter(item => item.sourceType === "matrix" && Number(item.exit) === Number(exit.exit) && item.status !== "void" && new Date(item.dueAt) <= new Date()).length;
      incomeRows.push(`<tr><th scope="row">Exit ${Number(exit.exit)} matrix</th><td>PHP ${formatNumber(exit.matrixIncome)}</td><td>${MatrixBenefits.progress(eligible, exit.matrixMonths)}</td><td>${MatrixBenefits.state(capitalizeStatus(exit.status), exit.status === "active" ? "active" : exit.status === "qualified" || exit.status === "pending" ? "pending" : "locked")}</td></tr>`);
    });
    document.getElementById("premium-rules-rows").innerHTML = incomeRows.join("");
    const entitlements = summary && summary.productPlusEntitlements || [];
    document.getElementById("premium-benefit-products-rows").innerHTML = exits.filter(exit => Number(exit.productMonths) > 0).map(exit => {
      const benefit = entitlements.find(item => Number(item.exit) === Number(exit.exit));
      const eligible = benefit && benefit.active ? Number(benefit.vestedMonths || 0) : 0;
      const bonus = Number(exit.productSpend || 0) * Number(exit.productBonusPercent || 0) / 100;
      return `<tr><th scope="row">Exit ${Number(exit.exit)}</th><td>PHP ${formatNumber(exit.productSpend)}</td><td>PHP ${formatNumber(bonus)} (${Number(exit.productBonusPercent || 0)}%)</td><td>${MatrixBenefits.progress(eligible, exit.productMonths)}</td><td>${MatrixBenefits.state(benefit && benefit.active ? "Active" : "Locked", benefit && benefit.active ? "active" : "locked")}</td></tr>`;
    }).join("");
  }

  async function renderPremiumProductProgress() {
    if (!window.matrixSupabase) return;
    const badge = document.getElementById("premium-product-progress-badge");
    try {
      const { data, error } = await window.matrixSupabase.rpc("get_my_product_entry_progress", { p_entry_type: "matrix_1200_entry" });
      if (error) throw error;
      const approved = Number(data?.approvedAmount || 0);
      const pending = Number(data?.pendingAmount || 0);
      const target = Number(data?.targetAmount || 1500);
      const remaining = Math.max(Number(data?.remainingAmount ?? target - approved), 0);
      const percent = target > 0 ? Math.min(approved / target * 100, 100) : 0;
      const money = value => `PHP ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      badge.textContent = `${Math.round(percent)}% Complete`;
      document.getElementById("premium-product-progress-bar").style.width = `${percent}%`;
      document.getElementById("premium-product-approved").textContent = money(approved);
      document.getElementById("premium-product-pending").textContent = money(pending);
      document.getElementById("premium-product-remaining").textContent = money(remaining);
    } catch (error) {
      badge.textContent = "Progress unavailable";
    }
  }

  async function renderMemberOverview(member, summary) {
    if (premiumViewRequested || !window.matrixSupabase) return;
    const standard = summary && summary.timelineDashboard;
    const patronizing = summary && summary.patronizingDashboard;
    const setPlanStatus = (id, label) => {
      const status = document.getElementById(id);
      status.textContent = label;
      status.dataset.state = label.toLowerCase().replace(/\s+/g, "-");
    };
    setPlanStatus("overview-premium-status", member.status === "active" ? "Active" : "Not active");
    setPlanStatus("overview-standard-status", standard && standard.isActive ? "Active" : standard && standard.pendingRequest ? "Pending review" : "Not active");
    setPlanStatus("overview-patronizing-status", patronizing && patronizing.entry ? "Active" : patronizing && (patronizing.pendingTokenRequest || patronizing.pendingProductEntryOrder) ? "Pending review" : "Not active");

    const [budgetResult, fundsResult, shopResult] = await Promise.all([
      window.matrixSupabase.rpc("get_my_budget_plan_dashboard"),
      window.matrixSupabase.rpc("get_my_member_funds_dashboard"),
      window.matrixSupabase.rpc("get_public_shop_products")
    ]);
    setPlanStatus("overview-budget-status", budgetResult.error ? "Unavailable" : budgetResult.data && budgetResult.data.isActive ? "Active" : budgetResult.data && Number(budgetResult.data.entryCredit || 0) > 0 ? "In progress" : "Not active");
    if (!fundsResult.error && fundsResult.data) {
      const money = value => `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById("overview-main-funds").textContent = money(fundsResult.data.mainAvailable);
      document.getElementById("overview-investment-funds").textContent = money(fundsResult.data.investmentAvailable);
    }
    const preview = document.getElementById("overview-shop-products");
    if (shopResult.error) {
      preview.innerHTML = '<p class="shop-empty">Products are temporarily unavailable.</p>';
      return;
    }
    const products = Array.isArray(shopResult.data) ? shopResult.data.slice(0, 3) : [];
    preview.innerHTML = products.length ? products.map(product => {
      const image = /^(?:data:image\/(?:png|jpeg|webp|gif);base64,|assets\/products\/[a-z0-9-]+\.(?:jpg|png)$)/i.test(product.photoData || "") ? product.photoData : "";
      const price = Number(product.price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `<a class="dashboard-shop-item" href="shop.html">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">` : '<span class="dashboard-shop-no-photo">Photo unavailable</span>'}<span class="dashboard-shop-info"><strong>${escapeHtml(product.name)}</strong><span>PHP ${price}</span></span></a>`;
    }).join("") : '<p class="shop-empty">No products are available yet.</p>';
  }

  function renderNotifications(summary) {
    const notifications = summary && Array.isArray(summary.notifications) ? summary.notifications : [];
    const highCount = notifications.filter(item => item.priority === "high").length;
    notificationCount.hidden = notifications.length === 0;
    notificationCount.textContent = String(Math.min(notifications.length, 99));
    notificationSummary.textContent = notifications.length ? `${notifications.length} update${notifications.length === 1 ? "" : "s"}` : "No updates";
    notificationMenuToggle.classList.toggle("has-notifications", notifications.length > 0);
    notificationMenuToggle.classList.toggle("has-priority", highCount > 0);
    notificationList.innerHTML = notifications.length ? notifications.map(item => `
      <article class="notification-item ${item.priority === "high" ? "priority" : ""}">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.message)}</p>
        <span>${formatDateTime(item.createdAt)}</span>
      </article>
    `).join("") : `<div class="notification-empty">You have no new member updates.</div>`;
  }

  function populateProfileDetailsForm(member) {
    if (!member) return;
    profileFullName.value = member.fullName || "";
    profileUsername.value = member.username || "";
    profilePhone.value = member.phone || "";
    profileWallet.value = member.walletAddress || "";
  }

  async function handleProfileDetailsSubmit(event) {
    event.preventDefault();
    profileDetailsAlert.style.display = "none";
    profileDetailsSave.disabled = true;
    try {
      await MatrixDB.updateMyProfileDetails({
        fullName: profileFullName.value.trim(),
        username: profileUsername.value.trim(),
        phone: profilePhone.value.trim(),
        walletAddress: profileWallet.value.trim()
      });
      const updated = await MatrixDB.getAuthenticatedMember();
      renderDashboard(updated);
      showProfileDetailsAlert("Profile details updated.", "success");
    } catch (error) {
      showProfileDetailsAlert(error.message, "danger");
    } finally {
      profileDetailsSave.disabled = false;
    }
  }

  function showProfileDetailsAlert(message, type) {
    profileDetailsAlert.className = `alert alert-${type}`;
    profileDetailsAlert.textContent = message;
    profileDetailsAlert.style.display = "block";
  }

  function renderShippingAddresses(addresses = []) {
    shippingAddressCount.textContent = String(addresses.length);
    shippingDefault.checked = addresses.length === 0;
    if (!addresses.length) {
      shippingAddressList.innerHTML = `<div class="shipping-address-empty">No shipping address yet.</div>`;
      return;
    }

    shippingAddressList.innerHTML = addresses.map(address => `
      <article class="shipping-address-panel" data-address-id="${escapeHtml(address.id)}">
        <div class="shipping-address-topline">
          <strong>${escapeHtml(address.fullName)}</strong>
          ${address.isDefault ? `<span class="badge badge-active">Default</span>` : ""}
        </div>
        <p>${escapeHtml(address.streetAddress)}, ${escapeHtml(address.barangay)}, ${escapeHtml(address.city)}, ${escapeHtml(address.province)}, ${escapeHtml(address.region)} ${escapeHtml(address.postalCode)}</p>
        <span>${escapeHtml(address.phone)}</span>
        ${address.notes ? `<small>${escapeHtml(address.notes)}</small>` : ""}
        <div class="profile-form-actions">
          <button class="button button-outline button-small edit-shipping-address" type="button">Edit</button>
          <button class="button button-outline button-small delete-shipping-address" type="button">Delete</button>
        </div>
      </article>
    `).join("");

    shippingAddressList.querySelectorAll("[data-address-id]").forEach(panel => {
      const address = addresses.find(item => item.id === panel.dataset.addressId);
      panel.querySelector(".edit-shipping-address").addEventListener("click", () => populateShippingAddressForm(address));
      panel.querySelector(".delete-shipping-address").addEventListener("click", async () => {
        if (!window.confirm("Delete this shipping address?")) return;
        shippingAddressAlert.style.display = "none";
        try {
          await MatrixDB.deleteShippingAddress(address.id);
          renderShippingAddresses(MatrixDB.getShippingAddresses());
          showShippingAddressAlert("Shipping address deleted.", "success");
        } catch (error) {
          showShippingAddressAlert(error.message, "danger");
        }
      });
    });
  }

  function populateShippingAddressForm(address) {
    if (!address) return;
    shippingAddressId.value = address.id;
    shippingFullName.value = address.fullName || "";
    shippingPhone.value = address.phone || "";
    shippingRegion.value = address.region || "";
    shippingProvince.value = address.province || "";
    shippingCity.value = address.city || "";
    shippingBarangay.value = address.barangay || "";
    shippingStreet.value = address.streetAddress || "";
    shippingPostal.value = address.postalCode || "";
    shippingNotes.value = address.notes || "";
    shippingDefault.checked = Boolean(address.isDefault);
    shippingCancelBtn.hidden = false;
    shippingSaveBtn.textContent = "Update Address";
    shippingFullName.focus();
  }

  function resetShippingAddressForm() {
    shippingAddressForm.reset();
    shippingAddressId.value = "";
    shippingDefault.checked = MatrixDB.getShippingAddresses().length === 0;
    shippingCancelBtn.hidden = true;
    shippingSaveBtn.textContent = "Save Address";
  }

  async function handleShippingAddressSubmit(event) {
    event.preventDefault();
    shippingAddressAlert.style.display = "none";
    shippingSaveBtn.disabled = true;
    try {
      await MatrixDB.saveShippingAddress({
        id: shippingAddressId.value || null,
        fullName: shippingFullName.value.trim(),
        phone: shippingPhone.value.trim(),
        region: shippingRegion.value.trim(),
        province: shippingProvince.value.trim(),
        city: shippingCity.value.trim(),
        barangay: shippingBarangay.value.trim(),
        streetAddress: shippingStreet.value.trim(),
        postalCode: shippingPostal.value.trim(),
        notes: shippingNotes.value.trim(),
        isDefault: shippingDefault.checked
      });
      renderShippingAddresses(MatrixDB.getShippingAddresses());
      resetShippingAddressForm();
      showShippingAddressAlert("Shipping address saved.", "success");
      const returnTo = params.get("returnTo");
      if (returnTo) {
        const returnUrl = new URL(returnTo, window.location.origin);
        if (returnUrl.origin === window.location.origin && returnUrl.pathname === "/packages-orders.html") {
          window.location.assign(`${returnUrl.pathname}${returnUrl.search}`);
        }
      }
    } catch (error) {
      showShippingAddressAlert(error.message, "danger");
    } finally {
      shippingSaveBtn.disabled = false;
    }
  }

  function showShippingAddressAlert(message, type) {
    shippingAddressAlert.className = `alert alert-${type}`;
    shippingAddressAlert.textContent = message;
    shippingAddressAlert.style.display = "block";
  }

  function countMatrixDescendants(parentMemberId, planId, positions) {
    const childrenByParent = new Map();
    positions.forEach(position => {
      if (position.planId !== planId || !position.parentMemberId) return;
      const children = childrenByParent.get(position.parentMemberId) || [];
      children.push(position.memberId);
      childrenByParent.set(position.parentMemberId, children);
    });

    const visited = new Set([parentMemberId]);
    const pending = [...(childrenByParent.get(parentMemberId) || [])];
    let count = 0;

    while (pending.length) {
      const memberId = pending.pop();
      if (visited.has(memberId)) continue;
      visited.add(memberId);
      count += 1;
      pending.push(...(childrenByParent.get(memberId) || []));
    }

    return count;
  }

  function renderFreeAccountDashboard(member) {
    dbStatusBadge.className = "badge badge-pending"; dbStatusBadge.textContent = "Free Account";
    dbAvatarLetter.textContent = member.fullName.charAt(0).toUpperCase(); dbFullName.textContent = member.fullName; dbUsername.textContent = `@${member.username}`;
    dbWallet.textContent = shortenWallet(member.walletAddress); dbEmail.textContent = member.email; dbPhone.textContent = member.phone; dbJoinDate.textContent = formatDate(member.createdAt);
    dbAccountId.textContent = member.accountCode;
    dbSponsor.textContent = "Not in Premium Plan yet";
    populateProfileDetailsForm(member);
    renderShippingAddresses(MatrixDB.getShippingAddresses());
    referralContainer.style.display = "none";
    dbWelcomeTitle.textContent = premiumViewRequested ? "Premium Plan" : "Overview";
    dbWelcomeDesc.textContent = premiumViewRequested ? "Activate the Premium Plan to join its matrix." : `Welcome back, ${member.fullName.split(/\s+/)[0]}. Here's where your plans and funds stand today.`;
    dashboardWelcomeMeta.hidden = premiumViewRequested;
    dashboardAccountState.textContent = "Account ready";
    activeMetricsRow.style.display = "none"; pendingDetailsCard.style.display = "none"; balanceCard.style.display = "none"; productsPlusCard.style.display = "none"; activeTreeCard.style.display = "none";
    premiumNextStep.style.display = "none";
    renderPremiumRules(MatrixDB.getMemberMatrixSummary(member.id));
    setDashboardView(member);
    renderMemberOverview(member, MatrixDB.getMemberMatrixSummary(member.id));
  }

  function renderPremiumNextStep(member, summary) {
    const nextExit = summary && summary.exits && summary.exits.find(exit => exit.status !== "active");
    premiumNextStepAction.hidden = true;
    premiumNextStepAction.onclick = null;
    premiumNextStepStatus.className = "benefit-state";
    if (member.status !== "active") {
      return;
    }
    if (!nextExit) {
      premiumNextStepTitle.textContent = "All exits active";
      premiumNextStepStatus.textContent = "Active";
      premiumNextStepStatus.classList.add("benefit-state-active");
      premiumNextStepCopy.textContent = "Review your monthly income and Products Plus eligibility below.";
      return;
    }
    const remaining = Math.max(Number(nextExit.requiredDownlines || 0) - Number(nextExit.qualifiedDownlines || 0), 0);
    const requiredLevel = Number(nextExit.requiredDownlineExit || 0) === 0 ? "Entry" : `Exit ${nextExit.requiredDownlineExit}`;
    premiumNextStepTitle.textContent = `Exit ${nextExit.exit}`;
    premiumNextStepStatus.textContent = capitalizeStatus(nextExit.status);
    premiumNextStepStatus.classList.add(nextExit.status === "qualified" ? "benefit-state-active" : "benefit-state-pending");
    if (nextExit.status === "qualified") {
      premiumNextStepCopy.textContent = `${nextExit.actionLabel}: PHP ${formatNumber(nextExit.actionAmount)}. Your downline requirement is complete; submit the exit request for approval.`;
      premiumNextStepAction.hidden = false;
      premiumNextStepAction.href = `exit-action.html?exit=${encodeURIComponent(nextExit.exit)}`;
      premiumNextStepAction.textContent = nextExit.actionType === "reinvest" || /^Re-Stake/i.test(nextExit.actionLabel) ? "Re-Stake" : "Buy";
    } else if (nextExit.status === "pending") {
      premiumNextStepCopy.textContent = "Your exit request is awaiting admin approval.";
    } else {
      premiumNextStepCopy.textContent = `${remaining} direct ${remaining === 1 ? "downline" : "downlines"} at ${requiredLevel} needed to qualify.`;
    }
  }

  function renderStatusIcon(locked) {
    return locked
      ? `<svg class="status-icon status-icon-lock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M4.5 7V5.25a3.5 3.5 0 0 1 7 0V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7h.75Zm1.5 0h4V5.25a2 2 0 1 0-4 0V7Z"/></svg>`
      : `<svg class="status-icon status-icon-unlock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M10 7V5.25a2 2 0 0 0-3.74-1l-1.3-.75A3.5 3.5 0 0 1 11.5 5.25V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7H10Z"/></svg>`;
  }


  function renderBalancePanel(member, summary) {
    const earned = Number(summary ? summary.earnedBalance : 0);
    const pending = Number(summary ? summary.pendingWithdrawal : 0);
    const pendingExitBalance = Number(summary ? summary.pendingExitBalance : 0);
    const available = Math.max(earned - pending - pendingExitBalance, 0);

    balanceTotalBadge.textContent = `PHP ${formatNumber(available)}`;
    balanceTotal.textContent = `PHP ${formatNumber(available)}`;
    requestWithdrawalBtn.disabled = false;
    requestWithdrawalBtn.title = "Transfer eligible matrix income to Main Funds";
  }

  function renderProductsPlusPanel(member, summary) {
    const entitlements = summary && summary.productPlusEntitlements ? summary.productPlusEntitlements : [];
    const vouchers = summary && summary.vouchers ? summary.vouchers : { balance: 0, history: [] };
    voucherBalance.textContent = `PHP ${formatNumber(vouchers.balance || 0)}`;
    voucherHistory.innerHTML = vouchers.history && vouchers.history.length ? vouchers.history.map(entry => `<article class="product-plus-month vested"><div class="product-plus-month-index">${Number(entry.amount) >= 0 ? "+" : "−"}</div><div><h5>${entry.type === "credit" ? "Voucher credit" : "Voucher redemption"}: PHP ${formatNumber(Math.abs(Number(entry.amount)))}</h5><p>${escapeHtml(entry.reference)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""} · ${formatDate(entry.createdAt)}</p></div></article>`).join("") : `<div class="empty-state"><p>No voucher activity yet.</p></div>`;
    const totalAvailable = entitlements.reduce((total, item) => total + Number(item.availableVestedSpend || 0), 0);
    productsPlusBadge.textContent = `PHP ${formatNumber(totalAvailable)} Available`;

    if (entitlements.length === 0) {
      productsPlusTabs.innerHTML = "";
      productsPlusList.innerHTML = `<div class="empty-state"><p>No Products Plus rewards are configured.</p></div>`;
      return;
    }

    let selectedExit = entitlements[0].exit;
    productsPlusTabs.innerHTML = entitlements.map(item => `
      <button class="matrix-tab ${item.exit === selectedExit ? "active" : ""} ${item.active ? "" : "locked"}" type="button" data-products-exit="${item.exit}" role="tab" aria-selected="${item.exit === selectedExit}">
        <strong>Exit ${item.exit}</strong>
        <span class="matrix-tab-status">${renderStatusIcon(!item.active)}<span>${item.active ? `${item.vestedMonths}/${item.productMonths} vested` : "Locked"}</span></span>
      </button>
    `).join("");

    productsPlusTabs.querySelectorAll(".matrix-tab").forEach(button => {
      button.addEventListener("click", () => {
        selectedExit = Number(button.dataset.productsExit);
        productsPlusTabs.querySelectorAll(".matrix-tab").forEach(tabButton => {
          const selected = Number(tabButton.dataset.productsExit) === selectedExit;
          tabButton.classList.toggle("active", selected);
          tabButton.setAttribute("aria-selected", selected ? "true" : "false");
        });
        renderSelectedProductPlus();
      });
    });
    enableDragScroll(productsPlusTabs);
    renderSelectedProductPlus();

    function renderSelectedProductPlus() {
      const item = entitlements.find(entitlement => entitlement.exit === selectedExit);
      if (!item) return;
      const available = Number(item.availableVestedSpend || 0);
      const used = Number(item.approvedSpend || 0) + Number(item.pendingSpend || 0);
      productsPlusStatus.innerHTML = `${renderStatusIcon(!item.active)}<span>${item.active ? "Available" : "Locked"}</span>`;
      productsPlusStatus.className = `matrix-qualification ${item.active ? "qualified" : "locked"}`;
      productsPlusAvailable.textContent = `PHP ${formatNumber(available)}`;
      productsPlusSummary.textContent = item.active
        ? `PHP ${formatNumber(item.productBaseSpend)} in eligible purchases unlocks monthly. Approved purchases earn a ${item.productBonusPercent}% voucher; unused eligibility carries forward.`
        : `Products Plus begins after Exit ${item.exit} is approved. Nothing expires while this exit remains locked.`;
      productsPlusMonthly.textContent = `PHP ${formatNumber(item.productBaseSpend)} purchase`;
      productsPlusVested.textContent = `${item.vestedMonths} / ${item.productMonths}`;
      productsPlusRate.textContent = `${item.productBonusPercent}%`;
      productsPlusUsed.textContent = `PHP ${formatNumber(used)}`;
      productsPlusScheduleNote.textContent = `${item.vestedMonths}/${item.productMonths} months vested · PHP ${formatNumber(item.totalSpend)} total entitlement`;
      productsPlusRequestBtn.disabled = !item.active || available <= 0;
      productsPlusRequestBtn.onclick = () => openProductClaimModal(member.id, item.exit, available, item.productBonusPercent);
      productsPlusList.innerHTML = `
        <article class="product-plus-month ${item.vestedMonths > 0 ? "vested" : "upcoming"}">
          <div class="product-plus-month-index">${item.vestedMonths}/${item.productMonths}</div>
          <div>
            <h5>PHP ${formatNumber(item.productBaseSpend)} eligible purchase monthly</h5>
            <p>${item.nextUnlockAt ? `Next month vests ${formatDate(item.nextUnlockAt)}` : (item.active ? "All months vested" : `Starts after Exit ${item.exit} approval`)}</p>
          </div>
          <span class="withdrawal-status ${item.vestedMonths >= item.productMonths ? "status-approved" : "status-pending"}">${item.vestedMonths >= item.productMonths ? "Complete" : (item.active ? "Vesting" : "Locked")}</span>
        </article>
      `;
    }
  }

  // Draw Matrix Tree Structure
  async function renderDownlineTree(memberId, planId, loggedInUser) {
    const navigationStack = [];

    function buildNodeHtml(node, isFocusedRoot = false) {
      if (node.isOpenSlot) {
        return `<div class="tree-branch"><div class="tree-node-wrapper"><div class="tree-node-card empty-card"><div class="tree-node-name">Open Spot</div><div class="tree-node-username">Available</div></div></div></div>`;
      }
      const isRoot = node.id === loggedInUser.id;
      const stage = node.matrixStage || { label: "Entry", status: "active" };
      const canOpen = !isFocusedRoot && !node.isReferralPending && node.canTraverse !== false;
      const tag = canOpen ? "button" : "div";
      const attributes = canOpen ? `type="button" data-tree-member-id="${escapeHtml(node.id)}" aria-label="View ${escapeHtml(node.fullName)}'s direct downlines"` : "";
      return `
        <div class="tree-branch">
          <div class="tree-node-wrapper">
            <${tag} class="tree-node-card ${isRoot ? "root-card" : ""} ${isFocusedRoot ? "focused-card" : ""} ${canOpen ? "drillable-card" : ""} ${node.isReferralPending ? "referral-pending-card" : ""}" ${attributes}>
              <div class="tree-node-name" title="${escapeHtml(node.fullName)}">${escapeHtml(node.fullName)}</div>
              <div class="tree-node-username">@${escapeHtml(node.username)}</div>
              <div class="tree-node-stage stage-${stage.status}">
                ${renderStatusIcon(stage.status === "locked")}
                <span>${escapeHtml(stage.label)}</span>
                ${node.isReferralPending ? "" : `<small>${capitalizeStatus(stage.status)}</small>`}
              </div>
              ${canOpen ? `<div class="tree-node-open-hint">View direct downlines →</div>` : ""}
            </${tag}>
          </div>
        </div>
      `;
    }

    async function renderLevel(rootId) {
      treeVisualizer.setAttribute("aria-busy", "true");
      treeVisualizer.innerHTML = `<div class="empty-state tree-loading-state"><p>Loading matrix level...</p></div>`;
      let treeData;
      try {
        treeData = await MatrixDB.getMemberTree(rootId, planId);
      } catch (error) {
        treeVisualizer.removeAttribute("aria-busy");
        treeVisualizer.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message || "Unable to load this matrix level.")}</p><button class="button button-outline button-small" id="tree-retry-btn" type="button">Try Again</button></div>`;
        treeVisualizer.querySelector("#tree-retry-btn").addEventListener("click", () => renderLevel(rootId));
        return;
      }
      treeVisualizer.removeAttribute("aria-busy");
      if (!treeData) {
        treeVisualizer.innerHTML = `<div class="empty-state"><p>No downline positions found.</p></div>`;
        return;
      }
      const children = Array.isArray(treeData.children) ? treeData.children : [];
      treeVisualizer.innerHTML = `
        <div class="tree-explorer">
          <div class="tree-explorer-status"><span>Viewing direct downlines of</span><strong>${escapeHtml(treeData.fullName)}</strong></div>
          <div class="tree-wrapper">
            ${buildNodeHtml(treeData, true)}
            <div class="tree-children-container">${children.map(child => buildNodeHtml(child)).join("")}</div>
          </div>
          <div class="tree-explorer-actions">
            <button class="button button-outline button-small" id="tree-upline-btn" type="button" ${treeData.parent ? "" : "disabled"}>View Upline</button>
            <button class="button button-outline button-small" id="tree-back-btn" type="button" ${navigationStack.length ? "" : "disabled"}>← Back</button>
            <button class="button button-primary button-small" id="tree-home-btn" type="button" ${rootId === memberId ? "disabled" : ""}>My Node</button>
          </div>
        </div>`;

      treeVisualizer.querySelectorAll("[data-tree-member-id]").forEach(button => {
        button.addEventListener("click", async () => {
          navigationStack.push(rootId);
          await renderLevel(button.dataset.treeMemberId);
        });
      });
      treeVisualizer.querySelector("#tree-upline-btn").addEventListener("click", async () => {
        if (!treeData.parent) return;
        navigationStack.push(rootId);
        await renderLevel(treeData.parent.id);
      });
      treeVisualizer.querySelector("#tree-back-btn").addEventListener("click", async () => {
        const previousId = navigationStack.pop();
        if (previousId) await renderLevel(previousId);
      });
      treeVisualizer.querySelector("#tree-home-btn").addEventListener("click", async () => {
        navigationStack.length = 0;
        await renderLevel(memberId);
      });
    }

    await renderLevel(memberId);
  }

  // Copy Premium Plan upline code to clipboard
  function copyReferralLink() {
    refLinkInput.select();
    refLinkInput.setSelectionRange(0, 99999); // For mobile devices
    
    try {
      navigator.clipboard.writeText(refLinkInput.value).then(() => {
        showCopyToast();
      }).catch(err => {
        // Fallback copy
        document.execCommand('copy');
        showCopyToast();
      });
    } catch (e) {
      document.execCommand('copy');
      showCopyToast();
    }
  }

  function closeAccountMenu() {
    accountMenu.hidden = true;
    accountMenuToggle.setAttribute("aria-expanded", "false");
  }

  function closeNotificationMenu() {
    notificationMenu.hidden = true;
    notificationMenuToggle.setAttribute("aria-expanded", "false");
  }

  function openProfileDrawer() {
    closeAccountMenu();
    closeNotificationMenu();
    profileDrawer.classList.add("open");
    profileDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("profile-open");
    profileDrawerClose.focus();
  }

  function closeProfileDrawer() {
    if (!profileDrawer.classList.contains("open")) return;
    profileDrawer.classList.remove("open");
    profileDrawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("profile-open");
    accountMenuToggle.focus();
  }

  function focusDashboardSection(section) {
    if (!section || section.style.display === "none") return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => section.focus({ preventScroll: true }), 350);
  }

  function enableDragScroll(scroller) {
    if (scroller.dataset.dragReady === "true") return;
    scroller.dataset.dragReady = "true";
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;

    scroller.addEventListener("pointerdown", event => {
      if (event.pointerType === "touch") return;
      // Keep tabs and other controls fully clickable. Drag scrolling should only
      // begin from the scroller's non-interactive area.
      if (event.target.closest("button, a, input, select, textarea")) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.setPointerCapture(event.pointerId);
      scroller.classList.add("dragging");
    });
    scroller.addEventListener("pointermove", event => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 5) moved = true;
      scroller.scrollLeft = startScroll - delta;
    });
    const endDrag = event => {
      if (!dragging) return;
      dragging = false;
      scroller.classList.remove("dragging");
      if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    };
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointercancel", endDrag);
    scroller.addEventListener("click", event => {
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }, true);
  }

  function showCopyToast() {
    copyToast.style.display = "block";
    setTimeout(() => {
      copyToast.style.display = "none";
    }, 2000);
  }

  // Logout session
  async function logout() {
    if (window.MATRIX_USES_SUPABASE) {
      try { await MatrixDB.signOut(); } catch (error) { console.error(error); }
    } else if (MatrixDB.signOut) {
      try { MatrixDB.signOut(); } catch (error) { console.error(error); }
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("matrix_auth_token");
    showLogin();
  }

  // Utility String Formatters
  function shortenWallet(wallet) {
    if (!wallet) return "";
    if (wallet.length <= 12) return wallet;
    return `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return isoString;
    }
  }

  function formatDateTime(isoString) {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return isoString;
    }
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function capitalizeStatus(value) {
    return String(value || "locked")
      .replace("-", " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }
});
