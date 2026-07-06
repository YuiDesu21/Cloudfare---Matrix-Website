/**
 * Matrix Database Layer (localStorage-backed MVP)
 * Handles data models, validations, placement checks, and state persistence.
 */

const MATRIX_PLANS = {
  power3: {
    id: "power3",
    name: "Power of 3",
    maxChildren: 3,
    price: 500
  },
  power5: {
    id: "power5",
    name: "Power of 5",
    maxChildren: 5,
    price: 1000
  },
  power7: {
    id: "power7",
    name: "Power of 7",
    maxChildren: 7,
    price: 1500
  }
};

const DB_KEYS = {
  PENDING: "matrix_pending_registrations",
  MEMBERS: "matrix_members",
  POSITIONS: "matrix_positions",
  LOGS: "matrix_activity_logs",
  SETTINGS: "matrix_settings"
};

// Fallback UUID generator if crypto.randomUUID is unavailable
function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return 'mvp-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
}

// Read/Write helper wrappers
function readStorage(key, defaultValue = []) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.error("Error reading localStorage key: " + key, e);
    return defaultValue;
  }
}

function writeStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("Error writing localStorage key: " + key, e);
  }
}

const MatrixDB = {
  MATRIX_PLANS,

  initializeDatabase() {
    if (!localStorage.getItem(DB_KEYS.SETTINGS)) {
      writeStorage(DB_KEYS.SETTINGS, { adminPassword: "admin123" });
    }
    if (!localStorage.getItem(DB_KEYS.PENDING)) writeStorage(DB_KEYS.PENDING, []);
    if (!localStorage.getItem(DB_KEYS.MEMBERS)) writeStorage(DB_KEYS.MEMBERS, []);
    if (!localStorage.getItem(DB_KEYS.POSITIONS)) writeStorage(DB_KEYS.POSITIONS, []);
    if (!localStorage.getItem(DB_KEYS.LOGS)) writeStorage(DB_KEYS.LOGS, []);
    
    this.addActivityLog("system", "Database initialized.");
  },

  getSettings() {
    return readStorage(DB_KEYS.SETTINGS, { adminPassword: "admin123" });
  },

  saveSettings(settings) {
    writeStorage(DB_KEYS.SETTINGS, settings);
    this.addActivityLog("system", "Settings updated.");
  },

  getPendingRegistrations() {
    return readStorage(DB_KEYS.PENDING, []);
  },

  getMembers() {
    return readStorage(DB_KEYS.MEMBERS, []);
  },

  getPositions() {
    return readStorage(DB_KEYS.POSITIONS, []);
  },

  getMemberById(memberId) {
    const members = this.getMembers();
    return members.find(m => m.id === memberId) || null;
  },

  getMemberByUsername(username) {
    if (!username) return null;
    const members = this.getMembers();
    const cleanUsername = username.trim().toLowerCase();
    return members.find(m => m.username.trim().toLowerCase() === cleanUsername) || null;
  },

  getMemberByCredential(emailOrWallet) {
    if (!emailOrWallet) return null;
    const members = this.getMembers();
    const cleanCred = emailOrWallet.trim().toLowerCase();
    return members.find(m => 
      m.email.trim().toLowerCase() === cleanCred || 
      m.walletAddress.trim().toLowerCase() === cleanCred
    ) || null;
  },

  registerPending(memberData) {
    this.initializeDatabase();
    
    const pending = this.getPendingRegistrations();
    const members = this.getMembers();

    const username = memberData.username.trim();
    const email = memberData.email.trim();
    const wallet = memberData.walletAddress.trim();

    // 1. Validation for uniqueness
    const existsInMembers = members.some(m => 
      m.username.toLowerCase() === username.toLowerCase() ||
      m.email.toLowerCase() === email.toLowerCase() ||
      m.walletAddress.toLowerCase() === wallet.toLowerCase()
    );

    const existsInPending = pending.some(p => 
      (p.status === "pending" || p.status === "active") && (
        p.username.toLowerCase() === username.toLowerCase() ||
        p.email.toLowerCase() === email.toLowerCase() ||
        p.walletAddress.toLowerCase() === wallet.toLowerCase()
      )
    );

    if (existsInMembers || existsInPending) {
      throw new Error("Username, Email, or Wallet Address is already registered or has a pending request.");
    }

    const newRequest = {
      id: generateUUID(),
      fullName: memberData.fullName.trim(),
      username: username,
      email: email,
      phone: memberData.phone.trim(),
      walletAddress: wallet,
      sponsorUsername: memberData.sponsorUsername ? memberData.sponsorUsername.trim() : "",
      requestedPlanId: memberData.requestedPlanId,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    pending.push(newRequest);
    writeStorage(DB_KEYS.PENDING, pending);

    this.addActivityLog("registration", `New pending registration for ${newRequest.fullName} (${newRequest.username})`);
    return newRequest;
  },

  approveAndPlace(pendingId, parentMemberId) {
    this.initializeDatabase();

    const pendingList = this.getPendingRegistrations();
    const pendingIndex = pendingList.findIndex(p => p.id === pendingId);

    if (pendingIndex === -1) {
      throw new Error("Pending registration request not found.");
    }

    const pending = pendingList[pendingIndex];
    if (pending.status !== "pending") {
      throw new Error("This request is no longer pending.");
    }

    const members = this.getMembers();
    const positions = this.getPositions();
    const plan = MATRIX_PLANS[pending.requestedPlanId];

    if (!plan) {
      throw new Error("Invalid matrix plan selected.");
    }

    // Uniqueness checks in active members list just in case
    const isDuplicate = members.some(m => 
      m.username.toLowerCase() === pending.username.toLowerCase() ||
      m.email.toLowerCase() === pending.email.toLowerCase() ||
      m.walletAddress.toLowerCase() === pending.walletAddress.toLowerCase()
    );
    if (isDuplicate) {
      throw new Error("A member with these details has already been approved.");
    }

    // If placing as root, parentMemberId should be null or empty
    const isRoot = !parentMemberId;

    if (isRoot) {
      // Check if a root already exists for this plan
      const rootExists = positions.some(p => p.planId === plan.id && p.parentMemberId === null);
      if (rootExists) {
        throw new Error(`A root member already exists for the ${plan.name} plan. You must select a parent.`);
      }
    } else {
      // Validate Parent
      const parent = members.find(m => m.id === parentMemberId);
      if (!parent) {
        throw new Error("Selected parent member does not exist.");
      }
      
      const parentPosition = positions.find(pos => pos.memberId === parent.id && pos.planId === plan.id);
      if (!parentPosition) {
        throw new Error("Selected parent is not placed in the requested matrix plan.");
      }

      // Check capacity
      const currentChildren = positions.filter(pos => pos.parentMemberId === parent.id && pos.planId === plan.id);
      if (currentChildren.length >= plan.maxChildren) {
        throw new Error(`Selected parent already has the maximum of ${plan.maxChildren} children in this plan.`);
      }
    }

    // Resolve Sponsor ID
    let sponsorId = null;
    if (pending.sponsorUsername) {
      const sponsor = this.getMemberByUsername(pending.sponsorUsername);
      if (sponsor) {
        sponsorId = sponsor.id;
      }
    }

    // Create Active Member
    const newMemberId = pending.id; // Retain ID from registration request
    const newMember = {
      id: newMemberId,
      fullName: pending.fullName,
      username: pending.username,
      email: pending.email,
      phone: pending.phone,
      walletAddress: pending.walletAddress,
      sponsorId: sponsorId,
      status: "active",
      createdAt: pending.createdAt,
      approvedAt: new Date().toISOString()
    };

    // Create Matrix Position
    const newPosition = {
      id: generateUUID(),
      memberId: newMemberId,
      planId: plan.id,
      parentMemberId: isRoot ? null : parentMemberId,
      placedAt: new Date().toISOString()
    };

    // Update Lists
    members.push(newMember);
    positions.push(newPosition);

    // Update registration status
    pending.status = "approved";
    pendingList[pendingIndex] = pending;

    writeStorage(DB_KEYS.MEMBERS, members);
    writeStorage(DB_KEYS.POSITIONS, positions);
    writeStorage(DB_KEYS.PENDING, pendingList);

    this.addActivityLog("approval", `Approved & placed member ${newMember.fullName} (${newMember.username}) in ${plan.name}`);
    return newMember;
  },

  rejectPending(pendingId) {
    this.initializeDatabase();
    
    const pendingList = this.getPendingRegistrations();
    const pendingIndex = pendingList.findIndex(p => p.id === pendingId);

    if (pendingIndex === -1) {
      throw new Error("Pending registration request not found.");
    }

    const pending = pendingList[pendingIndex];
    pending.status = "rejected";
    writeStorage(DB_KEYS.PENDING, pendingList);

    this.addActivityLog("rejection", `Rejected registration request for ${pending.fullName} (${pending.username})`);
    return pending;
  },

  deleteMember(memberId) {
    this.initializeDatabase();

    const members = this.getMembers();
    const positions = this.getPositions();

    const memberIndex = members.findIndex(m => m.id === memberId);
    if (memberIndex === -1) {
      throw new Error("Member not found.");
    }

    const member = members[memberIndex];

    // Check if member has any children in any matrix plan
    const hasChildren = positions.some(pos => pos.parentMemberId === memberId);
    if (hasChildren) {
      throw new Error("Cannot delete this member because they currently have children placed under them in the matrix tree.");
    }

    // Remove from members
    members.splice(memberIndex, 1);

    // Remove from positions
    const filteredPositions = positions.filter(pos => pos.memberId !== memberId);

    // Remove or reset status in pending registrations so they can register again
    const pendingList = this.getPendingRegistrations();
    const pendingIndex = pendingList.findIndex(p => p.id === memberId);
    if (pendingIndex !== -1) {
      pendingList.splice(pendingIndex, 1);
      writeStorage(DB_KEYS.PENDING, pendingList);
    }

    writeStorage(DB_KEYS.MEMBERS, members);
    writeStorage(DB_KEYS.POSITIONS, filteredPositions);

    this.addActivityLog("deletion", `Deleted member ${member.fullName} (${member.username})`);
    return true;
  },

  getPositionByMemberId(memberId) {
    const positions = this.getPositions();
    return positions.find(pos => pos.memberId === memberId) || null;
  },

  getEligibleParents(planId) {
    const members = this.getMembers();
    const positions = this.getPositions();
    const plan = MATRIX_PLANS[planId];

    if (!plan) return [];

    // Find positions in this plan
    const planPositions = positions.filter(pos => pos.planId === planId);

    // Filter those who have fewer children than maxChildren
    return planPositions
      .map(pos => {
        const member = members.find(m => m.id === pos.memberId);
        const children = planPositions.filter(c => c.parentMemberId === pos.memberId);
        return {
          memberId: pos.memberId,
          fullName: member ? member.fullName : "Unknown",
          username: member ? member.username : "unknown",
          childrenCount: children.length,
          maxChildren: plan.maxChildren,
          slotsLeft: plan.maxChildren - children.length
        };
      })
      .filter(parent => parent.slotsLeft > 0);
  },

  getRootMembers(planId) {
    const positions = this.getPositions();
    const members = this.getMembers();
    
    const rootPos = positions.filter(pos => pos.planId === planId && pos.parentMemberId === null);
    return rootPos.map(pos => members.find(m => m.id === pos.memberId)).filter(Boolean);
  },

  getMemberTree(memberId, planId) {
    const members = this.getMembers();
    const positions = this.getPositions();
    const plan = MATRIX_PLANS[planId];
    
    if (!plan) return null;

    const member = members.find(m => m.id === memberId);
    if (!member) return null;

    const position = positions.find(pos => pos.memberId === memberId && pos.planId === planId);
    if (!position) return null;

    // Recursive tree building
    const buildTree = (mId) => {
      const m = members.find(x => x.id === mId);
      if (!m) return null;

      const childrenPos = positions.filter(pos => pos.parentMemberId === mId && pos.planId === planId);
      
      const children = childrenPos.map(cp => buildTree(cp.memberId)).filter(Boolean);

      // Add dummy empty/open slots up to maxChildren
      const openSlots = plan.maxChildren - children.length;
      const displayChildren = [...children];
      for (let i = 0; i < openSlots; i++) {
        displayChildren.push({
          isOpenSlot: true,
          label: "Open Spot"
        });
      }

      return {
        id: m.id,
        fullName: m.fullName,
        username: m.username,
        walletAddress: m.walletAddress,
        planId: planId,
        children: displayChildren
      };
    };

    return buildTree(memberId);
  },

  addActivityLog(type, message) {
    const logs = readStorage(DB_KEYS.LOGS, []);
    logs.unshift({
      id: generateUUID(),
      type,
      message,
      createdAt: new Date().toISOString()
    });
    // Cap at 100 entries
    if (logs.length > 100) logs.pop();
    writeStorage(DB_KEYS.LOGS, logs);
  },

  getActivityLogs() {
    return readStorage(DB_KEYS.LOGS, []);
  },

  resetAllData() {
    localStorage.removeItem(DB_KEYS.PENDING);
    localStorage.removeItem(DB_KEYS.MEMBERS);
    localStorage.removeItem(DB_KEYS.POSITIONS);
    localStorage.removeItem(DB_KEYS.LOGS);
    localStorage.removeItem(DB_KEYS.SETTINGS);
    this.initializeDatabase();
    this.addActivityLog("system", "Database reset complete.");
  },

  exportData() {
    const data = {
      pending: this.getPendingRegistrations(),
      members: this.getMembers(),
      positions: this.getPositions(),
      logs: this.getActivityLogs(),
      settings: this.getSettings()
    };
    return JSON.stringify(data, null, 2);
  },

  importData(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      if (data.pending) writeStorage(DB_KEYS.PENDING, data.pending);
      if (data.members) writeStorage(DB_KEYS.MEMBERS, data.members);
      if (data.positions) writeStorage(DB_KEYS.POSITIONS, data.positions);
      if (data.logs) writeStorage(DB_KEYS.LOGS, data.logs);
      if (data.settings) writeStorage(DB_KEYS.SETTINGS, data.settings);
      
      this.initializeDatabase();
      this.addActivityLog("system", "Database imported successfully.");
      return true;
    } catch (e) {
      console.error("Failed to import data: ", e);
      throw new Error("Invalid database export file format: " + e.message);
    }
  },

  seedSampleData() {
    this.initializeDatabase();
    
    // Clear first to prevent duplicates
    writeStorage(DB_KEYS.PENDING, []);
    writeStorage(DB_KEYS.MEMBERS, []);
    writeStorage(DB_KEYS.POSITIONS, []);
    writeStorage(DB_KEYS.LOGS, []);

    const now = new Date();
    
    // Helper to format ISO strings slightly in the past
    const daysAgo = (days) => {
      const d = new Date();
      d.setDate(now.getDate() - days);
      return d.toISOString();
    };

    // Seed Active Members
    // Format: id, fullName, username, email, phone, walletAddress, sponsorId, status, createdAt, approvedAt
    const seededMembers = [
      // Roots
      {
        id: "root-p3",
        fullName: "Arthur Pendragon",
        username: "arthur",
        email: "arthur@matrix.io",
        phone: "+639111111111",
        walletAddress: "0xRootP3Address1111111111111111111111",
        sponsorId: null,
        status: "active",
        createdAt: daysAgo(10),
        approvedAt: daysAgo(9)
      },
      {
        id: "root-p5",
        fullName: "Merlin Ambrosius",
        username: "merlin",
        email: "merlin@matrix.io",
        phone: "+639222222222",
        walletAddress: "0xRootP5Address2222222222222222222222",
        sponsorId: null,
        status: "active",
        createdAt: daysAgo(10),
        approvedAt: daysAgo(9)
      },
      {
        id: "root-p7",
        fullName: "Guinevere Leodegrance",
        username: "guinevere",
        email: "guinevere@matrix.io",
        phone: "+639333333333",
        walletAddress: "0xRootP7Address3333333333333333333333",
        sponsorId: null,
        status: "active",
        createdAt: daysAgo(10),
        approvedAt: daysAgo(9)
      },
      // Power of 3 members
      {
        id: "lancelot-p3",
        fullName: "Lancelot Du Lac",
        username: "lancelot",
        email: "lancelot@matrix.io",
        phone: "+639444444444",
        walletAddress: "0xLancelotAddress444444444444444444444",
        sponsorId: "root-p3",
        status: "active",
        createdAt: daysAgo(8),
        approvedAt: daysAgo(8)
      },
      {
        id: "gawain-p3",
        fullName: "Gawain Orkney",
        username: "gawain",
        email: "gawain@matrix.io",
        phone: "+639555555555",
        walletAddress: "0xGawainAddress55555555555555555555555",
        sponsorId: "root-p3",
        status: "active",
        createdAt: daysAgo(8),
        approvedAt: daysAgo(8)
      },
      {
        id: "percival-p3",
        fullName: "Percival Wales",
        username: "percival",
        email: "percival@matrix.io",
        phone: "+639666666666",
        walletAddress: "0xPercivalAddress666666666666666666666",
        sponsorId: "root-p3",
        status: "active",
        createdAt: daysAgo(7),
        approvedAt: daysAgo(7)
      },
      // Galahad (Grandchild of root-p3, placed under lancelot-p3, sponsored by gawain-p3 to show difference)
      {
        id: "galahad-p3",
        fullName: "Galahad Pure",
        username: "galahad",
        email: "galahad@matrix.io",
        phone: "+639777777777",
        walletAddress: "0xGalahadAddress777777777777777777777",
        sponsorId: "gawain-p3", // Gawain sponsored, but placed under Lancelot
        status: "active",
        createdAt: daysAgo(6),
        approvedAt: daysAgo(6)
      },
      // Power of 5 children
      {
        id: "tristan-p5",
        fullName: "Tristan Lyonesse",
        username: "tristan",
        email: "tristan@matrix.io",
        phone: "+639888888888",
        walletAddress: "0xTristanAddress8888888888888888888888",
        sponsorId: "root-p5",
        status: "active",
        createdAt: daysAgo(5),
        approvedAt: daysAgo(5)
      },
      {
        id: "iseult-p5",
        fullName: "Iseult Ireland",
        username: "iseult",
        email: "iseult@matrix.io",
        phone: "+639999999999",
        walletAddress: "0xIseultAddress9999999999999999999999",
        sponsorId: "root-p5",
        status: "active",
        createdAt: daysAgo(5),
        approvedAt: daysAgo(5)
      },
      // Power of 7 children
      {
        id: "bors-p7",
        fullName: "Bors Ganis",
        username: "bors",
        email: "bors@matrix.io",
        phone: "+639101010101",
        walletAddress: "0xBorsAddress101010101010101010101010",
        sponsorId: "root-p7",
        status: "active",
        createdAt: daysAgo(4),
        approvedAt: daysAgo(4)
      }
    ];

    // Seed Matrix Positions
    // Format: id, memberId, planId, parentMemberId, placedAt
    const seededPositions = [
      // Roots
      { id: "pos-root-p3", memberId: "root-p3", planId: "power3", parentMemberId: null, placedAt: daysAgo(9) },
      { id: "pos-root-p5", memberId: "root-p5", planId: "power5", parentMemberId: null, placedAt: daysAgo(9) },
      { id: "pos-root-p7", memberId: "root-p7", planId: "power7", parentMemberId: null, placedAt: daysAgo(9) },
      // Power of 3 children
      { id: "pos-lance-p3", memberId: "lancelot-p3", planId: "power3", parentMemberId: "root-p3", placedAt: daysAgo(8) },
      { id: "pos-gawain-p3", memberId: "gawain-p3", planId: "power3", parentMemberId: "root-p3", placedAt: daysAgo(8) },
      { id: "pos-percival-p3", memberId: "percival-p3", planId: "power3", parentMemberId: "root-p3", placedAt: daysAgo(7) },
      // Power of 3 grandchild
      { id: "pos-galahad-p3", memberId: "galahad-p3", planId: "power3", parentMemberId: "lancelot-p3", placedAt: daysAgo(6) },
      // Power of 5 children
      { id: "pos-tristan-p5", memberId: "tristan-p5", planId: "power5", parentMemberId: "root-p5", placedAt: daysAgo(5) },
      { id: "pos-iseult-p5", memberId: "iseult-p5", planId: "power5", parentMemberId: "root-p5", placedAt: daysAgo(5) },
      // Power of 7 children
      { id: "pos-bors-p7", memberId: "bors-p7", planId: "power7", parentMemberId: "root-p7", placedAt: daysAgo(4) }
    ];

    // Seed Pending Registrations (At least 2 pending)
    const seededPending = [
      {
        id: "pending-req-1",
        fullName: "Mordred Orkney",
        username: "mordred",
        email: "mordred@matrix.io",
        phone: "+639121212121",
        walletAddress: "0xMordredAddress12121212121212121212",
        sponsorUsername: "arthur",
        requestedPlanId: "power3",
        status: "pending",
        createdAt: daysAgo(1)
      },
      {
        id: "pending-req-2",
        fullName: "Bedivere Lucan",
        username: "bedivere",
        email: "bedivere@matrix.io",
        phone: "+639131313131",
        walletAddress: "0xBedivereAddress13131313131313131313",
        sponsorUsername: "merlin",
        requestedPlanId: "power5",
        status: "pending",
        createdAt: daysAgo(1)
      }
    ];

    writeStorage(DB_KEYS.MEMBERS, seededMembers);
    writeStorage(DB_KEYS.POSITIONS, seededPositions);
    writeStorage(DB_KEYS.PENDING, seededPending);
    
    // Add logs
    this.addActivityLog("system", "Sample demonstration data seeded.");
    this.addActivityLog("system", "Root positions established for Power of 3, 5, and 7.");
  }
};

// Auto initialize on load
MatrixDB.initializeDatabase();
window.MatrixDB = MatrixDB;
