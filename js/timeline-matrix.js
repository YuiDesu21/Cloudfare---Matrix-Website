document.addEventListener("DOMContentLoaded", async () => {
  const SESSION_KEY = "matrix_logged_in_member_id";
  const PLAN_ID = "timeline-power3";
  const ACTIVATION_PRICE = 693;

  if (!window.MatrixDB) {
    showAlert("Please open the member portal before accessing Timeline Matrix.", "danger");
    return;
  }

  if (window.MATRIX_USES_SUPABASE) {
    return;
  }

  MatrixDB.initializeDatabase();
  const memberId = sessionStorage.getItem(SESSION_KEY);
  const member = memberId ? MatrixDB.getMemberById(memberId) : null;
  if (!member) {
    showAlert("Your member session is no longer available. Please sign in again.", "danger");
    window.setTimeout(() => { window.location.href = "portal.html"; }, 1200);
    return;
  }

  const elements = {
    statusBadge: document.getElementById("timeline-status-badge"),
    userStatus: document.getElementById("timeline-user-status"),
    userName: document.getElementById("timeline-user-name"),
    avatarLetter: document.getElementById("timeline-avatar-letter"),
    accountMenuToggle: document.getElementById("timeline-account-menu-toggle"),
    accountMenu: document.getElementById("timeline-account-menu"),
    activationCard: document.getElementById("timeline-activation-card"),
    activationForm: document.getElementById("timeline-activation-form"),
    paymentMethod: document.getElementById("timeline-payment-method"),
    availableBalance: document.getElementById("timeline-available-balance"),
    gcashFields: Array.from(document.querySelectorAll(".timeline-gcash-field")),
    gcashName: document.getElementById("timeline-gcash-name"),
    gcashNumber: document.getElementById("timeline-gcash-number"),
    reference: document.getElementById("timeline-reference"),
    submit: document.getElementById("timeline-submit"),
    dashboard: document.getElementById("timeline-dashboard"),
    balance: document.getElementById("timeline-balance"),
    balanceTotalBadge: document.getElementById("timeline-balance-total-badge"),
    balanceTotal: document.getElementById("timeline-balance-total"),
    descendants: document.getElementById("timeline-descendants"),
    highestExit: document.getElementById("timeline-highest-exit"),
    tabs: document.getElementById("timeline-tabs"),
    selectedBadge: document.getElementById("timeline-selected-badge"),
    exitDetail: document.getElementById("timeline-exit-detail"),
    productsBadge: document.getElementById("timeline-products-badge"),
    productsTabs: document.getElementById("timeline-products-tabs"),
    productsStatus: document.getElementById("timeline-products-status"),
    productsAvailable: document.getElementById("timeline-products-available"),
    productsSummary: document.getElementById("timeline-products-summary"),
    productsMonthly: document.getElementById("timeline-products-monthly"),
    productsVested: document.getElementById("timeline-products-vested"),
    productsReward: document.getElementById("timeline-products-reward"),
    productsUsed: document.getElementById("timeline-products-used"),
    productsRequestBtn: document.getElementById("timeline-products-request-btn"),
    productsScheduleNote: document.getElementById("timeline-products-schedule-note"),
    productsDetail: document.getElementById("timeline-products-detail"),
    voucherBalance: document.getElementById("timeline-voucher-balance"),
    voucherHistory: document.getElementById("timeline-voucher-history"),
    tree: document.getElementById("timeline-tree"),
    productsModal: document.getElementById("timeline-products-modal"),
    productsForm: document.getElementById("timeline-products-form"),
    productsAmount: document.getElementById("timeline-products-amount"),
    productsReference: document.getElementById("timeline-products-reference"),
    productsNotes: document.getElementById("timeline-products-notes"),
    productsLimit: document.getElementById("timeline-products-limit"),
    productsAlert: document.getElementById("timeline-products-alert"),
    productsSubmit: document.getElementById("timeline-products-submit")
  };

  let summary = MatrixDB.getMemberMatrixSummary(member.id, PLAN_ID);
  let pendingClaim = null;

  setupAccountMenu();
  elements.gcashNumber.addEventListener("input", () => {
    elements.gcashNumber.value = elements.gcashNumber.value.replace(/\D/g, "").slice(0, 11);
  });
  elements.gcashName.addEventListener("input", () => {
    elements.gcashName.value = elements.gcashName.value.replace(/[^\p{L} .'-]/gu, "").slice(0, 30);
  });
  elements.paymentMethod.addEventListener("change", renderPaymentMode);
  document.getElementById("timeline-products-close").addEventListener("click", closeProductsModal);
  elements.productsModal.addEventListener("click", event => {
    if (event.target === elements.productsModal) closeProductsModal();
  });
  elements.productsForm.addEventListener("submit", submitProductsClaim);
  elements.activationForm.addEventListener("submit", submitActivation);

  render();

  function setupAccountMenu() {
    elements.userStatus.style.display = "block";
    elements.userName.textContent = member.fullName || member.username || "Member";
    elements.avatarLetter.textContent = (member.fullName || "M").charAt(0).toUpperCase();
    elements.accountMenuToggle.addEventListener("click", () => {
      const open = elements.accountMenu.hidden;
      elements.accountMenu.hidden = !open;
      elements.accountMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    elements.accountMenu.querySelectorAll("[data-timeline-action]").forEach(button => {
      button.addEventListener("click", () => {
        closeAccountMenu();
        if (button.dataset.timelineAction === "profile") window.location.href = "portal.html#profile";
        if (button.dataset.timelineAction === "main") window.location.href = "portal.html";
        if (button.dataset.timelineAction === "packages") window.location.href = "packages-orders.html";
        if (button.dataset.timelineAction === "withdraw") window.location.href = "withdrawal-request.html";
        if (button.dataset.timelineAction === "withdrawal-history") window.location.href = "withdrawal-history.html";
        if (button.dataset.timelineAction === "history") window.location.href = "passive-income-history.html";
        if (button.dataset.timelineAction === "entry") window.location.href = "upgrade-entry-production.html";
        if (button.dataset.timelineAction === "logout") logout();
      });
    });
    document.addEventListener("click", event => {
      if (!elements.userStatus.contains(event.target)) closeAccountMenu();
    });
  }

  function render() {
    summary = MatrixDB.getMemberMatrixSummary(member.id, PLAN_ID);
    const active = Boolean(summary && summary.isTimelineActive);
    const pending = summary && summary.pendingTimelineRequest;
    elements.statusBadge.textContent = active ? "Active" : pending ? "Pending Approval" : "Not Active";
    elements.statusBadge.className = `badge ${active ? "badge-active" : "badge-pending"}`;
    elements.activationCard.style.display = active ? "none" : "block";
    elements.dashboard.style.display = active ? "grid" : "none";

    const mainSummary = MatrixDB.getMemberMatrixSummary(member.id, "power3-passive");
    const available = getAvailableBalance(mainSummary);
    elements.availableBalance.value = money(available);
    elements.gcashName.value = member.fullName || "";
    elements.gcashNumber.value = validGcashNumber(member.phone);
    elements.submit.disabled = Boolean(pending);
    elements.submit.textContent = pending ? "Timeline Activation Pending" : "Submit Timeline Activation";
    renderPaymentMode();

    if (!active) {
      if (pending) showAlert("Your Timeline Matrix activation is waiting for admin approval.", "info");
      return;
    }

    renderMetrics();
    renderExitTabs();
    renderProductsPlus();
    renderTree();
  }

  function renderPaymentMode() {
    const useBalance = elements.paymentMethod.value === "available_balance";
    elements.gcashFields.forEach(field => { field.style.display = useBalance ? "none" : ""; });
  }

  function submitActivation(event) {
    event.preventDefault();
    hideAlert();
    const details = { paymentMethod: elements.paymentMethod.value };
    if (details.paymentMethod === "available_balance") {
      const mainSummary = MatrixDB.getMemberMatrixSummary(member.id, "power3-passive");
      if (getAvailableBalance(mainSummary) < ACTIVATION_PRICE) {
        showAlert("Available balance is not enough for the PHP 693 Timeline activation.", "danger");
        return;
      }
    } else {
      details.gcashName = elements.gcashName.value.trim();
      details.gcashNumber = elements.gcashNumber.value.trim();
      details.referenceNumber = elements.reference.value.trim();
      if (!/^[\p{L} .'-]+$/u.test(details.gcashName)) {
        showAlert("GCash account name may only contain letters and normal name punctuation.", "danger");
        return;
      }
      if (!/^09\d{9}$/.test(details.gcashNumber)) {
        showAlert("Enter an 11-digit GCash number starting with 09.", "danger");
        return;
      }
      if (!/^[A-Za-z0-9-]{6,40}$/.test(details.referenceNumber)) {
        showAlert("Enter a valid 6-40 character GCash reference.", "danger");
        return;
      }
    }

    try {
      elements.submit.disabled = true;
      MatrixDB.requestTimelineActivation(member.id, details);
      showAlert("Timeline Matrix activation was submitted for admin approval.", "success");
      render();
    } catch (error) {
      elements.submit.disabled = false;
      showAlert(error.message, "danger");
    }
  }

  function renderMetrics() {
    const available = getAvailableBalance(MatrixDB.getMemberMatrixSummary(member.id, "power3-passive"));
    const activeExits = (summary.exits || []).filter(exit => exit.status === "active");
    elements.balance.textContent = money(available);
    elements.balanceTotalBadge.textContent = money(available);
    elements.balanceTotal.textContent = money(available);
    elements.descendants.textContent = Number(summary.descendantCount || 0).toLocaleString();
    elements.highestExit.textContent = activeExits.length ? `Exit ${Math.max(...activeExits.map(exit => Number(exit.exit)))}` : "Entry";
  }

  function renderExitTabs() {
    const exits = summary.exits || [];
    let selected = exits[0] ? String(exits[0].exit) : "";
    elements.tabs.innerHTML = exits.map(exit => `
      <button class="matrix-tab ${String(exit.exit) === selected ? "active" : ""} ${exit.status === "locked" ? "locked" : ""}" type="button" data-exit="${exit.exit}" role="tab" aria-selected="${String(exit.exit) === selected}">
        <strong>Exit ${exit.exit}</strong>
        <span class="matrix-tab-status">${statusIcon(exit.status === "locked")}<span>${capitalize(exit.status)}</span></span>
      </button>
    `).join("");
    elements.tabs.querySelectorAll("[data-exit]").forEach(button => {
      button.addEventListener("click", () => {
        selected = button.dataset.exit;
        elements.tabs.querySelectorAll("[data-exit]").forEach(tab => {
          const active = tab.dataset.exit === selected;
          tab.classList.toggle("active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        renderExitDetail(Number(selected));
      });
    });
    if (selected) renderExitDetail(Number(selected));
  }

  function renderExitDetail(exitNumber) {
    const exit = (summary.exits || []).find(item => Number(item.exit) === exitNumber);
    if (!exit) return;
    const ledger = summary.rewardLedger || [];
    const now = new Date();
    const creditedMonths = ledger.filter(entry => entry.sourceType === "timeline-matrix" && Number(entry.exit) === exitNumber && new Date(entry.dueAt) <= now).length;
    elements.selectedBadge.textContent = `Exit ${exit.exit}`;
    elements.exitDetail.innerHTML = `
      <article class="exit-card">
        <div class="exit-number">Exit ${exit.exit}</div>
        <div>
          <h5>${capitalize(exit.status)}</h5>
          <p>${escapeHtml(exit.requirementRank)}. No stake or buy action is required for Timeline exits.</p>
          <div class="exit-meta">
            <span>Downlines: ${exit.qualifiedDownlines}/${exit.requiredDownlines}</span>
            <span>Products Plus: ${money(exit.productSpend)} purchase + ${money(exit.productBonusAmount)} voucher · ${exit.productMonths} ${exit.productMonths === 1 ? "month" : "months"}</span>
            <span>Matrix Income: ${money(exit.matrixIncome)} · ${creditedMonths}/${exit.matrixMonths} months credited</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderProductsPlus() {
    const entitlements = summary.productPlusEntitlements || [];
    const vouchers = summary.vouchers || { balance: 0, history: [] };
    const totalAvailable = entitlements.reduce((total, item) => total + Number(item.availableVestedSpend || 0), 0);
    elements.productsBadge.textContent = `${money(totalAvailable)} Available`;
    elements.voucherBalance.textContent = money(vouchers.balance || 0);
    elements.voucherHistory.innerHTML = vouchers.history && vouchers.history.length
      ? vouchers.history.map(entry => `<article class="product-plus-month vested"><div class="product-plus-month-index">${Number(entry.amount) >= 0 ? "+" : "-"}</div><div><h5>${entry.type === "credit" ? "Voucher credit" : "Voucher redemption"}: ${money(Math.abs(Number(entry.amount)))}</h5><p>${escapeHtml(entry.reference)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""} · ${formatDate(entry.createdAt)}</p></div></article>`).join("")
      : `<div class="empty-state"><p>No voucher activity yet.</p></div>`;

    if (!entitlements.length) {
      elements.productsTabs.innerHTML = "";
      elements.productsDetail.innerHTML = `<div class="empty-state"><p>No Products Plus rewards are configured.</p></div>`;
      return;
    }

    let selected = entitlements[0] ? Number(entitlements[0].exit) : null;
    elements.productsTabs.innerHTML = entitlements.map(item => `
      <button class="matrix-tab ${Number(item.exit) === selected ? "active" : ""} ${item.active ? "" : "locked"}" type="button" data-products-exit="${item.exit}" role="tab" aria-selected="${Number(item.exit) === selected}">
        <strong>Exit ${item.exit}</strong>
        <span class="matrix-tab-status">${statusIcon(!item.active)}<span>${item.active ? `${item.vestedMonths}/${item.productMonths} vested` : "Locked"}</span></span>
      </button>
    `).join("");
    elements.productsTabs.querySelectorAll("[data-products-exit]").forEach(button => {
      button.addEventListener("click", () => {
        selected = Number(button.dataset.productsExit);
        elements.productsTabs.querySelectorAll("[data-products-exit]").forEach(tab => {
          const active = Number(tab.dataset.productsExit) === selected;
          tab.classList.toggle("active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        renderSelectedProduct(selected);
      });
    });
    if (selected) renderSelectedProduct(selected);
  }

  function renderSelectedProduct(exitNumber) {
    const item = (summary.productPlusEntitlements || []).find(entitlement => Number(entitlement.exit) === exitNumber);
    if (!item) return;
    const available = Number(item.availableVestedSpend || 0);
    const used = Number(item.approvedSpend || 0) + Number(item.pendingSpend || 0);
    elements.productsStatus.innerHTML = `${statusIcon(!item.active)}<span>${item.active ? "Available" : "Locked"}</span>`;
    elements.productsStatus.className = `matrix-qualification ${item.active ? "qualified" : "locked"}`;
    elements.productsAvailable.textContent = money(available);
    elements.productsSummary.textContent = item.active
      ? `${money(item.productBaseSpend)} in eligible purchases unlocks monthly. Approved purchases earn a ${money(item.productBonusAmount)} product voucher.`
      : `Products Plus begins after Exit ${item.exit} is active. Nothing expires while this exit remains locked.`;
    elements.productsMonthly.textContent = `${money(item.productBaseSpend)} purchase`;
    elements.productsVested.textContent = `${item.vestedMonths} / ${item.productMonths}`;
    elements.productsReward.textContent = money(item.productBonusAmount);
    elements.productsUsed.textContent = money(used);
    elements.productsScheduleNote.textContent = `${item.vestedMonths}/${item.productMonths} months vested · ${money(item.totalSpend)} total entitlement`;
    elements.productsRequestBtn.disabled = !item.active || available <= 0;
    elements.productsRequestBtn.onclick = () => openProductsModal(item);
    elements.productsDetail.innerHTML = `
      <article class="product-plus-month ${item.active ? "vested" : "upcoming"}">
        <div class="product-plus-month-index">${item.vestedMonths}/${item.productMonths}</div>
        <div>
          <h5>${money(item.productBaseSpend)} eligible purchase monthly</h5>
          <p>${item.nextUnlockAt ? `Next month vests ${formatDate(item.nextUnlockAt)}` : (item.active ? "All months vested" : `Starts after Exit ${item.exit} approval`)}</p>
        </div>
        <span class="withdrawal-status ${item.vestedMonths >= item.productMonths ? "status-approved" : "status-pending"}">${item.vestedMonths >= item.productMonths ? "Complete" : (item.active ? "Vesting" : "Locked")}</span>
      </article>
    `;
  }

  function openProductsModal(item) {
    pendingClaim = item;
    elements.productsForm.reset();
    elements.productsAmount.max = String(item.availableVestedSpend || 0);
    elements.productsAmount.value = String(item.availableVestedSpend || 0);
    elements.productsLimit.textContent = `Exit ${item.exit}: claim up to ${money(item.availableVestedSpend)} in eligible product purchases.`;
    elements.productsAlert.style.display = "none";
    elements.productsModal.style.display = "flex";
    elements.productsAmount.focus();
  }

  function closeProductsModal() {
    elements.productsModal.style.display = "none";
    pendingClaim = null;
  }

  function submitProductsClaim(event) {
    event.preventDefault();
    if (!pendingClaim) return;
    elements.productsAlert.style.display = "none";
    elements.productsSubmit.disabled = true;
    try {
      MatrixDB.requestProductPlusClaim(member.id, pendingClaim.exit, Number(elements.productsAmount.value), {
        planId: PLAN_ID,
        reference: elements.productsReference.value.trim(),
        notes: elements.productsNotes.value.trim()
      });
      closeProductsModal();
      render();
      showAlert("Timeline Products Plus claim was submitted for admin review.", "success");
    } catch (error) {
      elements.productsAlert.className = "alert alert-danger";
      elements.productsAlert.textContent = error.message;
      elements.productsAlert.style.display = "block";
    } finally {
      elements.productsSubmit.disabled = false;
    }
  }

  function renderTree() {
    const tree = MatrixDB.getMemberTree(member.id, PLAN_ID);
    if (!tree) {
      elements.tree.innerHTML = `<div class="empty-state"><p>No Timeline Matrix position found.</p></div>`;
      return;
    }
    elements.tree.innerHTML = `
      <div class="tree-explorer">
        <div class="tree-explorer-status"><span>Viewing direct timeline downlines of</span><strong>${escapeHtml(tree.fullName)}</strong></div>
        <div class="tree-wrapper">
          ${nodeHtml(tree, true)}
          <div class="tree-children-container">${(tree.children || []).map(child => nodeHtml(child, false)).join("")}</div>
        </div>
      </div>`;
  }

  function nodeHtml(node, focused) {
    if (node.isOpenSlot) {
      return `<div class="tree-branch"><div class="tree-node-wrapper"><div class="tree-node-card empty-card"><div class="tree-node-name">Open Spot</div><div class="tree-node-username">Available</div></div></div></div>`;
    }
    const stage = node.matrixStage || { label: "Entry", status: "active" };
    return `
      <div class="tree-branch">
        <div class="tree-node-wrapper">
          <div class="tree-node-card ${focused ? "focused-card root-card" : ""}">
            <div class="tree-node-name" title="${escapeHtml(node.fullName)}">${escapeHtml(node.fullName)}</div>
            <div class="tree-node-username">@${escapeHtml(node.username)}</div>
            <div class="tree-node-stage stage-${escapeHtml(stage.status)}">${statusIcon(stage.status === "locked")}<span>${escapeHtml(stage.label)}</span></div>
          </div>
        </div>
      </div>`;
  }

  function getAvailableBalance(balanceSummary) {
    const earned = Number(balanceSummary ? balanceSummary.earnedBalance : 0);
    const pending = Number(balanceSummary ? balanceSummary.pendingWithdrawal : 0);
    const pendingExitBalance = Number(balanceSummary ? balanceSummary.pendingExitBalance : 0);
    const pendingTimelineBalance = Number(balanceSummary ? balanceSummary.pendingTimelineBalance : 0);
    return Math.max(earned - pending - pendingExitBalance - pendingTimelineBalance, 0);
  }

  function validGcashNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (/^09\d{9}$/.test(digits)) return digits;
    if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
    return "";
  }

  function closeAccountMenu() {
    elements.accountMenu.hidden = true;
    elements.accountMenuToggle.setAttribute("aria-expanded", "false");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("matrix_auth_token");
    window.location.href = "portal.html";
  }

  function statusIcon(locked) {
    return locked
      ? `<svg class="status-icon status-icon-lock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M4.5 7V5.25a3.5 3.5 0 0 1 7 0V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7h.75Zm1.5 0h4V5.25a2 2 0 1 0-4 0V7Z"/></svg>`
      : `<svg class="status-icon status-icon-unlock" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M10 7V5.25a2 2 0 0 0-3.74-1l-1.3-.75A3.5 3.5 0 0 1 11.5 5.25V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7H10Z"/></svg>`;
  }

  function money(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-";
  }

  function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function hideAlert() {
    const alert = document.getElementById("timeline-alert");
    alert.style.display = "none";
  }

  function showAlert(message, type) {
    const alert = document.getElementById("timeline-alert");
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = "block";
  }
});
