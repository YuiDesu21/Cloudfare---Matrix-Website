document.addEventListener("DOMContentLoaded", async () => {
  const alertBox = document.getElementById("funds-alert");
  const planSelect = document.getElementById("funds-matrix-plan");
  const methodSelect = document.getElementById("funds-topup-method");
  let methods = [];
  if (!window.matrixSupabase) return show("Main Funds is unavailable in this environment.", "danger");
  const { data: session } = await window.matrixSupabase.auth.getSession();
  if (!session.session) return window.location.replace("portal.html");

  const methodResponse = await window.matrixSupabase.rpc("get_active_payment_methods");
  if (methodResponse.error) return show(methodResponse.error.message, "danger");
  methods = methodResponse.data || [];
  methodSelect.innerHTML = `<option value="">Choose payment method</option>${methods.map(method =>
    `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)}</option>`).join("")}`;
  methodSelect.addEventListener("change", renderPaymentMethod);

  planSelect.addEventListener("change", renderPlanNote);
  bindForm("funds-matrix-form", "transfer_matrix_income_to_main", () => ({
    p_plan_id: planSelect.value,
    p_amount: Number(document.getElementById("funds-matrix-amount").value)
  }), "Matrix income transferred to Main Funds.");
  bindForm("funds-topup-form", "request_member_fund_topup", () => ({
    p_amount: Number(document.getElementById("funds-topup-amount").value),
    p_payment_method_id: methodSelect.value,
    p_reference_number: document.getElementById("funds-topup-reference").value.trim()
  }), "Top-up sent for admin verification.");
  bindForm("funds-to-investment-form", "transfer_main_to_investment", () => ({
    p_amount: Number(document.getElementById("funds-to-investment-amount").value)
  }), "Funds transferred to Investment Funds.");
  bindForm("funds-to-main-form", "transfer_investment_to_main", () => ({
    p_amount: Number(document.getElementById("funds-to-main-amount").value)
  }), "Unlocked funds transferred to Main Funds.");
  await refresh();

  async function refresh() {
    const { data, error } = await window.matrixSupabase.rpc("get_my_member_funds_dashboard");
    if (error) return show(error.message, "danger");
    document.getElementById("funds-content").hidden = false;
    document.getElementById("funds-main").textContent = money(data.mainAvailable);
    const reserved = Number(data.mainBalance || 0) - Number(data.mainAvailable || 0);
    document.getElementById("funds-main-reserved").textContent = reserved > 0 ? `${money(reserved)} reserved for withdrawal` : "Available to transfer or withdraw";
    document.getElementById("funds-investment-available").textContent = money(data.investmentAvailable);
    document.getElementById("funds-investment-total").textContent = `${money(data.investmentBalance)} total`;
    document.getElementById("funds-locked").textContent = money(data.investmentLocked);
    const labels = { "power3-passive": "Premium Plan", "timeline-power3": "Standard Plan", "patronizing-income": "Patronizing Income", "budget-plan": "Budget Plan" };
    const balances = data.matrixBalances || {};
    planSelect.innerHTML = Object.entries(labels).map(([key, label]) =>
      `<option value="${key}">${label} | ${money(balances[key])} available</option>`).join("");
    renderPlanNote();
    document.getElementById("funds-contracts").innerHTML = (data.investments || []).length
      ? data.investments.map(contract => `<div class="funds-row"><div><strong>Budget Plan ${escapeHtml(contract.rankName)}</strong><small>${Number(contract.months)} months | ${money(contract.principal)} principal</small></div><span>${new Date(contract.unlocksAt) > new Date() ? `Unlocks ${date(contract.unlocksAt)}` : "Unlocked"}</span></div>`).join("")
      : `<p class="funds-empty">No investment contracts yet.</p>`;
    document.getElementById("funds-topups").innerHTML = (data.topups || []).length
      ? data.topups.map(topup => `<div class="funds-row"><div><strong>${money(topup.amount)} | ${escapeHtml(topup.methodName)}</strong><small>Reference ${escapeHtml(topup.referenceNumber)} | ${date(topup.createdAt)}</small></div><span>${escapeHtml(topup.status)}</span></div>`).join("")
      : `<p class="funds-empty">No top-up requests yet.</p>`;
    document.getElementById("funds-activity").innerHTML = (data.fundActivity || []).filter(item => new Date(item.availableAt) <= new Date()).length
      ? data.fundActivity.filter(item => new Date(item.availableAt) <= new Date()).map(item => `<div class="funds-row"><div><strong>${escapeHtml(item.note || item.sourceType)}</strong><small>${item.account === "main" ? "Main Funds" : "Investment Funds"} | ${date(item.availableAt)}</small></div><span class="${Number(item.amount) < 0 ? "funds-debit" : "funds-credit"}">${Number(item.amount) > 0 ? "+" : ""}${money(item.amount)}</span></div>`).join("")
      : `<p class="funds-empty">No funds activity yet.</p>`;
  }
  function renderPlanNote() {
    document.getElementById("funds-matrix-note").textContent = planSelect.value === "power3-passive"
      ? "Premium Plan transfers require at least PHP 1,000."
      : "Only income whose due date has passed can be transferred.";
    document.getElementById("funds-matrix-amount").min = planSelect.value === "power3-passive" ? "1000" : "0.01";
  }
  function renderPaymentMethod() {
    const method = methods.find(item => item.id === methodSelect.value);
    const target = document.getElementById("funds-payment-details");
    target.hidden = !method;
    target.innerHTML = method ? `<strong>${escapeHtml(method.methodName)}</strong><span>${escapeHtml(method.accountName)} | ${escapeHtml(method.accountNumber)}</span>${method.instructions ? `<p>${escapeHtml(method.instructions)}</p>` : ""}${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} payment QR code">` : ""}` : "";
  }
  function bindForm(id, rpc, args, success) {
    const form = document.getElementById(id);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const { error } = await window.matrixSupabase.rpc(rpc, args());
        if (error) throw error;
        form.reset();
        if (id === "funds-topup-form") renderPaymentMethod();
        show(success, "success");
        await refresh();
      } catch (error) {
        show(error.message || "The request failed. Please try again.", "danger");
      } finally {
        button.disabled = false;
      }
    });
  }
  function show(message, type) {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.hidden = false;
  }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function date(value) { return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
});
