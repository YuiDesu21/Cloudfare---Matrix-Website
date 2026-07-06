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
  const adminLoginAlert = document.getElementById("admin-login-alert");

  const adminDashboardSection = document.getElementById("admin-dashboard-section");
  const adminUserStatus = document.getElementById("admin-user-status");
  const logoutBtnAdmin = document.getElementById("logout-btn-admin");

  // Tab navigation
  const tabButtons = document.querySelectorAll(".tab-btn");
  const adminSections = document.querySelectorAll(".admin-section");
  const badgePendingCount = document.getElementById("badge-pending-count");

  // Metrics
  const statActiveMembers = document.getElementById("stat-active-members");
  const statPendingRequests = document.getElementById("stat-pending-requests");
  const statRevenue = document.getElementById("stat-revenue");

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
  const pendingAlert = document.getElementById("pending-alert");
  const membersTableBody = document.getElementById("members-table-body");
  const memberSearchInput = document.getElementById("member-search");
  const directoryAlert = document.getElementById("directory-alert");

  // Matrix Viewer
  const viewerPlanSelect = document.getElementById("viewer-plan-select");
  const treeMemberSearchInput = document.getElementById("tree-member-search");
  const globalTreeVisualizer = document.getElementById("global-tree-visualizer");

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
    const settings = MatrixDB.getSettings();

    if (inputPass === settings.adminPassword) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
      enterDashboard();
    } else {
      adminLoginAlert.textContent = "Incorrect admin password. Please try again.";
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
      if (target === "tab-visualizer") {
        renderGlobalTree();
      }
    });
  });

  // Modal Closures
  btnClosePlacementModal.addEventListener("click", () => closeModal(placementModal));
  btnCancelPlacement.addEventListener("click", () => closeModal(placementModal));
  
  btnCloseDetailsModal.addEventListener("click", () => closeModal(detailsModal));
  btnCloseDetailsFooter.addEventListener("click", () => closeModal(detailsModal));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal(placementModal);
      closeModal(detailsModal);
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
      
      newPasswordInput.value = "";
      showUtilityMessage("Admin access password updated successfully.", "alert-success");
      refreshAll();
    } catch (err) {
      showUtilityMessage("Password update failed: " + err.message, "alert-danger");
    }
  });

  // Modal placement radio handlers
  modeParentRadio.addEventListener("change", togglePlacementRadioState);
  modeRootRadio.addEventListener("change", togglePlacementRadioState);

  // Search input events
  memberSearchInput.addEventListener("input", renderMembersDirectory);
  treeMemberSearchInput.addEventListener("input", filterTreeNodesHighlight);
  viewerPlanSelect.addEventListener("change", renderGlobalTree);

  // Modal Placement submission
  placementForm.addEventListener("submit", handlePlacementSubmission);

  // Setup Initial State & Functions
  function checkAdminSession() {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "true") {
      enterDashboard();
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
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    adminPasswordInput.value = "";
    adminAuthSection.style.display = "block";
    adminDashboardSection.style.display = "none";
    adminUserStatus.style.display = "none";
  }

  // Unified Refresh
  function refreshAll() {
    renderOverviewStats();
    renderPendingQueue();
    renderMembersDirectory();
    renderLogs();
    renderGlobalTree();
  }

  // Render Stats Card
  function renderOverviewStats() {
    const members = MatrixDB.getMembers();
    const pending = MatrixDB.getPendingRegistrations().filter(p => p.status === "pending");
    const positions = MatrixDB.getPositions();

    statActiveMembers.textContent = members.length;
    statPendingRequests.textContent = pending.length;
    
    // Pending Tab count badge
    if (pending.length > 0) {
      badgePendingCount.textContent = pending.length;
      badgePendingCount.style.display = "inline-block";
    } else {
      badgePendingCount.style.display = "none";
    }

    // Estimate Revenue volume (sum of plan prices for all active placements)
    let totalVolume = 0;
    positions.forEach(pos => {
      const plan = MatrixDB.MATRIX_PLANS[pos.planId];
      if (plan) {
        totalVolume += plan.price;
      }
    });

    statRevenue.textContent = `${totalVolume.toLocaleString()} F3`;
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
      tr.querySelector(".reject-btn").addEventListener("click", () => {
        if (confirm(`Are you sure you want to reject the registration request for ${req.fullName} (@${req.username})?`)) {
          try {
            MatrixDB.rejectPending(req.id);
            refreshAll();
          } catch (e) {
            showPendingAlert(e.message, "danger");
          }
        }
      });

      pendingTableBody.appendChild(tr);
    });
  }

  // Open Placement Modal
  function openPlacementModal(req) {
    modalAlert.style.display = "none";
    modalPendingId.value = req.id;
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
      opt.textContent = "No parents available in this plan. Place as Root instead.";
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
      MatrixDB.approveAndPlace(pendingId, parentId);
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
      <li><span class="label">Matrix Plan:</span><span class="val">${position ? MatrixDB.MATRIX_PLANS[position.planId].name : "None"}</span></li>
      <li><span class="label">Parent Placement:</span><span class="val">${parentStr}</span></li>
      <li><span class="label">Invited Sponsor:</span><span class="val">${sponsorStr}</span></li>
      <li><span class="label">Registration Date:</span><span class="val">${formatDate(member.createdAt)}</span></li>
      <li><span class="label">Approval Date:</span><span class="val">${formatDate(member.approvedAt)}</span></li>
    `;
    detailsModal.classList.add("active");
  }

  // Render Global Tree Visualizer
  function renderGlobalTree() {
    const planId = viewerPlanSelect.value;
    globalTreeVisualizer.innerHTML = "";

    const roots = MatrixDB.getRootMembers(planId);

    if (roots.length === 0) {
      globalTreeVisualizer.innerHTML = `
        <div class="empty-state">
          <p>No active matrix placements exist for this plan.</p>
          <p style="font-size: 0.8rem; margin-top: 0.5rem; color: var(--muted);">Approve a pending request in the queue to place a root member.</p>
        </div>
      `;
      return;
    }

    // Render each root tree (usually only 1 root per plan, but loop to handle all gracefully)
    roots.forEach(root => {
      const treeData = MatrixDB.getMemberTree(root.id, planId);
      if (!treeData) return;

      const treeWrapper = document.createElement("div");
      treeWrapper.className = "tree-wrapper";
      treeWrapper.style.marginBottom = "3rem";

      // Recursive tree builder
      function buildTreeHtml(node) {
        if (!node) return "";

        if (node.isOpenSlot) {
          return `
            <div class="tree-branch">
              <div class="tree-node-wrapper">
                <div class="tree-node-card empty-card">
                  <div class="tree-node-name">Open Spot</div>
                  <div class="tree-node-username">Available</div>
                </div>
              </div>
            </div>
          `;
        }

        const isRoot = node.id === root.id;
        const shortWallet = shortenWallet(node.walletAddress);

        let childrenHtml = "";
        if (node.children && node.children.length > 0) {
          childrenHtml = `
            <div class="tree-children-container">
              ${node.children.map(child => buildTreeHtml(child)).join("")}
            </div>
          `;
        }

        return `
          <div class="tree-branch" data-username="${node.username.toLowerCase()}" data-name="${node.fullName.toLowerCase()}">
            <div class="tree-node-wrapper">
              <div class="tree-node-card ${isRoot ? 'root-card' : ''}" id="node-${node.id}">
                <div class="tree-node-name" title="${node.fullName}">${node.fullName}</div>
                <div class="tree-node-username">@${node.username}</div>
                <div class="tree-node-info">${shortWallet}</div>
              </div>
            </div>
            ${childrenHtml}
          </div>
        `;
      }

      treeWrapper.innerHTML = buildTreeHtml(treeData);
      globalTreeVisualizer.appendChild(treeWrapper);
    });

    // Run filter highlight checks immediately after rendering
    filterTreeNodesHighlight();
  }

  // Highlight and focus member node in Global Tree Map
  function filterTreeNodesHighlight() {
    const searchVal = treeMemberSearchInput.value.trim().toLowerCase();
    
    // Clear previous highlights
    document.querySelectorAll(".tree-node-card").forEach(card => {
      card.classList.remove("highlight-node");
    });

    if (!searchVal) return;

    // Search matches
    const branches = document.querySelectorAll(".tree-branch");
    let matchedNodeCard = null;

    for (let branch of branches) {
      const uName = branch.getAttribute("data-username");
      const fName = branch.getAttribute("data-name");

      if (uName && fName && (uName.includes(searchVal) || fName.includes(searchVal))) {
        const card = branch.querySelector(".tree-node-card");
        if (card && !card.classList.contains("empty-card")) {
          card.classList.add("highlight-node");
          matchedNodeCard = card;
        }
      }
    }

    // Scroll node card into view if matched
    if (matchedNodeCard) {
      matchedNodeCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
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
