document.addEventListener("DOMContentLoaded", async () => {
  const SESSION_KEY = "matrix_logged_in_member_id";
  const alertBox = document.getElementById("exit-action-alert");
  const requestedExit = Number(new URLSearchParams(window.location.search).get("exit"));
  let paymentMethod = "gcash";
  const gcashInput = document.getElementById("buy-gcash-number");
  gcashInput.addEventListener("input", () => { gcashInput.value = gcashInput.value.replace(/\D/g, "").slice(0, 11); });
  const gcashNameInput = document.getElementById("buy-gcash-name");
  const walletInput = document.getElementById("restake-wallet");
  const referenceInput = document.getElementById("buy-reference");
  gcashNameInput.addEventListener("input", () => { gcashNameInput.value = gcashNameInput.value.replace(/[^\p{L} .'-]/gu, "").slice(0, 30); });
  walletInput.addEventListener("input", () => { walletInput.value = walletInput.value.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 52); });
  referenceInput.addEventListener("input", () => { referenceInput.value = referenceInput.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40); });

  try {
    if (!window.MatrixDB || !Number.isInteger(requestedExit)) throw new Error("Open this page using the next Exit button on your dashboard.");
    if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
    const memberId = window.MATRIX_USES_SUPABASE ? ((await MatrixDB.getAuthenticatedMember()) || {}).id : sessionStorage.getItem(SESSION_KEY);
    const member = memberId ? MatrixDB.getMemberById(memberId) : null;
    if (!member) throw new Error("Your member session is no longer available. Please sign in again.");
    const summary = MatrixDB.getMemberMatrixSummary(member.id);
    const exits = summary && Array.isArray(summary.exits) ? summary.exits : [];
    const nextExit = exits.find(item => item.status !== "active");
    const exit = exits.find(item => Number(item.exit) === requestedExit);
    if (!exit || !nextExit || exit.exit !== nextExit.exit || exit.status !== "qualified") throw new Error("This Exit is not currently available for request.");
    initialize(member, summary, exit);
  } catch (error) {
    showAlert(error.message, "danger");
  }

  function initialize(member, summary, exit) {
    const isRestake = exit.actionType === "reinvest" || /^Re-Stake/i.test(exit.actionLabel);
    const verb = isRestake ? "Re-Stake" : "Buy";
    const available = Math.max(Number(summary.earnedBalance || 0) - Number(summary.pendingWithdrawal || 0) - Number(summary.pendingExitBalance || 0), 0);
    const sufficient = available >= Number(exit.actionAmount);
    document.getElementById("exit-action-layout").style.display = "grid";
    document.getElementById("exit-action-title").textContent = `Exit ${exit.exit} ${verb}`;
    document.getElementById("exit-action-description").textContent = `Submit your ${verb} request for administrator review.`;
    document.getElementById("exit-action-amount").textContent = Number(exit.exit) === 1 && isRestake ? `${exit.actionLabel}: ${money(exit.actionAmount)}` : money(exit.actionAmount);
    document.getElementById("exit-action-number").textContent = `Exit ${exit.exit}`;
    document.getElementById("exit-action-verb").textContent = verb;
    document.getElementById("exit-action-requirement").textContent = exit.requirementRank.split(" / ")[0];
    document.getElementById("exit-action-submit").textContent = `Request ${verb}`;
    document.getElementById("restake-fields").hidden = !isRestake;
    document.getElementById("buy-tabs").hidden = isRestake;
    document.getElementById("gcash-fields").hidden = isRestake;
    document.getElementById("restake-wallet").value = isRestake ? (member.walletAddress || "") : "";
    document.getElementById("buy-gcash-name").value = member.fullName || "";
    document.getElementById("buy-gcash-number").value = validGcashNumber(member.phone);
    document.getElementById("exit-available-balance").textContent = money(available);
    document.getElementById("balance-sufficiency").textContent = sufficient ? "Sufficient" : "Insufficient";
    document.getElementById("balance-sufficiency").className = `badge ${sufficient ? "badge-active" : "badge-pending"}`;
    document.getElementById("balance-message").textContent = sufficient ? `Your balance can cover the ${money(exit.actionAmount)} Buy.` : "Not enough balance";

    document.querySelectorAll("[data-payment-tab]").forEach(button => button.addEventListener("click", () => {
      paymentMethod = button.dataset.paymentTab;
      document.querySelectorAll("[data-payment-tab]").forEach(tab => { tab.classList.toggle("active", tab === button); tab.setAttribute("aria-selected", tab === button ? "true" : "false"); });
      document.getElementById("gcash-fields").hidden = paymentMethod !== "gcash";
      document.getElementById("balance-fields").hidden = paymentMethod !== "balance";
      document.getElementById("exit-action-submit").disabled = paymentMethod === "balance" && !sufficient;
      if (paymentMethod === "balance" && !sufficient) showAlert("Not enough balance", "danger"); else hideAlert();
    }));

    document.getElementById("copy-gcash-number").addEventListener("click", async event => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.copyValue);
      event.currentTarget.textContent = "Copied";
      window.setTimeout(() => { event.currentTarget.textContent = "09912054007 · Copy"; }, 1200);
    });
    document.getElementById("copy-restake-wallet").addEventListener("click", async event => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.copyValue);
      event.currentTarget.textContent = "Copied";
      window.setTimeout(() => { event.currentTarget.textContent = "Copy Wallet"; }, 1200);
    });

    document.getElementById("exit-action-form").addEventListener("submit", async event => {
      event.preventDefault(); hideAlert();
      const details = isRestake
        ? { paymentMethod: "f3_wallet", f3Wallet: document.getElementById("restake-wallet").value.trim() }
        : paymentMethod === "balance"
          ? { paymentMethod: "available_balance" }
          : { paymentMethod: "gcash", gcashName: document.getElementById("buy-gcash-name").value.trim(), gcashNumber: document.getElementById("buy-gcash-number").value.trim(), referenceNumber: document.getElementById("buy-reference").value.trim() };
      if (isRestake && !/^[A-Za-z0-9:_-]{1,52}$/.test(details.f3Wallet)) return showAlert("F3 wallet may only use up to 52 letters, numbers, colons, underscores, or hyphens.", "danger");
      if (!isRestake && paymentMethod === "gcash" && (!/^[\p{L} .'-]+$/u.test(details.gcashName) || details.gcashName.length > 30)) return showAlert("GCash name must use letters and normal name punctuation only.", "danger");
      if (!isRestake && paymentMethod === "gcash" && !/^09\d{9}$/.test(details.gcashNumber)) return showAlert("Enter an 11-digit GCash number starting with 09.", "danger");
      if (!isRestake && paymentMethod === "gcash" && !/^[A-Za-z0-9-]{6,40}$/.test(details.referenceNumber)) return showAlert("Enter a valid 6–40 character GCash reference.", "danger");
      if (!isRestake && paymentMethod === "balance" && !sufficient) return showAlert("Not enough balance", "danger");
      const submit = document.getElementById("exit-action-submit");
      try {
        submit.disabled = true;
        await MatrixDB.requestExitAction(member.id, exit.exit, details);
        showAlert(`${verb} request submitted for administrator review.`, "success");
        window.setTimeout(() => { window.location.href = "portal.html"; }, 1000);
      } catch (error) { submit.disabled = false; showAlert(error.message, "danger"); }
    });
  }

  function money(value) { return `PHP ${Number(value || 0).toLocaleString()}`; }
  function validGcashNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (/^09\d{9}$/.test(digits)) return digits;
    if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
    return "";
  }
  function hideAlert() { alertBox.style.display = "none"; }
  function showAlert(message, type) { alertBox.className = `alert alert-${type}`; alertBox.textContent = message; alertBox.style.display = "block"; }
});
