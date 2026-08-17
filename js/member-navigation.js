document.addEventListener("DOMContentLoaded", async () => {
  const menuRoot = document.querySelector("[data-member-menu]");
  if (!menuRoot) return;

  const toggle = menuRoot.querySelector("[data-member-menu-toggle]");
  const menu = menuRoot.querySelector("[data-member-menu-list]");
  const name = menuRoot.querySelector("[data-member-menu-name]");
  const avatar = menuRoot.querySelector("[data-member-menu-avatar]");
  const currentPage = menuRoot.dataset.currentPage || pageIdFromLocation();
  const pages = [
    { id: "profile", label: "Profile", href: "portal.html#profile" },
    { id: "dashboard", label: "Dashboard", href: "portal.html" },
    { id: "packages-orders", label: "Packages & Orders", href: "packages-orders.html" },
    { id: "timeline-matrix", label: "Timeline Matrix", href: "timeline-matrix.html" },
    { id: "withdrawal-request", label: "Balance Withdrawal", href: "withdrawal-request.html" },
    { id: "withdrawal-history", label: "Withdrawal History", href: "withdrawal-history.html" },
    { id: "passive-income-history", label: "Passive Income History", href: "passive-income-history.html" },
    { id: "upgrade-entry-production", label: "Entry Activation", href: "upgrade-entry-production.html" }
  ];

  const member = await loadCurrentMember();
  const isAdmin = member ? await loadAdminStatus(member) : false;
  if (member) {
    const displayName = member.fullName || member.username || "Member";
    name.textContent = displayName;
    avatar.textContent = displayName.charAt(0).toUpperCase();
  }

  const availablePages = isAdmin ? [...pages, { id: "admin", label: "Admin Portal", href: "admin.html" }] : pages;
  menu.innerHTML = availablePages
    .filter(page => page.id !== currentPage)
    .map(page => `<a href="${page.href}">${page.label}</a>`)
    .join("") + `<button type="button" class="account-menu-signout" data-member-signout>Sign Out</button>`;

  menuRoot.style.display = "flex";

  toggle.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  menu.querySelector("[data-member-signout]").addEventListener("click", async () => {
    sessionStorage.removeItem("matrix_logged_in_member_id");
    if (window.matrixSupabase) await window.matrixSupabase.auth.signOut();
    window.location.href = "portal.html";
  });

  document.addEventListener("click", event => {
    if (!menuRoot.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  async function loadCurrentMember() {
    try {
      if (window.MatrixDB) {
        if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
        if (typeof MatrixDB.getAuthenticatedMember === "function") {
          const authenticated = await MatrixDB.getAuthenticatedMember();
          if (authenticated) return authenticated;
        }
        const memberId = sessionStorage.getItem("matrix_logged_in_member_id");
        return memberId && typeof MatrixDB.getMemberById === "function" ? MatrixDB.getMemberById(memberId) : null;
      }
      if (window.matrixSupabase) {
        const { data: sessionData } = await window.matrixSupabase.auth.getSession();
        if (!sessionData.session) return null;
        const { data } = await window.matrixSupabase.rpc("get_my_dashboard");
        return data && data.member ? { ...data.member, isAdmin: Boolean(data.isAdmin) } : null;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async function loadAdminStatus(memberData) {
    if (memberData.isAdmin) return true;
    try {
      if (window.MatrixDB && typeof MatrixDB.getMemberMatrixSummary === "function") {
        const summary = MatrixDB.getMemberMatrixSummary(memberData.id);
        return Boolean(summary && summary.isAdmin);
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  function pageIdFromLocation() {
    const fileName = window.location.pathname.split("/").pop() || "portal.html";
    return fileName.replace(/\.html$/i, "") || "dashboard";
  }
});
