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
  const regSponsor = document.getElementById("reg-sponsor");
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

  const activeMetricsRow = document.getElementById("active-metrics-row");
  const metricReferrals = document.getElementById("metric-referrals");
  const metricChildren = document.getElementById("metric-children");

  const matrixOverviewCard = document.getElementById("matrix-overview-card");
  const matrixTabs = document.getElementById("matrix-tabs");
  const matrixSelectedBadge = document.getElementById("matrix-selected-badge");
  const matrixQualification = document.getElementById("matrix-qualification");
  const matrixTitle = document.getElementById("matrix-title");
  const matrixSummary = document.getElementById("matrix-summary");
  const matrixRequirement = document.getElementById("matrix-requirement");
  const matrixActionLink = document.getElementById("matrix-action-link");
  const matrixActionMessage = document.getElementById("matrix-action-message");
  const matrixDateFact = document.getElementById("matrix-date-fact");
  const matrixDateLabel = document.getElementById("matrix-date-label");
  const matrixPlacedTime = document.getElementById("matrix-placed-time");
  const matrixExitNote = document.getElementById("matrix-exit-note");
  const matrixExits = document.getElementById("matrix-exits");
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
  const errSponsor = document.getElementById("err-sponsor");

  // Route URL queries
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const refSponsor = params.get("ref");
  const FEATURES = (window.MATRIX_CONFIG && window.MATRIX_CONFIG.features) || {};

  accountMenu.querySelectorAll('[data-account-action="withdraw"], [data-account-action="history"]').forEach(button => {
    button.hidden = !FEATURES.withdrawals;
  });
  requestWithdrawalBtn.hidden = !FEATURES.withdrawals;
  const passiveIncomeHistoryLink = document.getElementById("passive-income-history-link");
  if (passiveIncomeHistoryLink) passiveIncomeHistoryLink.hidden = !FEATURES.passiveIncomeHistory;

  const MATRIX_RULES = MatrixDB.getMatrixRules();

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
    } else if (window.location.hash === "#profile") {
      openProfileDrawer();
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
  } else if (action === "register") {
    showRegister();
    if (refSponsor) {
      regSponsor.value = refSponsor;
    }
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

  accountMenu.querySelectorAll("[data-account-action]").forEach(button => {
    button.addEventListener("click", () => {
      closeAccountMenu();
      if (button.dataset.accountAction === "profile") {
        openProfileDrawer();
      } else if (button.dataset.accountAction === "timeline") {
        window.location.href = "timeline-matrix.html";
      } else if (button.dataset.accountAction === "withdraw") {
        window.location.href = "withdrawal-request.html";
      } else if (button.dataset.accountAction === "history") {
        window.location.href = "withdrawal-history.html";
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
  requestWithdrawalBtn.addEventListener("click", () => {
    window.location.href = "withdrawal-request.html";
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
    if (resetPasswordNew.value.length < 8) {
      resetPasswordAlert.className = "alert alert-danger";
      resetPasswordAlert.textContent = "Your new password must contain at least 8 characters.";
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

    // Referral check (if provided, it must identify an account)
    const sponsorVal = regSponsor.value.trim();
    if (sponsorVal && !window.MATRIX_USES_SUPABASE) {
      const sponsor = MatrixDB.getMemberByAccountCode(sponsorVal);
      if (!sponsor) {
        errSponsor.textContent = "Upline Account ID / referral code not found. Leaving it blank is allowed.";
        hasErrors = true;
      }
    }

    if (hasErrors) return;

    // Proceed to DB registration
    try {
      const data = {
        fullName: regFullName.value,
        username: usernameVal,
        email: emailVal,
        phone: regPhone.value,
        walletAddress: regWallet.value,
        referralCode: sponsorVal
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
    dbSponsor.textContent = pending.sponsorUsername ? `@${pending.sponsorUsername}` : "None";

    // Hide Referral link
    referralContainer.style.display = "none";

    // Fill Dashboard Views
    dbWelcomeTitle.textContent = `Welcome, ${pending.fullName}!`;
    dbWelcomeDesc.textContent = "Your account is currently under manual review by the site administrator.";

    activeMetricsRow.style.display = "none";
    activeTreeCard.style.display = "none";
    matrixOverviewCard.style.display = "none";
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

    // Resolve Sponsor Name
    let sponsorName = "None";
    if (member.sponsorId) {
      const sp = MatrixDB.getMemberById(member.sponsorId);
      sponsorName = sp ? `${sp.fullName} (@${sp.username})` : "Active Member";
    }
    dbSponsor.textContent = sponsorName;

    // Show Referral link panel
    referralContainer.style.display = "block";
    const refLink = `${window.location.origin}${window.location.pathname}?action=register&ref=${encodeURIComponent(member.accountCode)}`;
    refLinkInput.value = refLink;

    // Welcome Box details
    dbWelcomeTitle.textContent = `Welcome Back, ${member.fullName}!`;
    dbWelcomeDesc.textContent = "You are an active participant in our network. View your squad structure and downline tree below.";

    // Active components
    pendingDetailsCard.style.display = "none";
    activeMetricsRow.style.display = "grid";
    matrixOverviewCard.style.display = "block";
    balanceCard.style.display = "block";
    productsPlusCard.style.display = FEATURES.productsPlus ? "block" : "none";
    activeTreeCard.style.display = "block";

    // Find position detail
    const summary = MatrixDB.getMemberMatrixSummary(member.id);
    const pos = summary && summary.position ? summary.position : MatrixDB.getPositionByMemberId(member.id);
    const positions = pos ? [pos] : [];
    const adminMenuButton = accountMenu.querySelector('[data-account-action="admin"]');
    if (adminMenuButton) adminMenuButton.hidden = !(FEATURES.adminPortal && summary && summary.isAdmin);
    renderMatrixOverview(member, positions, summary);
    renderBalancePanel(member, summary);
    renderProductsPlusPanel(member, summary);
    renderNotifications(summary);

    if (pos) {
      // Calculate referrals & downline children
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
    dbSponsor.textContent = member.sponsorId ? `@${(MatrixDB.getMemberById(member.sponsorId) || {}).username || "member"}` : "None";
    referralContainer.style.display = "none";
    dbWelcomeTitle.textContent = `Welcome, ${member.fullName}!`; dbWelcomeDesc.textContent = "Your free account is ready. Unlock Entry to join the Power of Three matrix.";
    activeMetricsRow.style.display = "none"; pendingDetailsCard.style.display = "none"; balanceCard.style.display = "none"; productsPlusCard.style.display = "none"; activeTreeCard.style.display = "none";
    matrixOverviewCard.style.display = "block"; matrixSelectedBadge.textContent = "Locked";
    matrixTabs.innerHTML = `<button class="matrix-tab active locked" type="button"><strong>Entry</strong><span class="matrix-tab-status">${renderStatusIcon(true)}<span>Locked</span></span></button>`;
    matrixQualification.innerHTML = `${renderStatusIcon(true)}<span>Locked</span>`; matrixQualification.className = "matrix-qualification locked";
    matrixTitle.textContent = "Entry:"; matrixSummary.textContent = "Buy 1,200 Pesos worth of F3 Token";
    matrixRequirement.textContent = "Submit the GCash transaction reference for admin verification.";
    matrixActionLink.hidden = true;
    matrixActionMessage.textContent = "";
    matrixDateFact.style.display = "none";
    matrixExitNote.textContent = "PHP 1,200 activation · PHP 900 held-token allocation + PHP 300 matrix allocation · PHP 693 cash-exit entitlement if three-invite qualification is not completed";
    matrixExits.innerHTML = `<article class="exit-card"><div class="exit-number">Entry</div><div><h5>Unlock the first available plan</h5><p>Submit your GCash payment reference. Admin approval activates and places your account in the matrix.</p>${FEATURES.entryActivation ? `<a class="button button-primary button-small" href="upgrade-entry.html">Unlock Entry</a>` : `<span class="badge badge-pending">Activation requests coming soon</span>`}</div></article>`;
  }

  function renderMatrixOverview(member, positions, summary) {
    const rules = summary && summary.rules ? summary.rules : MATRIX_RULES;
    const exits = summary && summary.exits ? summary.exits : [];
    const nextExit = exits.find(item => item.status !== "active");
    let selectedId = "entry";

    matrixTabs.innerHTML = [`entry`, ...exits.map(exit => String(exit.exit))].map(exitId => {
      const isEntry = exitId === "entry";
      const exit = exits.find(item => String(item.exit) === exitId);
      const status = isEntry ? "active" : (exit ? exit.status : "locked");
      return `
        <button class="matrix-tab ${exitId === selectedId ? "active" : ""} ${status === "locked" ? "locked" : ""}" type="button" data-matrix-id="${exitId}" role="tab" aria-selected="${exitId === selectedId}">
          <strong>${isEntry ? "Entry" : `Exit ${exit.exit}`}</strong>
          <span class="matrix-tab-status">
            ${renderStatusIcon(status === "locked")}
            <span>${capitalizeStatus(status)}</span>
          </span>
        </button>
      `;
    }).join("");

    matrixTabs.querySelectorAll(".matrix-tab").forEach(button => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.matrixId;
        renderMatrixDetail(member, positions, summary, selectedId, nextExit ? nextExit.exit : null);
        matrixTabs.querySelectorAll(".matrix-tab").forEach(tab => {
          const isActive = tab.dataset.matrixId === selectedId;
          tab.classList.toggle("active", isActive);
          tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
      });
    });

    enableDragScroll(matrixTabs);

    renderMatrixDetail(member, positions, summary, selectedId, nextExit ? nextExit.exit : null);
  }

  function renderMatrixDetail(member, positions, summary, matrixId, nextExitNumber) {
    const rules = summary && summary.rules ? summary.rules : MATRIX_RULES;
    const placement = getMatrixPlacement(member, positions, summary);

    if (matrixId === "entry") {
      matrixSelectedBadge.textContent = "Entry";
      matrixQualification.innerHTML = `${renderStatusIcon(false)}<span>Active</span>`;
      matrixQualification.className = "matrix-qualification qualified";
      matrixTitle.textContent = "Entry:";
      matrixSummary.textContent = `Hold ${formatNumber(rules.entry.holdF3)} F3 Token worth ${formatNumber(rules.entry.holdPesoValue)} Pesos`;
      matrixRequirement.textContent = "Entry starts on admin approval.";
      matrixActionLink.hidden = true;
      matrixActionMessage.textContent = "";
      matrixDateFact.style.display = placement && placement.placedAt ? "" : "none";
      matrixDateLabel.textContent = "Entry Date";
      matrixPlacedTime.textContent = placement ? formatDateTime(placement.placedAt) : "-";
      matrixExitNote.textContent = `Earn PHP ${formatNumber(rules.entry.passiveIncome)} monthly for ${rules.entry.passiveMonths} months.`;
      matrixExits.innerHTML = renderEntryCard(rules, summary);
      return;
    }

    const exit = (summary.exits || []).find(item => String(item.exit) === matrixId);
    if (!exit) return;

    matrixSelectedBadge.textContent = `Exit ${exit.exit}`;
    matrixQualification.innerHTML = `${renderStatusIcon(exit.status === "locked")}<span>${capitalizeStatus(exit.status)}</span>`;
    matrixQualification.className = `matrix-qualification ${exit.status === "locked" ? "locked" : "qualified"}`;
    const actionVerb = exit.actionType === "reinvest" || /^Re-Stake/i.test(exit.actionLabel) ? "Re-Stake" : "Buy";
    matrixTitle.textContent = `Exit ${exit.exit}:`;
    matrixSummary.textContent = formatExitActionSummary(exit, actionVerb);
    matrixRequirement.textContent = exit.requirementRank.split(" / ")[0];
    const isNextExit = exit.exit === nextExitNumber;
    const canRequestExit = isNextExit && exit.status === "qualified";
    const canShowRequirement = isNextExit && exit.status === "locked";
    matrixActionLink.hidden = !(canRequestExit || canShowRequirement);
    matrixActionLink.textContent = actionVerb;
    matrixActionMessage.textContent = "";
    if (canRequestExit) {
      matrixActionLink.href = `exit-action.html?exit=${encodeURIComponent(exit.exit)}`;
      matrixActionLink.onclick = null;
    } else if (canShowRequirement) {
      matrixActionLink.href = "#";
      matrixActionLink.onclick = event => {
        event.preventDefault();
        const remaining = Math.max(Number(exit.requiredDownlines || 0) - Number(exit.qualifiedDownlines || 0), 0);
        const requiredLevel = Number(exit.requiredDownlineExit || 0) === 0 ? "Entry" : `Exit ${exit.requiredDownlineExit}`;
        matrixActionMessage.textContent = `${remaining} direct ${remaining === 1 ? "downline" : "downlines"} at ${requiredLevel} needed`;
      };
    } else {
      matrixActionLink.onclick = null;
    }
    const exitDate = exit.status === "pending"
      ? exit.requestedAt
      : exit.status === "active" ? exit.approvedAt : null;
    matrixDateFact.style.display = exit.status === "locked" ? "none" : "";
    matrixDateLabel.textContent = exit.status === "pending" ? "Requested Date" : "Approval Date";
    matrixPlacedTime.textContent = exitDate
      ? formatDateTime(exitDate)
      : exit.status === "qualified" ? "Ready to request" : "Awaiting approval";
    matrixExitNote.textContent = `${exit.qualifiedDownlines}/${exit.requiredDownlines} required downlines qualified`;
    matrixExits.innerHTML = renderExitCard(exit, summary);
  }

  function renderEntryCard(rules, summary) {
    const entryRewards = summary && summary.rewardLedger ? summary.rewardLedger.filter(item => item.sourceType === "entry") : [];
    const totalEntry = rules.entry.passiveIncome * rules.entry.passiveMonths;
    return `
      <article class="exit-card">
        <div class="exit-number">Entry</div>
        <div>
          <h5>Passive Income: PHP ${formatNumber(rules.entry.passiveIncome)} x ${rules.entry.passiveMonths} months</h5>
          <p>Total entry passive income entitlement: PHP ${formatNumber(totalEntry)}. This starts when admin approves the member's registration.</p>
          <div class="exit-meta">
            <span>${entryRewards.length} ledger entries created</span>
            <span>Balance due is shown in the Balance tab later</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderStatusIcon(locked) {
    return locked
      ? `<svg class="status-icon status-icon-lock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M4.5 7V5.25a3.5 3.5 0 0 1 7 0V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7h.75Zm1.5 0h4V5.25a2 2 0 1 0-4 0V7Z"/></svg>`
      : `<svg class="status-icon status-icon-unlock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M10 7V5.25a2 2 0 0 0-3.74-1l-1.3-.75A3.5 3.5 0 0 1 11.5 5.25V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7H10Z"/></svg>`;
  }

  function renderExitCard(exit, summary) {
    const ledger = summary && Array.isArray(summary.rewardLedger) ? summary.rewardLedger : [];
    const now = new Date();
    const passiveVested = ledger.filter(item => item.sourceType === "exit" && Number(item.exit) === Number(exit.exit) && new Date(item.dueAt) <= now).length;
    const matrixVested = ledger.filter(item => item.sourceType === "matrix" && Number(item.exit) === Number(exit.exit) && new Date(item.dueAt) <= now).length;
    const productBonus = Number(exit.productSpend || 0) * (Number(exit.productBonusPercent || 0) / 100);
    return `
      <article class="exit-card">
        <div class="exit-number">Exit ${exit.exit}</div>
        <div>
          <h5>${formatExitActionSummary(exit)}</h5>
          <p>${exit.requirementRank.split(" / ")[0]}. Once qualified, submit a request and wait for admin approval.</p>
          <div class="exit-meta">
            <span>Downlines: ${exit.qualifiedDownlines}/${exit.requiredDownlines}</span>
            <span>Passive: PHP ${formatNumber(exit.passiveIncome)} monthly · ${passiveVested}/${exit.passiveMonths} vested</span>
            ${exit.productSpend > 0 ? `<span>Products Plus: PHP ${formatNumber(exit.productSpend)} + PHP ${formatNumber(productBonus)} (${exit.productBonusPercent}%) · ${exit.productMonths} months</span>` : "<span>No Products Plus for this exit</span>"}
          </div>
        </div>
      </article>
      <article class="exit-card matrix-income-card">
        <div class="exit-number">Bonus</div>
        <div>
          <h5>Matrix Income: PHP ${formatNumber(exit.matrixIncome || 0)} monthly</h5>
          <p>Credited to your available balance at the end of each eligible month after this Exit is approved.</p>
          <div class="exit-meta">
            <span>Credited months: ${matrixVested}/${exit.matrixMonths || 0}</span>
            <span>Total entitlement: PHP ${formatNumber(Number(exit.matrixIncome || 0) * Number(exit.matrixMonths || 0))}</span>
          </div>
        </div>
      </article>
    `;
  }

  function formatExitActionSummary(exit, fallbackVerb = null) {
    const isRestake = exit.actionType === "reinvest" || /^Re-Stake/i.test(exit.actionLabel);
    const verb = fallbackVerb || (isRestake ? "Re-Stake" : "Buy");
    if (Number(exit.exit) === 1 && isRestake) return `${verb} ${formatNumber(exit.actionAmount)} F3 Token`;
    return `${verb} ${formatNumber(exit.actionAmount)} Pesos worth of F3 Token`;
  }

  function renderBalancePanel(member, summary) {
    const earned = Number(summary ? summary.earnedBalance : 0);
    const pending = Number(summary ? summary.pendingWithdrawal : 0);
    const pendingExitBalance = Number(summary ? summary.pendingExitBalance : 0);
    const available = Math.max(earned - pending - pendingExitBalance, 0);

    balanceTotalBadge.textContent = `PHP ${formatNumber(available)}`;
    balanceTotal.textContent = `PHP ${formatNumber(available)}`;
    requestWithdrawalBtn.disabled = false;
    requestWithdrawalBtn.title = available > 0
      ? `Withdraw up to PHP ${formatNumber(available)}`
      : "View your withdrawal availability and next passive-income due date";
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

  function getMatrixPlacement(member, positions, summary) {
    const position = positions.find(item => item.memberId === member.id);

    if (!position) return null;

    const positionNumber = Number(summary && summary.positionNumber) || 0;

    return {
      label: positionNumber > 0 ? `Position #${positionNumber}` : "Placed",
      placedAt: position.placedAt
    };
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

  // Copy Referral link to clipboard
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
