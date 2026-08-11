document.addEventListener("DOMContentLoaded", async () => {
  const loginSection = document.getElementById("admin-login");
  const content = document.getElementById("admin-content");
  const loginAlert = document.getElementById("admin-login-alert");
  const alertBox = document.getElementById("admin-alert");
  const list = document.getElementById("admin-entry-list");
  const timelineList = document.getElementById("admin-timeline-list");
  const exitList = document.getElementById("admin-exit-list");
  const withdrawalList = document.getElementById("admin-withdrawal-list");
  const productsList = document.getElementById("admin-products-list");
  const commerceOrderList = document.getElementById("admin-commerce-order-list");
  const memberTableBody = document.getElementById("admin-member-table-body");
  const memberSummary = document.getElementById("admin-member-summary");
  const memberPagination = document.getElementById("admin-member-pagination");
  const memberSearch = document.getElementById("admin-member-search");
  const memberStatus = document.getElementById("admin-member-status");
  const paymentMethodForm = document.getElementById("admin-payment-method-form");
  const paymentMethodId = document.getElementById("admin-payment-method-id");
  const paymentMethodName = document.getElementById("admin-payment-method-name");
  const paymentAccountName = document.getElementById("admin-payment-account-name");
  const paymentAccountNumber = document.getElementById("admin-payment-account-number");
  const paymentSort = document.getElementById("admin-payment-sort");
  const paymentQr = document.getElementById("admin-payment-qr");
  const paymentQrPreview = document.getElementById("admin-payment-qr-preview");
  const paymentInstructions = document.getElementById("admin-payment-instructions");
  const paymentActive = document.getElementById("admin-payment-active");
  const paymentSave = document.getElementById("admin-payment-save");
  const paymentCancel = document.getElementById("admin-payment-cancel");
  const paymentMethodList = document.getElementById("admin-payment-method-list");
  const commercePackageForm = document.getElementById("admin-commerce-package-form");
  const commercePackageId = document.getElementById("admin-commerce-package-id");
  const commercePackageType = document.getElementById("admin-commerce-package-type");
  const commercePackageName = document.getElementById("admin-commerce-package-name");
  const commercePackageDescription = document.getElementById("admin-commerce-package-description");
  const commercePackageSort = document.getElementById("admin-commerce-package-sort");
  const commercePackageActive = document.getElementById("admin-commerce-package-active");
  const commerceItems = document.getElementById("admin-commerce-items");
  const commerceAddItem = document.getElementById("admin-commerce-add-item");
  const commercePackageSave = document.getElementById("admin-commerce-package-save");
  const commercePackageCancel = document.getElementById("admin-commerce-package-cancel");
  const commercePackageFilter = document.getElementById("admin-commerce-package-filter");
  const commercePackageList = document.getElementById("admin-commerce-package-list");
  const signout = document.getElementById("admin-signout");
  const adminUserStatus = document.getElementById("admin-user-status");
  const ownerFinancesTab = document.getElementById("admin-owner-finances-tab");
  const financeSummary = document.getElementById("finance-summary");
  const statMembers = document.getElementById("stat-members");
  const statPendingRequests = document.getElementById("stat-pending-requests");
  const statAdminAccess = document.getElementById("stat-admin-access");
  const pendingBadge = document.getElementById("badge-pending-count");
  const voucherModal = document.getElementById("voucher-redemption-modal");
  const voucherForm = document.getElementById("voucher-redemption-form");
  const voucherAlert = document.getElementById("voucher-redemption-alert");
  const timelineDecisionModal = document.getElementById("timeline-decision-modal");
  const timelineDecisionForm = document.getElementById("timeline-decision-form");
  const timelineDecisionAlert = document.getElementById("timeline-decision-alert");
  const viewerPlanSelect = document.getElementById("production-viewer-plan-select");
  const treeMemberSearch = document.getElementById("production-tree-member-search");
  const matrixExitFilter = document.getElementById("production-matrix-exit-filter");
  const matrixStatusFilter = document.getElementById("production-matrix-status-filter");
  const matrixExplorerCount = document.getElementById("production-matrix-explorer-count");
  const matrixExplorerBreadcrumbs = document.getElementById("production-matrix-explorer-breadcrumbs");
  const globalTreeVisualizer = document.getElementById("production-global-tree-visualizer");
  const matrixMemberDetails = document.getElementById("production-matrix-member-details");
  let voucherMemberId = null;
  let timelineDecision = null;
  let memberPage = 1;
  let currentUserId = null;
  let ownerMode = false;
  let memberRoles = new Map();
  let matrixExplorerNodes = [];
  let matrixExplorerExpanded = new Set();
  let matrixExplorerSelectedId = null;
  let paymentMethods = [];
  let paymentQrData = "";
  let commercePackages = [];
  const pendingCounts = {};

  document.querySelectorAll("[data-production-tab]").forEach(button => button.addEventListener("click", async () => {
    const target = button.dataset.productionTab;
    document.querySelectorAll("[data-production-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".admin-section").forEach(section => {
      const active = section.id === target;
      section.classList.toggle("active", active);
      if (section.id === "tab-finances") section.hidden = !ownerMode;
    });
    if (target === "tab-finances") await loadFinances();
    if (target === "tab-matrix-viewer") await loadMatrixExplorer();
    if (target === "tab-payment-methods") await loadPaymentMethods();
    if (target === "tab-commerce-packages") await loadCommercePackages();
  }));
  document.querySelectorAll("[data-production-approval-tab]").forEach(button => button.addEventListener("click", () => {
    const selected = button.dataset.productionApprovalTab;
    document.querySelectorAll("[data-production-approval-tab]").forEach(tab => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", active ? "true" : "false"); });
    document.querySelectorAll("[data-production-approval-panel]").forEach(panel => { panel.hidden = panel.dataset.productionApprovalPanel !== selected; });
  }));
  document.getElementById("admin-login-form").addEventListener("submit", async event => {
    event.preventDefault(); loginAlert.style.display = "none";
    const { error } = await window.matrixSupabase.auth.signInWithPassword({ email: document.getElementById("admin-email").value.trim(), password: document.getElementById("admin-password").value });
    if (error) return show(loginAlert, error.message, "danger");
    await enter();
  });
  document.getElementById("admin-refresh").addEventListener("click", loadAll);
  document.getElementById("admin-member-filters").addEventListener("submit", async event => {
    event.preventDefault(); memberPage = 1; await loadMembers();
  });
  memberStatus.addEventListener("change", async () => { memberPage = 1; await loadMembers(); });
  paymentQr.addEventListener("change", handlePaymentQrChange);
  paymentCancel.addEventListener("click", () => resetPaymentMethodForm());
  paymentMethodForm.addEventListener("submit", handlePaymentMethodSubmit);
  commerceAddItem.addEventListener("click", () => addCommerceItemRow());
  commercePackageCancel.addEventListener("click", () => resetCommercePackageForm());
  commercePackageFilter.addEventListener("change", renderCommercePackages);
  commercePackageForm.addEventListener("submit", handleCommercePackageSubmit);
  viewerPlanSelect.addEventListener("change", loadMatrixExplorer);
  treeMemberSearch.addEventListener("input", renderMatrixExplorerRows);
  [matrixExitFilter, matrixStatusFilter].forEach(input => input.addEventListener("change", renderMatrixExplorerRows));
  document.getElementById("production-matrix-expand-all").addEventListener("click", () => { matrixExplorerExpanded = new Set(matrixExplorerNodes.filter(node => node.childIds.length).map(node => node.id)); renderMatrixExplorerRows(); });
  document.getElementById("production-matrix-collapse-all").addEventListener("click", () => { matrixExplorerExpanded = new Set(matrixExplorerNodes.filter(node => !node.parentId && node.childIds.length).map(node => node.id)); renderMatrixExplorerRows(); });
  document.getElementById("voucher-redemption-close").addEventListener("click", closeVoucherModal);
  voucherModal.addEventListener("click", event => { if (event.target === voucherModal) closeVoucherModal(); });
  document.getElementById("timeline-decision-close").addEventListener("click", closeTimelineDecision);
  timelineDecisionModal.addEventListener("click", event => { if (event.target === timelineDecisionModal) closeTimelineDecision(); });
  timelineDecisionForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!timelineDecision) return;
    const submit = document.getElementById("timeline-decision-submit");
    const note = document.getElementById("timeline-decision-note").value.trim();
    if (note.length < 3) return show(timelineDecisionAlert, "Enter a short decision note.", "danger");
    submit.disabled = true;
    const { error } = await window.matrixSupabase.rpc(timelineDecision.rpc, { p_request_id: timelineDecision.requestId, p_decision_note: note });
    submit.disabled = false;
    if (error) return show(timelineDecisionAlert, error.message, "danger");
    closeTimelineDecision(); show(alertBox, "Timeline request updated successfully.", "success"); await loadAll();
  });
  voucherForm.addEventListener("submit", async event => {
    event.preventDefault(); voucherAlert.style.display = "none";
    const submit = document.getElementById("voucher-redemption-submit"); submit.disabled = true;
    const { data, error } = await window.matrixSupabase.rpc("admin_redeem_voucher", { p_member_id: voucherMemberId, p_amount: Number(document.getElementById("voucher-redemption-amount").value), p_reference: document.getElementById("voucher-redemption-reference").value.trim(), p_notes: document.getElementById("voucher-redemption-notes").value.trim() });
    submit.disabled = false;
    if (error) { voucherAlert.className="alert alert-danger"; voucherAlert.textContent=error.message; voucherAlert.style.display="block"; return; }
    closeVoucherModal(); show(alertBox, `Voucher redemption recorded. Remaining balance: ${money(data.balance)}.`, "success");
  });
  document.addEventListener("click", () => closeMemberActionMenus());
  signout.addEventListener("click", async () => { await window.matrixSupabase.auth.signOut(); location.reload(); });
  const { data } = await window.matrixSupabase.auth.getSession();
  if (data.session) await enter();

  async function enter() {
    const [{ data: userData }, { data: isOwner }, { data: roles }, { error }] = await Promise.all([
      window.matrixSupabase.auth.getUser(), window.matrixSupabase.rpc("is_owner"),
      window.matrixSupabase.rpc("admin_get_member_roles"), window.matrixSupabase.rpc("admin_get_entry_requests")
    ]);
    if (error) { await window.matrixSupabase.auth.signOut(); return show(loginAlert, "This account does not have administrator access.", "danger"); }
    currentUserId = userData.user && userData.user.id;
    ownerMode = Boolean(isOwner);
    ownerFinancesTab.hidden = !ownerMode;
    document.getElementById("tab-finances").hidden = !ownerMode;
    statAdminAccess.textContent = ownerMode ? "Owner" : "Admin";
    memberRoles = new Map((roles || []).map(item => [item.memberId, item]));
    loginSection.style.display = "none"; content.style.display = "block"; adminUserStatus.style.display = "flex"; await loadAll();
  }
  async function loadAll() { await Promise.all([loadMembers(), loadEntry(), loadTimeline(), loadExits(), loadWithdrawals(), loadProducts(), loadCommerceOrders(), loadPaymentMethods(), loadCommercePackages()]); }
  async function loadMembers() {
    memberTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Loading member directory...</td></tr>`;
    const { data, error } = await window.matrixSupabase.rpc("admin_get_members", {
      p_search: memberSearch.value.trim(), p_status: memberStatus.value,
      p_page: memberPage, p_page_size: 10
    });
    if (error) {
      memberTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Unable to load the member directory.</td></tr>`;
      return show(alertBox, error.message, "danger");
    }
    const members = data.members || [];
    memberSummary.textContent = `${Number(data.total).toLocaleString()} member${Number(data.total) === 1 ? "" : "s"} found`;
    statMembers.textContent = Number(data.total).toLocaleString();
    if (!members.length) {
      memberTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No matching members found.</td></tr>`;
    } else {
      memberTableBody.innerHTML = members.map(member => {
        const access = memberRoles.get(member.id) || { role: "member", isOwner: false };
        const main = member.mainPosition;
        const timeline = member.timelinePosition;
        const placements = getMemberPlacements(member);
        const planLabel = placements.length ? placements.map(placement => `<span class="matrix-plan-chip">${escapeHtml(placement.label)}</span>`).join("") : `<span class="matrix-plan-chip muted">Not placed</span>`;
        const parentLabel = main ? (main.parentUsername ? `@${main.parentUsername}` : "ROOT Node") : timeline ? (timeline.parentUsername ? `@${timeline.parentUsername}` : "ROOT Node") : "-";
        const sponsorLabel = member.sponsorName ? `@${member.sponsorName}` : "-";
        const viewControl = placements.length > 1 ? `<div class="member-actions-menu view-matrix-menu"><button class="button button-outline button-small view-member view-member-menu-toggle" type="button" aria-expanded="false">View</button><div class="member-actions-dropdown" hidden>${placements.map(placement => `<button class="member-menu-item view-member-plan" type="button" data-plan-id="${escapeHtml(placement.planId)}">${escapeHtml(placement.label)}</button>`).join("")}</div></div>` : `<button class="button button-outline button-small view-member" type="button" data-plan-id="${escapeHtml(placements[0]?.planId || "")}" ${placements.length ? "" : "disabled"}>View</button>`;
        const redeemButton = member.id === currentUserId ? "" : `<button class="button button-outline button-small redeem-voucher" type="button">Voucher</button>`;
        const menuButton = !ownerMode || member.id === currentUserId ? "" : `<div class="member-actions-menu"><button class="member-actions-toggle" type="button" aria-label="Open actions for ${escapeHtml(member.fullName)}" aria-expanded="false"><span></span><span></span><span></span></button><div class="member-actions-dropdown" hidden>${access.role === "admin" ? `<button class="member-menu-item remove-admin" type="button">Remove Admin</button>` : `<button class="member-menu-item invite-admin" type="button">Invite Admin</button>`}<button class="member-menu-item danger delete-member" type="button">Delete User</button></div></div>`;
        return `<tr data-member-id="${escapeHtml(member.id)}" data-member-name="${escapeHtml(member.fullName)}"><td><strong>${escapeHtml(member.fullName)}</strong><br><small>${escapeHtml(member.accountCode)}</small></td><td><strong class="admin-table-handle">@${escapeHtml(member.username)}</strong><br><span class="withdrawal-status ${memberStatusClass(member.status)}">${access.isOwner ? "Owner" : access.role === "admin" ? "Admin" : escapeHtml(member.status)}</span></td><td><div class="matrix-plan-list">${planLabel}</div></td><td>${escapeHtml(parentLabel)}</td><td>${escapeHtml(sponsorLabel)}</td><td>${copyField(member.walletAddress)}</td><td>${formatDate(member.approvedAt || member.createdAt)}</td><td><div class="actions">${viewControl}${redeemButton}${menuButton}</div></td></tr>`;
      }).join("");
      bindCopyButtons(memberTableBody);
      memberTableBody.querySelectorAll("[data-member-id]").forEach(row => {
        const invite = row.querySelector(".invite-admin");
        const remove = row.querySelector(".remove-admin");
        const deleteMember = row.querySelector(".delete-member");
        const menuToggle = row.querySelector(".member-actions-toggle");
        const menu = row.querySelector(".member-actions-dropdown");
        if (menuToggle && menu) menuToggle.addEventListener("click", event => {
          event.stopPropagation();
          closeMemberActionMenus(menu);
          const willOpen = menu.hidden;
          menu.hidden = !willOpen;
          menuToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
        });
        if (invite) invite.addEventListener("click", async () => {
          closeMemberActionMenus();
          const { data, error } = await window.matrixSupabase.rpc("owner_invite_admin", { p_member_id: row.dataset.memberId });
          if (error) return show(alertBox, error.message, "danger");
          const link = `${window.location.origin}/portal.html?admin_invite=${encodeURIComponent(data.token)}`;
          try { await navigator.clipboard.writeText(link); show(alertBox, `Invitation link copied. It expires ${new Date(data.expiresAt).toLocaleString()}.`, "success"); }
          catch (_) { window.prompt("Copy this administrator invitation link:", link); }
        });
        if (remove) remove.addEventListener("click", async () => { closeMemberActionMenus(); if (!window.confirm("Remove administrator access for this member?")) return; await act("owner_remove_admin", { p_member_id: row.dataset.memberId }); });
        if (deleteMember) deleteMember.addEventListener("click", async () => {
          closeMemberActionMenus();
          if (!window.confirm(`Delete ${row.dataset.memberName}? This only works for registered, unplaced members with no business history.`)) return;
          await act("owner_delete_registered_member", { p_member_id: row.dataset.memberId });
        });
        const viewMenuToggle = row.querySelector(".view-member-menu-toggle");
        if (viewMenuToggle) viewMenuToggle.addEventListener("click", event => {
          event.stopPropagation();
          const menu = viewMenuToggle.nextElementSibling;
          closeMemberActionMenus(menu);
          const willOpen = menu.hidden;
          menu.hidden = !willOpen;
          viewMenuToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
        });
        row.querySelectorAll(".view-member-plan").forEach(button => button.addEventListener("click", async () => {
          closeMemberActionMenus();
          await activateMatrixViewer(row.dataset.memberId, button.dataset.planId);
        }));
        const redeem = row.querySelector(".redeem-voucher");
        if (redeem) redeem.addEventListener("click", () => { voucherMemberId=row.dataset.memberId; voucherForm.reset(); voucherAlert.style.display="none"; document.getElementById("voucher-redemption-member").textContent=`Member: ${row.dataset.memberName}`; voucherModal.style.display="flex"; document.getElementById("voucher-redemption-amount").focus(); });
        const directView = row.querySelector(".view-member[data-plan-id]");
        if (directView) directView.addEventListener("click", async () => { if (!directView.dataset.planId) return show(alertBox, "This member is not placed in a matrix yet.", "danger"); await activateMatrixViewer(row.dataset.memberId, directView.dataset.planId); });
      });
    }
    renderMemberPagination(Number(data.page), Number(data.totalPages));
  }
  function renderMemberPagination(page, totalPages) {
    memberPagination.innerHTML = `<button class="button button-outline button-small" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${totalPages}</span><button class="button button-outline button-small" type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Next</button>`;
    memberPagination.querySelectorAll("button:not([disabled])").forEach(button => button.addEventListener("click", async () => {
      memberPage = Number(button.dataset.page); await loadMembers();
      document.getElementById("admin-member-heading").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }
  async function loadPaymentMethods() {
    paymentMethodList.innerHTML = `<div class="portal-card withdrawal-empty"><p>Loading payment methods...</p></div>`;
    const { data, error } = await window.matrixSupabase.rpc("admin_get_payment_methods");
    if (error) {
      paymentMethodList.innerHTML = `<div class="portal-card withdrawal-empty"><p>Unable to load payment methods.</p></div>`;
      return show(alertBox, error.message, "danger");
    }
    paymentMethods = data || [];
    if (!paymentMethods.length) {
      paymentMethodList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No payment methods yet</strong><p>Add GCash, Maribank, or bank transfer details before opening order payments.</p></div>`;
      return;
    }
    paymentMethodList.innerHTML = paymentMethods.map(method => `
      <article class="portal-card payment-method-card" data-payment-method-id="${escapeHtml(method.id)}">
        <div class="withdrawal-history-topline">
          <div>
            <span class="withdrawal-reference-label">Sort ${Number(method.sortOrder || 100)}</span>
            <h2>${escapeHtml(method.methodName)}</h2>
          </div>
          <span class="withdrawal-status ${method.isActive ? "status-approved" : "status-rejected"}">${method.isActive ? "Active" : "Inactive"}</span>
        </div>
        <div class="payment-method-body">
          ${method.qrImageData ? `<img class="payment-method-qr" src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} QR code">` : `<div class="payment-method-qr empty">No QR</div>`}
          <div class="withdrawal-history-details">
            <div><span>Account name</span><strong>${escapeHtml(method.accountName)}</strong></div>
            <div><span>Account number</span>${copyField(method.accountNumber)}</div>
            <div><span>Instructions</span><strong>${escapeHtml(method.instructions || "-")}</strong></div>
            <div><span>Updated</span><strong>${formatDate(method.updatedAt)}</strong></div>
          </div>
        </div>
        <div class="balance-card-buttons">
          <button class="button button-outline button-small edit-payment-method" type="button">Edit</button>
          <button class="button button-outline button-small delete-payment-method" type="button">Delete</button>
        </div>
      </article>
    `).join("");
    bindCopyButtons(paymentMethodList);
    paymentMethodList.querySelectorAll("[data-payment-method-id]").forEach(card => {
      const method = paymentMethods.find(item => item.id === card.dataset.paymentMethodId);
      card.querySelector(".edit-payment-method").addEventListener("click", () => populatePaymentMethodForm(method));
      card.querySelector(".delete-payment-method").addEventListener("click", async () => {
        if (!window.confirm(`Delete ${method.methodName}?`)) return;
        const { error } = await window.matrixSupabase.rpc("admin_delete_payment_method", { p_method_id: method.id });
        if (error) return show(alertBox, error.message, "danger");
        resetPaymentMethodForm();
        show(alertBox, "Payment method deleted.", "success");
        await loadPaymentMethods();
      });
    });
  }
  async function handlePaymentQrChange() {
    paymentQrData = "";
    paymentQrPreview.hidden = true;
    paymentQrPreview.removeAttribute("src");
    const file = paymentQr.files && paymentQr.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      paymentQr.value = "";
      return show(alertBox, "Upload an image file for the QR code.", "danger");
    }
    if (file.size > 900000) {
      paymentQr.value = "";
      return show(alertBox, "QR image is too large. Please use an image under 900 KB.", "danger");
    }
    paymentQrData = await readFileAsDataUrl(file);
    paymentQrPreview.src = paymentQrData;
    paymentQrPreview.hidden = false;
  }
  async function handlePaymentMethodSubmit(event) {
    event.preventDefault();
    paymentSave.disabled = true;
    const payload = {
      p_method_id: paymentMethodId.value || null,
      p_method_name: paymentMethodName.value.trim(),
      p_account_name: paymentAccountName.value.trim(),
      p_account_number: paymentAccountNumber.value.trim(),
      p_qr_image_data: paymentQrData,
      p_instructions: paymentInstructions.value.trim(),
      p_sort_order: Number(paymentSort.value || 100),
      p_is_active: paymentActive.checked
    };
    const { error } = await window.matrixSupabase.rpc("admin_save_payment_method", payload);
    paymentSave.disabled = false;
    if (error) return show(alertBox, error.message, "danger");
    resetPaymentMethodForm();
    show(alertBox, "Payment method saved.", "success");
    await loadPaymentMethods();
  }
  function populatePaymentMethodForm(method) {
    if (!method) return;
    paymentMethodId.value = method.id;
    paymentMethodName.value = method.methodName || "";
    paymentAccountName.value = method.accountName || "";
    paymentAccountNumber.value = method.accountNumber || "";
    paymentSort.value = method.sortOrder || 100;
    paymentInstructions.value = method.instructions || "";
    paymentActive.checked = Boolean(method.isActive);
    paymentQrData = method.qrImageData || "";
    paymentQr.value = "";
    paymentQrPreview.src = paymentQrData;
    paymentQrPreview.hidden = !paymentQrData;
    paymentCancel.hidden = false;
    paymentSave.textContent = "Update Method";
    paymentMethodName.focus();
  }
  function resetPaymentMethodForm() {
    paymentMethodForm.reset();
    paymentMethodId.value = "";
    paymentQrData = "";
    paymentQrPreview.hidden = true;
    paymentQrPreview.removeAttribute("src");
    paymentActive.checked = true;
    paymentSort.value = 100;
    paymentCancel.hidden = true;
    paymentSave.textContent = "Save Method";
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  async function loadCommercePackages() {
    commercePackageList.innerHTML = `<div class="portal-card withdrawal-empty"><p>Loading packages...</p></div>`;
    const { data, error } = await window.matrixSupabase.rpc("admin_get_commerce_packages");
    if (error) {
      commercePackageList.innerHTML = `<div class="portal-card withdrawal-empty"><p>Unable to load packages.</p></div>`;
      return show(alertBox, error.message, "danger");
    }
    commercePackages = data || [];
    renderCommercePackages();
    if (!commerceItems.children.length) addCommerceItemRow();
  }
  function renderCommercePackages() {
    const selectedType = commercePackageFilter.value;
    const visiblePackages = selectedType === "all" ? commercePackages : commercePackages.filter(item => item.packageType === selectedType);
    if (!visiblePackages.length) {
      commercePackageList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No packages found</strong><p>Create a package on the left, then it will show here.</p></div>`;
      return;
    }
    commercePackageList.innerHTML = visiblePackages.map(commercePackage => `
      <article class="portal-card commerce-package-card" data-commerce-package-id="${escapeHtml(commercePackage.id)}">
        <div class="withdrawal-history-topline">
          <div>
            <span class="withdrawal-reference-label">${escapeHtml(commercePackage.packageTypeLabel)} | Sort ${Number(commercePackage.sortOrder || 100)}</span>
            <h2>${escapeHtml(commercePackage.packageName)}</h2>
          </div>
          <span class="withdrawal-status ${commercePackage.isActive ? "status-approved" : "status-rejected"}">${commercePackage.isActive ? "Active" : "Inactive"}</span>
        </div>
        ${commercePackage.description ? `<p class="withdrawal-history-note">${escapeHtml(commercePackage.description)}</p>` : ""}
        <div class="commerce-package-total"><span>Total</span><strong>${money(commercePackage.totalPrice)}</strong></div>
        <div class="commerce-package-items">
          ${(commercePackage.items || []).map(item => `
            <div class="commerce-package-item">
              ${item.photoData ? `<img src="${escapeHtml(item.photoData)}" alt="${escapeHtml(item.itemName)}">` : `<span class="commerce-item-photo-empty">No Photo</span>`}
              <div><strong>${escapeHtml(item.itemName)}</strong><span>${money(item.price)}</span></div>
            </div>
          `).join("")}
        </div>
        <div class="balance-card-buttons">
          <button class="button button-outline button-small edit-commerce-package" type="button">Edit</button>
          <button class="button button-outline button-small delete-commerce-package" type="button">Delete</button>
        </div>
      </article>
    `).join("");
    commercePackageList.querySelectorAll("[data-commerce-package-id]").forEach(card => {
      const commercePackage = commercePackages.find(item => item.id === card.dataset.commercePackageId);
      card.querySelector(".edit-commerce-package").addEventListener("click", () => populateCommercePackageForm(commercePackage));
      card.querySelector(".delete-commerce-package").addEventListener("click", async () => {
        if (!window.confirm(`Delete ${commercePackage.packageName}?`)) return;
        const { error } = await window.matrixSupabase.rpc("admin_delete_commerce_package", { p_package_id: commercePackage.id });
        if (error) return show(alertBox, error.message, "danger");
        resetCommercePackageForm();
        show(alertBox, "Package deleted.", "success");
        await loadCommercePackages();
      });
    });
  }
  function addCommerceItemRow(item = {}) {
    const row = document.createElement("article");
    row.className = "package-item-row";
    row.dataset.photoData = item.photoData || "";
    row.innerHTML = `
      <div class="package-item-photo-control">
        ${item.photoData ? `<img src="${escapeHtml(item.photoData)}" alt="">` : `<span>No Photo</span>`}
        <input class="package-item-photo-input" type="file" accept="image/*">
      </div>
      <div class="form-group"><label>Item name</label><input class="form-control package-item-name" type="text" maxlength="100" value="${escapeHtml(item.itemName || "")}" required></div>
      <div class="form-group"><label>Price</label><input class="form-control package-item-price" type="number" min="0" max="1000000" step="0.01" value="${Number(item.price || 0)}" required></div>
      <div class="form-group"><label>Sort</label><input class="form-control package-item-sort" type="number" min="0" max="9999" step="1" value="${Number(item.sortOrder || ((commerceItems.children.length + 1) * 10))}"></div>
      <button class="button button-outline button-small remove-package-item" type="button">Remove</button>
    `;
    commerceItems.appendChild(row);
    row.querySelector(".remove-package-item").addEventListener("click", () => {
      if (commerceItems.children.length <= 1) {
        return show(alertBox, "Each package needs at least one item.", "danger");
      }
      row.remove();
    });
    row.querySelector(".package-item-photo-input").addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        event.target.value = "";
        return show(alertBox, "Upload an image file for the item photo.", "danger");
      }
      if (file.size > 900000) {
        event.target.value = "";
        return show(alertBox, "Item photo is too large. Please use an image under 900 KB.", "danger");
      }
      const dataUrl = await readFileAsDataUrl(file);
      row.dataset.photoData = dataUrl;
      row.querySelector(".package-item-photo-control").firstElementChild.outerHTML = `<img src="${escapeHtml(dataUrl)}" alt="">`;
    });
  }
  function collectCommerceItems() {
    return Array.from(commerceItems.querySelectorAll(".package-item-row")).map((row, index) => ({
      itemName: row.querySelector(".package-item-name").value.trim(),
      price: Number(row.querySelector(".package-item-price").value || 0),
      photoData: row.dataset.photoData || "",
      sortOrder: Number(row.querySelector(".package-item-sort").value || ((index + 1) * 10))
    }));
  }
  async function handleCommercePackageSubmit(event) {
    event.preventDefault();
    commercePackageSave.disabled = true;
    const { error } = await window.matrixSupabase.rpc("admin_save_commerce_package", {
      p_package_id: commercePackageId.value || null,
      p_package_type: commercePackageType.value,
      p_package_name: commercePackageName.value.trim(),
      p_description: commercePackageDescription.value.trim(),
      p_is_active: commercePackageActive.checked,
      p_sort_order: Number(commercePackageSort.value || 100),
      p_items: collectCommerceItems()
    });
    commercePackageSave.disabled = false;
    if (error) return show(alertBox, error.message, "danger");
    resetCommercePackageForm();
    show(alertBox, "Package saved.", "success");
    await loadCommercePackages();
  }
  function populateCommercePackageForm(commercePackage) {
    if (!commercePackage) return;
    commercePackageId.value = commercePackage.id;
    commercePackageType.value = commercePackage.packageType;
    commercePackageName.value = commercePackage.packageName || "";
    commercePackageDescription.value = commercePackage.description || "";
    commercePackageSort.value = commercePackage.sortOrder || 100;
    commercePackageActive.checked = Boolean(commercePackage.isActive);
    commerceItems.innerHTML = "";
    (commercePackage.items || []).forEach(item => addCommerceItemRow(item));
    if (!commerceItems.children.length) addCommerceItemRow();
    commercePackageCancel.hidden = false;
    commercePackageSave.textContent = "Update Package";
    commercePackageName.focus();
  }
  function resetCommercePackageForm() {
    commercePackageForm.reset();
    commercePackageId.value = "";
    commercePackageType.value = "timeline_entry";
    commercePackageSort.value = 100;
    commercePackageActive.checked = true;
    commerceItems.innerHTML = "";
    addCommerceItemRow();
    commercePackageCancel.hidden = true;
    commercePackageSave.textContent = "Save Package";
  }
  async function activateMatrixViewer(memberId, planId = null) {
    if (planId && viewerPlanSelect.value !== planId) viewerPlanSelect.value = planId;
    document.querySelectorAll("[data-production-tab]").forEach(tab => tab.classList.toggle("active", tab.dataset.productionTab === "tab-matrix-viewer"));
    document.querySelectorAll(".admin-section").forEach(section => section.classList.toggle("active", section.id === "tab-matrix-viewer"));
    await loadMatrixExplorer(memberId);
  }
  async function loadMatrixExplorer(preferredMemberId = null) {
    globalTreeVisualizer.innerHTML = `<div class="empty-state"><p>Loading matrix placements...</p></div>`;
    const { data, error } = await window.matrixSupabase.rpc("admin_get_matrix_explorer", { p_plan_id: viewerPlanSelect.value });
    if (error) { globalTreeVisualizer.innerHTML = `<div class="empty-state"><p>Unable to load the Matrix Explorer.</p></div>`; return show(alertBox, error.message, "danger"); }
    const byParent = new Map();
    (data || []).forEach(node => {
      const key = node.parentMemberId || "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(node);
    });
    byParent.forEach(nodes => nodes.sort((left, right) => new Date(left.placedAt) - new Date(right.placedAt)));
    matrixExplorerNodes = [];
    const flatten = (node, depth) => {
      const children = byParent.get(node.id) || [];
      matrixExplorerNodes.push({ ...node, depth, childIds: children.map(child => child.id), openSlots: Math.max(3 - children.length, 0) });
      children.forEach(child => flatten(child, depth + 1));
    };
    (byParent.get("root") || []).forEach(root => flatten(root, 0));
    matrixExplorerExpanded = new Set((byParent.get("root") || []).filter(root => (byParent.get(root.id) || []).length).map(root => root.id));
    matrixExplorerSelectedId = matrixExplorerNodes.some(node => node.id === preferredMemberId) ? preferredMemberId : (matrixExplorerNodes[0] || {}).id || null;
    renderMatrixExplorerRows();
    renderMatrixMemberDetails();
  }
  function renderMatrixExplorerRows() {
    const query = treeMemberSearch.value.trim().toLowerCase();
    const exitFilter = matrixExitFilter.value;
    const statusFilter = matrixStatusFilter.value;
    const filtered = Boolean(query || exitFilter !== "all" || statusFilter !== "all");
    const nodeById = new Map(matrixExplorerNodes.map(node => [node.id, node]));
    const matchingIds = new Set();
    matrixExplorerNodes.forEach(node => {
      const stage = node.matrixStage || { exit: 0, status: "active" };
      const matchesQuery = !query || [node.fullName, node.username, node.walletAddress, node.id].some(value => String(value || "").toLowerCase().includes(query));
      const matchesExit = exitFilter === "all" || Number(exitFilter) === Number(stage.exit || 0);
      const matchesStatus = statusFilter === "all" || stage.status === statusFilter;
      if (!matchesQuery || !matchesExit || !matchesStatus) return;
      let cursor = node;
      while (cursor) { matchingIds.add(cursor.id); cursor = cursor.parentMemberId ? nodeById.get(cursor.parentMemberId) : null; }
    });
    const visible = matrixExplorerNodes.filter(node => {
      if (filtered) return matchingIds.has(node.id);
      let parentId = node.parentMemberId;
      while (parentId) { if (!matrixExplorerExpanded.has(parentId)) return false; parentId = nodeById.get(parentId)?.parentMemberId || null; }
      return true;
    });
    matrixExplorerCount.textContent = `${matrixExplorerNodes.length} ${matrixExplorerNodes.length === 1 ? "member" : "members"}`;
    if (!visible.length) { globalTreeVisualizer.innerHTML = `<div class="empty-state"><p>No members match the selected filters.</p></div>`; return; }
    globalTreeVisualizer.innerHTML = visible.map(node => {
      const stage = node.matrixStage || { label: "Entry", status: "active", exit: 0 };
      const expanded = filtered || matrixExplorerExpanded.has(node.id);
      const hasChildren = node.childIds.length > 0;
      return `<div class="matrix-explorer-row ${node.id === matrixExplorerSelectedId ? "selected" : ""}" role="treeitem" aria-level="${node.depth + 1}" aria-expanded="${hasChildren ? expanded : "false"}"><div class="matrix-explorer-member-cell" style="--tree-depth:${node.depth}">${hasChildren ? `<button class="matrix-tree-toggle" type="button" data-toggle-id="${escapeHtml(node.id)}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(node.fullName)}">${expanded ? "-" : "+"}</button>` : `<span class="matrix-tree-leaf">&bull;</span>`}<button class="matrix-explorer-member" type="button" data-explorer-member-id="${escapeHtml(node.id)}"><strong>${escapeHtml(node.fullName)}</strong><span>@${escapeHtml(node.username)} | ${escapeHtml(shorten(node.walletAddress))}</span></button></div><span class="matrix-explorer-stage stage-${escapeHtml(stage.status)}">${escapeHtml(stage.label)} <small>${escapeHtml(capitalize(stage.status))}</small></span><span class="matrix-explorer-children">${node.childIds.length}/${node.childIds.length + node.openSlots}</span></div>`;
    }).join("");
    globalTreeVisualizer.querySelectorAll("[data-toggle-id]").forEach(button => button.addEventListener("click", () => { const id = button.dataset.toggleId; if (matrixExplorerExpanded.has(id)) matrixExplorerExpanded.delete(id); else matrixExplorerExpanded.add(id); renderMatrixExplorerRows(); }));
    globalTreeVisualizer.querySelectorAll("[data-explorer-member-id]").forEach(button => button.addEventListener("click", () => { matrixExplorerSelectedId = button.dataset.explorerMemberId; renderMatrixExplorerRows(); renderMatrixMemberDetails(); }));
  }
  function renderMatrixMemberDetails() {
    const node = matrixExplorerNodes.find(item => item.id === matrixExplorerSelectedId);
    if (!node) { matrixExplorerBreadcrumbs.textContent = "Select a member"; matrixMemberDetails.innerHTML = `<div class="empty-state"><p>Select a member to view their details.</p></div>`; return; }
    const nodeById = new Map(matrixExplorerNodes.map(item => [item.id, item]));
    const path = [];
    let cursor = node;
    while (cursor) { path.unshift(cursor.fullName); cursor = cursor.parentMemberId ? nodeById.get(cursor.parentMemberId) : null; }
    matrixExplorerBreadcrumbs.textContent = path.join(" > ");
    const descendants = countExplorerDescendants(node.id);
    const stage = node.matrixStage || { label: "Entry", status: "active" };
    matrixMemberDetails.innerHTML = `<span class="withdrawal-eyebrow">Selected member</span><h3>${escapeHtml(node.fullName)}</h3><p class="matrix-member-username">@${escapeHtml(node.username)}</p><div class="matrix-member-stage stage-${escapeHtml(stage.status)}"><strong>${escapeHtml(stage.label)}</strong><span>${escapeHtml(capitalize(stage.status))}</span></div><dl class="matrix-member-detail-list"><div><dt>Direct children</dt><dd>${node.childIds.length}</dd></div><div><dt>Total downline</dt><dd>${descendants}</dd></div><div><dt>Open positions</dt><dd>${node.openSlots}</dd></div><div><dt>Parent placement</dt><dd>${node.parentUsername ? `@${escapeHtml(node.parentUsername)}` : "Root"}</dd></div><div><dt>Invited sponsor</dt><dd>${node.sponsorUsername ? `@${escapeHtml(node.sponsorUsername)}` : "None"}</dd></div><div><dt>Email</dt><dd>${escapeHtml(node.email || "-")}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(node.phone || "-")}</dd></div><div><dt>Wallet</dt><dd title="${escapeHtml(node.walletAddress || "")}">${escapeHtml(shorten(node.walletAddress))}</dd></div><div><dt>Placed</dt><dd>${formatDate(node.placedAt)}</dd></div></dl>`;
  }
  function countExplorerDescendants(memberId) {
    const node = matrixExplorerNodes.find(item => item.id === memberId);
    return node ? node.childIds.reduce((total, childId) => total + 1 + countExplorerDescendants(childId), 0) : 0;
  }
  async function loadEntry() {
    const [{ data: requests, error }, { data: parents, error: parentError }] = await Promise.all([
      window.matrixSupabase.rpc("admin_get_entry_requests"), window.matrixSupabase.rpc("admin_get_eligible_parents")
    ]);
    if (error || parentError) return show(alertBox, (error || parentError).message, "danger");
    const pending = requests.filter(request => request.status === "pending");
    updateCount("entry", pending.length);
    if (!pending.length) { list.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending Entry requests</strong><p>New requests will appear here.</p></div>`; return; }
    list.innerHTML = pending.map(request => `<article class="portal-card withdrawal-history-item" data-request-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.accountCode)}</span><h2>${escapeHtml(request.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Username</span><strong>@${escapeHtml(request.username)}</strong></div><div><span>Reference</span><strong>${escapeHtml(request.referenceNumber)}</strong></div><div><span>Amount</span><strong>PHP ${Number(request.amount).toLocaleString()}</strong></div><div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div><div class="form-group" style="margin-top:1rem"><label>Matrix placement start</label>${request.sponsorId ? `<div class="form-control">${escapeHtml(request.sponsorName)} (${escapeHtml(request.sponsorCode)})</div>` : `<select class="form-control parent-select"><option value="">Auto from root/admin</option>${parents.map(parent => `<option value="${escapeHtml(parent.memberId)}">${escapeHtml(parent.fullName)} - ${parent.slotsLeft} direct slot(s)</option>`).join("")}</select>`}<small class="form-hint">Approval places the member in the next open 3-wide slot under this line.</small></div><div class="balance-card-buttons"><button class="button button-primary button-small approve-entry" type="button">Approve &amp; Auto-place</button><button class="button button-outline button-small reject-entry" type="button">Reject</button></div></article>`).join("");
    list.querySelectorAll("[data-request-id]").forEach(card => card.querySelector(".withdrawal-history-details").insertAdjacentHTML("beforeend", `<div><span>F3 Wallet</span>${copyField(requests.find(item => item.id === card.dataset.requestId).walletAddress)}</div>`));
    bindCopyButtons(list);
    list.querySelectorAll("[data-request-id]").forEach(card => {
      card.querySelector(".approve-entry").addEventListener("click", async () => { const parent = card.querySelector(".parent-select"); await act("admin_approve_entry", { p_request_id: card.dataset.requestId, p_parent_member_id: parent && parent.value ? parent.value : null }); });
      card.querySelector(".reject-entry").addEventListener("click", async () => act("admin_reject_entry", { p_request_id: card.dataset.requestId }));
    });
  }
  async function loadExits() {
    const { data: requests, error } = await window.matrixSupabase.rpc("admin_get_exit_requests");
    if (error) return show(alertBox, error.message, "danger");
    const pending = requests.filter(request => request.status === "pending");
    updateCount("exit", pending.length);
    if (!pending.length) { exitList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending Exit requests</strong><p>Qualified member requests will appear here.</p></div>`; return; }
    exitList.innerHTML = pending.map(request => {
      const details = request.paymentMethod === "f3_wallet" ? `<div><span>F3 Wallet</span>${copyField(request.f3Wallet)}</div>` : request.paymentMethod === "available_balance" ? `<div><span>Payment</span><strong>Available Balance</strong></div>` : `<div><span>GCash</span><strong>${escapeHtml(request.gcashName || "-")} · ${escapeHtml(request.gcashNumber || "-")}</strong></div><div><span>Reference</span><strong>${escapeHtml(request.referenceNumber || "-")}</strong></div>`;
      return `<article class="portal-card withdrawal-history-item" data-exit-request-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.accountCode)} · Exit ${request.exit}</span><h2>${escapeHtml(request.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Username</span><strong>@${escapeHtml(request.username)}</strong></div><div><span>Action</span><strong>${escapeHtml(request.actionLabel)}</strong></div><div><span>Amount</span><strong>${escapeHtml(exitActionAmountLabel(request))}</strong></div>${details}<div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div><div class="balance-card-buttons" style="margin-top:1rem"><button class="button button-primary button-small approve-exit" type="button">Approve Exit</button><button class="button button-outline button-small reject-exit" type="button">Reject</button></div></article>`;
    }).join("");
    bindCopyButtons(exitList);
    exitList.querySelectorAll("[data-exit-request-id]").forEach(card => {
      card.querySelector(".approve-exit").addEventListener("click", async () => act("admin_approve_exit", { p_request_id: card.dataset.exitRequestId }));
      card.querySelector(".reject-exit").addEventListener("click", async () => act("admin_reject_exit", { p_request_id: card.dataset.exitRequestId }));
    });
  }
  async function loadTimeline() {
    const { data: requests, error } = await window.matrixSupabase.rpc("admin_get_timeline_requests");
    if (error) return show(alertBox, error.message, "danger");
    const pending = (requests || []).filter(request => request.status === "pending");
    updateCount("timeline", pending.length);
    if (!pending.length) { timelineList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending Timeline requests</strong><p>Approved members enter the automatic left-to-right timeline queue.</p></div>`; return; }
    timelineList.innerHTML = pending.map(request => {
      const payment = request.paymentMethod === "available_balance"
        ? `<div><span>Payment</span><strong>Available Balance</strong></div>`
        : `<div><span>GCash account</span><strong>${escapeHtml(request.gcashName)} &middot; ${escapeHtml(request.gcashNumber)}</strong></div><div><span>Reference</span><strong>${escapeHtml(request.referenceNumber)}</strong></div>`;
      return `<article class="portal-card withdrawal-history-item" data-timeline-request-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.accountCode)} &middot; Timeline Matrix</span><h2>${escapeHtml(request.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Username</span><strong>@${escapeHtml(request.username)}</strong></div><div><span>Activation</span><strong>${money(request.amount)}</strong></div>${payment}<div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div><div class="balance-card-buttons" style="margin-top:1rem"><button class="button button-primary button-small approve-timeline" type="button">Approve &amp; Place</button><button class="button button-outline button-small reject-timeline" type="button">Reject</button></div></article>`;
    }).join("");
    timelineList.querySelectorAll("[data-timeline-request-id]").forEach(card => {
      const request = pending.find(item => item.id === card.dataset.timelineRequestId);
      card.querySelector(".approve-timeline").addEventListener("click", () => openTimelineDecision(request, "approve"));
      card.querySelector(".reject-timeline").addEventListener("click", () => openTimelineDecision(request, "reject"));
    });
  }
  async function loadWithdrawals() {
    const { data: requests, error } = await window.matrixSupabase.rpc("admin_get_withdrawals");
    if (error) return show(alertBox, error.message, "danger");
    const pending = requests.filter(request => request.status === "pending");
    updateCount("withdrawals", pending.length);
    if (!pending.length) { withdrawalList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending withdrawals</strong><p>Member withdrawal requests will appear here.</p></div>`; return; }
    withdrawalList.innerHTML = pending.map(request => `<article class="portal-card withdrawal-history-item" data-withdrawal-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.withdrawalCode)}</span><h2>PHP ${Number(request.amount).toLocaleString()}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Member</span><strong>${escapeHtml(request.fullName)} (${escapeHtml(request.accountCode)})</strong></div><div><span>GCash account</span><strong>${escapeHtml(request.accountName)}</strong></div><div><span>GCash number</span><strong>${escapeHtml(request.gcashNumber)}</strong></div><div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div>${request.payoutDetails ? `<p class="withdrawal-history-note"><strong>Note:</strong> ${escapeHtml(request.payoutDetails)}</p>` : ""}<div class="balance-card-buttons"><button class="button button-primary button-small approve-withdrawal" type="button">Approve Withdrawal</button><button class="button button-outline button-small reject-withdrawal" type="button">Reject</button></div></article>`).join("");
    withdrawalList.querySelectorAll("[data-withdrawal-id]").forEach(card => {
      const request = pending.find(item => item.id === card.dataset.withdrawalId);
      const numberCell = card.querySelectorAll(".withdrawal-history-details > div")[2];
      numberCell.innerHTML = `<span>GCash number</span>${copyField(request.gcashNumber)}`;
    });
    bindCopyButtons(withdrawalList);
    withdrawalList.querySelectorAll("[data-withdrawal-id]").forEach(card => {
      card.querySelector(".approve-withdrawal").addEventListener("click", async () => act("admin_approve_withdrawal", { p_request_id: card.dataset.withdrawalId }));
      card.querySelector(".reject-withdrawal").addEventListener("click", async () => act("admin_reject_withdrawal", { p_request_id: card.dataset.withdrawalId }));
    });
  }
  async function loadProducts() {
    const { data: claims, error } = await window.matrixSupabase.rpc("admin_get_product_plus_claims");
    if (error) return show(alertBox, error.message, "danger");
    updateCount("products", claims.length);
    if (!claims.length) { productsList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending Products Plus claims</strong><p>Member purchase claims will appear here.</p></div>`; return; }
    productsList.innerHTML = claims.map(claim => `<article class="portal-card withdrawal-history-item" data-product-claim-id="${escapeHtml(claim.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(claim.accountCode)} &middot; Exit ${Number(claim.exit)}</span><h2>${escapeHtml(claim.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Purchase amount</span><strong>${money(claim.spendAmount)}</strong></div><div><span>Voucher if approved</span><strong>${money(claim.bonusAmount)} (${Number(claim.bonusPercent)}%)</strong></div><div><span>Purchase reference</span><strong>${escapeHtml(claim.purchaseReference)}</strong></div><div><span>Requested</span><strong>${new Date(claim.createdAt).toLocaleString()}</strong></div></div>${claim.purchaseNotes ? `<p class="withdrawal-history-note"><strong>Notes:</strong> ${escapeHtml(claim.purchaseNotes)}</p>` : ""}<div class="balance-card-buttons"><button class="button button-primary button-small approve-product" type="button">Approve &amp; Issue Voucher</button><button class="button button-outline button-small reject-product" type="button">Reject</button></div></article>`).join("");
    productsList.querySelectorAll("[data-product-claim-id]").forEach(card => {
      card.querySelector(".approve-product").addEventListener("click", async () => act("admin_approve_product_plus_claim", { p_claim_id: card.dataset.productClaimId }));
      card.querySelector(".reject-product").addEventListener("click", async () => act("admin_reject_product_plus_claim", { p_claim_id: card.dataset.productClaimId }));
    });
  }
  async function loadCommerceOrders() {
    const { data: orders, error } = await window.matrixSupabase.rpc("admin_get_commerce_orders");
    if (error) return show(alertBox, error.message, "danger");
    const openOrders = (orders || []).filter(order => !["received", "rejected", "cancelled"].includes(order.status));
    updateCount("orders", openOrders.filter(order => order.status === "pending_shipping_fee").length);
    if (!openOrders.length) {
      commerceOrderList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No open order requests</strong><p>Member package orders will appear here.</p></div>`;
      return;
    }
    commerceOrderList.innerHTML = openOrders.map(order => {
      const address = order.shippingAddressSnapshot || {};
      const packageSnapshot = order.packageSnapshot || {};
      const items = packageSnapshot.items || [];
      return `<article class="portal-card withdrawal-history-item"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(order.orderCode)} &middot; ${escapeHtml(order.packageTypeLabel)}</span><h2>${escapeHtml(packageSnapshot.packageName || "Package order")}</h2></div><span class="withdrawal-status ${commerceOrderStatusClass(order.status)}">${escapeHtml(commerceOrderStatusLabel(order.status))}</span></div><div class="withdrawal-history-details"><div><span>Member</span><strong>${escapeHtml(order.fullName)} (@${escapeHtml(order.username)})</strong></div><div><span>Package total</span><strong>${money(order.packageTotal)}</strong></div><div><span>Voucher use</span><strong>${money(order.voucherAmount || 0)}</strong></div><div><span>Requested</span><strong>${new Date(order.createdAt).toLocaleString()}</strong></div></div><p class="withdrawal-history-note"><strong>Ship to:</strong> ${escapeHtml(address.fullName || "-")} &middot; ${escapeHtml(address.phone || "-")} &middot; ${escapeHtml(address.streetAddress || "-")}, ${escapeHtml(address.barangay || "-")}, ${escapeHtml(address.city || "-")}, ${escapeHtml(address.province || "-")}, ${escapeHtml(address.region || "-")} ${escapeHtml(address.postalCode || "")}</p>${order.memberNotes ? `<p class="withdrawal-history-note"><strong>Member note:</strong> ${escapeHtml(order.memberNotes)}</p>` : ""}<div class="commerce-admin-order-items">${items.map(item => `<span>${escapeHtml(item.itemName)} (${money(item.price)})</span>`).join("")}</div></article>`;
    }).join("");
  }
  async function loadFinances() {
    financeSummary.innerHTML = `<div class="portal-card withdrawal-empty"><p>Calculating finances...</p></div>`;
    const { data, error } = await window.matrixSupabase.rpc("owner_get_finance_summary");
    if (error) { financeSummary.innerHTML = ""; return show(alertBox, error.message, "danger"); }
    const groups = [
      ["Cash overview", [["Gross external inflows", data.cash.grossExternalInflows], ["Approved cash withdrawals", data.cash.approvedCashWithdrawals], ["Cash before other expenses", Number(data.cash.grossExternalInflows)-Number(data.cash.approvedCashWithdrawals)]]],
      ["Entry", [["Approved Entries", data.entry.approvedCount, "count"], ["Entry cash received", data.entry.cashReceived], ["Pending Entry payments", data.entry.pendingAmount], ["Held-token allocation", data.entry.tokenHoldingAllocation], ["Matrix allocation", data.entry.matrixAllocation], ["Cash-exit entitlement (PHP 231 × 3 per Entry)", data.entry.cashExitEntitlement]]],
      ["Exit payments", [["Approved Exits", data.exits.approvedCount, "count"], ["External Exit payments", data.exits.externalPayments], ["Balance reinvestments", data.exits.balanceReinvestments], ["Pending external payments", data.exits.pendingExternalPayments]]],
      ["Member reward obligations", [["Total scheduled", data.rewards.totalScheduled], ["Entry rewards", data.rewards.entryScheduled], ["Exit passive rewards", data.rewards.exitPassiveScheduled], ["Matrix rewards", data.rewards.matrixScheduled], ["Settled or reinvested", data.rewards.settledOrReinvested], ["Outstanding and due", data.rewards.outstandingDue], ["Outstanding future", data.rewards.outstandingFuture]]],
      ["Products Plus", [["Configured product allocation", data.productsPlus.configuredProductAllocation], ["Maximum configured voucher bonus", data.productsPlus.configuredMaximumVoucherBonus], ["Approved product purchases", data.productsPlus.approvedPurchaseAmount], ["Pending product purchases", data.productsPlus.pendingPurchaseAmount], ["Voucher allocated", data.productsPlus.voucherAllocated], ["Voucher redeemed", data.productsPlus.voucherRedeemed], ["Voucher outstanding", data.productsPlus.voucherOutstanding]]],
      ["Withdrawals", [["Approved / paid", data.withdrawals.approvedPaid], ["Pending", data.withdrawals.pending], ["Rejected", data.withdrawals.rejected]]]
    ];
    financeSummary.innerHTML = groups.map(([title, rows]) => `<article class="portal-card withdrawal-history-item"><div class="withdrawal-history-topline"><h2>${title}</h2></div><div class="withdrawal-history-details">${rows.map(([label,value,type]) => `<div><span>${label}</span><strong>${type === "count" ? Number(value).toLocaleString() : money(value)}</strong></div>`).join("")}</div></article>`).join("") + `<p class="withdrawal-history-note">Generated ${new Date(data.generatedAt).toLocaleString()}. Operational tracking only; product costs, taxes, refunds, GCash fees, and other business expenses are not yet recorded.</p>`;
  }
  async function act(name, args) { const { error } = await window.matrixSupabase.rpc(name, args); if (error) return show(alertBox, error.message, "danger"); show(alertBox, "Request updated successfully.", "success"); await loadAll(); }
  function updateCount(name, count) {
    const badge = document.getElementById(`production-count-${name}`);
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle("has-requests", count > 0);
    }
    pendingCounts[name] = Number(count || 0);
    const total = Object.values(pendingCounts).reduce((sum, value) => sum + value, 0);
    statPendingRequests.textContent = total.toLocaleString();
    pendingBadge.textContent = total;
    pendingBadge.style.display = total > 0 ? "inline-flex" : "none";
  }
  function memberStatusClass(status) { return status === "active" ? "status-approved" : status === "suspended" ? "status-rejected" : "status-pending"; }
  function formatDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function shorten(value) { const text = String(value || ""); return text.length > 14 ? `${text.slice(0, 7)}...${text.slice(-4)}` : text || "-"; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1); }
  function commerceOrderStatusLabel(status) {
    return ({ pending_shipping_fee: "Pending Fee", approved_for_payment: "Approved", payment_submitted: "Payment Sent", payment_approved: "Payment Approved", shipped: "Shipped", received: "Received", rejected: "Rejected", cancelled: "Cancelled" })[status] || capitalize(status || "pending");
  }
  function commerceOrderStatusClass(status) {
    if (["received", "shipped", "payment_approved"].includes(status)) return "status-approved";
    if (["rejected", "cancelled"].includes(status)) return "status-rejected";
    return "status-pending";
  }
  function openTimelineDecision(request, action) {
    timelineDecision = { requestId: request.id, rpc: action === "approve" ? "admin_approve_timeline_request" : "admin_reject_timeline_request" };
    document.getElementById("timeline-decision-title").textContent = `${action === "approve" ? "Approve" : "Reject"} Timeline Request`;
    document.getElementById("timeline-decision-summary").textContent = `${request.fullName} | ${money(request.amount)} | ${request.paymentMethod === "available_balance" ? "Available Balance" : request.referenceNumber}`;
    document.getElementById("timeline-decision-note").value = "";
    document.getElementById("timeline-decision-submit").textContent = action === "approve" ? "Approve & Place" : "Reject Request";
    timelineDecisionAlert.style.display = "none";
    timelineDecisionModal.style.display = "flex";
    document.getElementById("timeline-decision-note").focus();
  }
  function closeTimelineDecision() { timelineDecisionModal.style.display = "none"; timelineDecision = null; }
  function closeVoucherModal() { voucherModal.style.display="none"; voucherMemberId=null; }
  function getMemberPlacements(member) {
    const placements = [];
    if (member.mainPosition) placements.push({ planId: "power3-passive", label: "PHP 1,200 Matrix" });
    if (member.timelinePosition) placements.push({ planId: "timeline-power3", label: "PHP 693 Timeline" });
    return placements;
  }
  function exitActionAmountLabel(request) {
    return `PHP ${Number(request.actionAmount || 0).toLocaleString()}`;
  }
  function closeMemberActionMenus(exceptMenu = null) {
    document.querySelectorAll(".member-actions-dropdown").forEach(menu => {
      if (menu === exceptMenu) return;
      menu.hidden = true;
    });
    document.querySelectorAll(".member-actions-toggle").forEach(toggle => {
      if (exceptMenu && toggle.nextElementSibling === exceptMenu) return;
      toggle.setAttribute("aria-expanded", "false");
    });
  }
  function copyField(value) { const clean = String(value || "").trim(); return `<span class="admin-copy-field"><code title="${escapeHtml(clean)}">${escapeHtml(clean || "-")}</code><button class="copy-admin-value" type="button" data-copy-value="${escapeHtml(clean)}" aria-label="Copy ${escapeHtml(clean || "value")}" title="Copy to clipboard" ${clean ? "" : "disabled"}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5.5 1.5h6A1.5 1.5 0 0 1 13 3v8.5h-1.5V3h-6V1.5Zm-2 3h6A1.5 1.5 0 0 1 11 6v7A1.5 1.5 0 0 1 9.5 14.5h-6A1.5 1.5 0 0 1 2 13V6a1.5 1.5 0 0 1 1.5-1.5Zm0 1.5v7h6V6h-6Z"/></svg><span class="copy-feedback" aria-live="polite"></span></button></span>`; }
  function bindCopyButtons(container) { container.querySelectorAll(".copy-admin-value").forEach(button => button.addEventListener("click", async () => { try { await navigator.clipboard.writeText(button.dataset.copyValue || ""); const feedback = button.querySelector(".copy-feedback"); feedback.textContent = "Copied"; button.classList.add("copied"); window.setTimeout(() => { feedback.textContent = ""; button.classList.remove("copied"); }, 1200); } catch (error) { show(alertBox, "Unable to copy automatically. Select and copy the value manually.", "danger"); } })); }
  function show(element, message, type) { element.className = `alert alert-${type}`; element.textContent = message; element.style.display = "block"; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
});
