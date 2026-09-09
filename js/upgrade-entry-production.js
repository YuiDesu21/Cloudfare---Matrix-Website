document.addEventListener("DOMContentLoaded", async () => {
  const alertBox = document.getElementById("upgrade-alert");
  const layout = document.getElementById("upgrade-layout");
  const form = document.getElementById("upgrade-form");
  const submit = document.getElementById("upgrade-submit");
  const statusBadge = document.getElementById("upgrade-status");
  const uplineCodeInput = document.getElementById("upgrade-upline-code");
  const referenceInput = document.getElementById("upgrade-reference");
  const productProgressBadge = document.getElementById("upgrade-product-progress-badge");
  const productProgressBar = document.getElementById("upgrade-product-progress-bar");
  const productApproved = document.getElementById("upgrade-product-approved");
  const productPending = document.getElementById("upgrade-product-pending");
  const productRemaining = document.getElementById("upgrade-product-remaining");
  try {
    const { data: sessionData } = await window.matrixSupabase.auth.getSession();
    if (!sessionData.session) return redirect("Sign in before requesting Entry activation.");
    const [dashboardResponse, progressResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_my_product_entry_progress", { p_entry_type: "matrix_1200_entry" })
    ]);
    const { data: dashboard, error: dashboardError } = dashboardResponse;
    if (dashboardError) throw dashboardError;
    if (progressResponse.error) throw progressResponse.error;
    renderProductProgress(progressResponse.data);
    if (dashboard.member.status === "active") {
      layout.style.display = "grid"; form.hidden = true; statusBadge.textContent = "Entry Active"; statusBadge.className = "badge badge-active"; return;
    }
    const { data: requests, error: requestError } = await window.matrixSupabase.rpc("get_my_entry_requests");
    if (requestError) throw requestError;
    const pending = requests.find(request => request.status === "pending");
    layout.style.display = "grid";
    if (pending) {
      statusBadge.textContent = "Pending Approval";
      submit.disabled = true;
      referenceInput.value = pending.referenceNumber;
      uplineCodeInput.value = pending.matrixUplineCode || "";
      show("Your Entry request is waiting for administrator review.", "info");
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!document.getElementById("upgrade-confirm").checked) return show("Confirm the payment details before submitting.", "danger");
      submit.disabled = true;
      const reference = referenceInput.value.trim();
      const matrixUplineCode = uplineCodeInput.value.trim().toUpperCase();
      const { error } = await window.matrixSupabase.rpc("request_entry_activation", { p_reference_number: reference, p_matrix_upline_code: matrixUplineCode });
      if (error) { submit.disabled = false; return show(error.message, "danger"); }
      statusBadge.textContent = "Pending Approval";
      show("Your Entry activation request was submitted securely.", "success");
    });
  } catch (error) { show(error.message, "danger"); }
  function renderProductProgress(progress = {}) {
    const approved = Number(progress.approvedAmount || 0);
    const pending = Number(progress.pendingAmount || 0);
    const target = Number(progress.targetAmount || 1200);
    const remaining = Math.max(Number(progress.remainingAmount || 0), 0);
    const percent = target > 0 ? Math.min(approved / target * 100, 100) : 0;
    productProgressBadge.textContent = `${Math.round(percent)}% Complete`;
    productProgressBar.style.width = `${percent}%`;
    productApproved.textContent = money(approved);
    productPending.textContent = money(pending);
    productRemaining.textContent = money(remaining);
  }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
  function show(message, type) { alertBox.className = `alert alert-${type}`; alertBox.textContent = message; alertBox.style.display = "block"; }
  function redirect(message) { show(message, "danger"); window.setTimeout(() => { window.location.href = "portal.html"; }, 1200); }
});
