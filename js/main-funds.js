document.addEventListener("DOMContentLoaded", async () => {
  const client = window.matrixSupabase;
  const { parseCents, toCents, centsToInput, money } = window.MatrixFundsMoney;
  const $ = id => document.getElementById(id);
  const dialog = $("funds-transfer-dialog");
  const from = $("funds-from");
  const amount = $("funds-amount");
  const methodSelect = $("funds-topup-method");
  const actionDialogs = { deposit: $("funds-deposit-dialog"), withdraw: $("funds-withdraw-dialog"), earnings: $("funds-earnings-dialog") };
  const actionState = { deposit: { processing: false }, withdraw: { processing: false }, earnings: { processing: false } };
  const actionTriggers = { deposit: $("funds-open-deposit"), withdraw: $("funds-open-withdraw"), earnings: $("funds-open-earnings") };
  const legacyView = location.hash === "#investment-funds" ? "investment" : location.hash === "#funds-activity" ? "transactions" : "";
  const view = new URLSearchParams(location.search).get("view") || legacyView || "main";
  const wallet = view === "investment" ? "investment" : "main";
  const names = { main: "Main Funds", investment: "Investment Funds" };
  const pendingStorageKey = "matrix_pending_wallet_transfer";
  const actionStorageKey = kind => `matrix_pending_${kind}_action`;
  const planLabels = { "power3-passive": "Premium Plan", "timeline-power3": "Standard Plan", "patronizing-income": "Patronizing Income", "budget-plan": "Budget Plan" };
  const matrixPlans = ["budget-plan", "timeline-power3", "power3-passive"];
  let dashboard;
  let methods = [];
  let transactions = [];
  let filter = "all";
  let visibleCount = 10;
  let transferKey = null;
  let processing = false;
  let uncertain = false;
  let balanceHidden = false;

  if (!client) return show("Funds are unavailable in this environment.", "danger");
  const { data: session } = await client.auth.getSession();
  if (!session.session) return location.replace("portal.html");
  if (!["main", "investment", "transactions"].includes(view)) return location.replace("main-funds.html");
  if (legacyView) history.replaceState(null, "", `main-funds.html?view=${view}`);

  document.title = `${view === "transactions" ? "Transactions" : names[view]} | Matrix Portal`;
  $("funds-page-title").textContent = view === "transactions" ? "Transactions" : names[view];
  $("funds-page-description").textContent = view === "investment"
    ? "Manage your available investment funds and reinvestments."
    : view === "transactions" ? "Review your wallet activity." : "Manage your wallet balance and transactions.";
  $("funds-main-tab").setAttribute("aria-current", view === "main" ? "page" : "false");
  $("funds-investment-tab").setAttribute("aria-current", view === "investment" ? "page" : "false");
  $("funds-main-actions").hidden = view !== "main";
  $("funds-investment-actions").hidden = view !== "investment";
  $("funds-earnings-section").hidden = view !== "main";
  $("funds-all-activity").hidden = view === "transactions";
  document.querySelector(".funds-overview").hidden = view === "transactions";
  document.querySelector(".funds-secondary-balance").hidden = view === "transactions";
  document.querySelector(".funds-wallet-tabs").hidden = view === "transactions";

  const methodResponse = await client.rpc("get_active_payment_methods");
  if (methodResponse.error) show("Payment methods could not be loaded. Please refresh this page.", "danger");
  methods = methodResponse.data || [];
  methodSelect.innerHTML = `<option value="">Choose payment method</option>${methods.map(method => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)}</option>`).join("")}`;
  methodSelect.addEventListener("change", renderPaymentMethod);
  $("funds-topup-form").addEventListener("submit", reviewDeposit);
  $("funds-deposit-back").addEventListener("click", () => actionStep("deposit", "entry"));
  $("funds-deposit-confirm").addEventListener("click", submitDeposit);
  $("funds-withdraw-form").addEventListener("submit", reviewWithdrawal);
  $("funds-withdraw-amount").addEventListener("input", renderWithdrawalPreview);
  $("funds-withdraw-max").addEventListener("click", () => { $("funds-withdraw-amount").value = centsToInput(availableCents("main")); renderWithdrawalPreview(); });
  $("funds-withdraw-number").addEventListener("input", () => { $("funds-withdraw-number").value = $("funds-withdraw-number").value.replace(/\D/g, "").slice(0, 11); });
  $("funds-withdraw-back").addEventListener("click", () => { if (!actionState.withdraw.uncertain) actionStep("withdraw", "entry"); });
  $("funds-withdraw-confirm").addEventListener("click", submitWithdrawal);
  $("funds-earnings-source").addEventListener("change", updateEarnings);
  $("funds-earnings-amount").addEventListener("input", renderEarningsPreview);
  $("funds-earnings-max").addEventListener("click", () => { $("funds-earnings-amount").value = centsToInput(earningsAvailable()); renderEarningsPreview(); });
  $("funds-earnings-form").addEventListener("submit", reviewEarnings);
  $("funds-earnings-back").addEventListener("click", () => { if (!actionState.earnings.uncertain) actionStep("earnings", "entry"); });
  $("funds-earnings-confirm").addEventListener("click", submitEarnings);
  Object.entries(actionTriggers).forEach(([kind, trigger]) => trigger.addEventListener("click", () => openAction(kind)));
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeAction(button.dataset.closeDialog)));
  Object.entries(actionDialogs).forEach(([kind, target]) => target.addEventListener("cancel", event => {
    if (actionState[kind].processing || actionState[kind].uncertain) event.preventDefault();
    else actionTriggers[kind].focus();
  }));
  $("funds-balance-toggle").addEventListener("click", () => {
    balanceHidden = !balanceHidden;
    $("funds-balance-toggle").textContent = balanceHidden ? "◌" : "◉";
    $("funds-balance-toggle").setAttribute("aria-label", balanceHidden ? "Show balance" : "Hide balance");
    renderBalances();
  });
  document.querySelectorAll("[data-open-transfer]").forEach(button => button.addEventListener("click", openTransfer));
  $("funds-transfer-close").addEventListener("click", closeTransfer);
  $("funds-entry-cancel").addEventListener("click", closeTransfer);
  $("funds-transfer-done").addEventListener("click", closeTransfer);
  dialog.addEventListener("cancel", event => { if (processing || uncertain) event.preventDefault(); });
  from.addEventListener("change", () => { transferKey = null; renderRoute(); });
  $("funds-swap").addEventListener("click", () => { from.value = from.value === "main" ? "investment" : "main"; transferKey = null; renderRoute(); });
  amount.addEventListener("input", () => { transferKey = null; renderPreview(); });
  $("funds-max").addEventListener("click", () => { amount.value = centsToInput(availableCents(from.value)); renderPreview(); amount.focus(); });
  $("funds-transfer-form").addEventListener("submit", event => {
    event.preventDefault();
    const cents = transferCents();
    if (cents === null || cents < 1 || cents > availableCents(from.value)) return renderPreview(true);
    $("funds-review-from").textContent = names[from.value];
    $("funds-review-to").textContent = names[otherWallet(from.value)];
    $("funds-review-amount").textContent = money(cents);
    $("funds-review-received").textContent = money(cents);
    $("funds-review-remaining").textContent = money(availableCents(from.value) - cents);
    $("funds-transfer-error").hidden = true;
    $("funds-transfer-entry").hidden = true;
    $("funds-transfer-review").hidden = false;
    $("funds-transfer-confirm").focus();
  });
  $("funds-review-back").addEventListener("click", () => { if (!processing && !uncertain) { $("funds-transfer-review").hidden = true; $("funds-transfer-entry").hidden = false; amount.focus(); } });
  $("funds-transfer-confirm").addEventListener("click", confirmTransfer);
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.filter;
    visibleCount = 10;
    document.querySelectorAll("[data-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderHistory();
  }));
  $("funds-history-search").addEventListener("input", () => { visibleCount = 10; renderHistory(); });
  $("funds-more").addEventListener("click", () => { visibleCount += 10; renderHistory(); });
  $("funds-detail-close").addEventListener("click", () => $("funds-detail-dialog").close());
  $("funds-activity").addEventListener("click", event => {
    const row = event.target.closest("[data-transaction]");
    if (row) showTransaction(Number(row.dataset.transaction));
  });
  await refresh();
  const requestedDialog = new URLSearchParams(location.search).get("dialog");
  if (view === "main" && actionDialogs[requestedDialog] && dashboard) {
    openAction(requestedDialog);
    history.replaceState(null, "", "main-funds.html");
  }
  const pending = JSON.parse(sessionStorage.getItem(pendingStorageKey) || "null");
  if (pending && dashboard) {
    const completed = (dashboard.fundActivity || []).some(item => item.sourceId === pending.key && item.sourceType === "wallet_transfer");
    if (completed) {
      sessionStorage.removeItem(pendingStorageKey);
      show(`Transfer ${pending.key} completed.`, "success");
    } else {
      from.value = pending.source;
      amount.value = pending.amount;
      transferKey = pending.key;
      uncertain = true;
      renderRoute();
      $("funds-transfer-entry").hidden = true;
      $("funds-transfer-review").hidden = false;
      $("funds-transfer-success").hidden = true;
      $("funds-review-from").textContent = names[from.value];
      $("funds-review-to").textContent = names[otherWallet(from.value)];
      $("funds-review-amount").textContent = money(transferCents());
      $("funds-review-received").textContent = money(transferCents());
      $("funds-review-remaining").textContent = money(availableCents(from.value) - transferCents());
      $("funds-review-back").disabled = true;
      $("funds-transfer-error").textContent = `Transfer status is still unverified. Retry with the same reference ${transferKey}; it cannot create a second transfer.`;
      $("funds-transfer-error").hidden = false;
      dialog.showModal();
    }
  }
  for (const kind of ["withdraw", "earnings"]) {
    const saved = JSON.parse(sessionStorage.getItem(actionStorageKey(kind)) || "null");
    if (!saved || !dashboard) continue;
    const { data } = await client.rpc("get_my_funds_action_status", {
      p_kind: kind === "withdraw" ? "withdrawal" : "matrix", p_idempotency_key: saved.key
    });
    if (data && data.id) {
      sessionStorage.removeItem(actionStorageKey(kind));
      show(`${kind === "withdraw" ? "Withdrawal request" : "Matrix transfer"} ${data.code || data.id} was recorded.`, "success");
      await refresh();
      continue;
    }
    actionState[kind].key = saved.key;
    actionState[kind].uncertain = true;
    if (kind === "withdraw") {
      $("funds-withdraw-amount").value = saved.args.p_amount;
      $("funds-withdraw-name").value = saved.args.p_account_name;
      $("funds-withdraw-number").value = saved.args.p_gcash_number;
      $("funds-withdraw-notes").value = saved.args.p_notes;
      $("funds-withdraw-review-amount").textContent = money(toCents(saved.args.p_amount));
      $("funds-withdraw-review-net").textContent = money(toCents(saved.args.p_amount));
      $("funds-withdraw-review-recipient").textContent = `${saved.args.p_account_name} · ${saved.args.p_gcash_number}`;
      $("funds-withdraw-review-remaining").textContent = money(Math.max(0, availableCents("main") - toCents(saved.args.p_amount)));
    } else {
      $("funds-earnings-source").value = saved.args.p_plan_id;
      $("funds-earnings-amount").value = saved.args.p_amount;
      $("funds-earnings-review-source").textContent = planLabels[saved.args.p_plan_id];
      $("funds-earnings-review-amount").textContent = money(toCents(saved.args.p_amount));
      $("funds-earnings-review-remaining").textContent = money(Math.max(0, earningsAvailable() - toCents(saved.args.p_amount)));
      $("funds-earnings-review-main").textContent = money(availableCents("main") + toCents(saved.args.p_amount));
    }
    actionStep(kind, "review");
    const errorBox = $(kind === "withdraw" ? "funds-withdraw-review-error" : "funds-earnings-review-error");
    errorBox.textContent = `Status is unverified. Retry with the same reference ${saved.key}; it cannot create a second request.`;
    errorBox.hidden = false;
    $(kind === "withdraw" ? "funds-withdraw-back" : "funds-earnings-back").disabled = true;
    actionDialogs[kind].showModal();
    break;
  }

  async function refresh() {
    const { data, error } = await client.rpc("get_my_member_funds_dashboard");
    if (error) return show("Wallet balances could not be loaded. Please refresh this page.", "danger");
    dashboard = data;
    $("funds-content").hidden = false;
    renderBalances();
    renderEarnings();
    transactions = buildTransactions(data);
    renderHistory();
    if (dialog.open) renderRoute();
  }
  function renderBalances() {
    if (!dashboard) return;
    const reserved = Math.max(0, toCents(dashboard.mainBalance) - toCents(dashboard.mainAvailable));
    $("funds-primary-label").textContent = view === "investment" ? "Available Investment Funds" : "Available Balance";
    $("funds-primary-balance").textContent = balanceHidden ? "••••••" : money(availableCents(wallet));
    $("funds-primary-note").textContent = view === "investment"
      ? `${money(toCents(dashboard.investmentLocked))} committed to active contracts${toCents(dashboard.investmentPending) ? `; ${money(toCents(dashboard.investmentPending))} pending approval` : ""}`
      : reserved ? `${money(reserved)} reserved for pending withdrawal` : "Available for withdrawal or transfer";
    $("funds-secondary-label").textContent = view === "investment" ? "Main Funds" : "Investment Funds";
    $("funds-secondary-balance").textContent = balanceHidden ? "••••••" : money(availableCents(otherWallet(wallet)));
    $("funds-secondary-note").textContent = view === "investment" ? "Available for withdrawal or transfer" : "Available for reinvestment";
    $("funds-secondary-link").href = view === "investment" ? "main-funds.html" : "main-funds.html?view=investment";
  }
  function renderEarnings() {
    const select = $("funds-earnings-source");
    const balances = dashboard.matrixBalances || {};
    const transferable = id => {
      const cents = toCents(balances[id]);
      return id === "power3-passive" && cents < 100000 ? 0 : cents;
    };
    const total = matrixPlans.reduce((sum, id) => sum + transferable(id), 0);
    $("funds-earnings-total").textContent = money(total);
    $("funds-earnings-list").innerHTML = matrixPlans.map(id =>
      `<div class="funds-matrix-plan"><span>${escapeHtml(planLabels[id])}</span><strong>${money(transferable(id))}</strong></div>`).join("");
    const premiumDue = toCents(balances["power3-passive"]);
    $("funds-earnings-note").hidden = premiumDue === 0 || premiumDue >= 100000;
    $("funds-earnings-note").textContent = premiumDue > 0 && premiumDue < 100000
      ? `${money(premiumDue)} in Premium earnings is due but remains below the PHP 1,000 transfer minimum.` : "";
    const eligible = matrixPlans.filter(id => transferable(id) > 0);
    $("funds-open-earnings").disabled = eligible.length === 0;
    const prior = select.value;
    select.innerHTML = matrixPlans.map(id =>
      `<option value="${id}"${eligible.includes(id) ? "" : " disabled"}>${escapeHtml(planLabels[id])}</option>`).join("");
    select.value = eligible.includes(prior) ? prior : eligible[0] || "";
    updateEarnings();
  }
  function updateEarnings() {
    const source = $("funds-earnings-source").value;
    $("funds-earnings-available").textContent = `${money(earningsAvailable())} due and available${source === "power3-passive" ? " · PHP 1,000 minimum transfer" : ""}`;
    renderEarningsPreview();
  }
  function earningsAvailable() { return toCents((dashboard && dashboard.matrixBalances || {})[$("funds-earnings-source").value]); }
  function openTransfer() {
    if (!dashboard) return;
    from.value = view === "investment" ? "investment" : "main";
    amount.value = "";
    transferKey = null;
    uncertain = false;
    $("funds-transfer-entry").hidden = false;
    $("funds-transfer-review").hidden = true;
    $("funds-transfer-success").hidden = true;
    $("funds-transfer-error").hidden = true;
    renderRoute();
    dialog.showModal();
    from.focus();
  }
  function closeTransfer() { if (!processing && !uncertain) dialog.close(); }
  function renderRoute() {
    const dest = otherWallet(from.value);
    $("funds-to-name").textContent = names[dest];
    $("funds-from-balance").textContent = `${money(availableCents(from.value))} available`;
    $("funds-to-balance").textContent = `${money(availableCents(dest))} available`;
    const cents = transferCents();
    if (cents === null || cents > availableCents(from.value)) amount.value = "";
    renderPreview();
  }
  function renderPreview(forceError = false) {
    const cents = transferCents();
    const valid = cents !== null && cents >= 1 && cents <= availableCents(from.value);
    const display = valid ? cents : 0;
    $("funds-preview-amount").textContent = money(display);
    $("funds-preview-remaining").textContent = money(availableCents(from.value) - display);
    $("funds-preview-destination").textContent = money(availableCents(otherWallet(from.value)) + display);
    $("funds-transfer-continue").disabled = !valid;
    $("funds-amount-error").hidden = !forceError;
    if (forceError) $("funds-amount-error").textContent = "Enter a positive amount up to your available balance, with at most two decimal places.";
  }
  async function confirmTransfer() {
    if (processing) return;
    const cents = transferCents();
    if (cents === null || cents < 1 || cents > availableCents(from.value)) return renderPreview(true);
    transferKey ||= crypto.randomUUID();
    sessionStorage.setItem(pendingStorageKey, JSON.stringify({ key: transferKey, source: from.value, amount: centsToInput(cents) }));
    processing = true;
    $("funds-transfer-confirm").disabled = true;
    $("funds-transfer-confirm").textContent = "Processing…";
    $("funds-review-back").disabled = true;
    $("funds-transfer-close").disabled = true;
    try {
      const result = await Promise.race([
        client.rpc("transfer_wallet_funds", { p_from_account: from.value, p_amount: centsToInput(cents), p_idempotency_key: transferKey }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("verification_timeout")), 20000))
      ]);
      if (result.error) throw result.error;
      $("funds-success-summary").textContent = `${money(cents)} moved to ${names[otherWallet(from.value)]}.`;
      $("funds-success-reference").textContent = result.data.id;
      sessionStorage.removeItem(pendingStorageKey);
      uncertain = false;
      $("funds-transfer-review").hidden = true;
      $("funds-transfer-success").hidden = false;
      await refresh();
    } catch (error) {
      const timedOut = error.message === "verification_timeout" || !error.code && /network|fetch|timeout/i.test(error.message || "");
      if (timedOut) {
        const { data } = await client.rpc("get_my_member_funds_dashboard");
        if (data && (data.fundActivity || []).some(item => item.sourceId === transferKey && item.sourceType === "wallet_transfer")) {
          dashboard = data;
          $("funds-success-summary").textContent = `${money(cents)} moved to ${names[otherWallet(from.value)]}.`;
          $("funds-success-reference").textContent = transferKey;
          sessionStorage.removeItem(pendingStorageKey);
          uncertain = false;
          $("funds-transfer-review").hidden = true;
          $("funds-transfer-success").hidden = false;
          await refresh();
        } else {
          uncertain = true;
          $("funds-transfer-error").textContent = `We could not verify this transfer. You can retry using the same reference ${transferKey}; it will not create another transfer. If the issue continues, contact support with this reference.`;
          $("funds-transfer-error").hidden = false;
          $("funds-transfer-close").disabled = false;
        }
      } else {
        sessionStorage.removeItem(pendingStorageKey);
        transferKey = null;
        uncertain = false;
        $("funds-transfer-error").textContent = /Could not find the function|PGRST202/.test(error.message || "")
          ? "Wallet transfers need a backend update before they can be used. No funds were moved."
          : "Transfer could not be completed. Check the amount and try again.";
        $("funds-transfer-error").hidden = false;
      }
    } finally {
      processing = false;
      $("funds-transfer-confirm").disabled = false;
      $("funds-transfer-confirm").textContent = "Confirm Transfer";
      $("funds-review-back").disabled = uncertain;
      $("funds-transfer-close").disabled = false;
    }
  }
  function actionStep(kind, step) {
    const ids = { deposit: ["funds-topup-form", "funds-deposit-review", "funds-deposit-success"],
      withdraw: ["funds-withdraw-form", "funds-withdraw-review", "funds-withdraw-success"],
      earnings: ["funds-earnings-form", "funds-earnings-review", "funds-earnings-success"] };
    ids[kind].forEach((id, index) => { $(id).hidden = index !== { entry: 0, review: 1, success: 2 }[step]; });
    if (step === "entry") $(ids[kind][0]).querySelector("input:not([type=checkbox]), select")?.focus();
    else if (step === "review") $(ids[kind][1]).querySelector("button")?.focus();
    else $(ids[kind][2]).querySelector("button")?.focus();
  }
  function openAction(kind) {
    if (!dashboard || actionState[kind].processing) return;
    actionState[kind].uncertain = false;
    actionState[kind].key = null;
    if (kind === "deposit") {
      $("funds-topup-form").reset();
      renderPaymentMethod();
      $("funds-deposit-error").hidden = true;
    } else if (kind === "withdraw") {
      $("funds-withdraw-form").reset();
      const metadata = session.session.user.user_metadata || {};
      $("funds-withdraw-name").value = metadata.full_name || metadata.fullName || "";
      const digits = String(metadata.phone || "").replace(/\D/g, "");
      $("funds-withdraw-number").value = /^09\d{9}$/.test(digits) ? digits : /^639\d{9}$/.test(digits) ? `0${digits.slice(2)}` : "";
      $("funds-withdraw-available").textContent = money(availableCents("main"));
      $("funds-withdraw-error").hidden = true;
      renderWithdrawalPreview();
    } else {
      $("funds-earnings-amount").value = "";
      $("funds-earnings-error").hidden = true;
      updateEarnings();
    }
    actionStep(kind, "entry");
    actionDialogs[kind].showModal();
  }
  function closeAction(dialogId) {
    const kind = Object.keys(actionDialogs).find(key => actionDialogs[key].id === dialogId);
    if (!kind || actionState[kind].processing || actionState[kind].uncertain) return;
    actionDialogs[kind].close();
    actionTriggers[kind].focus();
  }
  function reviewDeposit(event) {
    event.preventDefault();
    const cents = parseCents($("funds-topup-amount").value);
    const reference = $("funds-topup-reference").value.trim().toUpperCase();
    const selectedMethod = methods.find(item => item.id === methodSelect.value);
    if (cents === null || cents < 100 || cents > 100000000 || !selectedMethod || !/^[A-Z0-9-]{6,80}$/.test(reference)) {
      $("funds-deposit-error").textContent = "Enter PHP 1 to PHP 1,000,000, choose a payment method, and provide a valid reference.";
      $("funds-deposit-error").hidden = false;
      return;
    }
    $("funds-deposit-review-amount").textContent = money(cents);
    $("funds-deposit-review-method").textContent = selectedMethod.methodName;
    $("funds-deposit-review-reference").textContent = reference;
    $("funds-deposit-review-error").hidden = true;
    actionStep("deposit", "review");
  }
  async function submitDeposit() {
    const state = actionState.deposit;
    if (state.processing) return;
    state.processing = true;
    setActionBusy("deposit", true);
    const reference = $("funds-topup-reference").value.trim().toUpperCase();
    try {
      const { data, error } = await client.rpc("request_member_fund_topup", {
        p_amount: centsToInput(parseCents($("funds-topup-amount").value)),
        p_payment_method_id: methodSelect.value,
        p_reference_number: reference
      });
      if (error) throw error;
      $("funds-deposit-success-reference").textContent = data.reference_number || reference;
      actionStep("deposit", "success");
      await refresh();
    } catch (error) {
      const { data } = await client.rpc("get_my_member_funds_dashboard");
      const existing = (data && data.topups || []).find(item => item.referenceNumber === reference);
      if (existing) {
        dashboard = data;
        $("funds-deposit-success-reference").textContent = reference;
        actionStep("deposit", "success");
        await refresh();
      } else {
        $("funds-deposit-review-error").textContent = "Deposit request could not be verified. Check the reference before trying again.";
        $("funds-deposit-review-error").hidden = false;
      }
    } finally { state.processing = false; setActionBusy("deposit", false); }
  }
  function renderWithdrawalPreview() {
    const cents = parseCents($("funds-withdraw-amount").value);
    const valid = cents !== null && cents >= 50000 && cents <= availableCents("main");
    $("funds-withdraw-preview-amount").textContent = money(valid ? cents : 0);
    $("funds-withdraw-preview-net").textContent = money(valid ? cents : 0);
    $("funds-withdraw-preview-remaining").textContent = money(availableCents("main") - (valid ? cents : 0));
    $("funds-withdraw-continue").disabled = availableCents("main") < 50000;
  }
  function reviewWithdrawal(event) {
    event.preventDefault();
    const cents = parseCents($("funds-withdraw-amount").value);
    const name = $("funds-withdraw-name").value.trim();
    const number = $("funds-withdraw-number").value.trim();
    if (cents === null || cents < 50000 || cents > availableCents("main")
      || !/^[\p{L} .'-]+$/u.test(name) || name.length > 30 || !/^09\d{9}$/.test(number)
      || !$("funds-withdraw-ack").checked) {
      $("funds-withdraw-error").textContent = "Enter at least PHP 500 within your available balance, a valid GCash recipient, and confirm the details.";
      $("funds-withdraw-error").hidden = false;
      return;
    }
    $("funds-withdraw-review-amount").textContent = money(cents);
    $("funds-withdraw-review-net").textContent = money(cents);
    $("funds-withdraw-review-recipient").textContent = `${name} · ${number}`;
    $("funds-withdraw-review-remaining").textContent = money(availableCents("main") - cents);
    $("funds-withdraw-review-error").hidden = true;
    actionStep("withdraw", "review");
  }
  function renderEarningsPreview() {
    const source = $("funds-earnings-source").value;
    const cents = parseCents($("funds-earnings-amount").value);
    const minimum = source === "power3-passive" ? 100000 : 1;
    const valid = !!source && cents !== null && cents >= minimum && cents <= earningsAvailable();
    $("funds-earnings-preview-source").textContent = planLabels[source] || "Choose a plan";
    $("funds-earnings-preview-amount").textContent = money(valid ? cents : 0);
    $("funds-earnings-preview-remaining").textContent = money(earningsAvailable() - (valid ? cents : 0));
    $("funds-earnings-preview-main").textContent = money(availableCents("main") + (valid ? cents : 0));
    $("funds-earnings-continue").disabled = !valid;
    const error = $("funds-earnings-error");
    error.textContent = cents !== null && cents > earningsAvailable() ? "Amount exceeds this plan's available earnings."
      : cents !== null && cents < minimum ? `Minimum transfer is ${money(minimum)}.` : "";
    error.hidden = !error.textContent;
  }
  function reviewEarnings(event) {
    event.preventDefault();
    const source = $("funds-earnings-source").value;
    const cents = parseCents($("funds-earnings-amount").value);
    const minimum = source === "power3-passive" ? 100000 : 1;
    if (!source || cents === null || cents < minimum || cents > earningsAvailable()) {
      $("funds-earnings-error").textContent = source === "power3-passive"
        ? "Premium earnings require at least PHP 1,000 per transfer, within the available balance."
        : "Enter an amount within the available Matrix earnings balance.";
      $("funds-earnings-error").hidden = false;
      return;
    }
    $("funds-earnings-review-source").textContent = planLabels[source];
    $("funds-earnings-review-amount").textContent = money(cents);
    $("funds-earnings-review-remaining").textContent = money(earningsAvailable() - cents);
    $("funds-earnings-review-main").textContent = money(availableCents("main") + cents);
    $("funds-earnings-review-error").hidden = true;
    actionStep("earnings", "review");
  }
  function setActionBusy(kind, busy) {
    actionDialogs[kind].querySelectorAll("button").forEach(button => { button.disabled = busy; });
    if (!busy && actionState[kind].uncertain) {
      actionDialogs[kind].querySelectorAll("[data-close-dialog]").forEach(button => { button.disabled = true; });
      $(kind === "withdraw" ? "funds-withdraw-back" : "funds-earnings-back").disabled = true;
    }
    const confirmId = { deposit: "funds-deposit-confirm", withdraw: "funds-withdraw-confirm", earnings: "funds-earnings-confirm" }[kind];
    $(confirmId).textContent = busy ? "Processing…" : kind === "earnings" ? "Confirm Transfer" : "Submit Request";
  }
  async function submitKeyedAction(kind, rpc, args, onSuccess) {
    const state = actionState[kind];
    if (state.processing) return;
    state.key ||= crypto.randomUUID();
    sessionStorage.setItem(actionStorageKey(kind), JSON.stringify({ key: state.key, args }));
    state.processing = true;
    setActionBusy(kind, true);
    const errorBox = $(kind === "withdraw" ? "funds-withdraw-review-error" : "funds-earnings-review-error");
    errorBox.hidden = true;
    try {
      const result = await Promise.race([
        client.rpc(rpc, { ...args, p_idempotency_key: state.key }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("verification_timeout")), 20000))
      ]);
      if (result.error) throw result.error;
      state.uncertain = false;
      sessionStorage.removeItem(actionStorageKey(kind));
      await onSuccess(result.data);
      state.key = null;
    } catch (error) {
      const timeout = error.message === "verification_timeout" || (!error.code && /network|fetch|timeout/i.test(error.message || ""));
      if (timeout) {
        const { data } = await client.rpc("get_my_funds_action_status", { p_kind: kind === "withdraw" ? "withdrawal" : "matrix", p_idempotency_key: state.key });
        if (data && data.id) {
          state.uncertain = false;
          sessionStorage.removeItem(actionStorageKey(kind));
          await onSuccess(data);
          state.key = null;
        } else {
          state.uncertain = true;
          errorBox.textContent = `Status is unverified. Retry with the same reference ${state.key}; this cannot create a second request.`;
          errorBox.hidden = false;
        }
      } else {
        state.key = null;
        state.uncertain = false;
        sessionStorage.removeItem(actionStorageKey(kind));
        errorBox.textContent = /PGRST202|Could not find the function/.test(error.message || "")
          ? "This action is temporarily unavailable. No funds were moved."
          : error.message || "Request could not be completed. Please review the details and try again.";
        errorBox.hidden = false;
      }
    } finally { state.processing = false; setActionBusy(kind, false); }
  }
  function submitWithdrawal() {
    const cents = parseCents($("funds-withdraw-amount").value);
    if (cents === null || cents < 50000 || (!actionState.withdraw.uncertain && cents > availableCents("main"))) return actionStep("withdraw", "entry");
    return submitKeyedAction("withdraw", "request_main_withdrawal", {
      p_amount: centsToInput(cents), p_account_name: $("funds-withdraw-name").value.trim(),
      p_gcash_number: $("funds-withdraw-number").value.trim(), p_notes: $("funds-withdraw-notes").value.trim()
    }, async data => {
      $("funds-withdraw-success-reference").textContent = data.withdrawal_code || data.code || data.id;
      actionStep("withdraw", "success");
      await refresh();
    });
  }
  function submitEarnings() {
    const source = $("funds-earnings-source").value;
    const cents = parseCents($("funds-earnings-amount").value);
    if (cents === null || cents < (source === "power3-passive" ? 100000 : 1) || (!actionState.earnings.uncertain && cents > earningsAvailable())) return actionStep("earnings", "entry");
    return submitKeyedAction("earnings", "transfer_matrix_income_to_main_keyed", {
      p_plan_id: source, p_amount: centsToInput(cents)
    }, async data => {
      $("funds-earnings-success-summary").textContent = `${money(cents)} moved from ${planLabels[source]} to Main Funds.`;
      $("funds-earnings-success-reference").textContent = data.id;
      actionStep("earnings", "success");
      await refresh();
    });
  }
  function renderPaymentMethod() {
    const method = methods.find(item => item.id === methodSelect.value);
    const target = $("funds-payment-details");
    target.hidden = !method;
    target.innerHTML = method ? `<strong>${escapeHtml(method.methodName)}</strong><span>${escapeHtml(method.accountName)} | ${escapeHtml(method.accountNumber)}</span>${method.instructions ? `<p>${escapeHtml(method.instructions)}</p>` : ""}${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} payment QR code">` : ""}` : "";
  }
  function buildTransactions(data) {
    const ledger = (data.fundActivity || []).filter(item => new Date(item.availableAt) <= new Date()).map(item => ({
      title: item.sourceType === "matrix_income_transfer"
        ? `${planLabels[String(item.note || "").split(" ")[0]] || "Matrix earnings"} → Main Funds`
        : item.note || item.sourceType, account: item.account, amount: toCents(item.amount),
      category: item.sourceType === "verified_topup" ? "deposits" : item.sourceType === "main_withdrawal" ? "withdrawals"
        : item.sourceType === "budget_investment_income" ? "investments" : item.sourceType === "matrix_income_transfer" ? "matrix" : "transfers",
      status: "Completed", reference: item.sourceId || item.id || "", date: item.createdAt || item.availableAt,
      id: item.id || "", sourceType: item.sourceType
    }));
    const pendingTopups = (data.topups || []).filter(item => item.status !== "approved").map(item => ({
      title: `Deposit request · ${item.methodName || "payment"}`, account: "main", amount: toCents(item.amount),
      category: "deposits", status: item.status === "rejected" ? "Failed" : "Pending", reference: item.id,
      date: item.createdAt, id: item.id
    }));
    const pendingWithdrawals = (data.withdrawals || []).filter(item => item.status !== "approved").map(item => ({
      title: "Withdrawal request", account: "main", amount: -toCents(item.amount), category: "withdrawals",
      status: item.status === "rejected" ? "Cancelled" : "Pending", reference: item.code || item.id,
      date: item.createdAt, id: item.id
    }));
    const investmentRequests = (data.investmentRequests || []).map(item => ({
      title: `Budget Plan ${item.rankName || "investment"} request`, account: "investment",
      amount: -toCents(item.amount), category: "investments",
      status: item.status === "approved" ? "Completed" : item.status === "rejected" ? "Cancelled" : "Pending",
      reference: item.id, date: item.createdAt, id: item.id
    }));
    return [...ledger, ...pendingTopups, ...pendingWithdrawals, ...investmentRequests].sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  function renderHistory() {
    const query = $("funds-history-search").value.trim().toLowerCase();
    const list = transactions.filter(item => (view === "transactions" || item.account === wallet)
      && (filter === "all" || item.category === filter || filter === "transfers" && item.category === "matrix")
      && (!query || `${item.title} ${item.reference} ${item.category}`.toLowerCase().includes(query)));
    $("funds-activity").innerHTML = list.length ? list.slice(0, visibleCount).map(item => {
      const index = transactions.indexOf(item);
      return `<button class="funds-row funds-transaction" type="button" data-transaction="${index}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(names[item.account])} · ${dateTime(item.date)} · ${escapeHtml(item.status)}</small></span><span class="${item.amount < 0 ? "funds-debit" : "funds-credit"}">${item.amount > 0 ? "+" : ""}${money(item.amount)}</span></button>`;
    }).join("") : '<p class="funds-empty">No transactions match this view.</p>';
    $("funds-more").hidden = list.length <= visibleCount;
  }
  function showTransaction(index) {
    const item = transactions[index];
    if (!item) return;
    $("funds-detail-content").innerHTML = [["Type", item.title], ["Wallet", names[item.account]], ["Amount", money(item.amount)], ["Status", item.status], ["Date", dateTime(item.date)], ["Reference", item.reference || "Not available"]].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    $("funds-detail-dialog").showModal();
    $("funds-detail-close").focus();
  }
  function availableCents(account) { return toCents(account === "main" ? dashboard && dashboard.mainAvailable : dashboard && dashboard.investmentAvailable); }
  function otherWallet(account) { return account === "main" ? "investment" : "main"; }
  function transferCents() { return parseCents(amount.value); }
  function date(value) { return value ? new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function dateTime(value) { return value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
  function show(message, type) { const box = $("funds-alert"); box.className = `alert alert-${type}`; box.textContent = message; box.hidden = false; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
});
