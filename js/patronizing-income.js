document.addEventListener("DOMContentLoaded", async () => {
  const alertBox = document.getElementById("patronizing-alert");
  const content = document.getElementById("patronizing-content");
  const entryCard = document.getElementById("patronizing-entry-card");
  const entryBadge = document.getElementById("patronizing-entry-badge");
  const entryOptions = document.getElementById("patronizing-entry-options");
  const dashboardCard = document.getElementById("patronizing-dashboard-card");
  const exitsCard = document.getElementById("patronizing-exits-card");
  const tokenModal = document.getElementById("patronizing-token-modal");
  const tokenForm = document.getElementById("patronizing-token-form");
  const tokenAlert = document.getElementById("patronizing-token-alert");
  const paymentMethod = document.getElementById("patronizing-payment-method");
  const paymentPreview = document.getElementById("patronizing-payment-preview");
  const walletInput = document.getElementById("patronizing-wallet");
  const tokenSubmit = document.getElementById("patronizing-token-submit");

  let member = null;
  let dashboard = null;
  let selectedTokenPlan = "f3_token";

  if (!window.MatrixDB) {
    showAlert("Please sign in through your member dashboard before opening Patronizing Income.", "danger");
    return;
  }

  try {
    if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
    member = await MatrixDB.getAuthenticatedMember();
    if (!member) {
      showAlert("Your member session is no longer available. Please sign in again.", "danger");
      window.setTimeout(() => { window.location.href = "portal.html"; }, 1400);
      return;
    }
    dashboard = MatrixDB.getPatronizingDashboard();
    content.style.display = "block";
    render();
  } catch (error) {
    showAlert(error.message, "danger");
  }

  document.getElementById("patronizing-token-close").addEventListener("click", closeTokenModal);
  tokenModal.addEventListener("click", event => { if (event.target === tokenModal) closeTokenModal(); });
  paymentMethod.addEventListener("change", renderPaymentPreview);
  document.getElementById("patronizing-copy-wallet").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(walletInput.value);
      show(tokenAlert, "Wallet copied.", "success");
    } catch (error) {
      show(tokenAlert, "Unable to copy automatically. Select the wallet address manually.", "danger");
    }
  });
  tokenForm.addEventListener("submit", async event => {
    event.preventDefault();
    tokenAlert.style.display = "none";
    tokenSubmit.disabled = true;
    try {
      await MatrixDB.requestPatronizingTokenEntry({
        planCode: selectedTokenPlan,
        paymentMethodId: paymentMethod.value,
        referenceNumber: document.getElementById("patronizing-reference").value.trim(),
        notes: document.getElementById("patronizing-notes").value.trim()
      });
      closeTokenModal();
      await MatrixDB.refreshSessionData();
      dashboard = MatrixDB.getPatronizingDashboard();
      render();
      showAlert("F3 Token entry request submitted for admin review.", "success");
    } catch (error) {
      show(tokenAlert, error.message, "danger");
    } finally {
      tokenSubmit.disabled = false;
    }
  });

  function render() {
    dashboard = dashboard || {};
    const entry = dashboard.entry;
    const pendingToken = dashboard.pendingTokenRequest;
    const pendingProduct = dashboard.pendingProductEntryOrder;
    const isActive = Boolean(entry);
    document.getElementById("patronizing-benefit-income-rows").innerHTML = isActive
      ? `<tr><th scope="row">${entry.entryType === "f3_token" ? "F3 Token" : "Product Entry"}</th><td>PHP ${formatNumber(entry.monthlyIncome)}</td><td>PHP ${formatNumber(entry.monthlyRequirement)}</td><td>${MatrixBenefits.progress((dashboard.months || []).filter(month => month.status === "unlocked").length, entry.durationMonths)}</td><td>${MatrixBenefits.state("Active", "active")}</td></tr>`
      : `<tr><td colspan="5">Activate Patronizing Income to see your monthly benefit progress.</td></tr>`;
    document.getElementById("patronizing-rules-rows").innerHTML = (dashboard.exits || []).map(exit => `
      <tr><th scope="row">Exit ${Number(exit.exit)}</th>
        <td>PHP ${formatNumber(exit.maxPurchase)}</td><td>${formatNumber(exit.discountPercent)}%</td><td>PHP ${formatNumber(exit.usedPurchase)}</td>
        <td>${MatrixBenefits.state(String(exit.status || "locked").replace(/^./, letter => letter.toUpperCase()), exit.status === "active" ? "active" : exit.status === "qualified" ? "pending" : "locked")}</td></tr>`).join("");
    entryBadge.textContent = isActive ? "Active" : pendingToken || pendingProduct ? "Pending" : "Not Active";
    entryBadge.className = `badge ${isActive ? "badge-active" : "badge-pending"}`;
    entryCard.hidden = isActive;
    document.getElementById("patronizing-hero-description").textContent = isActive
      ? "Track monthly reflected income and use unlocked exit discounts for product purchases."
      : "Enter through F3 Token or products, track monthly reflected income, and use unlocked exit discounts for product purchases.";
    entryOptions.innerHTML = isActive ? "" : renderEntryOptions(pendingToken, pendingProduct);
    dashboardCard.hidden = !isActive;
    exitsCard.hidden = !isActive;
    if (isActive) {
      renderMonthly(entry);
      renderExits();
    }
    if (!isActive) bindEntryButtons();
  }

  function renderEntryOptions(pendingToken, pendingProduct) {
    const plans = dashboard.plans || [];
    const entryPurposes = ["patronizing_entry_product", "patronizing_entry_package"];
    const orders = typeof MatrixDB.getCommerceOrders === "function" ? MatrixDB.getCommerceOrders() : [];
    const startedPurpose = pendingProduct?.orderPurpose || orders.find(order => entryPurposes.includes(order.orderPurpose) && !["rejected", "cancelled"].includes(order.status))?.orderPurpose;
    return plans.map(plan => {
      const isToken = plan.entryType === "f3_token";
      const purpose = plan.planCode === "products_2800" ? "patronizing_entry_package" : "patronizing_entry_product";
      const disabled = Boolean(pendingToken) || (isToken ? Boolean(pendingProduct || startedPurpose) : Boolean(startedPurpose && startedPurpose !== purpose));
      const progress = isToken ? null : getProductEntryProgress(plan.entryAmount, purpose);
      const actionLabel = progress && (progress.approved > 0 || progress.pending > 0) ? "Continue Entry" : purpose === "patronizing_entry_package" ? "Choose Packages" : "Choose Products";
      return `
        <article class="patronizing-entry-option">
          <span>${isToken ? "F3 Token Entry" : purpose === "patronizing_entry_package" ? "Package Entry" : "Product Entry"}</span>
          <h2>${isToken ? `Buy ${formatNumber(plan.f3Tokens)} F3 Token` : `Buy ${purpose === "patronizing_entry_package" ? "qualifying packages" : "products"}`}</h2>
          <strong class="patronizing-entry-price">PHP ${formatNumber(plan.entryAmount)} <small>entry</small></strong>
          <ul>
            <li>${Number(plan.durationMonths)} Months</li>
            <li>Required PHP ${formatNumber(plan.monthlyRequirement)} worth product purchases per month</li>
            <li>PHP ${formatNumber(plan.monthlyIncome)} per month</li>
          </ul>
          ${progress ? `<div class="entry-progress-compact">
            <div class="entry-progress-meter"><span style="width:${progress.percent}%"></span></div>
            <div><strong>PHP ${formatNumber(progress.approved)} approved</strong><small>PHP ${formatNumber(progress.pending)} pending · PHP ${formatNumber(progress.remaining)} remaining</small></div>
          </div>` : ""}
          ${isToken
            ? `<button class="button button-primary button-small" type="button" data-patronizing-token-plan="${escapeHtml(plan.planCode)}" ${disabled ? "disabled" : ""}>Request ${formatNumber(plan.f3Tokens)} F3 Entry</button>`
            : disabled
              ? `<button class="button button-primary button-small" type="button" disabled>${actionLabel}</button>`
              : `<a class="button button-primary button-small" href="packages-orders.html?purpose=${purpose}">${actionLabel}</a>`}
        </article>`;
    }).join("");
  }

  function getProductEntryProgress(targetAmount, purpose) {
    const approvedStatuses = ["payment_approved", "shipped", "received"];
    const pendingStatuses = ["pending_shipping_fee", "approved_for_payment", "payment_submitted"];
    const orders = typeof MatrixDB.getCommerceOrders === "function" ? MatrixDB.getCommerceOrders() : [];
    const entryOrders = orders.filter(order => order.orderPurpose === purpose);
    const approved = entryOrders.filter(order => approvedStatuses.includes(order.status)).reduce((sum, order) => sum + Number(order.packageTotal || 0), 0);
    const pending = entryOrders.filter(order => pendingStatuses.includes(order.status)).reduce((sum, order) => sum + Number(order.packageTotal || 0), 0);
    const target = Number(targetAmount || 5818);
    return {
      approved,
      pending,
      remaining: Math.max(target - approved, 0),
      percent: target > 0 ? Math.min(approved / target * 100, 100) : 0
    };
  }

  function bindEntryButtons() {
    entryOptions.querySelectorAll("[data-patronizing-token-plan]").forEach(button => {
      button.addEventListener("click", () => openTokenModal(button.dataset.patronizingTokenPlan));
    });
  }

  function renderMonthly(entry) {
    const summary = dashboard.monthlySummary || {};
    document.getElementById("patronizing-active-badge").textContent = entry.entryType === "f3_token"
      ? `${formatNumber(entry.f3Tokens)} F3 Token Entry`
      : entry.planCode === "products_2800" ? "Package Entry" : "Product Entry";
    document.getElementById("patronizing-income-status").className = `matrix-qualification ${Number(summary.lockedIncome || 0) > 0 ? "locked" : "qualified"}`;
    document.getElementById("patronizing-income-status").textContent = Number(summary.lockedIncome || 0) > 0 ? "Locked Income" : "Unlocked";
    document.getElementById("patronizing-locked-income").textContent = `PHP ${formatNumber(summary.lockedIncome || 0)}`;
    document.getElementById("patronizing-income-summary").textContent = `PHP ${formatNumber(summary.approvedPurchase || 0)} approved purchases applied. PHP ${formatNumber(summary.remainingRequirement || 0)} requirement remains stacked.`;
    document.getElementById("patronizing-monthly-income").textContent = `PHP ${formatNumber(entry.monthlyIncome)}`;
    document.getElementById("patronizing-monthly-purchase").textContent = `PHP ${formatNumber(entry.monthlyRequirement)}`;
    document.getElementById("patronizing-months-reflected").textContent = `${Number(summary.dueMonths || 0)} / ${entry.durationMonths}`;
    document.getElementById("patronizing-unlocked-income").textContent = `PHP ${formatNumber(summary.unlockedIncome || 0)}`;
    document.getElementById("patronizing-requirement-note").textContent = `PHP ${formatNumber(summary.remainingRequirement || 0)} stacked requirement`;
    document.getElementById("patronizing-month-list").innerHTML = (dashboard.months || []).map(month => `
      <article class="product-plus-month ${month.status === "unlocked" ? "vested" : month.status === "upcoming" ? "upcoming" : ""}">
        <div class="product-plus-month-index">${Number(month.month)}/24</div>
        <div>
          <h5>PHP ${formatNumber(month.amount)} reflected income</h5>
          <p>Requires PHP ${formatNumber(month.requiredPurchase)} product purchases · ${formatDate(month.dueAt)}</p>
        </div>
        <span class="withdrawal-status ${month.status === "unlocked" ? "status-approved" : month.status === "upcoming" ? "status-pending" : "status-rejected"}">${statusLabel(month.status)}</span>
      </article>
    `).join("");
  }

  function renderExits() {
    const exits = dashboard.exits || [];
    const highest = exits.filter(exit => exit.status === "active").reduce((max, exit) => Math.max(max, Number(exit.exit)), 0);
    document.getElementById("patronizing-exit-badge").textContent = `Exit ${highest}`;
    const selected = exits.find(exit => exit.status === "active") || exits[0];
    document.getElementById("patronizing-exit-tabs").innerHTML = exits.map(exit => `
      <button class="matrix-tab ${exit.status === "active" ? "" : "locked"} ${exit === selected ? "active" : ""}" type="button" id="patronizing-exit-tab-${Number(exit.exit)}" data-patronizing-exit="${exit.exit}" role="tab" aria-controls="patronizing-exit-detail" aria-selected="${exit === selected}">
        <strong>Exit ${exit.exit}</strong>
        <span class="matrix-tab-status"><span>${exit.status === "active" ? `${formatNumber(exit.discountPercent)}%` : "Locked"}</span></span>
      </button>
    `).join("");
    selectExit(selected);
    document.getElementById("patronizing-exit-tabs").querySelectorAll("[data-patronizing-exit]").forEach(button => {
      button.addEventListener("click", () => {
        const exit = exits.find(item => Number(item.exit) === Number(button.dataset.patronizingExit));
        selectExit(exit);
      });
    });

    function selectExit(exit) {
      if (!exit) return;
      document.getElementById("patronizing-exit-tabs").querySelectorAll("[data-patronizing-exit]").forEach(button => {
        const active = Number(button.dataset.patronizingExit) === Number(exit.exit);
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
      document.getElementById("patronizing-exit-detail").setAttribute("aria-labelledby", `patronizing-exit-tab-${Number(exit.exit)}`);
      renderExitDetail(exit);
    }
  }

  function renderExitDetail(exit) {
    if (!exit) return;
    const remaining = Math.max(Number(exit.maxPurchase || 0) - Number(exit.usedPurchase || 0), 0);
    document.getElementById("patronizing-exit-detail").innerHTML = `
      <section class="matrix-status-panel">
        <span class="matrix-qualification ${exit.status === "active" ? "qualified" : "locked"}">${exit.status === "active" ? "Unlocked" : "Locked"}</span>
        <h4>Exit ${Number(exit.exit)}</h4>
        <p>${exit.status === "active" ? `Use up to PHP ${formatNumber(remaining)} remaining product purchases with ${formatNumber(exit.discountPercent)}% discount.` : `Needs 3 direct Patronizing downlines at Exit ${Number(exit.requiredDownlineExit)} or higher.`}</p>
        <dl class="matrix-facts products-plus-facts">
          <div><dt>Maximum Purchase</dt><dd>PHP ${formatNumber(exit.maxPurchase)}</dd></div>
          <div><dt>Discount</dt><dd>${formatNumber(exit.discountPercent)}%</dd></div>
          <div><dt>Already Used</dt><dd>PHP ${formatNumber(exit.usedPurchase)}</dd></div>
          <div><dt>Requirement</dt><dd>${Number(exit.qualifiedDownlines || 0)} / 3</dd></div>
        </dl>
        ${exit.status === "active" && remaining > 0
          ? `<a class="button button-primary button-small" href="packages-orders.html?purpose=patronizing_exit_discount&exit=${Number(exit.exit)}">Use Exit Discount</a>`
          : '<button class="button button-primary button-small" type="button" disabled>Use Exit Discount</button>'}
      </section>
    `;
  }

  function openTokenModal(planCode) {
    const plan = (dashboard.plans || []).find(item => item.planCode === planCode && item.entryType === "f3_token");
    if (!plan) return;
    selectedTokenPlan = planCode;
    document.getElementById("patronizing-token-summary").textContent = `Buy ${formatNumber(plan.f3Tokens)} F3 Token worth PHP ${formatNumber(plan.entryAmount)}.`;
    document.getElementById("patronizing-token-wallet-note").textContent = `This is where admin will send the ${formatNumber(plan.f3Tokens)} F3 Token after approval.`;
    const methods = MatrixDB.getPaymentMethods();
    tokenForm.reset();
    tokenAlert.style.display = "none";
    walletInput.value = member.walletAddress || "";
    paymentMethod.innerHTML = methods.length
      ? methods.map(method => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)} - ${escapeHtml(method.accountName)}</option>`).join("")
      : `<option value="">No active payment methods yet</option>`;
    paymentMethod.disabled = methods.length === 0;
    tokenSubmit.disabled = methods.length === 0;
    renderPaymentPreview();
    tokenModal.style.display = "flex";
  }

  function closeTokenModal() {
    tokenModal.style.display = "none";
    tokenAlert.style.display = "none";
  }

  function renderPaymentPreview() {
    const method = MatrixDB.getPaymentMethods().find(item => item.id === paymentMethod.value);
    paymentPreview.innerHTML = method
      ? `<div>${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} QR code">` : `<span>No QR</span>`}</div><section><strong>${escapeHtml(method.methodName)}</strong><p>${escapeHtml(method.accountName)} · ${escapeHtml(method.accountNumber)}</p>${method.instructions ? `<small>${escapeHtml(method.instructions)}</small>` : ""}</section>`
      : `<p>No active payment methods are available yet.</p>`;
  }

  function showAlert(message, type) {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.style.display = "block";
  }
  function show(element, message, type) {
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.style.display = "block";
  }
  function formatNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
  function formatDate(value) { return value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function statusLabel(status) { return ({ reflected: "Reflected", unlocked: "Unlocked", upcoming: "Upcoming" })[status] || "Reflected"; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
});
