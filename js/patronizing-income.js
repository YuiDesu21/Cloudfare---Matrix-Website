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
    entryBadge.textContent = isActive ? "Active" : pendingToken || pendingProduct ? "Pending" : "Not Active";
    entryBadge.className = `badge ${isActive ? "badge-active" : pendingToken || pendingProduct ? "badge-pending" : ""}`;
    entryOptions.innerHTML = renderEntryOptions(isActive, pendingToken, pendingProduct);
    dashboardCard.hidden = !isActive;
    exitsCard.hidden = !isActive;
    if (isActive) {
      renderMonthly(entry);
      renderExits();
    }
    bindEntryButtons();
  }

  function renderEntryOptions(isActive, pendingToken, pendingProduct) {
    const disabled = isActive || pendingToken || pendingProduct;
    const plans = dashboard.plans || [];
    const token = plans.find(plan => plan.entryType === "f3_token") || { entryAmount: 2100, f3Tokens: 35, monthlyRequirement: 1000, monthlyIncome: 200, durationMonths: 24 };
    const product = plans.find(plan => plan.entryType === "products") || { entryAmount: 5818, monthlyRequirement: 1250, monthlyIncome: 250, durationMonths: 24 };
    return `
      <article class="patronizing-entry-option">
        <span>F3 Token Entry</span>
        <h2>Buy ${formatNumber(token.f3Tokens)} F3 Token worth PHP ${formatNumber(token.entryAmount)}</h2>
        <ul>
          <li>${token.durationMonths} Months</li>
          <li>Required PHP ${formatNumber(token.monthlyRequirement)} worth product purchases per month</li>
          <li>PHP ${formatNumber(token.monthlyIncome)} per month</li>
        </ul>
        <button class="button button-primary button-small" type="button" data-patronizing-entry="token" ${disabled ? "disabled" : ""}>Request F3 Token Entry</button>
      </article>
      <article class="patronizing-entry-option">
        <span>Product Entry</span>
        <h2>Buy Products worth PHP ${formatNumber(product.entryAmount)}</h2>
        <ul>
          <li>${product.durationMonths} Months</li>
          <li>Required PHP ${formatNumber(product.monthlyRequirement)} worth product purchases per month</li>
          <li>PHP ${formatNumber(product.monthlyIncome)} per month</li>
        </ul>
        <a class="button button-primary button-small ${disabled ? "disabled" : ""}" href="${disabled ? "#" : "packages-orders.html?purpose=patronizing_entry_product"}">Choose Products</a>
      </article>
    `;
  }

  function bindEntryButtons() {
    const tokenButton = entryOptions.querySelector("[data-patronizing-entry='token']");
    if (tokenButton) tokenButton.addEventListener("click", openTokenModal);
  }

  function renderMonthly(entry) {
    const summary = dashboard.monthlySummary || {};
    document.getElementById("patronizing-active-badge").textContent = `${entry.entryType === "f3_token" ? "F3 Token" : "Product"} Entry`;
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
    document.getElementById("patronizing-exit-tabs").innerHTML = exits.map(exit => `
      <button class="matrix-tab ${exit.status === "active" ? "active" : "locked"}" type="button" data-patronizing-exit="${exit.exit}">
        <strong>Exit ${exit.exit}</strong>
        <span class="matrix-tab-status"><span>${exit.status === "active" ? `${formatNumber(exit.discountPercent)}%` : "Locked"}</span></span>
      </button>
    `).join("");
    const selected = exits.find(exit => exit.status === "active") || exits[0];
    renderExitDetail(selected);
    document.getElementById("patronizing-exit-tabs").querySelectorAll("[data-patronizing-exit]").forEach(button => {
      button.addEventListener("click", () => {
        const exit = exits.find(item => Number(item.exit) === Number(button.dataset.patronizingExit));
        renderExitDetail(exit);
      });
    });
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
        <a class="button button-primary button-small ${exit.status === "active" && remaining > 0 ? "" : "disabled"}" href="${exit.status === "active" && remaining > 0 ? `packages-orders.html?purpose=patronizing_exit_discount&exit=${Number(exit.exit)}` : "#"}">Use Exit Discount</a>
      </section>
    `;
  }

  function openTokenModal() {
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
