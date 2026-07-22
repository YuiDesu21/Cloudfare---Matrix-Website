document.addEventListener("DOMContentLoaded", async () => {
  const loginSection = document.getElementById("admin-login");
  const content = document.getElementById("admin-content");
  const loginAlert = document.getElementById("admin-login-alert");
  const alertBox = document.getElementById("admin-alert");
  const list = document.getElementById("admin-entry-list");
  const exitList = document.getElementById("admin-exit-list");
  const withdrawalList = document.getElementById("admin-withdrawal-list");
  const productsList = document.getElementById("admin-products-list");
  const memberList = document.getElementById("admin-member-list");
  const memberSummary = document.getElementById("admin-member-summary");
  const memberPagination = document.getElementById("admin-member-pagination");
  const memberSearch = document.getElementById("admin-member-search");
  const memberStatus = document.getElementById("admin-member-status");
  const signout = document.getElementById("admin-signout");
  const ownerTabs = document.getElementById("owner-tabs");
  const financeSummary = document.getElementById("finance-summary");
  const financeSection = document.getElementById("owner-finances");
  const operationsSection = document.getElementById("admin-operations");
  const voucherModal = document.getElementById("voucher-redemption-modal");
  const voucherForm = document.getElementById("voucher-redemption-form");
  const voucherAlert = document.getElementById("voucher-redemption-alert");
  let voucherMemberId = null;
  let memberPage = 1;
  let currentUserId = null;
  let ownerMode = false;
  let memberRoles = new Map();
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
  document.getElementById("voucher-redemption-close").addEventListener("click", closeVoucherModal);
  voucherModal.addEventListener("click", event => { if (event.target === voucherModal) closeVoucherModal(); });
  voucherForm.addEventListener("submit", async event => {
    event.preventDefault(); voucherAlert.style.display = "none";
    const submit = document.getElementById("voucher-redemption-submit"); submit.disabled = true;
    const { data, error } = await window.matrixSupabase.rpc("admin_redeem_voucher", { p_member_id: voucherMemberId, p_amount: Number(document.getElementById("voucher-redemption-amount").value), p_reference: document.getElementById("voucher-redemption-reference").value.trim(), p_notes: document.getElementById("voucher-redemption-notes").value.trim() });
    submit.disabled = false;
    if (error) { voucherAlert.className="alert alert-danger"; voucherAlert.textContent=error.message; voucherAlert.style.display="block"; return; }
    closeVoucherModal(); show(alertBox, `Voucher redemption recorded. Remaining balance: ${money(data.balance)}.`, "success");
  });
  ownerTabs.querySelectorAll("[data-owner-view]").forEach(button => button.addEventListener("click", async () => {
    const finances = button.dataset.ownerView === "finances";
    ownerTabs.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
    operationsSection.hidden = finances; financeSection.hidden = !finances;
    if (finances) await loadFinances();
  }));
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
    ownerTabs.hidden = !ownerMode;
    memberRoles = new Map((roles || []).map(item => [item.memberId, item]));
    loginSection.style.display = "none"; content.style.display = "block"; signout.hidden = false; await loadAll();
  }
  async function loadAll() { await Promise.all([loadMembers(), loadEntry(), loadExits(), loadWithdrawals(), loadProducts()]); }
  async function loadMembers() {
    memberList.innerHTML = `<div class="portal-card withdrawal-empty"><p>Loading member directory...</p></div>`;
    const { data, error } = await window.matrixSupabase.rpc("admin_get_members", {
      p_search: memberSearch.value.trim(), p_status: memberStatus.value,
      p_page: memberPage, p_page_size: 10
    });
    if (error) {
      memberList.innerHTML = "";
      return show(alertBox, error.message, "danger");
    }
    const members = data.members || [];
    memberSummary.textContent = `${Number(data.total).toLocaleString()} member${Number(data.total) === 1 ? "" : "s"} found`;
    if (!members.length) {
      memberList.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No matching members</strong><p>Try a different search or account status.</p></div>`;
    } else {
      memberList.innerHTML = members.map(member => { const access = memberRoles.get(member.id) || { role: "member", isOwner: false }; const control = !ownerMode || member.id === currentUserId ? "" : access.role === "admin" ? `<button class="button button-outline button-small remove-admin" type="button">Remove Admin</button>` : `<button class="button button-primary button-small invite-admin" type="button">Invite as Admin</button>`; const redeem = member.id === currentUserId ? "" : `<button class="button button-outline button-small redeem-voucher" type="button">Record Voucher Redemption</button>`; return `<article class="portal-card withdrawal-history-item admin-member-card" data-member-id="${escapeHtml(member.id)}" data-member-name="${escapeHtml(member.fullName)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(member.accountCode)}</span><h2>${escapeHtml(member.fullName)}</h2><p class="admin-member-contact">@${escapeHtml(member.username)} &middot; ${escapeHtml(member.email)}${member.phone ? ` &middot; ${escapeHtml(member.phone)}` : ""}</p></div><span class="withdrawal-status ${memberStatusClass(member.status)}">${access.isOwner ? "Owner" : access.role === "admin" ? "Admin" : escapeHtml(member.status)}</span></div><div class="withdrawal-history-details"><div><span>Sponsor</span><strong>${member.sponsorName ? `${escapeHtml(member.sponsorName)} (${escapeHtml(member.sponsorCode)})` : "Matrix root"}</strong></div><div><span>Direct Tree Children</span><strong>${Number(member.directChildrenCount).toLocaleString()}</strong></div><div><span>Sponsor Referrals</span><strong>${Number(member.referralCount).toLocaleString()}</strong></div><div><span>Progress</span><strong>${member.currentExit > 0 ? `Exit ${Number(member.currentExit)}` : member.status === "active" ? "Entry" : "Not entered"}</strong></div><div><span>${member.approvedAt ? "Approved" : "Joined"}</span><strong>${formatDate(member.approvedAt || member.createdAt)}</strong></div></div>${control || redeem ? `<div class="balance-card-buttons">${control}${redeem}</div>` : ""}</article>`; }).join("");
      memberList.querySelectorAll("[data-member-id]").forEach(card => {
        const invite = card.querySelector(".invite-admin");
        const remove = card.querySelector(".remove-admin");
        if (invite) invite.addEventListener("click", async () => {
          const { data, error } = await window.matrixSupabase.rpc("owner_invite_admin", { p_member_id: card.dataset.memberId });
          if (error) return show(alertBox, error.message, "danger");
          const link = `${window.location.origin}/portal.html?admin_invite=${encodeURIComponent(data.token)}`;
          try { await navigator.clipboard.writeText(link); show(alertBox, `Invitation link copied. It expires ${new Date(data.expiresAt).toLocaleString()}.`, "success"); }
          catch (_) { window.prompt("Copy this administrator invitation link:", link); }
        });
        if (remove) remove.addEventListener("click", async () => { if (!window.confirm("Remove administrator access for this member?")) return; await act("owner_remove_admin", { p_member_id: card.dataset.memberId }); });
        const redeem = card.querySelector(".redeem-voucher");
        if (redeem) redeem.addEventListener("click", () => { voucherMemberId=card.dataset.memberId; voucherForm.reset(); voucherAlert.style.display="none"; document.getElementById("voucher-redemption-member").textContent=`Member: ${card.dataset.memberName}`; voucherModal.style.display="flex"; document.getElementById("voucher-redemption-amount").focus(); });
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
  async function loadEntry() {
    const [{ data: requests, error }, { data: parents, error: parentError }] = await Promise.all([
      window.matrixSupabase.rpc("admin_get_entry_requests"), window.matrixSupabase.rpc("admin_get_eligible_parents")
    ]);
    if (error || parentError) return show(alertBox, (error || parentError).message, "danger");
    const pending = requests.filter(request => request.status === "pending");
    updateCount("entry", pending.length);
    if (!pending.length) { list.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No pending Entry requests</strong><p>New requests will appear here.</p></div>`; return; }
    list.innerHTML = pending.map(request => `<article class="portal-card withdrawal-history-item" data-request-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.accountCode)}</span><h2>${escapeHtml(request.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Username</span><strong>@${escapeHtml(request.username)}</strong></div><div><span>Reference</span><strong>${escapeHtml(request.referenceNumber)}</strong></div><div><span>Amount</span><strong>PHP ${Number(request.amount).toLocaleString()}</strong></div><div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div><div class="form-group" style="margin-top:1rem"><label>Matrix parent</label>${request.sponsorId ? `<div class="form-control">${escapeHtml(request.sponsorName)} (${escapeHtml(request.sponsorCode)})</div>` : `<select class="form-control parent-select"><option value="">Select parent</option>${parents.map(parent => `<option value="${escapeHtml(parent.memberId)}">${escapeHtml(parent.fullName)} — ${parent.slotsLeft} slot(s)</option>`).join("")}</select>`}</div><div class="balance-card-buttons"><button class="button button-primary button-small approve-entry" type="button">Approve &amp; Place</button><button class="button button-outline button-small reject-entry" type="button">Reject</button></div></article>`).join("");
    list.querySelectorAll("[data-request-id]").forEach(card => card.querySelector(".withdrawal-history-details").insertAdjacentHTML("beforeend", `<div><span>F3 Wallet</span>${copyField(requests.find(item => item.id === card.dataset.requestId).walletAddress)}</div>`));
    bindCopyButtons(list);
    list.querySelectorAll("[data-request-id]").forEach(card => {
      card.querySelector(".approve-entry").addEventListener("click", async () => { const parent = card.querySelector(".parent-select"); if (parent && !parent.value) return show(alertBox, "Select a matrix parent first.", "danger"); await act("admin_approve_entry", { p_request_id: card.dataset.requestId, p_parent_member_id: parent ? parent.value : null }); });
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
      return `<article class="portal-card withdrawal-history-item" data-exit-request-id="${escapeHtml(request.id)}"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(request.accountCode)} · Exit ${request.exit}</span><h2>${escapeHtml(request.fullName)}</h2></div><span class="withdrawal-status status-pending">Pending</span></div><div class="withdrawal-history-details"><div><span>Username</span><strong>@${escapeHtml(request.username)}</strong></div><div><span>Action</span><strong>${escapeHtml(request.actionLabel)}</strong></div><div><span>Amount</span><strong>PHP ${Number(request.actionAmount).toLocaleString()}</strong></div>${details}<div><span>Requested</span><strong>${new Date(request.createdAt).toLocaleString()}</strong></div></div><div class="balance-card-buttons" style="margin-top:1rem"><button class="button button-primary button-small approve-exit" type="button">Approve Exit</button><button class="button button-outline button-small reject-exit" type="button">Reject</button></div></article>`;
    }).join("");
    bindCopyButtons(exitList);
    exitList.querySelectorAll("[data-exit-request-id]").forEach(card => {
      card.querySelector(".approve-exit").addEventListener("click", async () => act("admin_approve_exit", { p_request_id: card.dataset.exitRequestId }));
      card.querySelector(".reject-exit").addEventListener("click", async () => act("admin_reject_exit", { p_request_id: card.dataset.exitRequestId }));
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
  function updateCount(name, count) { const badge = document.getElementById(`production-count-${name}`); if (!badge) return; badge.textContent = count; badge.classList.toggle("has-requests", count > 0); }
  function memberStatusClass(status) { return status === "active" ? "status-approved" : status === "suspended" ? "status-rejected" : "status-pending"; }
  function formatDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function closeVoucherModal() { voucherModal.style.display="none"; voucherMemberId=null; }
  function copyField(value) { const clean = String(value || "").trim(); return `<span class="admin-copy-field"><code title="${escapeHtml(clean)}">${escapeHtml(clean || "-")}</code><button class="copy-admin-value" type="button" data-copy-value="${escapeHtml(clean)}" aria-label="Copy ${escapeHtml(clean || "value")}" title="Copy to clipboard" ${clean ? "" : "disabled"}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5.5 1.5h6A1.5 1.5 0 0 1 13 3v8.5h-1.5V3h-6V1.5Zm-2 3h6A1.5 1.5 0 0 1 11 6v7A1.5 1.5 0 0 1 9.5 14.5h-6A1.5 1.5 0 0 1 2 13V6a1.5 1.5 0 0 1 1.5-1.5Zm0 1.5v7h6V6h-6Z"/></svg><span class="copy-feedback" aria-live="polite"></span></button></span>`; }
  function bindCopyButtons(container) { container.querySelectorAll(".copy-admin-value").forEach(button => button.addEventListener("click", async () => { try { await navigator.clipboard.writeText(button.dataset.copyValue || ""); const feedback = button.querySelector(".copy-feedback"); feedback.textContent = "Copied"; button.classList.add("copied"); window.setTimeout(() => { feedback.textContent = ""; button.classList.remove("copied"); }, 1200); } catch (error) { show(alertBox, "Unable to copy automatically. Select and copy the value manually.", "danger"); } })); }
  function show(element, message, type) { element.className = `alert alert-${type}`; element.textContent = message; element.style.display = "block"; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
});
