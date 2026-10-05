document.addEventListener("DOMContentLoaded", async () => {
  const alert = document.getElementById("budget-alert");
  if (!window.matrixSupabase) {
    showError("Budget Plan is unavailable in this environment.");
    return;
  }

  const { data: sessionData, error: sessionError } = await window.matrixSupabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    window.location.replace("portal.html");
    return;
  }

  const [budgetResponse, fundsResponse, requestsResponse, settingsResponse, methodsResponse, tokensResponse, profileResponse] = await Promise.all([
    window.matrixSupabase.rpc("get_my_budget_plan_dashboard"),
    window.matrixSupabase.rpc("get_my_member_funds_dashboard"),
    window.matrixSupabase.from("budget_investment_requests").select("id,rank_number,status")
      .eq("member_id", sessionData.session.user.id).eq("status", "pending"),
    window.matrixSupabase.from("budget_plan_token_settings").select("unit_price").eq("id", 1).single(),
    window.matrixSupabase.rpc("get_active_payment_methods"),
    window.matrixSupabase.from("budget_plan_token_requests")
      .select("id,quantity,amount,reference_number,status,created_at,delivery_reference")
      .eq("member_id", sessionData.session.user.id).order("created_at", { ascending: false }),
    window.matrixSupabase.rpc("get_my_dashboard")
  ]);
  const error = budgetResponse.error || fundsResponse.error || requestsResponse.error
    || settingsResponse.error || methodsResponse.error || tokensResponse.error || profileResponse.error;
  if (error) return showError(error.message);
  const data = budgetResponse.data;
  const funds = fundsResponse.data;
  const pendingRequests = requestsResponse.data || [];
  const tokenPrice = Number(settingsResponse.data.unit_price);
  const methods = methodsResponse.data || [];
  const walletAddress = profileResponse.data.member?.walletAddress || "";

  const rules = data.rules || [];
  const rank = Number(data.rank ?? -1);
  const current = rules.find(rule => Number(rule.rank) === rank);
  const entryCredit = Number(data.entryCredit || 0);
  const investmentCredit = Number(data.investmentCredit || 0);
  document.getElementById("budget-status").textContent = data.isActive ? "Active" : "Not Active";
  document.getElementById("budget-rank").textContent = current ? current.name : "Not Active";
  document.getElementById("budget-entry-value").textContent = `${money(entryCredit)} / PHP 150`;
  document.getElementById("budget-investment-value").textContent = `${money(investmentCredit)} / PHP 300`;
  document.getElementById("budget-entry-bar").style.width = `${Math.min(entryCredit / 150 * 100, 100)}%`;
  document.getElementById("budget-investment-bar").style.width = `${Math.min(investmentCredit / 300 * 100, 100)}%`;
  document.getElementById("budget-investment-status").textContent = data.canInvest ? "Qualified" : "Locked";
  document.getElementById("budget-eligibility-note").textContent = !data.isActive
    ? "Matrix placement begins when approved purchases reach PHP 150 in qualifying value."
    : rank < 1
      ? "Reach Overcomer rank to invest. Additional approved purchases continue filling the PHP 300 qualification."
      : data.canInvest ? "You meet the purchase and rank requirements for investing." : "Keep purchasing eligible products to complete the PHP 300 investment qualification.";

  document.getElementById("budget-passive-rows").innerHTML = rules.map(rule => `
    <tr><th scope="row">${escapeHtml(rule.name)}</th><td>${Number(rule.monthlyPassive) ? money(rule.monthlyPassive) : "-"}</td>
      <td>${Number(rule.passiveMonths) || "-"}</td><td>${rule.reachedAt ? "Reached" : "Locked"}</td></tr>`).join("");
  document.getElementById("budget-investment-rows").innerHTML = rules.filter(rule => Number(rule.investmentAmount) > 0).map(rule => {
    const contracts = (funds.investments || []).filter(item => Number(item.rank) === Number(rule.rank));
    const usedMonths = contracts.reduce((sum, item) => sum + Number(item.months || 0), 0);
    const active = contracts.find(item => new Date(item.unlocksAt) > new Date());
    const pending = pendingRequests.some(item => Number(item.rank_number) === Number(rule.rank));
    const qualified = data.canInvest && rank >= Number(rule.rank);
    const funded = Number(funds.investmentAvailable || 0) >= Number(rule.investmentAmount);
    const complete = usedMonths >= Number(rule.investmentMonths);
    const label = complete ? "Complete" : active ? `Unlocks ${new Date(active.unlocksAt).toLocaleDateString()}`
      : pending ? "Pending approval" : !qualified ? "Locked" : !funded ? "Add funds" : "Request Investment";
    const actionable = qualified && funded && !complete && !active && !pending;
    return `<tr><th scope="row">${escapeHtml(rule.name)}</th><td>${money(rule.investmentAmount)}</td>
      <td>${money(Number(rule.investmentAmount) * .3)}</td><td>${usedMonths} / ${Number(rule.investmentMonths)}</td>
      <td>${Math.min(Number(rule.contractMonths), Number(rule.investmentMonths) - usedMonths)} months</td>
      <td><button class="button button-outline button-small budget-action" type="button" data-budget-invest-rank="${Number(rule.rank)}" ${actionable ? "" : "disabled"}>${escapeHtml(label)}</button></td></tr>`;
  }).join("");
  document.querySelectorAll("[data-budget-invest-rank]").forEach(button => {
    if (button.disabled) return;
    button.addEventListener("click", async () => {
      const selectedRule = rules.find(rule => Number(rule.rank) === Number(button.dataset.budgetInvestRank));
      if (!window.confirm(`Request ${selectedRule.name} investment of ${money(selectedRule.investmentAmount)} from Investment Funds?`)) return;
      button.disabled = true;
      const { error: requestError } = await window.matrixSupabase.rpc("request_budget_investment", {
        p_rank_number: Number(button.dataset.budgetInvestRank)
      });
      if (requestError) { button.disabled = false; return showError(requestError.message); }
      window.location.reload();
    });
  });
  document.getElementById("budget-token-price").textContent = `${money(tokenPrice)} / F3`;
  const tokenQuantity = document.getElementById("budget-token-quantity");
  const tokenMethod = document.getElementById("budget-token-method");
  const tokenSubmit = document.getElementById("budget-token-submit");
  tokenMethod.innerHTML = `<option value="">Choose payment method</option>${methods.map(method =>
    `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)}</option>`).join("")}`;
  document.getElementById("budget-token-wallet").innerHTML = walletAddress
    ? `Tokens will be sent to your saved F3 wallet: <strong>${escapeHtml(walletAddress)}</strong>`
    : `Add an F3 wallet address in <a href="portal.html#profile">Profile</a> before requesting tokens.`;
  tokenSubmit.disabled = !walletAddress || !methods.length;
  tokenQuantity.addEventListener("input", updateTokenEstimate);
  tokenMethod.addEventListener("change", renderTokenPaymentMethod);
  updateTokenEstimate();
  document.getElementById("budget-token-history").innerHTML = (tokensResponse.data || []).length
    ? tokensResponse.data.map(request => `<div class="funds-row"><div><strong>${Number(request.quantity)} F3 | ${money(request.amount)}</strong><small>${escapeHtml(request.reference_number)} | ${new Date(request.created_at).toLocaleDateString()}</small></div><span>${escapeHtml(request.status)}${request.delivery_reference ? `<small>${escapeHtml(request.delivery_reference)}</small>` : ""}</span></div>`).join("")
    : `<p class="funds-empty">No F3 token requests yet.</p>`;
  document.getElementById("budget-token-form").addEventListener("submit", async event => {
    event.preventDefault();
    tokenSubmit.disabled = true;
    const { error: requestError } = await window.matrixSupabase.rpc("request_budget_token_purchase", {
      p_quantity: Number(tokenQuantity.value),
      p_payment_method_id: tokenMethod.value,
      p_reference_number: document.getElementById("budget-token-reference").value.trim()
    });
    if (requestError) { tokenSubmit.disabled = false; return showError(requestError.message); }
    window.location.reload();
  });
  document.getElementById("budget-content").hidden = false;

  function updateTokenEstimate() {
    const quantity = Number(tokenQuantity.value || 0);
    const amount = quantity * tokenPrice;
    document.getElementById("budget-token-estimate").textContent =
      `${money(amount)} payment | ${money(Math.round(amount * .8 * 100) / 100)} Budget qualification after approval`;
  }
  function renderTokenPaymentMethod() {
    const method = methods.find(item => item.id === tokenMethod.value);
    const target = document.getElementById("budget-token-payment-details");
    target.hidden = !method;
    target.innerHTML = method ? `<strong>${escapeHtml(method.methodName)}</strong><span>${escapeHtml(method.accountName)} | ${escapeHtml(method.accountNumber)}</span>${method.instructions ? `<p>${escapeHtml(method.instructions)}</p>` : ""}${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} payment QR code">` : ""}` : "";
  }

  function showError(message) {
    alert.textContent = message;
    alert.className = "alert alert-danger";
    alert.hidden = false;
  }
  function money(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }
});
