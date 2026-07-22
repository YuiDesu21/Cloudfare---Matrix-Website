document.addEventListener("DOMContentLoaded", async () => {
  const SESSION_KEY = "matrix_logged_in_member_id";
  const isRequestPage = Boolean(document.getElementById("withdrawal-request-form"));
  const pageAlert = document.getElementById(isRequestPage ? "withdrawal-page-alert" : "withdrawal-history-alert");

  if (!window.MatrixDB) {
    showAccessError("Please access your member dashboard before opening member finance.");
    return;
  }

  if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
  const memberId = window.MATRIX_USES_SUPABASE
    ? ((await MatrixDB.getAuthenticatedMember()) || {}).id
    : sessionStorage.getItem(SESSION_KEY);
  const member = memberId ? MatrixDB.getMemberById(memberId) : null;
  if (!member) {
    sessionStorage.removeItem(SESSION_KEY);
    showAccessError("Your member session is no longer available. Please sign in again.");
    return;
  }

  if (isRequestPage) await initializeRequestPage(member);
  else await initializeHistoryPage(member);

  function initializeRequestPage(memberData) {
    const summary = MatrixDB.getMemberMatrixSummary(memberData.id);
    const earned = Number(summary ? summary.earnedBalance : 0);
    const pending = Number(summary ? summary.pendingWithdrawal : 0);
    const pendingExitBalance = Number(summary ? summary.pendingExitBalance : 0);
    const available = Math.max(earned - pending - pendingExitBalance, 0);
    const form = document.getElementById("withdrawal-request-form");
    const amount = document.getElementById("withdrawal-amount");
    const accountName = document.getElementById("withdrawal-name");
    const gcashNumber = document.getElementById("withdrawal-gcash");
    const notes = document.getElementById("withdrawal-notes");
    const confirm = document.getElementById("withdrawal-confirm");
    const submit = document.getElementById("withdrawal-submit");
    gcashNumber.addEventListener("input", () => { gcashNumber.value = gcashNumber.value.replace(/\D/g, "").slice(0, 11); });
    accountName.addEventListener("input", () => { accountName.value = accountName.value.replace(/[^\p{L} .'-]/gu, "").slice(0, 30); });

    document.getElementById("withdrawal-form-layout").style.display = "grid";
    document.getElementById("withdrawal-available-display").textContent = formatMoney(available);
    document.getElementById("withdrawal-earned-display").textContent = formatMoney(earned);
    document.getElementById("withdrawal-pending-display").textContent = formatMoney(pending);
    document.getElementById("withdrawal-balance").value = formatMoney(available);
    amount.max = String(available);
    amount.placeholder = available > 0 ? `Up to ${available.toLocaleString()}` : "No balance available";
    amount.disabled = available <= 0;
    submit.disabled = available <= 0;
    accountName.value = memberData.fullName || "";
    gcashNumber.value = validGcashNumber(memberData.phone);
    if (available <= 0) {
      const nextReward = (summary && Array.isArray(summary.rewardLedger) ? summary.rewardLedger : [])
        .filter(entry => entry.status === "due" && new Date(entry.dueAt) > new Date())
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
      showAlert(nextReward
        ? `No balance is available yet. Your next ${nextReward.sourceLabel || "passive income"} of ${formatMoney(nextReward.amount)} becomes withdrawable on ${formatDateTime(nextReward.dueAt)}.`
        : "No balance is currently available for withdrawal. Passive income becomes withdrawable only after its due date.", "info");
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      hideAlert();
      const requestedAmount = Number(amount.value);
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > available) {
        showAlert(`Enter an amount between PHP 1 and ${formatMoney(available)}.`, "danger");
        return;
      }
      if (!/^[\p{L} .'-]+$/u.test(accountName.value.trim()) || accountName.value.trim().length > 30) {
        showAlert("GCash name must use letters and normal name punctuation only, up to 30 characters.", "danger");
        return;
      }
      if (!/^09\d{9}$/.test(gcashNumber.value.trim())) {
        showAlert("Enter an 11-digit GCash number starting with 09.", "danger");
        return;
      }
      if (!confirm.checked) {
        showAlert("Confirm the payout details before submitting.", "danger");
        return;
      }
      try {
        submit.disabled = true;
        const request = window.MATRIX_USES_SUPABASE
          ? (await window.matrixSupabase.rpc("request_withdrawal", {
              p_amount: requestedAmount,
              p_account_name: accountName.value.trim(),
              p_gcash_number: gcashNumber.value.trim(),
              p_notes: notes.value.trim()
            }))
          : { data: MatrixDB.requestWithdrawal(memberData.id, requestedAmount, notes.value.trim(), "GCash", accountName.value.trim(), gcashNumber.value.trim()) };
        if (request.error) throw request.error;
        const createdRequest = request.data;
        showAlert(`Withdrawal ${createdRequest.withdrawal_code || createdRequest.withdrawalCode} was submitted for administrator review.`, "success");
        form.reset();
        accountName.value = memberData.fullName || "";
        gcashNumber.value = validGcashNumber(memberData.phone);
        window.setTimeout(() => { window.location.href = "withdrawal-history.html"; }, 900);
      } catch (error) {
        submit.disabled = false;
        showAlert(error.message, "danger");
      }
    });
  }

  function validGcashNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (/^09\d{9}$/.test(digits)) return digits;
    if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
    return "";
  }

  async function initializeHistoryPage(memberData) {
    const response = window.MATRIX_USES_SUPABASE
      ? await window.matrixSupabase.rpc("get_my_withdrawals")
      : { data: MatrixDB.getMemberWithdrawalRequests(memberData.id) };
    if (response.error) throw response.error;
    const requests = response.data;
    const timeFilter = document.getElementById("history-time-filter");
    const statusFilter = document.getElementById("history-status-filter");
    document.getElementById("withdrawal-history-content").style.display = "block";
    document.getElementById("history-total-requested").textContent = formatMoney(sum(requests));
    document.getElementById("history-total-pending").textContent = formatMoney(sum(requests.filter(item => item.status === "pending")));
    document.getElementById("history-total-approved").textContent = formatMoney(sum(requests.filter(item => item.status === "approved")));
    timeFilter.addEventListener("change", renderHistory);
    statusFilter.addEventListener("change", renderHistory);
    renderHistory();

    function renderHistory() {
      const filtered = requests.filter(request => matchesTime(request, timeFilter.value) && (statusFilter.value === "all" || request.status === statusFilter.value));
      document.getElementById("history-result-count").textContent = `${filtered.length} ${filtered.length === 1 ? "request" : "requests"}`;
      const list = document.getElementById("withdrawal-history-list");
      if (!filtered.length) {
        list.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No matching withdrawals</strong><p>Try another filter or submit a new withdrawal request.</p></div>`;
        return;
      }
      list.innerHTML = filtered.map(request => {
        const origins = Array.isArray(request.origins) && request.origins.length
          ? request.origins.map(origin => `<span>${escapeHtml(origin.sourceLabel || "Passive Income")} · ${formatMoney(origin.amount)}</span>`).join("")
          : `<span>Passive Income Balance</span>`;
        const decisionDate = request.approvedAt || request.rejectedAt;
        return `
          <article class="portal-card withdrawal-history-item">
            <div class="withdrawal-history-topline">
              <div><span class="withdrawal-reference-label">${escapeHtml(request.withdrawalCode || request.referenceNumber || request.id.slice(0, 8).toUpperCase())}</span><h2>${formatMoney(request.amount)}</h2></div>
              <span class="withdrawal-status status-${escapeHtml(request.status)}">${escapeHtml(capitalize(request.status))}</span>
            </div>
            <div class="withdrawal-history-details">
              <div><span>Requested</span><strong>${formatDateTime(request.createdAt)}</strong></div>
              <div><span>Payout destination</span><strong>${escapeHtml(request.payoutMethod || "GCash")} · ${escapeHtml(request.gcashNumber || request.payoutDetails || "-")}</strong></div>
              <div><span>Account name</span><strong>${escapeHtml(request.accountName || "-")}</strong></div>
              <div><span>${decisionDate ? "Last updated" : "Review stage"}</span><strong>${decisionDate ? formatDateTime(decisionDate) : "Waiting for admin review"}</strong></div>
            </div>
            <div class="withdrawal-origin"><span>Balance origin</span><div>${origins}</div></div>
            ${request.payoutDetails ? `<p class="withdrawal-history-note"><strong>Note:</strong> ${escapeHtml(request.payoutDetails)}</p>` : ""}
          </article>`;
      }).join("");
    }
  }

  function matchesTime(request, filter) {
    if (filter === "all") return true;
    const created = new Date(request.createdAt);
    const now = new Date();
    if (filter === "year") return created.getFullYear() === now.getFullYear();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - Number(filter));
    return created >= cutoff;
  }

  function sum(items) { return items.reduce((total, item) => total + Number(item.amount || 0), 0); }
  function formatMoney(value) { return `PHP ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
  function formatDateTime(value) { return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-"; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function hideAlert() { pageAlert.style.display = "none"; }
  function showAlert(message, type) { pageAlert.className = `alert alert-${type}`; pageAlert.textContent = message; pageAlert.style.display = "block"; pageAlert.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function showAccessError(message) { showAlert(message, "danger"); window.setTimeout(() => { window.location.href = "portal.html"; }, 1400); }
});
