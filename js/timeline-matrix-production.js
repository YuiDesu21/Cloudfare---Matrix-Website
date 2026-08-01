// Supabase-backed Timeline Matrix page. The local MatrixDB implementation
// remains responsible for sandbox mode; production talks only to secured RPCs.
document.addEventListener("DOMContentLoaded", async () => {
  if (!window.MATRIX_USES_SUPABASE || !window.matrixSupabase) return;

  const elements = {
    statusBadge: document.getElementById("timeline-status-badge"),
    alert: document.getElementById("timeline-alert"),
    userStatus: document.getElementById("timeline-user-status"),
    userName: document.getElementById("timeline-user-name"),
    avatar: document.getElementById("timeline-avatar-letter"),
    accountToggle: document.getElementById("timeline-account-menu-toggle"),
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
    balanceBadge: document.getElementById("timeline-balance-total-badge"),
    balanceTotal: document.getElementById("timeline-balance-total"),
    descendants: document.getElementById("timeline-descendants"),
    highestExit: document.getElementById("timeline-highest-exit"),
    selectedBadge: document.getElementById("timeline-selected-badge"),
    tabs: document.getElementById("timeline-tabs"),
    exitDetail: document.getElementById("timeline-exit-detail"),
    tree: document.getElementById("timeline-tree"),
    productsCard: document.getElementById("timeline-products-card")
  };

  let member = null;
  let mainDashboard = null;
  let timelineDashboard = null;
  let availableBalance = 0;
  let selectedExit = 1;

  setupAccountMenu();
  elements.paymentMethod.addEventListener("change", renderPaymentMode);
  elements.gcashNumber.addEventListener("input", () => { elements.gcashNumber.value = elements.gcashNumber.value.replace(/\D/g, "").slice(0, 11); });
  elements.activationForm.addEventListener("submit", submitActivation);
  elements.productsCard.hidden = true;

  const { data: sessionData, error: sessionError } = await window.matrixSupabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    window.location.replace("portal.html");
    return;
  }
  await refresh();

  async function refresh() {
    hideAlert();
    const [mainResponse, timelineResponse, pendingExitResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_my_timeline_dashboard"),
      window.matrixSupabase.rpc("get_pending_exit_balance")
    ]);
    const error = mainResponse.error || timelineResponse.error || pendingExitResponse.error;
    if (error) return showAlert(error.message, "danger");
    mainDashboard = mainResponse.data;
    timelineDashboard = timelineResponse.data;
    member = mainDashboard && mainDashboard.member;
    if (!member) return showAlert("Your member profile could not be loaded.", "danger");
    availableBalance = Math.max(
      Number(mainDashboard.earnedBalance || 0)
      - Number(mainDashboard.pendingWithdrawal || 0)
      - Number(pendingExitResponse.data || 0),
      0
    );
    render();
  }

  function render() {
    elements.userStatus.style.display = "block";
    elements.userName.textContent = member.fullName || member.username || "Member";
    elements.avatar.textContent = (member.fullName || "M").charAt(0).toUpperCase();
    elements.availableBalance.value = money(availableBalance);
    elements.gcashName.value = elements.gcashName.value || member.fullName || "";
    elements.gcashNumber.value = elements.gcashNumber.value || validGcashNumber(member.phone);
    renderPaymentMode();

    const isActive = Boolean(timelineDashboard && timelineDashboard.isActive);
    const pending = timelineDashboard && timelineDashboard.pendingRequest;
    elements.statusBadge.textContent = isActive ? "Active" : pending ? "Pending Approval" : "Not Active";
    elements.statusBadge.className = `badge ${isActive ? "badge-active" : "badge-pending"}`;
    elements.activationCard.style.display = isActive ? "none" : "block";
    elements.dashboard.style.display = isActive ? "grid" : "none";
    elements.submit.disabled = Boolean(pending);
    elements.submit.textContent = pending ? "Timeline Activation Pending" : "Submit Timeline Activation";

    if (!isActive) {
      if (pending) showAlert("Your Timeline Matrix activation is waiting for admin approval.", "info");
      return;
    }

    elements.balance.textContent = money(availableBalance);
    elements.balanceBadge.textContent = money(availableBalance);
    elements.balanceTotal.textContent = money(availableBalance);
    elements.descendants.textContent = Number(timelineDashboard.directChildrenCount || 0).toLocaleString();
    elements.highestExit.textContent = Number(timelineDashboard.highestExit || 0) ? `Exit ${timelineDashboard.highestExit}` : "Entry";
    renderExitTabs();
    renderTree();
  }

  function renderPaymentMode() {
    const balancePayment = elements.paymentMethod.value === "available_balance";
    elements.gcashFields.forEach(field => { field.style.display = balancePayment ? "none" : ""; });
  }

  async function submitActivation(event) {
    event.preventDefault();
    hideAlert();
    const paymentMethod = elements.paymentMethod.value;
    if (paymentMethod === "available_balance" && availableBalance < 693) {
      showAlert("Available Balance is not enough for the PHP 693 Timeline activation.", "danger");
      return;
    }
    const args = { p_payment_method: paymentMethod, p_gcash_name: "", p_gcash_number: "", p_reference_number: "" };
    if (paymentMethod === "gcash") {
      const name = elements.gcashName.value.trim();
      const number = elements.gcashNumber.value.trim();
      const reference = elements.reference.value.trim();
      if (!/^[\p{L} .'-]+$/u.test(name) || !/^09\d{9}$/.test(number) || !/^[A-Za-z0-9-]{6,40}$/.test(reference)) {
        showAlert("Enter a valid GCash account name, number, and reference number.", "danger");
        return;
      }
      args.p_gcash_name = name;
      args.p_gcash_number = number;
      args.p_reference_number = reference;
    }
    elements.submit.disabled = true;
    const { error } = await window.matrixSupabase.rpc("request_timeline_activation", args);
    if (error) {
      elements.submit.disabled = false;
      showAlert(error.message, "danger");
      return;
    }
    elements.reference.value = "";
    await refresh();
    showAlert("Timeline Matrix activation was submitted for admin approval.", "success");
  }

  function renderExitTabs() {
    const exits = timelineDashboard.rules || [];
    if (!exits.length) return;
    if (!exits.some(exit => Number(exit.exit) === selectedExit)) selectedExit = Number(exits[0].exit);
    elements.tabs.innerHTML = exits.map(exit => `
      <button class="matrix-tab ${Number(exit.exit) === selectedExit ? "active" : ""} ${exit.status === "locked" ? "locked" : ""}" type="button" data-exit="${Number(exit.exit)}" role="tab" aria-selected="${Number(exit.exit) === selectedExit}">
        <strong>Exit ${Number(exit.exit)}</strong>
        <span class="matrix-tab-status">${statusIcon(exit.status === "locked")}<span>${capitalize(exit.status)}</span></span>
      </button>`).join("");
    elements.tabs.querySelectorAll("[data-exit]").forEach(button => button.addEventListener("click", () => {
      selectedExit = Number(button.dataset.exit);
      renderExitTabs();
    }));
    const exit = exits.find(item => Number(item.exit) === selectedExit);
    if (!exit) return;
    const creditedMonths = (timelineDashboard.rewardLedger || []).filter(entry => Number(entry.exit) === selectedExit && entry.sourceType === "timeline_matrix" && new Date(entry.dueAt) <= new Date()).length;
    const requirement = Number(exit.exit) === 1
      ? "3 direct Timeline downlines active"
      : `3 direct Timeline downlines completed Exit ${Number(exit.requiredDownlineExit)}`;
    elements.selectedBadge.textContent = `Exit ${Number(exit.exit)}`;
    elements.exitDetail.innerHTML = `<article class="exit-card"><div class="exit-number">Exit ${Number(exit.exit)}</div><div><h5>${capitalize(exit.status)}</h5><p>${requirement}. No stake or buy action is required for Timeline exits.</p><div class="exit-meta"><span>Downlines: ${Number(exit.qualifiedDownlines || 0)}/3</span><span>Matrix Income: ${money(exit.matrixIncome)} | ${creditedMonths}/${Number(exit.matrixMonths)} months credited</span></div></div></article>`;
  }

  async function renderTree() {
    elements.tree.innerHTML = `<div class="empty-state"><p>Loading Timeline Matrix position...</p></div>`;
    const { data: tree, error } = await window.matrixSupabase.rpc("get_my_timeline_level", { p_root_member_id: member.id });
    if (error) { elements.tree.innerHTML = `<div class="empty-state"><p>Unable to load the Timeline Matrix explorer.</p></div>`; return; }
    const children = tree.children || [];
    const openSlots = Array.from({ length: Math.max(3 - children.length, 0) }, () => ({ isOpenSlot: true }));
    elements.tree.innerHTML = `<div class="tree-explorer"><div class="tree-explorer-status"><span>Viewing direct timeline downlines of</span><strong>${escapeHtml(tree.fullName)}</strong></div><div class="tree-wrapper">${nodeHtml(tree, true)}<div class="tree-children-container">${[...children, ...openSlots].map(child => nodeHtml(child, false)).join("")}</div></div></div>`;
  }

  function nodeHtml(node, focused) {
    if (node.isOpenSlot) return `<div class="tree-branch"><div class="tree-node-wrapper"><div class="tree-node-card empty-card"><div class="tree-node-name">Open Spot</div><div class="tree-node-username">Available</div></div></div></div>`;
    const stage = node.matrixStage || { label: "Entry", status: "active" };
    return `<div class="tree-branch"><div class="tree-node-wrapper"><div class="tree-node-card ${focused ? "focused-card root-card" : ""}"><div class="tree-node-name" title="${escapeHtml(node.fullName)}">${escapeHtml(node.fullName)}</div><div class="tree-node-username">@${escapeHtml(node.username)}</div><div class="tree-node-stage stage-${escapeHtml(stage.status)}">${statusIcon(false)}<span>${escapeHtml(stage.label)}</span></div></div></div></div>`;
  }

  function setupAccountMenu() {
    elements.accountToggle.addEventListener("click", () => {
      const open = elements.accountMenu.hidden;
      elements.accountMenu.hidden = !open;
      elements.accountToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    elements.accountMenu.querySelectorAll("[data-timeline-action]").forEach(button => button.addEventListener("click", async () => {
      elements.accountMenu.hidden = true;
      const action = button.dataset.timelineAction;
      if (action === "profile") window.location.href = "portal.html#profile";
      if (action === "main") window.location.href = "portal.html";
      if (action === "withdraw") window.location.href = "withdrawal-request.html";
      if (action === "history") window.location.href = "passive-income-history.html";
      if (action === "logout") { await window.matrixSupabase.auth.signOut(); window.location.href = "portal.html"; }
    }));
    document.addEventListener("click", event => {
      if (!elements.userStatus.contains(event.target)) { elements.accountMenu.hidden = true; elements.accountToggle.setAttribute("aria-expanded", "false"); }
    });
  }

  function validGcashNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return /^09\d{9}$/.test(digits) ? digits : /^639\d{9}$/.test(digits) ? `0${digits.slice(2)}` : "";
  }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function statusIcon(locked) { return locked ? `<svg class="status-icon status-icon-lock" aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 7V5.25a3.5 3.5 0 0 1 7 0V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7h.75Zm1.5 0h4V5.25a2 2 0 1 0-4 0V7Z"/></svg>` : `<svg class="status-icon status-icon-unlock" aria-hidden="true" viewBox="0 0 16 16"><path d="M10 7V5.25a2 2 0 0 0-3.74-1l-1.3-.75A3.5 3.5 0 0 1 11.5 5.25V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7H10Z"/></svg>`; }
  function hideAlert() { elements.alert.style.display = "none"; }
  function showAlert(message, type) { elements.alert.className = `alert alert-${type}`; elements.alert.textContent = message; elements.alert.style.display = "block"; }
});
