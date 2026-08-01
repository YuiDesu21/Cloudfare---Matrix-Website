/**
 * Admin Panel Controller
 * Handles administrative tabs, password modification, JSON export/import, approval placements, and full tree structure mapping.
 */

document.addEventListener("DOMContentLoaded", () => {
  // DB check
  if (window.MatrixDB) {
    window.MatrixDB.initializeDatabase();
  } else {
    console.error("Database layer (matrix-db.js) failed to load.");
    return;
  }

  // Session keys
  const ADMIN_SESSION_KEY = "matrix_admin_logged_in";

  // Elements
  const adminAuthSection = document.getElementById("admin-auth-section");
  const adminLoginForm = document.getElementById("admin-login-form");
  const adminPasswordInput = document.getElementById("admin-password");
  const adminOperatorNameInput = document.getElementById("admin-operator-name");
  const adminLoginAlert = document.getElementById("admin-login-alert");

  const adminDashboardSection = document.getElementById("admin-dashboard-section");
  const adminUserStatus = document.getElementById("admin-user-status");
  const logoutBtnAdmin = document.getElementById("logout-btn-admin");

  // Tab navigation
  const tabButtons = document.querySelectorAll(".tab-btn");
  const adminSections = document.querySelectorAll(".admin-section");
  const badgePendingCount = document.getElementById("badge-pending-count");
  const approvalTabButtons = document.querySelectorAll("[data-approval-tab]");
  const approvalPanels = document.querySelectorAll("[data-approval-panel]");

  // Metrics
  const statActiveMembers = document.getElementById("stat-active-members");
  const statPendingRequests = document.getElementById("stat-pending-requests");
  const statRevenue = document.getElementById("stat-revenue");

  const btnRefreshOperations = document.getElementById("btn-refresh-operations");
  const btnExportOperations = document.getElementById("btn-export-operations");
  const operationsExceptionsTableBody = document.getElementById("operations-exceptions-table-body");
  const opsAvailableRewards = document.getElementById("ops-available-rewards");
  const opsScheduledRewards = document.getElementById("ops-scheduled-rewards");
  const opsApprovedPayouts = document.getElementById("ops-approved-payouts");
  const opsPendingPayouts = document.getElementById("ops-pending-payouts");
  const opsActivationVolume = document.getElementById("ops-activation-volume");
  const opsRecordedDecisions = document.getElementById("ops-recorded-decisions");
  const opsAuditEntries = document.getElementById("ops-audit-entries");
  const opsAuditIntegrity = document.getElementById("ops-audit-integrity");
  const opsExceptionCount = document.getElementById("ops-exception-count");
  const opsReportGenerated = document.getElementById("ops-report-generated");
  let operationsReport = null;

  // System Controls
  const btnSeed = document.getElementById("btn-seed");
  const btnReset = document.getElementById("btn-reset");
  const btnExport = document.getElementById("btn-export");
  const importFile = document.getElementById("import-file");
  const changePassForm = document.getElementById("change-pass-form");
  const newPasswordInput = document.getElementById("new-password");
  const utilityAlert = document.getElementById("utility-alert");
  const systemLogsContainer = document.getElementById("system-logs-container");

  // Tables & directory
  const pendingTableBody = document.getElementById("pending-table-body");
  const exitActionsTableBody = document.getElementById("exit-actions-table-body");
  const withdrawalsTableBody = document.getElementById("withdrawals-table-body");
  const productClaimsTableBody = document.getElementById("product-claims-table-body");
  const upgradeRequestsTableBody = document.getElementById("upgrade-requests-table-body");
  const timelineRequestsTableBody = document.getElementById("timeline-requests-table-body");
  const identityReviewsTableBody = document.getElementById("identity-reviews-table-body");
  const approvalHistoryTableBody = document.getElementById("approval-history-table-body");
  const pendingAlert = document.getElementById("pending-alert");
  const membersTableBody = document.getElementById("members-table-body");
  const memberSearchInput = document.getElementById("member-search");
  const directoryAlert = document.getElementById("directory-alert");

  // Matrix Viewer
  const viewerPlanSelect = document.getElementById("viewer-plan-select");
  const treeMemberSearchInput = document.getElementById("tree-member-search");
  const globalTreeVisualizer = document.getElementById("global-tree-visualizer");
  const matrixExitFilter = document.getElementById("matrix-exit-filter");
  const matrixStatusFilter = document.getElementById("matrix-status-filter");
  const matrixExpandAll = document.getElementById("matrix-expand-all");
  const matrixCollapseAll = document.getElementById("matrix-collapse-all");
  const matrixExplorerCount = document.getElementById("matrix-explorer-count");
  const matrixExplorerBreadcrumbs = document.getElementById("matrix-explorer-breadcrumbs");
  const matrixMemberDetails = document.getElementById("matrix-member-details");
  let matrixExplorerNodes = [];
  let matrixExplorerExpanded = new Set();
  let matrixExplorerSelectedId = null;

  // Modals
  const placementModal = document.getElementById("placement-modal");
  const btnClosePlacementModal = document.getElementById("btn-close-placement-modal");
  const btnCancelPlacement = document.getElementById("btn-cancel-placement");
  const placementForm = document.getElementById("placement-form");
  const modalPendingId = document.getElementById("modal-pending-id");
  const modalApplicantName = document.getElementById("modal-applicant-name");
  const modalApplicantUsername = document.getElementById("modal-applicant-username");
  const modalApplicantSponsor = document.getElementById("modal-applicant-sponsor");
  const modalApplicantPlan = document.getElementById("modal-applicant-plan");
  const parentSelectionGroup = document.getElementById("parent-selection-group");
  const modalParentSelect = document.getElementById("modal-parent-select");
  const rootWarnAlert = document.getElementById("root-warn-alert");
  const modalAlert = document.getElementById("modal-alert");
  const modeParentRadio = document.getElementById("mode-parent");
  const modeRootRadio = document.getElementById("mode-root");
  const modalDecisionNote = document.getElementById("modal-decision-note");

  const decisionModal = document.getElementById("decision-modal");
  const decisionForm = document.getElementById("decision-form");
  const decisionNote = document.getElementById("decision-note");
  const decisionModalTitle = document.getElementById("decision-modal-title");
  const decisionModalContext = document.getElementById("decision-modal-context");
  const decisionModalAlert = document.getElementById("decision-modal-alert");
  const btnCloseDecisionModal = document.getElementById("btn-close-decision-modal");
  const btnCancelDecision = document.getElementById("btn-cancel-decision");
  const btnConfirmDecision = document.getElementById("btn-confirm-decision");
  let pendingDecisionAction = null;

  const detailsModal = document.getElementById("details-modal");
  const btnCloseDetailsModal = document.getElementById("btn-close-details-modal");
  const btnCloseDetailsFooter = document.getElementById("btn-close-details-footer");
  const modalDetailsList = document.getElementById("modal-details-list");

  // Current session status check
  checkAdminSession();

  // Admin Authentication Actions
  adminLoginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    adminLoginAlert.style.display = "none";
    
    const inputPass = adminPasswordInput.value;
    try {
      MatrixDB.authenticateAdmin(inputPass, adminOperatorNameInput.value);
      sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
      enterDashboard();
    } catch (error) {
      adminLoginAlert.textContent = error.message;
      adminLoginAlert.className = "alert alert-danger";
      adminLoginAlert.style.display = "block";
    }
  });

  logoutBtnAdmin.addEventListener("click", logoutAdmin);

  // Tab controls event
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      adminSections.forEach(s => s.classList.remove("active"));

      btn.classList.add("active");
      const target = btn.getAttribute("data-target");
      document.getElementById(target).classList.add("active");

      // Specific tab loads
      if (target === "tab-visualizer") renderGlobalTree();
      if (target === "tab-operations") renderOperationsReport();
    });
  });

  approvalTabButtons.forEach(button => {
    button.addEventListener("click", () => {
      const selected = button.dataset.approvalTab;
      approvalTabButtons.forEach(tab => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      approvalPanels.forEach(panel => {
        const active = panel.dataset.approvalPanel === selected;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    });
  });

  // Modal Closures
  btnClosePlacementModal.addEventListener("click", () => closeModal(placementModal));
  btnCancelPlacement.addEventListener("click", () => closeModal(placementModal));
  
  btnCloseDetailsModal.addEventListener("click", () => closeModal(detailsModal));
  btnCloseDetailsFooter.addEventListener("click", () => closeModal(detailsModal));
  btnCloseDecisionModal.addEventListener("click", () => closeModal(decisionModal));
  btnCancelDecision.addEventListener("click", () => closeModal(decisionModal));
  decisionForm.addEventListener("submit", submitDecision);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal(placementModal);
      closeModal(detailsModal);
      closeModal(decisionModal);
    }
  });

  // Database Sandbox Controls
  btnSeed.addEventListener("click", () => {
    if (confirm("Are you sure you want to seed mock data? This will overwrite your existing matrix tree configuration.")) {
      MatrixDB.seedSampleData();
      showUtilityMessage("Sample simulation data seeded successfully.", "alert-success");
      refreshAll();
    }
  });

  btnRefreshOperations.addEventListener("click", renderOperationsReport);
  btnExportOperations.addEventListener("click", exportOperationsCsv);

  btnReset.addEventListener("click", () => {
    if (confirm("CRITICAL WARNING: This will permanently delete ALL registrations, members, logs and reset settings. Continue?")) {
      MatrixDB.resetAllData();
      showUtilityMessage("All database records cleared.", "alert-danger");
      refreshAll();
    }
  });

  btnExport.addEventListener("click", () => {
    try {
      const dataStr = MatrixDB.exportData();
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `matrix-db-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showUtilityMessage("Database exported successfully.", "alert-success");
    } catch (err) {
      showUtilityMessage("Failed to export database: " + err.message, "alert-danger");
    }
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        MatrixDB.importData(evt.target.result);
        showUtilityMessage("Database imported successfully.", "alert-success");
        refreshAll();
      } catch (err) {
        showUtilityMessage(err.message, "alert-danger");
      }
      importFile.value = ""; // reset input
    };
    reader.readAsText(file);
  });

  changePassForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const newPass = newPasswordInput.value;
    if (!newPass) return;

    try {
      const settings = MatrixDB.getSettings();
      settings.adminPassword = newPass;
      MatrixDB.saveSettings(settings);
      logoutAdmin();
      adminLoginAlert.textContent = "Admin password updated. All control-panel sessions were signed out.";
      adminLoginAlert.className = "alert alert-success";
      adminLoginAlert.style.display = "block";
    } catch (err) {
      showUtilityMessage("Password update failed: " + err.message, "alert-danger");
    }
  });

  // Modal placement radio handlers
  modeParentRadio.addEventListener("change", togglePlacementRadioState);
  modeRootRadio.addEventListener("change", togglePlacementRadioState);

  // Search input events
  memberSearchInput.addEventListener("input", renderMembersDirectory);
  treeMemberSearchInput.addEventListener("input", renderMatrixExplorerRows);
  viewerPlanSelect.addEventListener("change", renderGlobalTree);
  matrixExitFilter.addEventListener("change", renderMatrixExplorerRows);
  matrixStatusFilter.addEventListener("change", renderMatrixExplorerRows);
  matrixExpandAll.addEventListener("click", () => {
    matrixExplorerNodes.filter(node => node.childIds.length > 0).forEach(node => matrixExplorerExpanded.add(node.id));
    renderMatrixExplorerRows();
  });
  matrixCollapseAll.addEventListener("click", () => {
    matrixExplorerExpanded.clear();
    matrixExplorerNodes.filter(node => node.depth === 0).forEach(node => matrixExplorerExpanded.add(node.id));
    renderMatrixExplorerRows();
  });

  // Modal Placement submission
  placementForm.addEventListener("submit", handlePlacementSubmission);

  // Setup Initial State & Functions
  function checkAdminSession() {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "true" && sessionStorage.getItem("matrix_admin_auth_token")) {
      try {
        MatrixDB.getSettings();
        enterDashboard();
      } catch (error) {
        logoutAdmin();
        adminLoginAlert.textContent = "Your admin session has expired. Please sign in again.";
        adminLoginAlert.className = "alert alert-danger";
        adminLoginAlert.style.display = "block";
      }
    } else {
      adminAuthSection.style.display = "block";
      adminDashboardSection.style.display = "none";
      adminUserStatus.style.display = "none";
    }
  }

  function enterDashboard() {
    adminAuthSection.style.display = "none";
    adminDashboardSection.style.display = "block";
    adminUserStatus.style.display = "flex";
    
    refreshAll();
  }

  function logoutAdmin() {
    try { MatrixDB.signOut(); } catch (error) { console.error(error); }
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem("matrix_admin_auth_token");
    adminPasswordInput.value = "";
    adminOperatorNameInput.value = "";
    adminAuthSection.style.display = "block";
    adminDashboardSection.style.display = "none";
    adminUserStatus.style.display = "none";
  }

  // Unified Refresh
  function refreshAll() {
    updateApprovalCounts();
    renderOverviewStats();
    renderOperationsReport();
    renderPendingQueue();
    renderUpgradeQueue();
    renderTimelineQueue();
    renderIdentityReviewQueue();
    renderApprovalHistory();
    renderExitActionQueue();
    renderWithdrawalQueue();
    renderProductClaimQueue();
    renderMembersDirectory();
    renderLogs();
    renderGlobalTree();
  }

  function updateApprovalCounts() {
    const counts = {
      registrations: MatrixDB.getPendingRegistrations().filter(item => item.status === "pending").length,
      entry: MatrixDB.getUpgradeRequests().filter(item => item.status === "pending").length,
      timeline: MatrixDB.getTimelineRequests ? MatrixDB.getTimelineRequests().filter(item => item.status === "pending").length : 0,
      exit: MatrixDB.getExitActionRequests().filter(item => item.status === "pending").length,
      withdrawals: MatrixDB.getWithdrawalRequests().filter(item => item.status === "pending").length,
      products: MatrixDB.getProductPlusClaims().filter(item => item.status === "pending").length,
      identity: MatrixDB.getIdentityReviews ? MatrixDB.getIdentityReviews().filter(item => item.status === "open").length : 0
    };
    Object.entries(counts).forEach(([name, count]) => {
      const badge = document.getElementById(`approval-count-${name}`);
      if (!badge) return;
      badge.textContent = count;
      badge.classList.toggle("has-requests", count > 0);
    });
  }

  function openDecisionModal({ title, context, confirmLabel, onConfirm }) {
    pendingDecisionAction = onConfirm;
    decisionModalTitle.textContent = title;
    decisionModalContext.textContent = context;
    btnConfirmDecision.textContent = confirmLabel;
    decisionNote.value = "";
    decisionModalAlert.style.display = "none";
    decisionModal.classList.add("active");
    decisionNote.focus();
  }

  function submitDecision(event) {
    event.preventDefault();
    const note = decisionNote.value.trim();
    if (note.length < 5) {
      decisionModalAlert.textContent = "Add a short verification or decision note before continuing.";
      decisionModalAlert.className = "alert alert-danger";
      decisionModalAlert.style.display = "block";
      return;
    }
    try {
      pendingDecisionAction(note);
      closeModal(decisionModal);
      refreshAll();
    } catch (error) {
      decisionModalAlert.textContent = error.message;
      decisionModalAlert.className = "alert alert-danger";
      decisionModalAlert.style.display = "block";
    }
  }

  function renderApprovalHistory() {
    if (!approvalHistoryTableBody || !MatrixDB.getApprovalDecisionHistory) return;
    const decisions = MatrixDB.getApprovalDecisionHistory();
    approvalHistoryTableBody.innerHTML = decisions.length ? "" : `<tr><td colspan="6" class="empty-state">No recorded approval decisions yet.</td></tr>`;
    decisions.forEach(item => {
      const decision = item.latestDecision || {};
      const statusLabel = item.status === "approved" ? "Approved" : item.status === "rejected" ? "Rejected" : item.status === "pending" ? "Reopened" : "Reversed";
      const workflow = item.workflow === "timeline" ? "Timeline" : item.workflow.charAt(0).toUpperCase() + item.workflow.slice(1);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><strong>${escapeHtml(workflow)}</strong>${item.exit ? `<br><small>Exit ${item.exit}</small>` : ""}</td>
        <td><strong>${escapeHtml(item.fullName)}</strong><br><small>${escapeHtml(item.accountCode)} · @${escapeHtml(item.username)}</small></td>
        <td><span class="badge ${item.status === "approved" ? "badge-active" : "badge-pending"}">${statusLabel}</span></td>
        <td><strong>${escapeHtml(decision.decidedBy || "Legacy record")}</strong><br><small>${escapeHtml(decision.note || "No decision note recorded")}</small></td>
        <td>${formatDate(decision.decidedAt || item.createdAt)}</td>
        <td><div class="actions"></div></td>`;
      const actions = row.querySelector(".actions");
      if (item.status === "rejected") {
        const button = document.createElement("button");
        button.className = "button btn-secondary";
        button.textContent = "Reopen";
        button.addEventListener("click", () => openDecisionModal({
          title: "Reopen Rejected Request",
          context: `${workflow} request for ${item.fullName} will return to the pending queue.`,
          confirmLabel: "Reopen Request",
          onConfirm: note => MatrixDB.reverseApprovalDecision(item.workflow, item.requestId, note)
        }));
        actions.appendChild(button);
      } else if (item.status === "approved") {
        const button = document.createElement("button");
        button.className = "button btn-danger";
        button.textContent = "Reverse Approval";
        button.addEventListener("click", () => openDecisionModal({
          title: "Reverse Approved Request",
          context: `${workflow} approval for ${item.fullName} will only reverse when no downstream, paid reward, or later Exit dependency exists.`,
          confirmLabel: "Reverse Approval",
          onConfirm: note => MatrixDB.reverseApprovalDecision(item.workflow, item.requestId, note)
        }));
        actions.appendChild(button);
      } else {
        actions.textContent = "Final record";
      }
      approvalHistoryTableBody.appendChild(row);
    });
  }

  function renderUpgradeQueue() {
    if (!upgradeRequestsTableBody) return;
    const requests = MatrixDB.getUpgradeRequests().filter(item => item.status === "pending");
    const eligible = MatrixDB.getEligibleParents("power3-passive");
    upgradeRequestsTableBody.innerHTML = requests.length ? "" : `<tr><td colspan="7" class="empty-state">No pending Entry activations.</td></tr>`;
    requests.forEach(request => {
      const row=document.createElement("tr");
      const options=eligible.map(parent=>`<option value="${parent.memberId}">${escapeHtml(parent.fullName)} (@${escapeHtml(parent.username)}) — ${parent.childrenCount}/${parent.maxChildren}</option>`).join("");
      const placement=request.fixedParentId
        ? `<div class="fixed-placement"><strong>${escapeHtml(request.fixedParentName)}</strong><br><small>${escapeHtml(request.fixedParentCode)} · Fixed by referral</small></div>`
        : `<select class="form-control upgrade-parent"><option value="">${eligible.length ? "Select parent" : "Place as root"}</option>${options}</select>`;
      row.innerHTML=`<td><strong>${escapeHtml(request.fullName)}</strong><br><small>${escapeHtml(request.accountCode)} · @${escapeHtml(request.username)}</small></td><td>PHP ${Number(request.amount).toLocaleString()}</td><td><strong style="color:var(--gold-soft)">${escapeHtml(request.referenceNumber)}</strong></td><td>${formatDate(request.createdAt)}</td><td>${placement}</td><td><div class="actions"><button class="button btn-success approve-upgrade">Verify & Activate</button><button class="button btn-danger reject-upgrade">Reject</button></div></td>`;
      const walletCell = document.createElement("td");
      walletCell.innerHTML = copyField(request.walletAddress);
      row.insertBefore(walletCell, row.children[2]);
      walletCell.querySelector(".copy-admin-value").addEventListener("click", event => copyAdminValue(event.currentTarget));
      row.querySelector(".approve-upgrade").addEventListener("click",()=>{try{const select=row.querySelector(".upgrade-parent");const parent=request.fixedParentId||(select?select.value:null);if(!request.fixedParentId&&eligible.length&&!parent)throw new Error("Select a placement parent.");openDecisionModal({title:"Approve Entry Activation",context:`Record the PHP 1,200 payment verification for ${request.fullName}.`,confirmLabel:"Verify & Activate",onConfirm:note=>MatrixDB.approveUpgrade(request.id,parent||null,note)})}catch(error){showPendingAlert(error.message,"danger")}});
      row.querySelector(".reject-upgrade").addEventListener("click",()=>openDecisionModal({title:"Reject Entry Activation",context:`Record why the Entry activation for ${request.fullName} is being rejected.`,confirmLabel:"Reject Request",onConfirm:note=>MatrixDB.rejectUpgrade(request.id,note)}));
      upgradeRequestsTableBody.appendChild(row);
    });
  }

  function renderTimelineQueue() {
    if (!timelineRequestsTableBody || !MatrixDB.getTimelineRequests) return;
    const requests = MatrixDB.getTimelineRequests().filter(item => item.status === "pending");
    timelineRequestsTableBody.innerHTML = requests.length ? "" : `<tr><td colspan="7" class="empty-state">No pending Timeline Matrix activations.</td></tr>`;
    requests.forEach(request => {
      const row = document.createElement("tr");
      const paymentDetails = request.paymentMethod === "available_balance"
        ? `<span style="color:var(--muted);font-size:.72rem">Reserve and deduct from available balance on approval.</span>`
        : `<div style="display:grid;gap:.25rem"><span><strong>GCash Name:</strong> ${escapeHtml(request.gcashName || "-")}</span><span><strong>GCash Number:</strong> ${copyField(request.gcashNumber)}</span><span><strong>Reference:</strong> ${copyField(request.referenceNumber)}</span></div>`;
      row.innerHTML = `
        <td><strong>${escapeHtml(request.fullName)}</strong><br><small>${escapeHtml(request.accountCode)} Â· @${escapeHtml(request.username)}</small></td>
        <td>PHP ${Number(request.amount || 0).toLocaleString()}</td>
        <td>${request.paymentMethod === "available_balance" ? "Available Balance" : "GCash"}</td>
        <td>${paymentDetails}</td>
        <td>${formatDate(request.createdAt)}</td>
        <td><span style="color:var(--muted);font-size:.72rem">Next open Timeline slot</span></td>
        <td><div class="actions"><button class="button btn-success approve-timeline">Approve</button><button class="button btn-danger reject-timeline">Reject</button></div></td>
      `;
      row.querySelectorAll(".copy-admin-value").forEach(button => button.addEventListener("click", event => copyAdminValue(event.currentTarget)));
      row.querySelector(".approve-timeline").addEventListener("click", () => openDecisionModal({title:"Approve Timeline Activation",context:`Record the PHP 693 payment or balance verification for ${request.fullName}.`,confirmLabel:"Approve Activation",onConfirm:note=>MatrixDB.approveTimelineActivation(request.id,note)}));
      row.querySelector(".reject-timeline").addEventListener("click", () => openDecisionModal({title:"Reject Timeline Activation",context:`Record why the Timeline request for ${request.fullName} is being rejected.`,confirmLabel:"Reject Request",onConfirm:note=>MatrixDB.rejectTimelineActivation(request.id,note)}));
      timelineRequestsTableBody.appendChild(row);
    });
  }

  function renderIdentityReviewQueue() {
    if (!identityReviewsTableBody || !MatrixDB.getIdentityReviews) return;
    const reviews = MatrixDB.getIdentityReviews().filter(review => review.status === "open");
    identityReviewsTableBody.innerHTML = reviews.length ? "" : `<tr><td colspan="4" class="empty-state">No identity review flags.</td></tr>`;
    reviews.forEach(review => {
      const accounts = (review.members || []).map(member =>
        `<strong>${escapeHtml(member.fullName)}</strong><br><small>${escapeHtml(member.accountCode)} Â· @${escapeHtml(member.username)}</small>`
      ).join("<hr style=\"border:0;border-top:1px solid rgba(255,201,28,.12);margin:.45rem 0\">");
      const signal = review.type === "shared-phone" ? "Shared phone" : review.type === "invalid-phone" ? "Invalid phone" : "Duplicate payment reference";
      const row = document.createElement("tr");
      row.innerHTML = `<td><strong>${signal}</strong></td><td>${copyField(review.value)}</td><td>${accounts || "-"}</td><td><span class="badge badge-pending">Review</span></td>`;
      row.querySelectorAll(".copy-admin-value").forEach(button => button.addEventListener("click", event => copyAdminValue(event.currentTarget)));
      identityReviewsTableBody.appendChild(row);
    });
  }

  function renderWithdrawalQueue() {
    if (!withdrawalsTableBody) return;
    const requests = MatrixDB.getWithdrawalRequests().filter(request => request.status === "pending");
    withdrawalsTableBody.innerHTML = "";

    if (requests.length === 0) {
      withdrawalsTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No pending withdrawals.</td></tr>`;
      return;
    }

    requests.forEach(request => {
      const originSummary = Array.isArray(request.origins) && request.origins.length
        ? request.origins.map(origin => `${origin.sourceLabel || "Passive Income"}: PHP ${Number(origin.amount || 0).toLocaleString()}`).join("; ")
        : "Passive Income Balance";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${request.fullName}</strong><br><span style="color: var(--gold-soft); font-size: .72rem;">@${request.username}</span></td>
        <td><strong style="color: var(--gold-soft);">${request.withdrawalCode || request.referenceNumber || request.id.slice(0, 8).toUpperCase()}</strong></td>
        <td>PHP ${Number(request.amount || 0).toLocaleString()}</td>
        <td>${request.accountName || request.fullName || "-"}${request.payoutDetails ? `<br><small style="color: var(--muted);">${request.payoutDetails}</small>` : ""}</td>
        <td>${copyField(request.gcashNumber)}</td>
        <td><span style="font-size: .72rem; color: var(--muted);">${originSummary}</span></td>
        <td>${formatDate(request.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="button btn-success approve-withdrawal-btn" data-id="${request.id}">Approve</button>
            <button class="button btn-danger reject-withdrawal-btn" data-id="${request.id}">Reject</button>
          </div>
        </td>
      `;
      tr.querySelector(".copy-admin-value").addEventListener("click", event => copyAdminValue(event.currentTarget));
      tr.querySelector(".approve-withdrawal-btn").addEventListener("click", () => openDecisionModal({title:"Approve Withdrawal",context:`Confirm the PHP ${Number(request.amount || 0).toLocaleString()} payout has been sent to ${request.accountName || request.fullName}.`,confirmLabel:"Confirm Payout",onConfirm:note=>MatrixDB.approveWithdrawal(request.id,note)}));
      tr.querySelector(".reject-withdrawal-btn").addEventListener("click", () => openDecisionModal({title:"Reject Withdrawal",context:`Record why the withdrawal for ${request.fullName} is being rejected.`,confirmLabel:"Reject Request",onConfirm:note=>MatrixDB.rejectWithdrawal(request.id,note)}));
      withdrawalsTableBody.appendChild(tr);
    });
  }

  function renderProductClaimQueue() {
    if (!productClaimsTableBody) return;
    const claims = MatrixDB.getProductPlusClaims().filter(claim => claim.status === "pending");
    productClaimsTableBody.innerHTML = "";

    if (claims.length === 0) {
      productClaimsTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No pending Products Plus claims.</td></tr>`;
      return;
    }

    claims.forEach(claim => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${claim.fullName}</strong></td>
        <td><span style="color: var(--gold-soft);">@${claim.username}</span></td>
        <td>Exit ${claim.exit}</td>
        <td>PHP ${Number(claim.spendAmount || 0).toLocaleString()}</td>
        <td>PHP ${Number(claim.bonusAmount || 0).toLocaleString()} (${claim.bonusPercent}%)</td>
        <td>${formatDate(claim.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="button btn-success approve-product-claim-btn" data-id="${claim.id}">Approve</button>
            <button class="button btn-danger reject-product-claim-btn" data-id="${claim.id}">Reject</button>
          </div>
        </td>
      `;
      tr.querySelector(".approve-product-claim-btn").addEventListener("click", () => {
        try {
          MatrixDB.approveProductPlusClaim(claim.id);
          refreshAll();
        } catch (err) {
          showPendingAlert(err.message, "danger");
        }
      });
      tr.querySelector(".reject-product-claim-btn").addEventListener("click", () => {
        try {
          MatrixDB.rejectProductPlusClaim(claim.id);
          refreshAll();
        } catch (err) {
          showPendingAlert(err.message, "danger");
        }
      });
      productClaimsTableBody.appendChild(tr);
    });
  }

  function renderExitActionQueue() {
    if (!exitActionsTableBody) return;
    const requests = MatrixDB.getExitActionRequests().filter(request => request.status === "pending");
    exitActionsTableBody.innerHTML = "";

    if (requests.length === 0) {
      exitActionsTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">No pending exit actions to process.</td>
        </tr>
      `;
      return;
    }

    requests.forEach(request => {
      const tr = document.createElement("tr");
      const actionLabel = request.actionType === "reinvest" ? "Re-Stake" : "Buy";
      const paymentDetails = request.paymentMethod === "f3_wallet"
        ? `<div><strong>F3 Wallet</strong>${copyField(request.f3Wallet)}</div>`
        : request.paymentMethod === "available_balance"
          ? `<div><strong>Available Balance</strong><br><span style="color:var(--muted);font-size:.72rem">Deduct on approval</span></div>`
          : `<div style="display:grid;gap:.25rem"><span><strong>GCash Name:</strong> ${escapeHtml(request.gcashName || "-")}</span><span><strong>GCash Number:</strong> ${copyField(request.gcashNumber)}</span><span><strong>Reference:</strong> ${copyField(request.referenceNumber)}</span></div>`;
      tr.innerHTML = `
        <td><strong>${escapeHtml(request.fullName)}</strong><br><span style="color:var(--gold-soft);font-size:.72rem">@${escapeHtml(request.username)}</span></td>
        <td>Exit ${request.exit}</td>
        <td>${actionLabel}</td>
        <td>PHP ${Number(request.actionAmount || 0).toLocaleString()}</td>
        <td>${paymentDetails}</td>
        <td>${formatDate(request.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="button btn-success approve-exit-action-btn" data-id="${request.id}">Approve</button>
            <button class="button btn-danger reject-exit-action-btn" data-id="${request.id}">Reject</button>
          </div>
        </td>
      `;

      tr.querySelectorAll(".copy-admin-value").forEach(button => button.addEventListener("click", event => copyAdminValue(event.currentTarget)));

      tr.querySelector(".approve-exit-action-btn").addEventListener("click", () => openDecisionModal({title:`Approve Exit ${request.exit}`,context:`Record the payment or wallet verification for ${request.fullName}.`,confirmLabel:"Approve Exit",onConfirm:note=>MatrixDB.approveExitAction(request.id,note)}));

      tr.querySelector(".reject-exit-action-btn").addEventListener("click", () => openDecisionModal({title:`Reject Exit ${request.exit}`,context:`Record why the Exit action for ${request.fullName} is being rejected.`,confirmLabel:"Reject Request",onConfirm:note=>MatrixDB.rejectExitAction(request.id,note)}));

      exitActionsTableBody.appendChild(tr);
    });
  }

  // Render Stats Card
  function renderOverviewStats() {
    const members = MatrixDB.getMembers();
    const pending = MatrixDB.getPendingRegistrations().filter(p => p.status === "pending");
    const pendingUpgrades = MatrixDB.getUpgradeRequests().filter(item => item.status === "pending");
    const pendingTimeline = MatrixDB.getTimelineRequests ? MatrixDB.getTimelineRequests().filter(item => item.status === "pending") : [];
    const pendingTotal = pending.length + pendingUpgrades.length + pendingTimeline.length;
    const positions = MatrixDB.getPositions();

    statActiveMembers.textContent = members.filter(member => member.status === "active").length;
    statPendingRequests.textContent = pendingTotal;
    
    // Pending Tab count badge
    if (pendingTotal > 0) {
      badgePendingCount.textContent = pendingTotal;
      badgePendingCount.style.display = "inline-block";
    } else {
      badgePendingCount.style.display = "none";
    }

    // Estimate F3 volume (sum of squad prices for all active placements)
    let totalVolume = 0;
    positions.forEach(pos => {
      const plan = MatrixDB.MATRIX_PLANS[pos.planId];
      if (plan) {
        totalVolume += plan.price;
      }
    });

    statRevenue.textContent = `PHP ${totalVolume.toLocaleString()}`;
  }

  function formatPeso(value) {
    return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function renderOperationsReport() {
    if (!MatrixDB.getOperationsReport || !operationsExceptionsTableBody) return;
    try {
      operationsReport = MatrixDB.getOperationsReport();
      const metrics = operationsReport.metrics || {};
      opsAvailableRewards.textContent = formatPeso(metrics.availableRewards);
      opsScheduledRewards.textContent = formatPeso(metrics.scheduledRewards);
      opsApprovedPayouts.textContent = formatPeso(metrics.approvedPayouts);
      opsPendingPayouts.textContent = formatPeso(metrics.pendingPayouts);
      opsActivationVolume.textContent = formatPeso(metrics.activationVolume);
      opsRecordedDecisions.textContent = Number(metrics.recordedDecisions || 0).toLocaleString();
      opsAuditEntries.textContent = Number(metrics.auditEntries || 0).toLocaleString();
      const auditValid = Boolean(operationsReport.audit?.valid);
      opsAuditIntegrity.textContent = auditValid ? "Verified" : "Review";
      opsAuditIntegrity.style.color = auditValid ? "var(--success)" : "var(--danger)";
      const exceptions = operationsReport.exceptions || [];
      opsExceptionCount.textContent = exceptions.length;
      opsExceptionCount.className = `badge ${exceptions.some(item => item.severity === "high") ? "badge-danger" : "badge-pending"}`;
      opsReportGenerated.textContent = `Report generated ${formatDateTime(operationsReport.generatedAt)}. ${auditValid ? "Audit hash chain verified." : operationsReport.audit?.issue || "Audit review required."}`;
      operationsExceptionsTableBody.innerHTML = exceptions.length ? "" : `<tr><td colspan="4" class="empty-state">No reconciliation exceptions found.</td></tr>`;
      exceptions.forEach(exception => {
        const row = document.createElement("tr");
        const severity = exception.severity === "high" ? "High" : "Review";
        row.innerHTML = `<td><span class="badge ${exception.severity === "high" ? "badge-danger" : "badge-pending"}">${severity}</span></td><td><strong>${escapeHtml(exception.category)}</strong></td><td><code>${escapeHtml(exception.reference)}</code></td><td>${escapeHtml(exception.detail)}</td>`;
        operationsExceptionsTableBody.appendChild(row);
      });
    } catch (error) {
      operationsExceptionsTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">Operations report unavailable: ${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function exportOperationsCsv() {
    if (!operationsReport) renderOperationsReport();
    if (!operationsReport) return;
    const metrics = operationsReport.metrics || {};
    const lines = [
      ["Matrix Operations Report", operationsReport.generatedAt],
      ["Available rewards", metrics.availableRewards],
      ["Scheduled rewards", metrics.scheduledRewards],
      ["Approved payouts", metrics.approvedPayouts],
      ["Pending payouts", metrics.pendingPayouts],
      ["Activation volume", metrics.activationVolume],
      ["Recorded decisions", metrics.recordedDecisions],
      ["Audit entries", metrics.auditEntries],
      ["Audit integrity", operationsReport.audit?.valid ? "Verified" : "Review required"],
      [],
      ["Severity", "Category", "Reference", "Finding"],
      ...(operationsReport.exceptions || []).map(item => [item.severity, item.category, item.reference, item.detail])
    ];
    const blob = new Blob([lines.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `matrix-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Render Activity Log View
  function renderLogs() {
    const logs = MatrixDB.getActivityLogs();
    systemLogsContainer.innerHTML = "";

    if (logs.length === 0) {
      systemLogsContainer.innerHTML = `<div style="color: rgba(255,255,255,0.3); text-align: center; padding: 1rem;">No recent activities.</div>`;
      return;
    }

    logs.forEach(log => {
      const item = document.createElement("div");
      item.className = "log-item";
      
      const timeStr = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      item.innerHTML = `
        <span class="log-time">[${timeStr}]</span>
        <span class="log-msg"><strong style="color: var(--gold-soft);">${log.type.toUpperCase()}:</strong> ${log.message}</span>
      `;
      systemLogsContainer.appendChild(item);
    });
  }

  // Render Pending Queue Table
  function renderPendingQueue() {
    pendingAlert.style.display = "none";
    const pending = MatrixDB.getPendingRegistrations().filter(p => p.status === "pending");
    pendingTableBody.innerHTML = "";

    if (pending.length === 0) {
      pendingTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">No pending registrations to process.</td>
        </tr>
      `;
      return;
    }

    pending.forEach(req => {
      const tr = document.createElement("tr");
      const plan = MatrixDB.MATRIX_PLANS[req.requestedPlanId];
      const sponsorStr = req.sponsorUsername ? `@${req.sponsorUsername}` : "Direct (None)";
      
      tr.innerHTML = `
        <td><strong>${req.fullName}</strong></td>
        <td><span style="color: var(--gold-soft);">@${req.username}</span></td>
        <td>
          <div style="font-size: 0.78rem;">${req.email}</div>
          <div style="font-size: 0.72rem; color: var(--muted);">${req.phone}</div>
        </td>
        <td><span style="font-family: monospace; font-size: 0.78rem;" title="${req.walletAddress}">${shortenWallet(req.walletAddress)}</span></td>
        <td>${sponsorStr}</td>
        <td><span class="badge" style="background: rgba(255, 201, 28, 0.1); color: var(--gold-soft); border: 1px solid var(--gold);">${plan ? plan.name : req.requestedPlanId}</span></td>
        <td>${formatDate(req.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="button btn-success approve-btn" data-id="${req.id}">Approve</button>
            <button class="button btn-danger reject-btn" data-id="${req.id}">Reject</button>
          </div>
        </td>
      `;

      // Event listener for Approve button
      tr.querySelector(".approve-btn").addEventListener("click", () => {
        openPlacementModal(req);
      });

      // Event listener for Reject button
      tr.querySelector(".reject-btn").addEventListener("click", () => openDecisionModal({
        title: "Reject Registration",
        context: `Record why the registration request for ${req.fullName} is being rejected.`,
        confirmLabel: "Reject Registration",
        onConfirm: note => MatrixDB.rejectPending(req.id, note)
      }));

      pendingTableBody.appendChild(tr);
    });
  }

  // Open Placement Modal
  function openPlacementModal(req) {
    modalAlert.style.display = "none";
    modalPendingId.value = req.id;
    modalDecisionNote.value = "";
    modalApplicantName.textContent = req.fullName;
    modalApplicantUsername.textContent = req.username;
    modalApplicantSponsor.textContent = req.sponsorUsername ? `@${req.sponsorUsername}` : "None";
    
    const plan = MatrixDB.MATRIX_PLANS[req.requestedPlanId];
    modalApplicantPlan.textContent = plan ? plan.name : req.requestedPlanId;

    // Default modes reset
    modeParentRadio.checked = true;
    togglePlacementRadioState();

    // Populate eligible parent lists
    populateParentSelect(req.requestedPlanId);

    // Show modal
    placementModal.classList.add("active");
  }

  function togglePlacementRadioState() {
    if (modeRootRadio.checked) {
      parentSelectionGroup.style.display = "none";
      rootWarnAlert.style.display = "block";
    } else {
      parentSelectionGroup.style.display = "block";
      rootWarnAlert.style.display = "none";
    }
  }

  function populateParentSelect(planId) {
    modalParentSelect.innerHTML = "";
    
    const eligible = MatrixDB.getEligibleParents(planId);
    
    if (eligible.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No parents available in this squad. Place as Root instead.";
      modalParentSelect.appendChild(opt);
      
      // Auto toggle to root mode if no parents exist
      modeRootRadio.checked = true;
      togglePlacementRadioState();
      return;
    }

    eligible.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.memberId;
      opt.textContent = `${p.fullName} (@${p.username}) — [${p.childrenCount}/${p.maxChildren} slots filled]`;
      modalParentSelect.appendChild(opt);
    });
  }

  // Handle Modal Placement Submissions
  function handlePlacementSubmission(e) {
    e.preventDefault();
    modalAlert.style.display = "none";

    const pendingId = modalPendingId.value;
    const isRootPlacement = modeRootRadio.checked;
    const parentId = isRootPlacement ? null : modalParentSelect.value;

    if (!isRootPlacement && !parentId) {
      showModalAlert("Please select a valid parent member or choose 'Place as Root'.");
      return;
    }

    try {
      MatrixDB.approveAndPlace(pendingId, parentId, modalDecisionNote.value);
      closeModal(placementModal);
      refreshAll();
    } catch (err) {
      showModalAlert(err.message);
    }
  }

  function showModalAlert(msg) {
    modalAlert.textContent = msg;
    modalAlert.className = "alert alert-danger";
    modalAlert.style.display = "block";
  }

  // Render Members Directory Table
  function renderMembersDirectory() {
    directoryAlert.style.display = "none";
    const members = MatrixDB.getMembers();
    const positions = MatrixDB.getPositions();
    const query = memberSearchInput.value.trim().toLowerCase();
    
    membersTableBody.innerHTML = "";

    // Apply Filter Search
    const filtered = members.filter(m => {
      if (!query) return true;
      return (
        m.fullName.toLowerCase().includes(query) ||
        m.username.toLowerCase().includes(query) ||
        m.email.toLowerCase().includes(query) ||
        m.walletAddress.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      membersTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">No matching approved members found.</td>
        </tr>
      `;
      return;
    }

    filtered.forEach(m => {
      const tr = document.createElement("tr");
      
      // Find position of this member
      const pos = positions.find(p => p.memberId === m.id);
      const planName = pos ? (MatrixDB.MATRIX_PLANS[pos.planId] ? MatrixDB.MATRIX_PLANS[pos.planId].name : pos.planId) : "None";
      
      let parentStr = "-";
      if (pos && pos.parentMemberId) {
        const parent = MatrixDB.getMemberById(pos.parentMemberId);
        parentStr = parent ? `@${parent.username}` : "Active ID";
      } else if (pos && pos.parentMemberId === null) {
        parentStr = "ROOT Node";
      }

      let sponsorStr = "-";
      if (m.sponsorId) {
        const sp = MatrixDB.getMemberById(m.sponsorId);
        sponsorStr = sp ? `@${sp.username}` : "Active ID";
      }

      tr.innerHTML = `
        <td><strong>${m.fullName}</strong></td>
        <td><span style="color: var(--gold-soft);">@${m.username}</span></td>
        <td>${planName}</td>
        <td>${parentStr}</td>
        <td>${sponsorStr}</td>
        <td><span style="font-family: monospace; font-size: 0.78rem;" title="${m.walletAddress}">${shortenWallet(m.walletAddress)}</span></td>
        <td>${formatDate(m.approvedAt)}</td>
        <td>
          <div class="actions">
            <button class="button btn-outline-gold view-btn" data-id="${m.id}">Profile</button>
            <button class="button btn-danger delete-btn" data-id="${m.id}">Delete</button>
          </div>
        </td>
      `;

      // Event listeners
      tr.querySelector(".view-btn").addEventListener("click", () => openProfileDetailsModal(m, pos, parentStr, sponsorStr));
      tr.querySelector(".delete-btn").addEventListener("click", () => {
        if (confirm(`WARNING: Are you sure you want to permanently delete member ${m.fullName} (@${m.username}) from the database?`)) {
          try {
            MatrixDB.deleteMember(m.id);
            refreshAll();
          } catch (err) {
            showDirectoryAlert(err.message, "danger");
          }
        }
      });

      membersTableBody.appendChild(tr);
    });
  }

  function openProfileDetailsModal(member, position, parentStr, sponsorStr) {
    modalDetailsList.innerHTML = `
      <li><span class="label">Full Name:</span><span class="val">${member.fullName}</span></li>
      <li><span class="label">Username:</span><span class="val">@${member.username}</span></li>
      <li><span class="label">Email:</span><span class="val">${member.email}</span></li>
      <li><span class="label">Phone:</span><span class="val">${member.phone}</span></li>
      <li><span class="label">Wallet Address:</span><span class="val">${member.walletAddress}</span></li>
      <li><span class="label">Squad Matrix:</span><span class="val">${position ? MatrixDB.MATRIX_PLANS[position.planId].name : "None"}</span></li>
      <li><span class="label">Parent Placement:</span><span class="val">${parentStr}</span></li>
      <li><span class="label">Invited Sponsor:</span><span class="val">${sponsorStr}</span></li>
      <li><span class="label">Registration Date:</span><span class="val">${formatDate(member.createdAt)}</span></li>
      <li><span class="label">Approval Date:</span><span class="val">${formatDate(member.approvedAt)}</span></li>
    `;
    detailsModal.classList.add("active");
  }

  // Render the scalable text-based Global Matrix Explorer.
  function renderGlobalTree() {
    const planId = viewerPlanSelect.value;
    globalTreeVisualizer.innerHTML = "";
    const roots = MatrixDB.getRootMembers(planId);
    matrixExplorerNodes = [];
    matrixExplorerExpanded = new Set();
    matrixExplorerSelectedId = null;

    if (roots.length === 0) {
      globalTreeVisualizer.innerHTML = `
        <div class="empty-state">
          <p>No active matrix placements exist for this squad.</p>
          <p style="font-size: 0.8rem; margin-top: 0.5rem; color: var(--muted);">Approve a pending request in the queue to place a root member.</p>
        </div>
      `;
      return;
    }

    roots.forEach(root => {
      const treeData = MatrixDB.getMemberTree(root.id, planId);
      if (!treeData) return;
      flattenMatrixTree(treeData, null, 0);
      matrixExplorerExpanded.add(root.id);
    });
    matrixExplorerSelectedId = matrixExplorerNodes[0] ? matrixExplorerNodes[0].id : null;
    renderMatrixExplorerRows();
    renderMatrixMemberDetails();
  }

  function flattenMatrixTree(node, parentId, depth) {
    if (!node || node.isOpenSlot) return;
    const memberChildren = (node.children || []).filter(child => !child.isOpenSlot);
    const openSlots = (node.children || []).filter(child => child.isOpenSlot).length;
    matrixExplorerNodes.push({
      ...node,
      parentId,
      depth,
      childIds: memberChildren.map(child => child.id),
      openSlots
    });
    memberChildren.forEach(child => flattenMatrixTree(child, node.id, depth + 1));
  }

  function renderMatrixExplorerRows() {
    const query = treeMemberSearchInput.value.trim().toLowerCase();
    const exitFilter = matrixExitFilter.value;
    const statusFilter = matrixStatusFilter.value;
    const filteredMode = Boolean(query || exitFilter !== "all" || statusFilter !== "all");
    const matchingIds = new Set();

    matrixExplorerNodes.forEach(node => {
      const stage = node.matrixStage || { exit: 0, status: "active" };
      const matchesQuery = !query || [node.fullName, node.username, node.walletAddress, node.id].some(value => String(value || "").toLowerCase().includes(query));
      const matchesExit = exitFilter === "all" || Number(exitFilter) === Number(stage.exit || 0);
      const matchesStatus = statusFilter === "all" || stage.status === statusFilter;
      if (matchesQuery && matchesExit && matchesStatus) {
        matchingIds.add(node.id);
        let parentId = node.parentId;
        while (parentId) {
          matchingIds.add(parentId);
          parentId = matrixExplorerNodes.find(item => item.id === parentId)?.parentId || null;
        }
      }
    });

    const visibleRows = matrixExplorerNodes.filter(node => {
      if (filteredMode) return matchingIds.has(node.id);
      let parentId = node.parentId;
      while (parentId) {
        if (!matrixExplorerExpanded.has(parentId)) return false;
        parentId = matrixExplorerNodes.find(item => item.id === parentId)?.parentId || null;
      }
      return true;
    });

    matrixExplorerCount.textContent = `${matrixExplorerNodes.length} ${matrixExplorerNodes.length === 1 ? "member" : "members"}`;
    if (!visibleRows.length) {
      globalTreeVisualizer.innerHTML = `<div class="empty-state"><p>No members match the selected filters.</p></div>`;
      return;
    }

    globalTreeVisualizer.innerHTML = visibleRows.map(node => {
      const stage = node.matrixStage || { label: "Entry", status: "active", exit: 0 };
      const hasChildren = node.childIds.length > 0;
      const expanded = filteredMode || matrixExplorerExpanded.has(node.id);
      return `
        <div class="matrix-explorer-row ${node.id === matrixExplorerSelectedId ? "selected" : ""}" role="treeitem" aria-level="${node.depth + 1}" aria-expanded="${hasChildren ? expanded : "false"}">
          <div class="matrix-explorer-member-cell" style="--tree-depth:${node.depth}">
            ${hasChildren ? `<button class="matrix-tree-toggle" type="button" data-toggle-id="${node.id}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(node.fullName)}">${expanded ? "−" : "+"}</button>` : `<span class="matrix-tree-leaf">•</span>`}
            <button class="matrix-explorer-member" type="button" data-member-id="${node.id}">
              <strong>${escapeHtml(node.fullName)}</strong>
              <span>@${escapeHtml(node.username)} · ${escapeHtml(shortenWallet(node.walletAddress))}</span>
            </button>
          </div>
          <span class="matrix-explorer-stage stage-${escapeHtml(stage.status)}">${escapeHtml(stage.label)} <small>${escapeHtml(capitalizeStatus(stage.status))}</small></span>
          <span class="matrix-explorer-children">${node.childIds.length}/${node.childIds.length + node.openSlots}</span>
        </div>`;
    }).join("");

    globalTreeVisualizer.querySelectorAll("[data-toggle-id]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.toggleId;
        if (matrixExplorerExpanded.has(id)) matrixExplorerExpanded.delete(id);
        else matrixExplorerExpanded.add(id);
        renderMatrixExplorerRows();
      });
    });
    globalTreeVisualizer.querySelectorAll("[data-member-id]").forEach(button => {
      button.addEventListener("click", () => {
        matrixExplorerSelectedId = button.dataset.memberId;
        renderMatrixExplorerRows();
        renderMatrixMemberDetails();
      });
    });
  }

  function renderMatrixMemberDetails() {
    const node = matrixExplorerNodes.find(item => item.id === matrixExplorerSelectedId);
    if (!node) return;
    const members = MatrixDB.getMembers();
    const positions = MatrixDB.getPositions();
    const member = members.find(item => item.id === node.id) || node;
    const parent = members.find(item => item.id === node.parentId);
    const sponsor = members.find(item => item.id === member.sponsorId);
    const stage = node.matrixStage || { label: "Entry", status: "active" };
    const path = [];
    let cursor = node;
    while (cursor) {
      path.unshift(cursor.fullName);
      cursor = matrixExplorerNodes.find(item => item.id === cursor.parentId);
    }
    matrixExplorerBreadcrumbs.textContent = path.join(" › ");
    const totalDownlines = countExplorerDescendants(node.id);
    const position = positions.find(item => item.memberId === node.id && item.planId === viewerPlanSelect.value);
    matrixMemberDetails.innerHTML = `
      <span class="withdrawal-eyebrow">Selected member</span>
      <h3>${escapeHtml(node.fullName)}</h3>
      <p class="matrix-member-username">@${escapeHtml(node.username)}</p>
      <div class="matrix-member-stage stage-${escapeHtml(stage.status)}"><strong>${escapeHtml(stage.label)}</strong><span>${escapeHtml(capitalizeStatus(stage.status))}</span></div>
      <dl class="matrix-member-detail-list">
        <div><dt>Direct children</dt><dd>${node.childIds.length}</dd></div>
        <div><dt>Total downline</dt><dd>${totalDownlines}</dd></div>
        <div><dt>Open positions</dt><dd>${node.openSlots}</dd></div>
        <div><dt>Parent placement</dt><dd>${parent ? escapeHtml(parent.fullName) : "Root"}</dd></div>
        <div><dt>Invited sponsor</dt><dd>${sponsor ? `@${escapeHtml(sponsor.username)}` : "None"}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(member.email || "-")}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(member.phone || "-")}</dd></div>
        <div><dt>Wallet</dt><dd title="${escapeHtml(member.walletAddress || "")}">${escapeHtml(shortenWallet(member.walletAddress))}</dd></div>
        <div><dt>Placed</dt><dd>${position ? formatDate(position.placedAt) : "-"}</dd></div>
      </dl>`;
  }

  function countExplorerDescendants(memberId) {
    const node = matrixExplorerNodes.find(item => item.id === memberId);
    if (!node) return 0;
    return node.childIds.reduce((total, childId) => total + 1 + countExplorerDescendants(childId), 0);
  }

  // Close modals helper
  function closeModal(modalEl) {
    modalEl.classList.remove("active");
  }

  // Shorten wallet helper
  function shortenWallet(wallet) {
    if (!wallet) return "";
    if (wallet.length <= 12) return wallet;
    return `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  }

  // Format Date Helper
  function formatDate(isoString) {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return isoString;
    }
  }

  function capitalizeStatus(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[character]));
  }

  function copyField(value) {
    const text = String(value || "").trim();
    return `<span class="admin-copy-field"><code title="${escapeHtml(text)}">${escapeHtml(text || "-")}</code><button class="copy-admin-value" type="button" data-copy-value="${escapeHtml(text)}" aria-label="Copy ${escapeHtml(text || "value")}" title="Copy to clipboard" ${text ? "" : "disabled"}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5.5 1.5h6A1.5 1.5 0 0 1 13 3v8.5h-1.5V3h-6V1.5Zm-2 3h6A1.5 1.5 0 0 1 11 6v7A1.5 1.5 0 0 1 9.5 14.5h-6A1.5 1.5 0 0 1 2 13V6a1.5 1.5 0 0 1 1.5-1.5Zm0 1.5v7h6V6h-6Z"/></svg><span class="copy-feedback" aria-live="polite"></span></button></span>`;
  }

  async function copyAdminValue(button) {
    try {
      await navigator.clipboard.writeText(button.dataset.copyValue || "");
      const feedback = button.querySelector(".copy-feedback");
      feedback.textContent = "Copied";
      button.classList.add("copied");
      window.setTimeout(() => { feedback.textContent = ""; button.classList.remove("copied"); }, 1200);
    } catch (error) {
      showPendingAlert("Unable to copy automatically. Select and copy the value manually.", "danger");
    }
  }

  // Helper Alerts
  function showUtilityMessage(msg, className) {
    utilityAlert.className = `alert ${className}`;
    utilityAlert.textContent = msg;
    utilityAlert.style.display = "block";
    setTimeout(() => {
      utilityAlert.style.display = "none";
    }, 4000);
  }

  function showPendingAlert(msg, type) {
    pendingAlert.className = `alert alert-${type}`;
    pendingAlert.textContent = msg;
    pendingAlert.style.display = "block";
  }

  function showDirectoryAlert(msg, type) {
    directoryAlert.className = `alert alert-${type}`;
    directoryAlert.textContent = msg;
    directoryAlert.style.display = "block";
  }
});
