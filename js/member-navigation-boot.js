(function () {
  const page = window.location.pathname.split("/").pop() || "portal.html";
  if (page === "portal.html" || page === "portal") return;
  let prepareLayout = page !== "portal.html" && page !== "shop.html";
  if (!prepareLayout) {
    try {
      prepareLayout = Boolean(sessionStorage.getItem("matrix_logged_in_member_id") || sessionStorage.getItem("matrix_auth_token"));
      for (let index = 0; !prepareLayout && index < localStorage.length; index += 1) {
        prepareLayout = /^sb-.*-auth-token$/.test(localStorage.key(index) || "");
      }
    } catch (error) {
      prepareLayout = false;
    }
  }
  if (!prepareLayout) return;
  document.documentElement.classList.add("member-workspace", "member-nav-pending");
  const links = [
    ["Workspace", ["Overview", "portal.html"], ["Activity", "passive-income-history.html"]],
    ["Matrix plans", ["Budget Plan", "budget-plan.html"], ["Standard Plan", "timeline-matrix.html"], ["Premium Plan", "portal.html?view=premium"], ["Patronizing Income", "patronizing-income.html"]],
    ["Commerce", ["Shop", "shop.html"], ["Orders", "orders.html"], ["Entry Orders", "packages-orders.html"], ["Product Plus", "packages-orders.html?type=product_plus_requirement"]],
    ["Funds", ["Main Funds", "main-funds.html"], ["Investment Funds", "main-funds.html?view=investment"], ["Transactions", "main-funds.html?view=transactions"]]
  ];
  const shell = document.createElement("aside");
  shell.className = "member-sidebar";
  shell.dataset.shell = "true";
  shell.setAttribute("aria-label", "Member navigation loading");
  shell.innerHTML = `<a class="member-sidebar-brand" href="portal.html"><span class="member-sidebar-brand-mark">M</span><span><strong>MATRIX</strong><small>MEMBER PORTAL</small></span></a><nav aria-label="Member pages">${links.map(([group, ...items]) => `<span class="member-sidebar-group">${group}</span>${items.map(([label, href]) => `<a class="member-sidebar-link" href="${href}"><span class="member-sidebar-icon" aria-hidden="true"></span><span>${label}</span></a>`).join("")}`).join("")}</nav><div class="member-sidebar-footer"><span class="member-sidebar-account"><span class="member-sidebar-avatar">M</span><span><strong class="member-sidebar-name">Member</strong><small class="member-sidebar-id">Loading account</small></span></span></div>`;
  const mountShell = () => {
    if (!document.body) return;
    observer.disconnect();
    document.body.prepend(shell);
  };
  const observer = new MutationObserver(mountShell);
  observer.observe(document.documentElement, { childList: true });
  mountShell();
  window.setTimeout(() => {
    if (!document.documentElement.classList.contains("member-nav-pending")) return;
    shell.remove();
    document.documentElement.classList.remove("member-workspace", "member-nav-pending");
  }, 3000);
})();
