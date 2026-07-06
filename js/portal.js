/**
 * Member Portal Controller
 * Manages authentication views, registrations, active sessions, and downline visualizer render.
 */

document.addEventListener("DOMContentLoaded", () => {
  // DB Initialization
  if (window.MatrixDB) {
    window.MatrixDB.initializeDatabase();
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
  const loginAlert = document.getElementById("login-alert");

  const registerForm = document.getElementById("register-form");
  const regFullName = document.getElementById("reg-fullname");
  const regUsername = document.getElementById("reg-username");
  const regEmail = document.getElementById("reg-email");
  const regPhone = document.getElementById("reg-phone");
  const regWallet = document.getElementById("reg-wallet");
  const regSponsor = document.getElementById("reg-sponsor");
  const regPlan = document.getElementById("reg-plan");
  const registerAlert = document.getElementById("register-alert");

  const successReqId = document.getElementById("success-req-id");
  const successOkBtn = document.getElementById("success-ok-btn");

  const headerUserStatus = document.getElementById("header-user-status");
  const headerUserName = document.getElementById("header-user-name");
  const logoutBtnHeader = document.getElementById("logout-btn-header");
  const logoutBtnSidebar = document.getElementById("logout-btn-sidebar");

  const dbStatusBadge = document.getElementById("db-status-badge");
  const dbAvatarLetter = document.getElementById("db-avatar-letter");
  const dbFullName = document.getElementById("db-fullname");
  const dbUsername = document.getElementById("db-username");
  const dbWallet = document.getElementById("db-wallet");
  const dbEmail = document.getElementById("db-email");
  const dbPhone = document.getElementById("db-phone");
  const dbJoinDate = document.getElementById("db-joindate");
  const dbSponsor = document.getElementById("db-sponsor");

  const referralContainer = document.getElementById("referral-container");
  const refLinkInput = document.getElementById("ref-link-input");
  const copyRefBtn = document.getElementById("copy-ref-btn");
  const copyToast = document.getElementById("copy-toast");

  const dbWelcomeTitle = document.getElementById("db-welcome-title");
  const dbWelcomeDesc = document.getElementById("db-welcome-desc");

  const activeMetricsRow = document.getElementById("active-metrics-row");
  const metricPlan = document.getElementById("metric-plan");
  const metricReferrals = document.getElementById("metric-referrals");
  const metricChildren = document.getElementById("metric-children");

  const pendingDetailsCard = document.getElementById("pending-details-card");
  const pendingCardPlan = document.getElementById("pending-card-plan");
  const pendingCardDate = document.getElementById("pending-card-date");
  const pendingCardPrice = document.getElementById("pending-card-price");

  const activeTreeCard = document.getElementById("active-tree-card");
  const treeVisualizer = document.getElementById("member-tree-visualizer");

  // Navigation handlers
  const goToRegister = document.getElementById("go-to-register");
  const goToLogin = document.getElementById("go-to-login");

  // Form errors
  const errFullName = document.getElementById("err-fullname");
  const errUsername = document.getElementById("err-username");
  const errEmail = document.getElementById("err-email");
  const errPhone = document.getElementById("err-phone");
  const errWallet = document.getElementById("err-wallet");
  const errSponsor = document.getElementById("err-sponsor");
  const errPlan = document.getElementById("err-plan");

  // Route URL queries
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const refSponsor = params.get("ref");

  // Initial State Check
  checkSession();

  if (action === "register") {
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

  successOkBtn.addEventListener("click", () => {
    successView.style.display = "none";
    showLogin();
  });

  loginForm.addEventListener("submit", handleLogin);
  registerForm.addEventListener("submit", handleRegister);

  logoutBtnHeader.addEventListener("click", logout);
  logoutBtnSidebar.addEventListener("click", logout);

  copyRefBtn.addEventListener("click", copyReferralLink);

  // Helper Functions for View Switching
  function showLogin() {
    loginView.style.display = "block";
    registerView.style.display = "none";
    successView.style.display = "none";
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    headerUserStatus.style.display = "none";
    clearForms();
  }

  function showRegister() {
    loginView.style.display = "none";
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
  function handleLogin(e) {
    e.preventDefault();
    loginAlert.style.display = "none";
    
    const credential = loginCredentialInput.value.trim();
    if (!credential) return;

    // Check in approved members
    const member = MatrixDB.getMemberByCredential(credential);

    if (member) {
      sessionStorage.setItem(SESSION_KEY, member.id);
      renderDashboard(member);
      return;
    }

    // Check in pending registrations
    const pendingList = MatrixDB.getPendingRegistrations();
    const pendingReq = pendingList.find(p => 
      p.email.toLowerCase() === credential.toLowerCase() || 
      p.walletAddress.toLowerCase() === credential.toLowerCase()
    );

    if (pendingReq) {
      if (pendingReq.status === "rejected") {
        showLoginError("Your registration request was rejected by the administrator.");
      } else {
        // Pending members can log in to check status
        sessionStorage.setItem(SESSION_KEY, pendingReq.id);
        renderPendingDashboard(pendingReq);
      }
      return;
    }

    showLoginError("No member or pending request found with this Email or Wallet Address.");
  }

  function showLoginError(msg) {
    loginAlert.className = "alert alert-danger";
    loginAlert.textContent = msg;
    loginAlert.style.display = "block";
  }

  // Handle Register
  function handleRegister(e) {
    e.preventDefault();
    registerAlert.style.display = "none";
    document.querySelectorAll(".form-error").forEach(el => el.textContent = "");

    let hasErrors = false;

    // Local Field Validations
    if (!regFullName.value.trim()) {
      errFullName.textContent = "Full name is required.";
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

    if (!regPhone.value.trim()) {
      errPhone.textContent = "Phone number is required.";
      hasErrors = true;
    }

    if (!regWallet.value.trim()) {
      errWallet.textContent = "Wallet address is required.";
      hasErrors = true;
    }

    if (!regPlan.value) {
      errPlan.textContent = "Please select a matrix plan.";
      hasErrors = true;
    }

    // Sponsor check (if provided, must exist in active members)
    const sponsorVal = regSponsor.value.trim();
    if (sponsorVal) {
      const sponsor = MatrixDB.getMemberByUsername(sponsorVal);
      if (!sponsor) {
        errSponsor.textContent = "Referrer username not found. Leaving it blank is allowed.";
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
        sponsorUsername: sponsorVal,
        requestedPlanId: regPlan.value
      };

      const result = MatrixDB.registerPending(data);
      
      // Success State
      registerView.style.display = "none";
      successReqId.textContent = result.id;
      successView.style.display = "block";

    } catch (err) {
      registerAlert.className = "alert alert-danger";
      registerAlert.textContent = err.message;
      registerAlert.style.display = "block";
    }
  }

  // Session Check
  function checkSession() {
    const loggedInId = sessionStorage.getItem(SESSION_KEY);
    if (!loggedInId) return;

    // Try finding active member
    const member = MatrixDB.getMemberById(loggedInId);
    if (member) {
      renderDashboard(member);
      return;
    }

    // Try finding pending member
    const pendingList = MatrixDB.getPendingRegistrations();
    const pendingReq = pendingList.find(p => p.id === loggedInId);
    if (pendingReq) {
      if (pendingReq.status === "approved") {
        // Was approved in another tab/action
        const activeMem = MatrixDB.getMemberById(pendingReq.id);
        if (activeMem) {
          renderDashboard(activeMem);
        } else {
          logout();
        }
      } else if (pendingReq.status === "rejected") {
        logout();
      } else {
        renderPendingDashboard(pendingReq);
      }
      return;
    }

    // Session invalid
    logout();
  }

  // Render Pending Member Dashboard
  function renderPendingDashboard(pending) {
    authSection.style.display = "none";
    dashboardSection.style.display = "grid";

    // Setup Header User Status
    headerUserName.textContent = pending.fullName;
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

    pendingDetailsCard.style.display = "block";
    
    const plan = MatrixDB.MATRIX_PLANS[pending.requestedPlanId];
    pendingCardPlan.textContent = plan ? plan.name : pending.requestedPlanId;
    pendingCardDate.textContent = formatDate(pending.createdAt);
    pendingCardPrice.textContent = plan ? plan.price : "-";
  }

  // Render Approved Active Member Dashboard
  function renderDashboard(member) {
    authSection.style.display = "none";
    dashboardSection.style.display = "grid";

    // Setup Header User Status
    headerUserName.textContent = member.fullName;
    headerUserStatus.style.display = "flex";

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

    // Resolve Sponsor Name
    let sponsorName = "None";
    if (member.sponsorId) {
      const sp = MatrixDB.getMemberById(member.sponsorId);
      sponsorName = sp ? `${sp.fullName} (@${sp.username})` : "Active Member";
    }
    dbSponsor.textContent = sponsorName;

    // Show Referral link panel
    referralContainer.style.display = "block";
    const refLink = `${window.location.origin}${window.location.pathname}?action=register&ref=${member.username}`;
    refLinkInput.value = refLink;

    // Welcome Box details
    dbWelcomeTitle.textContent = `Welcome Back, ${member.fullName}!`;
    dbWelcomeDesc.textContent = "You are an active participant in our network. View your plan structure and downline tree below.";

    // Active components
    pendingDetailsCard.style.display = "none";
    activeMetricsRow.style.display = "grid";
    activeTreeCard.style.display = "block";

    // Find position detail
    const pos = MatrixDB.getPositionByMemberId(member.id);
    if (pos) {
      const plan = MatrixDB.MATRIX_PLANS[pos.planId];
      metricPlan.textContent = plan ? plan.name : "Active Plan";
      
      // Calculate referrals & downline children
      const allMembers = MatrixDB.getMembers();
      const referrals = allMembers.filter(m => m.sponsorId === member.id).length;
      metricReferrals.textContent = referrals;

      const positions = MatrixDB.getPositions();
      const directChildren = positions.filter(p => p.parentMemberId === member.id && p.planId === pos.planId).length;
      metricChildren.textContent = directChildren;

      // Render matrix tree
      renderDownlineTree(member.id, pos.planId, member);
    } else {
      metricPlan.textContent = "Unplaced";
      treeVisualizer.innerHTML = `<div class="empty-state"><p>Matrix position is not established. Contact admin.</p></div>`;
    }
  }

  // Draw Matrix Tree Structure
  function renderDownlineTree(memberId, planId, loggedInUser) {
    const treeData = MatrixDB.getMemberTree(memberId, planId);
    if (!treeData) {
      treeVisualizer.innerHTML = `<div class="empty-state"><p>No downline positions found.</p></div>`;
      return;
    }

    treeVisualizer.innerHTML = "";
    const treeWrapper = document.createElement("div");
    treeWrapper.className = "tree-wrapper";
    
    // Recursive Tree node generator
    function buildNodeHtml(node) {
      if (!node) return "";

      if (node.isOpenSlot) {
        return `
          <div class="tree-branch">
            <div class="tree-node-wrapper">
              <div class="tree-node-card empty-card">
                <div class="tree-node-name">Open Spot</div>
                <div class="tree-node-username">Available</div>
              </div>
            </div>
          </div>
        `;
      }

      const isRoot = node.id === loggedInUser.id;
      const shortW = shortenWallet(node.walletAddress);
      
      let childrenHtml = "";
      if (node.children && node.children.length > 0) {
        childrenHtml = `
          <div class="tree-children-container">
            ${node.children.map(child => buildNodeHtml(child)).join("")}
          </div>
        `;
      }

      return `
        <div class="tree-branch">
          <div class="tree-node-wrapper">
            <div class="tree-node-card ${isRoot ? "root-card" : ""}">
              <div class="tree-node-name" title="${node.fullName}">${node.fullName}</div>
              <div class="tree-node-username">@${node.username}</div>
              <div class="tree-node-info">${shortW}</div>
            </div>
          </div>
          ${childrenHtml}
        </div>
      `;
    }

    treeWrapper.innerHTML = buildNodeHtml(treeData);
    treeVisualizer.appendChild(treeWrapper);
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

  function showCopyToast() {
    copyToast.style.display = "block";
    setTimeout(() => {
      copyToast.style.display = "none";
    }, 2000);
  }

  // Logout session
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
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
});
