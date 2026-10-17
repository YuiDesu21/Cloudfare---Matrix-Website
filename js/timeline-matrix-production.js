// Supabase-backed Standard Plan page. The local MatrixDB implementation
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
    availableBalanceLabel: document.querySelector('label[for="timeline-available-balance"]'),
    externalFields: Array.from(document.querySelectorAll(".timeline-external-field")),
    paymentPreview: document.getElementById("timeline-payment-preview"),
    reference: document.getElementById("timeline-reference"),
    submit: document.getElementById("timeline-submit"),
    productProgress: document.getElementById("timeline-product-progress"),
    productProgressLabel: document.getElementById("timeline-product-progress-label"),
    productProgressBar: document.getElementById("timeline-product-progress-bar"),
    productApproved: document.getElementById("timeline-product-approved"),
    productPending: document.getElementById("timeline-product-pending"),
    productRemaining: document.getElementById("timeline-product-remaining"),
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
  let productEntryProgress = null;
  let availableBalance = 0;
  let mainFundsAvailable = 0;
  let selectedExit = 1;
  let paymentMethods = [];

  setupAccountMenu();
  elements.paymentMethod.addEventListener("change", renderPaymentMode);
  elements.activationForm.addEventListener("submit", submitActivation);
  elements.productsCard.hidden = true;
  elements.availableBalanceLabel.textContent = "Main Funds Available";

  const { data: sessionData, error: sessionError } = await window.matrixSupabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    window.location.replace("portal.html");
    return;
  }
  await refresh();

  async function refresh() {
    hideAlert();
    const [mainResponse, timelineResponse, pendingExitResponse, productProgressResponse, approvalResponse, methodsResponse, fundsResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_my_timeline_dashboard"),
      window.matrixSupabase.rpc("get_pending_exit_balance"),
      window.matrixSupabase.rpc("get_my_product_entry_progress", { p_entry_type: "timeline_entry" }),
      window.matrixSupabase.from("timeline_exit_progress").select("exit_number,approved_at").eq("member_id", sessionData.session.user.id),
      window.matrixSupabase.rpc("get_active_payment_methods"),
      window.matrixSupabase.rpc("get_my_member_funds_dashboard")
    ]);
    const error = mainResponse.error || timelineResponse.error || pendingExitResponse.error || productProgressResponse.error || approvalResponse.error || methodsResponse.error || fundsResponse.error;
    if (error) return showAlert(error.message, "danger");
    mainDashboard = mainResponse.data;
    timelineDashboard = timelineResponse.data;
    productEntryProgress = productProgressResponse.data;
    paymentMethods = methodsResponse.data || [];
    const selectedMethod = elements.paymentMethod.value;
    elements.paymentMethod.innerHTML = paymentMethods.map(method => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)} - ${escapeHtml(method.accountName)}</option>`).join("") + '<option value="main_funds">Main Funds</option>';
    if (selectedMethod === "main_funds" || paymentMethods.some(method => method.id === selectedMethod)) elements.paymentMethod.value = selectedMethod;
    timelineDashboard.approvedExits = approvalResponse.data || [];
    member = mainDashboard && mainDashboard.member;
    if (!member) return showAlert("Your member profile could not be loaded.", "danger");
    availableBalance = Math.max(
      Number(mainDashboard.earnedBalance || 0)
      - Number(mainDashboard.pendingWithdrawal || 0)
      - Number(pendingExitResponse.data || 0),
      0
    );
    mainFundsAvailable = Number(fundsResponse.data.mainAvailable || 0);
    render();
  }

  function render() {
    elements.userStatus.style.display = "block";
    elements.userName.textContent = member.fullName || member.username || "Member";
    elements.avatar.textContent = (member.fullName || "M").charAt(0).toUpperCase();
    elements.availableBalance.value = money(mainFundsAvailable);
    renderPaymentMode();

    const isActive = Boolean(timelineDashboard && timelineDashboard.isActive);
    const rules = timelineDashboard && timelineDashboard.rules || [];
    document.getElementById("timeline-rules-card").style.display = rules.length ? "block" : "none";
    const ledger = timelineDashboard.rewardLedger || [];
    const approvals = timelineDashboard.approvedExits || [];
    document.getElementById("timeline-rules-rows").innerHTML = rules.filter(rule => Number(rule.matrixMonths) > 0).map(rule => {
      const eligible = ledger.filter(item => Number(item.exit) === Number(rule.exit) && item.sourceType === "timeline_matrix" && item.status !== "void" && new Date(item.dueAt) <= new Date()).length;
      return `<tr><th scope="row">Exit ${Number(rule.exit)}</th><td>${money(rule.matrixIncome)}</td>
        <td>${MatrixBenefits.progress(eligible, rule.matrixMonths)}</td><td>${MatrixBenefits.state(capitalize(rule.status), rule.status === "active" ? "active" : rule.status === "qualified" ? "pending" : "locked")}</td></tr>`;
    }).join("");
    document.getElementById("timeline-benefit-products-rows").innerHTML = rules.filter(rule => Number(rule.productMonths) > 0).map(rule => {
      const approvedAt = approvals.find(item => Number(item.exit_number) === Number(rule.exit))?.approved_at;
      const start = approvedAt ? new Date(approvedAt) : null;
      const eligible = start ? Array.from({ length: Number(rule.productMonths) }, (_, index) => index + 1)
        .filter(month => Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month + 1, 0, 23, 59, 59) <= Date.now()).length : 0;
      return `<tr><th scope="row">Exit ${Number(rule.exit)}</th><td>${money(rule.productSpend)}</td><td>${money(rule.productBonusAmount)}</td>
        <td>${MatrixBenefits.progress(eligible, rule.productMonths)}</td><td>${MatrixBenefits.state(approvedAt ? "Active" : capitalize(rule.status), approvedAt ? "active" : rule.status === "qualified" ? "pending" : "locked")}</td></tr>`;
    }).join("");
    const pending = timelineDashboard && timelineDashboard.pendingRequest;
    elements.statusBadge.textContent = isActive ? "Active" : pending ? "Pending Approval" : "Not Active";
    elements.statusBadge.className = `badge ${isActive ? "badge-active" : "badge-pending"}`;
    elements.activationCard.style.display = isActive ? "none" : "block";
    elements.dashboard.style.display = isActive ? "grid" : "none";
    renderProductEntryProgress(isActive);
    elements.submit.disabled = Boolean(pending);
    elements.submit.textContent = pending ? "Standard Plan Activation Pending" : "Submit Standard Plan Activation";

    if (!isActive) {
      if (pending) showAlert("Your Standard Plan activation is waiting for admin approval.", "info");
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
    const balancePayment = elements.paymentMethod.value === "main_funds";
    elements.externalFields.forEach(field => { field.style.display = balancePayment ? "none" : ""; });
    const method = paymentMethods.find(item => item.id === elements.paymentMethod.value);
    elements.paymentPreview.innerHTML = method ? `${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} payment QR code">` : ""}<div><strong>${escapeHtml(method.methodName)}</strong><p>${escapeHtml(method.accountName)} · ${escapeHtml(method.accountNumber)}</p>${method.instructions ? `<small>${escapeHtml(method.instructions)}</small>` : ""}</div>` : "";
  }

  function renderProductEntryProgress(isActive) {
    if (!elements.productProgress) return;
    elements.productProgress.hidden = Boolean(isActive);
    const progress = productEntryProgress || {};
    const approved = Number(progress.approvedAmount || 0);
    const pending = Number(progress.pendingAmount || 0);
    const target = Number(progress.targetAmount || 693);
    const remaining = Math.max(Number(progress.remainingAmount || target), 0);
    const percent = target > 0 ? Math.min(approved / target * 100, 100) : 0;
    elements.productProgressLabel.textContent = `${money(approved)} / ${money(target)}`;
    elements.productProgressBar.style.width = `${percent}%`;
    elements.productApproved.textContent = money(approved);
    elements.productPending.textContent = money(pending);
    elements.productRemaining.textContent = money(remaining);
  }

  async function submitActivation(event) {
    event.preventDefault();
    hideAlert();
    const paymentMethod = elements.paymentMethod.value;
    if (paymentMethod === "main_funds" && mainFundsAvailable < 693) {
      showAlert("Main Funds needs at least PHP 693 for Standard Plan activation.", "danger");
      return;
    }
    const args = { p_payment_method: paymentMethod === "main_funds" ? "main_funds" : "external", p_payment_method_id: paymentMethod === "main_funds" ? null : paymentMethod, p_reference_number: "" };
    if (paymentMethod !== "main_funds") {
      const reference = elements.reference.value.trim();
      if (!paymentMethods.some(method => method.id === paymentMethod) || !/^[A-Za-z0-9-]{6,40}$/.test(reference)) {
        showAlert("Choose a payment method and enter a valid reference number.", "danger");
        return;
      }
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
    showAlert("Standard Plan activation was submitted for admin approval.", "success");
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
    elements.tree.innerHTML = `<div class="empty-state"><p>Loading Standard Plan position...</p></div>`;
    const { data: tree, error } = await window.matrixSupabase.rpc("get_my_timeline_level", { p_root_member_id: member.id });
    if (error) { elements.tree.innerHTML = `<div class="empty-state"><p>Unable to load the Standard Plan explorer.</p></div>`; return; }
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
      if (action === "budget") window.location.href = "budget-plan.html";
      if (action === "patronizing") window.location.href = "patronizing-income.html";
      if (action === "packages") window.location.href = "packages-orders.html";
      if (action === "product-plus") window.location.href = "packages-orders.html?type=product_plus_requirement";
      if (action === "funds") window.location.href = "main-funds.html";
      if (action === "withdraw") window.location.href = "main-funds.html?dialog=withdraw";
      if (action === "withdrawal-history") window.location.href = "withdrawal-history.html";
      if (action === "history") window.location.href = "passive-income-history.html";
      if (action === "entry") window.location.href = "portal.html?view=premium";
      if (action === "logout") { await window.matrixSupabase.auth.signOut(); window.location.href = "portal.html"; }
    }));
    document.addEventListener("click", event => {
      if (!elements.userStatus.contains(event.target)) { elements.accountMenu.hidden = true; elements.accountToggle.setAttribute("aria-expanded", "false"); }
    });
  }

  function money(value) { return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function statusIcon(locked) { return locked ? `<svg class="status-icon status-icon-lock" aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 7V5.25a3.5 3.5 0 0 1 7 0V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7h.75Zm1.5 0h4V5.25a2 2 0 1 0-4 0V7Z"/></svg>` : `<svg class="status-icon status-icon-unlock" aria-hidden="true" viewBox="0 0 16 16"><path d="M10 7V5.25a2 2 0 0 0-3.74-1l-1.3-.75A3.5 3.5 0 0 1 11.5 5.25V7h.75c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-5C2.5 7.56 3.06 7 3.75 7H10Z"/></svg>`; }
  function hideAlert() { elements.alert.style.display = "none"; }
  function showAlert(message, type) { elements.alert.className = `alert alert-${type}`; elements.alert.textContent = message; elements.alert.style.display = "block"; }
});
