document.addEventListener("DOMContentLoaded", async () => {
  const alertBox = document.getElementById("upgrade-alert");
  const layout = document.getElementById("upgrade-layout");
  const form = document.getElementById("upgrade-form");
  const submit = document.getElementById("upgrade-submit");
  const statusBadge = document.getElementById("upgrade-status");
  try {
    const { data: sessionData } = await window.matrixSupabase.auth.getSession();
    if (!sessionData.session) return redirect("Sign in before requesting Entry activation.");
    const { data: dashboard, error: dashboardError } = await window.matrixSupabase.rpc("get_my_dashboard");
    if (dashboardError) throw dashboardError;
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
      document.getElementById("upgrade-reference").value = pending.referenceNumber;
      show("Your Entry request is waiting for administrator review.", "info");
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!document.getElementById("upgrade-confirm").checked) return show("Confirm the payment details before submitting.", "danger");
      submit.disabled = true;
      const reference = document.getElementById("upgrade-reference").value.trim();
      const { error } = await window.matrixSupabase.rpc("request_entry_activation", { p_reference_number: reference });
      if (error) { submit.disabled = false; return show(error.message, "danger"); }
      statusBadge.textContent = "Pending Approval";
      show("Your Entry activation request was submitted securely.", "success");
    });
  } catch (error) { show(error.message, "danger"); }
  function show(message, type) { alertBox.className = `alert alert-${type}`; alertBox.textContent = message; alertBox.style.display = "block"; }
  function redirect(message) { show(message, "danger"); window.setTimeout(() => { window.location.href = "portal.html"; }, 1200); }
});
