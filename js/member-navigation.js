(function () {
  let sidebarSetupPending = false;
  const pages = [
    { id: "profile", label: "Profile", href: "portal.html#profile" },
    { id: "budget-plan", label: "Budget Plan", href: "budget-plan.html" },
    { id: "timeline-matrix", label: "Standard Plan", href: "timeline-matrix.html" },
    { id: "upgrade-entry", label: "Premium Plan", href: "portal.html?view=premium" },
    { id: "patronizing-income", label: "Patronizing Income", href: "patronizing-income.html" },
    { id: "entry-orders", label: "Entry Orders", href: "packages-orders.html" },
    { id: "orders", label: "Orders", href: "orders.html" },
    { id: "product-plus", label: "Product Plus", href: "packages-orders.html?type=product_plus_requirement" },
    { id: "main-funds", label: "Main Funds", href: "main-funds.html" },
    { id: "withdrawal-history", label: "Withdrawal History", href: "withdrawal-history.html" },
    { id: "passive-income-history", label: "Passive Income History", href: "passive-income-history.html" }
  ];

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupMemberNavigation, { once: true });
  } else {
    setupMemberNavigation();
  }
  document.addEventListener("matrix:member-authenticated", event => setupMemberSidebar(event.detail.member));
  document.addEventListener("matrix:member-signed-out", () => {
    document.querySelectorAll(".member-sidebar, .member-sidebar-backdrop, .member-sidebar-toggle, .member-sidebar-crumb").forEach(element => element.remove());
    document.body.classList.remove("member-sidebar-active", "member-sidebar-open");
    document.documentElement.classList.remove("member-workspace", "member-nav-pending");
  });

  function isProductPlusCatalog() {
    const params = new URLSearchParams(window.location.search);
    return ["product_plus_requirement", "product_plus_voucher"].includes(params.get("type"))
      || ["budget_qualification", "patronizing_entry_product", "patronizing_monthly_requirement", "patronizing_exit_discount"].includes(params.get("purpose"));
  }

  function setupMemberNavigation() {
    const menuRoot = document.querySelector("[data-member-menu]");
    if (!menuRoot || menuRoot.dataset.memberMenuReady === "true") {
      setupMemberSidebar();
      return;
    }

    const toggle = menuRoot.querySelector("[data-member-menu-toggle]");
    const menu = menuRoot.querySelector("[data-member-menu-list]");
    const name = menuRoot.querySelector("[data-member-menu-name]");
    const avatar = menuRoot.querySelector("[data-member-menu-avatar]");
    if (!toggle || !menu) {
      setupMemberSidebar();
      return;
    }

    menuRoot.dataset.memberMenuReady = "true";
    const currentPage = pageIdFromLocation() === "packages-orders"
      ? (isProductPlusCatalog() ? "product-plus" : "entry-orders")
      : menuRoot.dataset.currentPage || pageIdFromLocation();
    renderMenu(menu, pages, currentPage);
    bindSignOut(menu);
    menuRoot.style.display = "flex";

    toggle.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(toggle, menu);
    });

    menu.addEventListener("click", event => {
      event.stopPropagation();
    });

    document.addEventListener("click", event => {
      if (!menuRoot.contains(event.target)) closeMenu(toggle, menu);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu(toggle, menu);
    });

    hydrateMemberMenu(menu, name, avatar, currentPage);
    setupMemberSidebar();
  }

  async function setupMemberSidebar(authenticatedMember = null) {
    if (document.querySelector(".member-sidebar:not([data-shell])") || sidebarSetupPending) return;
    if (pageIdFromLocation() === "portal" && !authenticatedMember) return;
    sidebarSetupPending = true;
    const hasSessionHint = Boolean(sessionStorage.getItem("matrix_logged_in_member_id") || sessionStorage.getItem("matrix_auth_token"));
    const memberPromise = authenticatedMember ? Promise.resolve(authenticatedMember) : loadMemberWithRetry();
    const member = authenticatedMember || (hasSessionHint ? { fullName: "Member" } : await memberPromise);
    if (!member) {
      sidebarSetupPending = false;
      document.querySelector(".member-sidebar[data-shell]")?.remove();
      document.documentElement.classList.remove("member-workspace", "member-nav-pending");
      return;
    }
    const current = pageIdFromLocation();
    const isPremium = current === "portal" && new URLSearchParams(window.location.search).get("view") === "premium";
    const fundsView = new URLSearchParams(window.location.search).get("view");
    const selected = isPremium || current === "upgrade-entry" || current === "upgrade-entry-production" || current === "exit-action" ? "premium" : current === "portal" ? "overview" : current === "timeline-matrix" ? "standard" : current === "budget-plan" ? "budget" : current === "patronizing-income" ? "patronizing" : current === "shop" ? "shop" : current === "orders" ? "orders" : current === "packages-orders" ? (isProductPlusCatalog() ? "product-plus" : "entry-orders") : current === "passive-income-history" ? "activity" : current === "withdrawal-history" ? "transactions" : current === "withdrawal-request" ? "funds" : current === "main-funds" && (fundsView === "investment" || window.location.hash === "#investment-funds") ? "investment" : current === "main-funds" && (fundsView === "transactions" || window.location.hash === "#funds-activity") ? "transactions" : current === "main-funds" ? "funds" : "";
    const icons = {
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
      activity: '<circle cx="12" cy="12" r="9"/><path d="M3 12h4l2-4 3 8 2-4h7"/>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
      chart: '<path d="M5 21v-5m5 5V9m5 12V3m5 18v-9"/>',
      layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
      crown: '<path d="m2 7 5 4 5-7 5 7 5-4-2 12H4L2 7Zm2 15h16"/>',
      network: '<circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/>',
      cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 2h3l3 14h13l2-10H5"/>',
      wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18m-5 6h5M6 5V3h12"/>',
      trend: '<path d="m3 17 6-6 4 4 8-8m-6 0h6v6"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
      logout: '<path d="M10 17l5-5-5-5m5 5H3m8-9h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8"/>'
    };
    const icon = name => `<svg class="member-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    const link = (id, label, href, iconName) => `<a class="member-sidebar-link${selected === id ? " active" : ""}" href="${href}"${selected === id ? ' aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span></a>`;
    const sidebar = document.createElement("aside");
    sidebar.id = "member-sidebar";
    sidebar.className = "member-sidebar";
    sidebar.setAttribute("aria-label", "Member navigation");
    sidebar.innerHTML = `
      <a class="member-sidebar-brand" href="portal.html"><span class="member-sidebar-brand-mark">M</span><span><strong>MATRIX</strong><small>MEMBER PORTAL</small></span></a>
      <nav aria-label="Member pages">
        <span class="member-sidebar-group">Workspace</span>
        ${link("overview", "Overview", "portal.html", "home")}
        ${link("activity", "Activity", "passive-income-history.html", "activity")}
        <span class="member-sidebar-group">Matrix plans</span>
        ${link("budget", "Budget Plan", "budget-plan.html", "chart")}
        ${link("standard", "Standard Plan", "timeline-matrix.html", "layers")}
        ${link("premium", "Premium Plan", "portal.html?view=premium", "crown")}
        ${link("patronizing", "Patronizing Income", "patronizing-income.html", "network")}
        <span class="member-sidebar-group">Commerce</span>
        ${link("shop", "Shop", "shop.html", "cart")}
        ${link("orders", "Orders", "orders.html", "list")}
        ${link("entry-orders", "Entry Orders", "packages-orders.html", "list")}
        ${link("product-plus", "Product Plus", "packages-orders.html?type=product_plus_requirement", "cart")}
        <span class="member-sidebar-group">Funds</span>
        ${link("funds", "Main Funds", "main-funds.html", "wallet")}
        ${link("investment", "Investment Funds", "main-funds.html?view=investment", "trend")}
        ${link("transactions", "Transactions", "main-funds.html?view=transactions", "list")}
      </nav>
      <div class="member-sidebar-footer"><a class="member-sidebar-account" href="portal.html#profile"><span class="member-sidebar-avatar"></span><span><strong class="member-sidebar-name"></strong><small class="member-sidebar-id"></small></span></a><button class="member-sidebar-link member-sidebar-logout" type="button">${icon("logout")}<span>Log out</span></button></div>`;
    sidebar.querySelector(".member-sidebar-avatar").textContent = (member.fullName || member.username || "M").charAt(0).toUpperCase();
    sidebar.querySelector(".member-sidebar-name").textContent = member.fullName || member.username || "Member";
    sidebar.querySelector(".member-sidebar-id").textContent = member.accountCode ? `Member ID ${member.accountCode}` : "Member account";
    const toggle = document.createElement("button");
    toggle.className = "member-sidebar-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Open member navigation");
    toggle.setAttribute("aria-controls", "member-sidebar");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = icon("menu");
    const crumb = document.createElement("span");
    crumb.className = "member-sidebar-crumb";
    const currentLabel = { "passive-income-history": "Passive Income History", "withdrawal-history": "Withdrawal History", "withdrawal-request": "Withdraw" }[current] || { overview: "Overview", activity: "Activity", budget: "Budget Plan", standard: "Standard Plan", premium: "Premium Plan", patronizing: "Patronizing Income", shop: "Shop", orders: "Orders", "entry-orders": "Entry Orders", "product-plus": "Product Plus", funds: "Main Funds", investment: "Investment Funds", transactions: "Transactions" }[selected] || document.title.split("|")[0].trim();
    crumb.append("Member / ");
    const crumbCurrent = document.createElement("strong");
    crumbCurrent.textContent = currentLabel;
    crumb.append(crumbCurrent);
    const backdrop = document.createElement("button");
    backdrop.className = "member-sidebar-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close member navigation");
    document.body.prepend(sidebar, backdrop);
    document.querySelector(".member-sidebar[data-shell]")?.remove();
    const header = document.querySelector(".portal-header .header-wrapper");
    if (header) header.prepend(toggle, crumb);
    if (header && current !== "portal") setupMemberHeader(header, member);
    document.body.classList.add("member-sidebar-active");
    document.documentElement.classList.add("member-workspace");
    document.documentElement.classList.remove("member-nav-pending");
    const close = () => {
      document.body.classList.remove("member-sidebar-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open member navigation");
    };
    toggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("member-sidebar-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close member navigation" : "Open member navigation");
    });
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    sidebar.querySelector(".member-sidebar-logout").addEventListener("click", async () => {
      try {
        if (window.MatrixDB && typeof MatrixDB.signOut === "function") await MatrixDB.signOut();
        else if (window.matrixSupabase) await window.matrixSupabase.auth.signOut();
      } catch (error) { console.error(error); }
      sessionStorage.removeItem("matrix_logged_in_member_id");
      sessionStorage.removeItem("matrix_auth_token");
      window.location.href = "portal.html";
    });
    if (hasSessionHint) {
      const authenticatedMember = await memberPromise;
      if (!authenticatedMember) {
        sidebar.remove();
        backdrop.remove();
        toggle.remove();
        crumb.remove();
        document.body.classList.remove("member-sidebar-active");
        document.documentElement.classList.remove("member-workspace");
      } else {
        sidebar.querySelector(".member-sidebar-avatar").textContent = (authenticatedMember.fullName || authenticatedMember.username || "M").charAt(0).toUpperCase();
        sidebar.querySelector(".member-sidebar-name").textContent = authenticatedMember.fullName || authenticatedMember.username || "Member";
        sidebar.querySelector(".member-sidebar-id").textContent = authenticatedMember.accountCode ? `Member ID ${authenticatedMember.accountCode}` : "Member account";
        if (header && current !== "portal") setupMemberHeader(header, authenticatedMember);
      }
    }
    sidebarSetupPending = false;
  }

  function setupMemberHeader(header, member) {
    let status = header.querySelector(".user-status-strip");
    if (!status) {
      status = document.createElement("div");
      status.className = "user-status-strip";
      status.dataset.memberMenu = "";
      status.dataset.currentPage = pageIdFromLocation();
      status.innerHTML = '<button class="account-menu-toggle" type="button" aria-label="Open member menu" aria-expanded="false" data-member-menu-toggle><span class="header-avatar" data-member-menu-avatar>M</span></button><nav class="account-menu" aria-label="Member pages" data-member-menu-list hidden></nav>';
      header.append(status);
      setupMemberNavigation();
    }
    status.style.display = "flex";
    const avatar = status.querySelector(".header-avatar");
    if (avatar) avatar.textContent = (member.fullName || member.username || "M").charAt(0).toUpperCase();
    const name = status.querySelector("[data-member-menu-name]");
    if (name) name.textContent = member.fullName || member.username || "Member";
    const existingButton = status.querySelector(".member-notification-toggle");
    if (existingButton) {
      existingButton.refreshNotifications(member);
      return;
    }
    const button = document.createElement("button");
    button.className = "notification-menu-toggle member-notification-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Open notifications");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "member-notification-menu");
    button.innerHTML = '<svg class="notification-bell" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 22a2.75 2.75 0 0 0 2.65-2h-5.3A2.75 2.75 0 0 0 12 22Zm7-5.5-1.9-2.35V10a5.15 5.15 0 0 0-4.1-5.05V3a1 1 0 1 0-2 0v1.95A5.15 5.15 0 0 0 6.9 10v4.15L5 16.5V18h14v-1.5Z"/></svg><span class="notification-count" hidden></span>';
    const menu = document.createElement("div");
    menu.id = "member-notification-menu";
    menu.className = "notification-menu member-notification-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Member notifications");
    menu.hidden = true;
    menu.innerHTML = '<div class="notification-menu-heading"><strong>Notifications</strong><span>No updates</span></div><div class="notification-list"></div>';
    status.prepend(button, menu);
    const list = menu.querySelector(".notification-list");
    const count = button.querySelector(".notification-count");
    const renderNotifications = notifications => {
      const items = Array.isArray(notifications) ? notifications : [];
      list.replaceChildren();
      count.hidden = items.length === 0;
      button.classList.toggle("has-notifications", items.length > 0);
      button.classList.toggle("has-priority", items.some(item => item.priority === "high"));
      menu.querySelector(".notification-menu-heading span").textContent = items.length ? `${items.length} update${items.length === 1 ? "" : "s"}` : "No updates";
      if (!items.length) {
        list.innerHTML = '<div class="notification-empty">You have no new member updates.</div>';
        return;
      }
      count.hidden = false;
      count.textContent = String(Math.min(items.length, 99));
      items.forEach(item => {
        const article = document.createElement("article");
        article.className = `notification-item${item.priority === "high" ? " priority" : ""}`;
        const title = document.createElement("strong");
        title.textContent = item.title || "Update";
        const message = document.createElement("p");
        message.textContent = item.message || "";
        const date = document.createElement("span");
        date.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString("en-PH") : "";
        article.append(title, message, date);
        list.append(article);
      });
    };
    button.refreshNotifications = currentMember => {
      const summary = currentMember.id && window.MatrixDB && MatrixDB.getMemberMatrixSummary(currentMember.id);
      renderNotifications(summary && summary.notifications);
      if (currentMember.id && !window.MatrixDB && window.matrixSupabase) {
        window.matrixSupabase.rpc("get_my_dashboard")
          .then(({ data, error }) => { if (!error) renderNotifications(data && data.notifications); })
          .catch(error => console.error("Unable to load member notifications", error));
      }
    };
    button.refreshNotifications(member);
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", event => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) status.querySelector(".account-menu-toggle")?.setAttribute("aria-expanded", "false");
      if (open) {
        const accountMenu = status.querySelector(".account-menu");
        if (accountMenu) accountMenu.hidden = true;
      }
    });
    status.querySelector(".account-menu-toggle")?.addEventListener("click", close);
    document.addEventListener("click", event => { if (!menu.contains(event.target) && event.target !== button) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  }

  async function loadMemberWithRetry() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const member = await loadCurrentMember();
      if (member) return member;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150));
    }
    return null;
  }

  async function hydrateMemberMenu(menu, name, avatar, currentPage) {
    const member = await loadCurrentMember();
    const isAdmin = member ? await loadAdminStatus(member) : false;
    if (member && name && avatar) {
      const displayName = member.fullName || member.username || "Member";
      name.textContent = displayName;
      avatar.textContent = displayName.charAt(0).toUpperCase();
    }
    const availablePages = isAdmin ? [...pages, { id: "admin", label: "Admin Portal", href: "admin.html" }] : pages;
    renderMenu(menu, availablePages, currentPage);
    bindSignOut(menu);
  }

  function renderMenu(menu, availablePages, currentPage) {
    menu.innerHTML = availablePages
      .filter(page => page.id !== currentPage)
      .map(page => `<a href="${page.href}">${page.label}</a>`)
      .join("") + `<button type="button" class="account-menu-signout" data-member-signout>Sign Out</button>`;
  }

  function bindSignOut(menu) {
    const signOut = menu.querySelector("[data-member-signout]");
    if (!signOut || signOut.dataset.bound === "true") return;
    signOut.dataset.bound = "true";
    signOut.addEventListener("click", async () => {
      sessionStorage.removeItem("matrix_logged_in_member_id");
      if (window.matrixSupabase) await window.matrixSupabase.auth.signOut();
      window.location.href = "portal.html";
    });
  }

  function toggleMenu(toggle, menu) {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeMenu(toggle, menu) {
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
})();
