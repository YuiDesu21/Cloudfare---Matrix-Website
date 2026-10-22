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
  if (budgetResponse.error || !budgetResponse.data) {
    showError(budgetResponse.error?.message || "Budget Plan could not be loaded. Please refresh the page.");
    return;
  }
  const fundsReady = !fundsResponse.error && Boolean(fundsResponse.data);
  const requestsReady = !requestsResponse.error;
  const tokenPrice = Number(settingsResponse.data?.unit_price);
  const tokenPriceReady = !settingsResponse.error && Number.isFinite(tokenPrice) && tokenPrice > 0;
  const methodsReady = !methodsResponse.error && Array.isArray(methodsResponse.data);
  const profileReady = !profileResponse.error && Boolean(profileResponse.data?.member);
  const data = budgetResponse.data;
  const funds = fundsReady ? fundsResponse.data : { investments: [], matrixBalances: {}, investmentAvailable: 0 };
  const pendingRequests = requestsResponse.data || [];
  const methods = methodsReady ? methodsResponse.data : [];
  const walletAddress = profileReady ? profileResponse.data.member.walletAddress || "" : "";
  const contracts = funds.investments || [];
  const contractIds = contracts.map(contract => contract.id);
  const investmentIncomeResponse = fundsReady && contractIds.length
    ? await window.matrixSupabase.from("budget_investment_income").select("contract_id,due_at").in("contract_id", contractIds)
    : { data: [], error: null };
  const investmentReady = fundsReady && requestsReady && !investmentIncomeResponse.error;
  const investmentIncome = investmentIncomeResponse.data || [];
  if (!fundsReady || !requestsReady || !tokenPriceReady || !methodsReady || tokensResponse.error || !profileReady || !investmentReady) {
    showError("Some account details could not be loaded. Affected actions are unavailable until you refresh the page.", "info");
  }

  const rules = data.rules || [];
  const rank = Number(data.rank ?? -1);
  const current = rules.find(rule => Number(rule.rank) === rank);
  const entryCredit = Number(data.entryCredit || 0);
  const investmentCredit = Number(data.investmentCredit || 0);
  const budgetStatus = document.getElementById("budget-status");
  budgetStatus.textContent = data.isActive ? "Active" : "Not Active";
  budgetStatus.className = `badge ${data.isActive ? "badge-active" : "badge-pending"}`;
  document.querySelector(".plan-hero-side .plan-entry-amount").hidden = Boolean(data.isActive);
  document.getElementById("budget-dashboard-jump").hidden = !data.isActive;
  const rankBadge = document.getElementById("budget-rank");
  rankBadge.textContent = current ? current.name : "Not Active";
  rankBadge.className = `badge ${data.isActive ? "badge-active" : "badge-pending"}`;
  const entryComplete = entryCredit >= 150;
  const investmentComplete = investmentCredit >= 300;
  const purchaseCard = document.getElementById("budget-purchase-card");
  purchaseCard.hidden = entryComplete && investmentComplete;
  if (!purchaseCard.hidden) {
    const target = entryComplete ? 300 : 150;
    const credit = entryComplete ? investmentCredit : entryCredit;
    document.getElementById("budget-progress-title").textContent = entryComplete ? "Investment Qualification" : "Matrix Entry";
    document.getElementById("budget-progress-value").textContent = `${money(credit)} / PHP ${target}`;
    document.getElementById("budget-progress-description").textContent = entryComplete
      ? "Entry complete. Additional approved purchases count toward investment qualification."
      : "Approved product or F3 token payments count toward your entry target.";
    const meter = purchaseCard.querySelector("[role=progressbar]");
    meter.setAttribute("aria-valuemax", String(target));
    meter.setAttribute("aria-valuenow", String(Math.min(credit, target)));
    document.getElementById("budget-progress-bar").style.width = `${Math.min(credit / target * 100, 100)}%`;
    document.getElementById("budget-eligibility-note").textContent = !entryComplete
      ? "Matrix placement begins when approved purchases reach PHP 150 in qualifying value."
      : "Reach Overcomer rank and complete the PHP 300 purchase target to unlock investment eligibility.";
  }
  const investmentBadge = document.getElementById("budget-investment-status");
  investmentBadge.textContent = data.canInvest ? "Qualified" : "Locked";
  investmentBadge.className = `badge ${data.canInvest ? "badge-active" : "badge-pending"}`;
  if (data.isActive) {
    const nextRank = rules.find(rule => Number(rule.rank) === rank + 1);
    const downlineCount = data.nextRankQualifiedDownlines;
    const rankProgress = document.getElementById("budget-rank-progress");
    document.getElementById("budget-summary-rank").textContent = current?.name || "Challenger";
    document.getElementById("budget-summary-next-rank").textContent = !nextRank
      ? "Highest rank reached."
      : Number.isInteger(downlineCount)
        ? `${Math.min(downlineCount, 3)} of 3 qualifying direct downlines toward ${nextRank.name}.`
        : `Next: ${nextRank.name}. Requires 3 qualifying direct downlines.`;
    if (nextRank && Number.isInteger(downlineCount)) {
      rankProgress.hidden = false;
      rankProgress.setAttribute("aria-valuenow", String(Math.min(downlineCount, 3)));
      document.getElementById("budget-rank-progress-fill").style.width = `${Math.min(downlineCount, 3) / 3 * 100}%`;
    }

    const income = data.passiveIncome || [];
    const currentIncome = income.filter(item => item.sourceLabel === `Budget Plan ${current?.name}`);
    const creditedMonths = currentIncome.filter(item => item.status !== "scheduled").length;
    const nextIncome = income.filter(item => item.status === "scheduled" && Number.isFinite(Date.parse(item.dueAt)))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
    document.getElementById("budget-summary-earnings").textContent = fundsReady
      ? money(funds.matrixBalances?.["budget-plan"]) : "Unavailable";
    document.getElementById("budget-summary-monthly").textContent = money(current?.monthlyPassive);
    document.getElementById("budget-summary-months").textContent = Number(current?.passiveMonths)
      ? `${creditedMonths} of ${current.passiveMonths} months credited at ${current.name}.`
      : "Monthly income starts at Promoter rank.";
    document.getElementById("budget-summary-next-month").textContent = nextIncome
      ? `Next eligible month: ${formatDate(nextIncome.dueAt)}`
      : "No upcoming monthly income scheduled.";

    const activeContracts = contracts.filter(item => Number.isFinite(Date.parse(item.unlocksAt)) && Date.parse(item.unlocksAt) > Date.now());
    const nextContractEnd = activeContracts.slice().sort((a, b) => Date.parse(a.unlocksAt) - Date.parse(b.unlocksAt))[0];
    document.getElementById("budget-summary-investment").textContent = !investmentReady ? "Unavailable" : activeContracts.length
      ? `${activeContracts.length} active ${activeContracts.length === 1 ? "contract" : "contracts"}`
      : pendingRequests.length ? "Pending review" : data.canInvest ? "Qualified" : "Locked";
    document.getElementById("budget-summary-investment-detail").textContent = !investmentReady
      ? "Investment details could not be loaded. Refresh the page to review them."
      : nextContractEnd
      ? `${money(activeContracts.reduce((sum, item) => sum + Number(item.principal || 0), 0))} committed. Next contract ends ${formatDate(nextContractEnd.unlocksAt)}.`
      : pendingRequests.length ? "Your investment request is awaiting approval."
        : data.canInvest ? "You can request an investment from Investment Funds."
          : `${rank < 1 ? "Reach Overcomer and complete" : "Complete"} ${money(300 - investmentCredit)} more in qualifying purchase value.`;
    document.getElementById("budget-dashboard").hidden = false;
  }
  document.getElementById("budget-passive-rows").innerHTML = rules.map(rule => {
    const months = Number(rule.passiveMonths || 0);
    const eligible = (data.passiveIncome || []).filter(item => item.sourceLabel === `Budget Plan ${rule.name}` && item.status !== "scheduled").length;
    const state = !rule.reachedAt ? "Locked" : eligible >= months && months ? "Complete" : eligible ? "Eligible" : "Scheduled";
    return `<tr><th scope="row">${escapeHtml(rule.name)}</th><td>${Number(rule.monthlyPassive) ? money(rule.monthlyPassive) : "-"}</td>
      <td>${months ? MatrixBenefits.progress(eligible, months) : "-"}</td><td>${MatrixBenefits.state(state, !rule.reachedAt ? "locked" : eligible ? "active" : "pending")}</td></tr>`;
  }).join("");
  document.getElementById("budget-investment-rows").innerHTML = rules.filter(rule => Number(rule.investmentAmount) > 0).map(rule => {
    const rankContracts = contracts.filter(item => Number(item.rank) === Number(rule.rank));
    const usedMonths = rankContracts.reduce((sum, item) => sum + Number(item.months || 0), 0);
    const eligibleMonths = investmentIncome.filter(item => rankContracts.some(contract => contract.id === item.contract_id) && new Date(item.due_at) <= new Date()).length;
    const active = rankContracts.find(item => new Date(item.unlocksAt) > new Date());
    const pending = pendingRequests.some(item => Number(item.rank_number) === Number(rule.rank));
    const qualified = data.canInvest && rank >= Number(rule.rank);
    const funded = Number(funds.investmentAvailable || 0) >= Number(rule.investmentAmount);
    const complete = usedMonths >= Number(rule.investmentMonths);
    const label = !investmentReady ? "Unavailable" : complete ? "Complete" : active ? `Unlocks ${new Date(active.unlocksAt).toLocaleDateString()}`
      : pending ? "Pending approval" : !qualified ? "Locked" : !funded ? "Add funds" : "Request Investment";
    const actionable = investmentReady && qualified && funded && !complete && !active && !pending;
    return `<tr><th scope="row">${escapeHtml(rule.name)}</th><td>${money(rule.investmentAmount)}</td>
      <td>${money(Number(rule.investmentAmount) * .3)}</td><td>${investmentReady ? MatrixBenefits.progress(eligibleMonths, rule.investmentMonths) : "Unavailable"}</td>
      <td>${investmentReady ? `${Math.min(Number(rule.contractMonths), Number(rule.investmentMonths) - usedMonths)} months` : "Unavailable"}</td>
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
  document.getElementById("budget-token-price").textContent = tokenPriceReady ? `${money(tokenPrice)} / F3` : "Price unavailable";
  const tokenQuantity = document.getElementById("budget-token-quantity");
  const tokenMethod = document.getElementById("budget-token-method");
  const tokenSubmit = document.getElementById("budget-token-submit");
  tokenMethod.innerHTML = `<option value="">Choose payment method</option>${methods.map(method =>
    `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)}</option>`).join("")}`;
  document.getElementById("budget-token-wallet").innerHTML = !profileReady
    ? "Saved F3 wallet could not be loaded. Refresh the page before requesting tokens."
    : walletAddress
    ? `Tokens will be sent to your saved F3 wallet: <strong>${escapeHtml(walletAddress)}</strong>`
    : `Add an F3 wallet address in <a href="portal.html#profile">Profile</a> before requesting tokens.`;
  tokenSubmit.disabled = !tokenPriceReady || !walletAddress || !methods.length;
  tokenQuantity.addEventListener("input", updateTokenEstimate);
  tokenMethod.addEventListener("change", renderTokenPaymentMethod);
  updateTokenEstimate();
  document.getElementById("budget-token-history").innerHTML = tokensResponse.error
    ? `<p class="funds-empty">Token requests could not be loaded. Refresh the page to try again.</p>`
    : (tokensResponse.data || []).length
    ? tokensResponse.data.map(request => `<div class="funds-row"><div><strong>${Number(request.quantity)} F3 | ${money(request.amount)}</strong><small>${escapeHtml(request.reference_number)} | ${new Date(request.created_at).toLocaleDateString()}</small></div><span>${escapeHtml(request.status)}${request.delivery_reference ? `<small>${escapeHtml(request.delivery_reference)}</small>` : ""}</span></div>`).join("")
    : `<p class="funds-empty">No F3 token requests yet.</p>`;
  document.getElementById("budget-token-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!tokenPriceReady || !walletAddress || !methods.length) return;
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
    if (!tokenPriceReady) {
      document.getElementById("budget-token-estimate").textContent = "Price unavailable. Refresh the page before requesting tokens.";
      return;
    }
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

  function showError(message, type = "danger") {
    alert.textContent = message;
    alert.className = `alert alert-${type}`;
    alert.hidden = false;
  }
  function money(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value));
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }
});
