const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "matrix-db.json");
const MATRIX_RULES_FILE = path.join(DATA_DIR, "matrix-rules.json");
const SUPABASE_BROWSER_FILE = path.join(__dirname, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");
const SANDBOX_RUNTIME_CONFIG = path.join(__dirname, "js", "runtime-config.sandbox.js");
const PRODUCTION_ENTRY_PAGE = path.join(__dirname, "upgrade-entry-production.html");
const PRODUCTION_ADMIN_PAGE = path.join(__dirname, "admin-production.html");
const AUTH_SESSIONS = new Map();
const LEGACY_SANDBOX_PASSWORD = "member123";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString("hex")}`;
}

function passwordMatches(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expectedHex] = storedHash.split(":");
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createAuthSession(role, memberId = null) {
  const token = crypto.randomBytes(32).toString("hex");
  AUTH_SESSIONS.set(token, { role, memberId, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return token;
}

function getAuthSession(request) {
  const token = String(request.headers["x-matrix-auth"] || "");
  const session = AUTH_SESSIONS.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) AUTH_SESSIONS.delete(token);
    return null;
  }
  return session;
}

const MATRIX_PLANS = {
  "power3-passive": { id: "power3-passive", name: "Power of Three Passive Income", maxChildren: 3, price: 20, pesoValue: 1200 }
};

function normalizePlanId(planId) {
  if (planId === "power3" || planId === "power5" || planId === "power7" || planId === "junior" || planId === "senior") return "power3-passive";
  return planId;
}

function boundedText(value, label, maxLength, minLength = 1) {
  const text = String(value || "").trim();
  if (text.length < minLength) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} cannot exceed ${maxLength} characters.`);
  return text;
}

function validateGcashNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  if (!/^09\d{9}$/.test(number)) throw new Error("Enter an 11-digit GCash number starting with 09.");
  return number;
}

function validatePersonName(value, label = "Name") {
  const name = boundedText(value, label, 30);
  if (!/^[\p{L} .'-]+$/u.test(name)) throw new Error(`${label} may only contain letters and normal name punctuation.`);
  return name;
}

function validateF3Wallet(value) {
  const wallet = boundedText(value, "F3 wallet", 52);
  if (!/^[A-Za-z0-9:_-]+$/.test(wallet)) throw new Error("F3 wallet contains unsupported characters.");
  return wallet;
}

const DEFAULT_DB = {
  pending: [],
  members: [],
  positions: [],
  exitActions: [],
  rewardLedger: [],
  withdrawalRequests: [],
  upgradeRequests: [],
  productPlusClaims: [],
  logs: [],
  settings: {}
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicAccount(account) {
  if (!account) return null;
  const { passwordHash, ...safe } = account;
  return safe;
}

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    writeDatabase(clone(DEFAULT_DB));
    return;
  }

  const db = readDatabase();
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_DB)) {
    if (typeof db[key] === "undefined") {
      db[key] = clone(value);
      changed = true;
    }
  }
  if (!db.settings.adminPasswordHash) {
    db.settings.adminPasswordHash = hashPassword(db.settings.adminPassword || "admin123");
    delete db.settings.adminPassword;
    changed = true;
  }
  if (normalizeStoredPlans(db)) changed = true;
  const usedAccountCodes = new Set();
  for (const member of db.members || []) {
    const normalizedCode = String(member.accountCode || "").trim().toUpperCase();
    if (!normalizedCode || usedAccountCodes.has(normalizedCode)) {
      member.accountCode = generateAccountCode(db, usedAccountCodes);
      changed = true;
    } else {
      member.accountCode = normalizedCode;
    }
    usedAccountCodes.add(member.accountCode);
    if (!member.passwordHash) {
      member.passwordHash = hashPassword(LEGACY_SANDBOX_PASSWORD);
      changed = true;
    }
  }
  for (const pending of db.pending || []) {
    if (!pending.passwordHash) {
      pending.passwordHash = hashPassword(LEGACY_SANDBOX_PASSWORD);
      changed = true;
    }
  }
  for (const member of (db.members || []).filter(item => item.status === "active")) {
    const beforeCount = (db.rewardLedger || []).length;
    ensureEntryRewardLedger(db, member);
    if ((db.rewardLedger || []).length !== beforeCount) changed = true;
  }
  const currentRules = getMatrixRules();
  for (const action of (db.exitActions || []).filter(item => item.status === "approved")) {
    const exitRule = (currentRules.exits || []).find(item => item.exit === action.exit);
    if (!exitRule) continue;
    const beforeCount = (db.rewardLedger || []).length;
    createExitRewardLedger(db, action.memberId, exitRule, action.approvedAt || action.createdAt);
    if ((db.rewardLedger || []).length !== beforeCount) changed = true;
  }
  if (migrateSandboxRewardSchedule(db)) changed = true;
  for (const request of db.upgradeRequests || []) {
    if (request.status === "pending" && Number(request.amount) !== 1200) {
      request.amount = 1200;
      changed = true;
    }
  }
  const activeMemberIds = new Set((db.members || []).filter(item => item.status === "active").map(item => item.id));
  const memberIds = new Set((db.members || []).map(item => item.id));
  const validRewardLedger = (db.rewardLedger || []).filter(entry => activeMemberIds.has(entry.memberId));
  if (validRewardLedger.length !== (db.rewardLedger || []).length) {
    db.rewardLedger = validRewardLedger;
    changed = true;
  }
  for (const collectionName of ["upgradeRequests", "exitActions", "withdrawalRequests", "productPlusClaims"]) {
    const validRecords = (db[collectionName] || []).filter(record => memberIds.has(record.memberId));
    if (validRecords.length !== (db[collectionName] || []).length) {
      db[collectionName] = validRecords;
      changed = true;
    }
  }
  if (changed) writeDatabase(db);
}

function readDatabase() {
  ensureDataDirectoryOnly();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return { ...clone(DEFAULT_DB), ...JSON.parse(raw) };
  } catch (error) {
    return clone(DEFAULT_DB);
  }
}

function writeDatabase(db) {
  ensureDataDirectoryOnly();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getMatrixRules() {
  ensureDataDirectoryOnly();
  try {
    return JSON.parse(fs.readFileSync(MATRIX_RULES_FILE, "utf8"));
  } catch (error) {
    return {
      programName: "Matrix Power of Three Passive Income",
      matrixId: "power3-passive",
      matrixName: "Power of Three Passive Income",
      maxDirectDownlines: 3,
      entry: { holdF3: 20, holdPesoValue: 1200, tokenHoldingAllocation: 900, matrixAllocation: 300, passiveIncome: 231, passiveMonths: 3 },
      exits: []
    };
  }
}

function getApprovedExitLevel(db, memberId) {
  return (db.exitActions || [])
    .filter(action => action.memberId === memberId && action.status === "approved")
    .reduce((highest, action) => Math.max(highest, Number(action.exit || 0)), 0);
}

function countQualifiedDirectDownlines(db, memberId, requiredDownlineExit) {
  const directChildren = (db.positions || []).filter(position => position.parentMemberId === memberId);
  return directChildren.filter(position => getApprovedExitLevel(db, position.memberId) >= requiredDownlineExit).length;
}

function getExitStatuses(db, memberId) {
  const rules = getMatrixRules();
  return (rules.exits || []).map(exitRule => {
    const qualifiedDownlines = countQualifiedDirectDownlines(db, memberId, exitRule.requiredDownlineExit);
    const approvedAction = (db.exitActions || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "approved");
    const pendingAction = (db.exitActions || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "pending");
    const previousExitIsActive = exitRule.exit === 1 || (db.exitActions || []).some(action =>
      action.memberId === memberId && action.exit === exitRule.exit - 1 && action.status === "approved"
    );
    let status = "locked";
    if (previousExitIsActive && qualifiedDownlines >= rules.maxDirectDownlines) status = "qualified";
    if (pendingAction) status = "pending";
    if (approvedAction) status = "active";

    return {
      ...exitRule,
      qualifiedDownlines,
      requiredDownlines: rules.maxDirectDownlines,
      status,
      approvedAt: approvedAction ? approvedAction.approvedAt : null,
      requestedAt: pendingAction ? pendingAction.createdAt : null
    };
  });
}

function ensureEntryRewardLedger(db, member) {
  const rules = getMatrixRules();
  const alreadyCreated = (db.rewardLedger || []).some(entry => entry.memberId === member.id && entry.sourceType === "entry");
  if (alreadyCreated || !rules.entry) return;

  for (let month = 1; month <= Number(rules.entry.passiveMonths || 0); month += 1) {
    const dueDate = new Date(member.approvedAt || new Date().toISOString());
    dueDate.setMonth(dueDate.getMonth() + month);
    db.rewardLedger.push({
      id: generateUUID(),
      memberId: member.id,
      sourceType: "entry",
      sourceLabel: "Entry Passive Income",
      amount: rules.entry.passiveIncome,
      dueAt: dueDate.toISOString(),
      status: "due",
      createdAt: new Date().toISOString()
    });
  }
}

function endOfFollowingMonth(approvalAt, monthNumber) {
  const approved = new Date(approvalAt || new Date().toISOString());
  return new Date(Date.UTC(approved.getUTCFullYear(), approved.getUTCMonth() + monthNumber + 1, 0, 23, 59, 59, 999));
}

function createExitRewardLedger(db, memberId, exitRule, approvalAt = new Date().toISOString()) {
  const passiveExists = (db.rewardLedger || []).some(entry => entry.memberId === memberId && entry.sourceType === "exit" && entry.exit === exitRule.exit);

  if (!passiveExists) {
    for (let month = 1; month <= Number(exitRule.passiveMonths || 0); month += 1) {
      db.rewardLedger.push({
        id: generateUUID(), memberId, sourceType: "exit",
        sourceLabel: `Exit ${exitRule.exit} Passive Income`, exit: exitRule.exit,
        amount: exitRule.passiveIncome, dueAt: endOfFollowingMonth(approvalAt, month).toISOString(),
        status: "due", createdAt: new Date().toISOString()
      });
    }
  }

  const matrixExists = (db.rewardLedger || []).some(entry => entry.memberId === memberId && entry.sourceType === "matrix" && entry.exit === exitRule.exit);
  if (!matrixExists && Number(exitRule.matrixIncome || 0) > 0) {
    for (let month = 1; month <= Number(exitRule.matrixMonths || 0); month += 1) {
      db.rewardLedger.push({
        id: generateUUID(), memberId, sourceType: "matrix",
        sourceLabel: `Exit ${exitRule.exit} Matrix Income`, exit: exitRule.exit,
        amount: exitRule.matrixIncome, dueAt: endOfFollowingMonth(approvalAt, month).toISOString(),
        status: "due", createdAt: new Date().toISOString()
      });
    }
  }
}

function migrateSandboxRewardSchedule(db) {
  db.settings = db.settings || {};
  if (Number(db.settings.rewardScheduleVersion || 0) >= 2) return false;

  const groups = new Map();
  for (const entry of db.rewardLedger || []) {
    const key = `${entry.memberId}:${entry.sourceType}:${entry.exit || "entry"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  for (const entries of groups.values()) {
    entries.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    const first = entries[0];
    const member = (db.members || []).find(item => item.id === first.memberId);
    const exitAction = first.sourceType === "exit"
      ? (db.exitActions || []).find(action => action.memberId === first.memberId && action.exit === first.exit && action.status === "approved")
      : null;
    const approvalAt = first.sourceType === "entry"
      ? member && member.approvedAt
      : exitAction && (exitAction.approvedAt || exitAction.createdAt);
    if (!approvalAt) continue;

    const oldFirstDue = Math.abs(new Date(first.dueAt).getTime() - new Date(approvalAt).getTime()) < 24 * 60 * 60 * 1000;
    if (!oldFirstDue) continue;
    for (const entry of entries) {
      if (Number(entry.withdrawnAmount || 0) > 0) continue;
      const shifted = new Date(entry.dueAt);
      shifted.setMonth(shifted.getMonth() + 1);
      entry.dueAt = shifted.toISOString();
    }
  }

  db.settings.rewardScheduleVersion = 2;
  return true;
}

function getProductPlusEntitlements(db, memberId) {
  const rules = getMatrixRules();
  const claims = db.productPlusClaims || [];
  return (rules.exits || [])
    .filter(exitRule => exitRule.productSpend > 0)
    .map(exitRule => {
      const approvedAction = (db.exitActions || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "approved");
      const productBaseSpend = Number(exitRule.productSpend || 0);
      const monthlyBonus = productBaseSpend * (Number(exitRule.productBonusPercent || 0) / 100);
      const monthlySpend = productBaseSpend;
      const productMonths = Number(exitRule.productMonths || 0);
      const totalSpend = monthlySpend * productMonths;
      const totalBonus = monthlyBonus * productMonths;
      let vestedMonths = 0;
      let nextUnlockAt = null;
      for (let month = 1; month <= productMonths; month += 1) {
        const unlockAt = approvedAction ? endOfFollowingMonth(approvedAction.approvedAt || approvedAction.createdAt, month) : null;
        const vested = Boolean(unlockAt && unlockAt <= new Date());
        if (vested) vestedMonths += 1;
        else if (!nextUnlockAt && unlockAt) nextUnlockAt = unlockAt.toISOString();
      }
      const vestedSpend = monthlySpend * vestedMonths;
      const memberClaims = claims.filter(claim => claim.memberId === memberId && claim.exit === exitRule.exit);
      const approvedSpend = memberClaims
        .filter(claim => claim.status === "approved")
        .reduce((total, claim) => total + Number(claim.spendAmount || 0), 0);
      const pendingSpend = memberClaims
        .filter(claim => claim.status === "pending")
        .reduce((total, claim) => total + Number(claim.spendAmount || 0), 0);
      return {
        exit: exitRule.exit,
        active: Boolean(approvedAction),
        productSpend: monthlySpend,
        productBaseSpend,
        monthlyBonus,
        monthlySpend,
        productMonths,
        productBonusPercent: exitRule.productBonusPercent,
        totalSpend,
        totalBonus,
        vestedMonths,
        vestedSpend,
        nextUnlockAt,
        approvedSpend,
        pendingSpend,
        remainingSpend: Math.max(totalSpend - approvedSpend - pendingSpend, 0),
        availableVestedSpend: Math.max(vestedSpend - approvedSpend - pendingSpend, 0),
        status: approvedAction ? "active" : "locked"
      };
    });
}

function getAvailableBalance(db, memberId) {
  const now = new Date();
  const dueRewards = (db.rewardLedger || []).filter(entry => entry.memberId === memberId && entry.status === "due" && new Date(entry.dueAt) <= now);
  const pendingWithdrawals = (db.withdrawalRequests || [])
    .filter(request => request.memberId === memberId && request.status === "pending")
    .reduce((total, request) => total + Number(request.amount || 0), 0);
  const pendingExitBuys = (db.exitActions || [])
    .filter(request => request.memberId === memberId && request.status === "pending" && request.paymentMethod === "available_balance")
    .reduce((total, request) => total + Number(request.actionAmount || 0), 0);
  const available = dueRewards.reduce((total, entry) => total + Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0), 0) - pendingWithdrawals - pendingExitBuys;
  return Math.max(available, 0);
}

function applyBalancePayment(db, memberId, amount) {
  let remaining = Number(amount || 0);
  const now = new Date();
  const dueRewards = (db.rewardLedger || [])
    .filter(entry => entry.memberId === memberId && entry.status === "due" && new Date(entry.dueAt) <= now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  for (const entry of dueRewards) {
    if (remaining <= 0) break;
    const available = Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0);
    const applied = Math.min(available, remaining);
    entry.withdrawnAmount = Number(entry.withdrawnAmount || 0) + applied;
    if (entry.withdrawnAmount >= Number(entry.amount || 0)) {
      entry.status = "paid";
      entry.paidAt = new Date().toISOString();
    }
    remaining -= applied;
  }
  if (remaining > 0) throw new Error("Not enough balance");
}

function getWithdrawalOrigins(db, memberId, requestedAmount) {
  const now = new Date();
  let remaining = Number(requestedAmount || 0);
  const origins = [];
  const dueRewards = (db.rewardLedger || [])
    .filter(entry => entry.memberId === memberId && entry.status === "due" && new Date(entry.dueAt) <= now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  for (const entry of dueRewards) {
    if (remaining <= 0) break;
    const available = Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0);
    if (available <= 0) continue;
    const applied = Math.min(available, remaining);
    origins.push({
      ledgerId: entry.id,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      exit: entry.exit || null,
      dueAt: entry.dueAt,
      amount: applied
    });
    remaining -= applied;
  }
  return origins;
}

function normalizeStoredPlans(db) {
  let changed = false;
  for (const pending of db.pending || []) {
    const normalized = normalizePlanId(pending.requestedPlanId);
    if (pending.requestedPlanId !== normalized) {
      pending.requestedPlanId = normalized;
      changed = true;
    }
  }
  for (const position of db.positions || []) {
    const normalized = normalizePlanId(position.planId);
    if (position.planId !== normalized) {
      position.planId = normalized;
      changed = true;
    }
  }
  return changed;
}

function ensureDataDirectoryOnly() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : `srv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addActivityLog(db, type, message) {
  db.logs.unshift({
    id: generateUUID(),
    type,
    message,
    createdAt: new Date().toISOString()
  });
  if (db.logs.length > 100) db.logs.length = 100;
}

function findMemberByUsername(db, username) {
  if (!username) return null;
  const cleanUsername = username.trim().toLowerCase();
  return db.members.find(member => member.username.trim().toLowerCase() === cleanUsername) || null;
}

function findMemberByAccountCode(db, accountCode) {
  const cleanCode = String(accountCode || "").trim().toUpperCase();
  if (!cleanCode) return null;
  return db.members.find(member => String(member.accountCode || "").trim().toUpperCase() === cleanCode) || null;
}

function generateAccountCode(db, additionalCodes = new Set()) {
  const used = new Set((db.members || []).map(member => String(member.accountCode || "").trim().toUpperCase()).filter(Boolean));
  for (const code of additionalCodes) used.add(code);
  let code;
  do {
    code = `MCS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  } while (used.has(code));
  return code;
}

function getReservedChildren(db, parentMemberId, planId, excludedMemberId = null) {
  const positionedIds = new Set(db.positions.filter(item => item.planId === planId).map(item => item.memberId));
  return db.members.filter(member => member.id !== excludedMemberId && member.sponsorId === parentMemberId && !positionedIds.has(member.id));
}

function getOccupiedChildCount(db, parentMemberId, planId, excludedMemberId = null) {
  const placed = db.positions.filter(item => item.parentMemberId === parentMemberId && item.planId === planId && item.memberId !== excludedMemberId).length;
  return placed + getReservedChildren(db, parentMemberId, planId, excludedMemberId).length;
}

function getMemberTree(db, memberId, planId) {
  const plan = MATRIX_PLANS[planId];
  if (!plan) return null;

  const member = db.members.find(item => item.id === memberId);
  const position = db.positions.find(item => item.memberId === memberId && item.planId === planId);
  if (!member || !position) return null;

  const buildTree = (currentMemberId, includeChildren = true) => {
    const currentMember = db.members.find(item => item.id === currentMemberId);
    if (!currentMember) return null;
    const currentPosition = db.positions.find(item => item.memberId === currentMemberId && item.planId === planId);
    const parentMember = currentPosition && currentPosition.parentMemberId
      ? db.members.find(item => item.id === currentPosition.parentMemberId)
      : null;

    const children = includeChildren
      ? db.positions
        .filter(item => item.parentMemberId === currentMemberId && item.planId === planId)
        .map(item => buildTree(item.memberId, false))
        .filter(Boolean)
      : [];

    for (const referredMember of includeChildren ? getReservedChildren(db, currentMemberId, planId) : []) {
      children.push({
        id: referredMember.id,
        fullName: referredMember.fullName,
        username: referredMember.username,
        accountCode: referredMember.accountCode,
        walletAddress: referredMember.walletAddress,
        isReferralPending: true,
        matrixStage: { label: "Not Registered", status: "registered", exit: 0 },
        children: []
      });
    }

    const openSlots = includeChildren ? Math.max(plan.maxChildren - children.length, 0) : 0;
    for (let index = 0; index < openSlots; index += 1) {
      children.push({ isOpenSlot: true, label: "Open Spot" });
    }

    const progressedExits = getExitStatuses(db, currentMemberId)
      .filter(exit => exit.status !== "locked")
      .sort((a, b) => Number(b.exit) - Number(a.exit));
    const currentExit = progressedExits[0] || null;

    return {
      id: currentMember.id,
      fullName: currentMember.fullName,
      username: currentMember.username,
      walletAddress: currentMember.walletAddress,
      planId,
      parent: parentMember ? {
        id: parentMember.id,
        fullName: parentMember.fullName,
        username: parentMember.username,
        accountCode: parentMember.accountCode
      } : null,
      matrixStage: currentExit
        ? { label: `Exit ${currentExit.exit}`, status: currentExit.status, exit: currentExit.exit }
        : { label: "Entry", status: "active", exit: 0 },
      children
    };
  };

  return buildTree(memberId);
}

function seedSampleData(db) {
  db.pending = [];
  db.members = [];
  db.positions = [];
  db.exitActions = [];
  db.rewardLedger = [];
  db.withdrawalRequests = [];
  db.productPlusClaims = [];
  db.logs = [];

  const now = new Date();
  const daysAgo = (days) => {
    const date = new Date(now);
    date.setDate(now.getDate() - days);
    return date.toISOString();
  };

  db.members = [
    { id: "member-arthur", accountCode: "MATRIX-0001", fullName: "Arthur Pendragon", username: "arthur", email: "arthur@matrix.io", phone: "+639111111111", walletAddress: "0xArthurAddress111111111111111111111111", sponsorId: null, status: "active", createdAt: daysAgo(10), approvedAt: daysAgo(9), cumulativeF3Tokens: 20 },
    { id: "member-lancelot", accountCode: "MATRIX-0002", fullName: "Lancelot Du Lac", username: "lancelot", email: "lancelot@matrix.io", phone: "+639444444444", walletAddress: "0xLancelotAddress444444444444444444444", sponsorId: "member-arthur", status: "active", createdAt: daysAgo(8), approvedAt: daysAgo(8), cumulativeF3Tokens: 20 },
    { id: "member-gawain", accountCode: "MATRIX-0003", fullName: "Gawain Orkney", username: "gawain", email: "gawain@matrix.io", phone: "+639555555555", walletAddress: "0xGawainAddress55555555555555555555555", sponsorId: "member-arthur", status: "active", createdAt: daysAgo(8), approvedAt: daysAgo(8), cumulativeF3Tokens: 20 },
    { id: "member-percival", accountCode: "MATRIX-0004", fullName: "Percival Wales", username: "percival", email: "percival@matrix.io", phone: "+639666666666", walletAddress: "0xPercivalAddress666666666666666666666", sponsorId: "member-arthur", status: "active", createdAt: daysAgo(7), approvedAt: daysAgo(7), cumulativeF3Tokens: 20 },
    { id: "member-galahad", accountCode: "MATRIX-0005", fullName: "Galahad Pure", username: "galahad", email: "galahad@matrix.io", phone: "+639777777777", walletAddress: "0xGalahadAddress777777777777777777777", sponsorId: "member-lancelot", status: "active", createdAt: daysAgo(6), approvedAt: daysAgo(6), cumulativeF3Tokens: 20 }
  ];

  db.positions = [
    { id: "pos-arthur", memberId: "member-arthur", planId: "power3-passive", parentMemberId: null, placedAt: daysAgo(9) },
    { id: "pos-lancelot", memberId: "member-lancelot", planId: "power3-passive", parentMemberId: "member-arthur", placedAt: daysAgo(8) },
    { id: "pos-gawain", memberId: "member-gawain", planId: "power3-passive", parentMemberId: "member-arthur", placedAt: daysAgo(8) },
    { id: "pos-percival", memberId: "member-percival", planId: "power3-passive", parentMemberId: "member-arthur", placedAt: daysAgo(7) },
    { id: "pos-galahad", memberId: "member-galahad", planId: "power3-passive", parentMemberId: "member-lancelot", placedAt: daysAgo(6) }
  ];

  db.pending = [
    { id: "pending-req-1", fullName: "Mordred Orkney", username: "mordred", email: "mordred@matrix.io", phone: "+639121212121", walletAddress: "0xMordredAddress12121212121212121212", sponsorUsername: "lancelot", requestedPlanId: "power3-passive", status: "pending", createdAt: daysAgo(1) }
  ];

  db.members.forEach(member => ensureEntryRewardLedger(db, member));

  addActivityLog(db, "system", "Sample demonstration data seeded.");
  addActivityLog(db, "system", "Power of Three sample matrix established.");
}

function handleAction(action, payload, auth = null) {
  ensureDatabase();
  const db = readDatabase();
  let shouldWrite = false;
  let data;

  switch (action) {
    case "authenticateMember": {
      const credential = String(payload.credential || "").trim().toLowerCase();
      const account = [...(db.members || []), ...(db.pending || [])].find(item =>
        String(item.email || "").toLowerCase() === credential ||
        String(item.walletAddress || "").toLowerCase() === credential
      );
      if (!account || !passwordMatches(payload.password, account.passwordHash)) throw new Error("Incorrect email, wallet address, or password.");
      data = { token: createAuthSession("member", account.id), account: { ...account, passwordHash: undefined } };
      break;
    }
    case "authenticateAdmin": {
      if (!passwordMatches(payload.password, db.settings.adminPasswordHash)) {
        throw new Error("Incorrect admin password. Please try again.");
      }
      data = { token: createAuthSession("admin") };
      break;
    }
    case "initializeDatabase":
      data = true;
      break;
    case "getSettings":
      data = { ...db.settings, adminPasswordHash: undefined };
      break;
    case "getMatrixRules":
      data = getMatrixRules();
      break;
    case "getMemberMatrixSummary": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) {
        data = null;
        break;
      }
      const ledger = db.rewardLedger || [];
      const now = new Date();
      const dueRewards = ledger.filter(entry => entry.memberId === member.id && new Date(entry.dueAt) <= now);
      const earnedBalance = dueRewards
        .filter(entry => entry.status === "due")
        .reduce((total, entry) => total + Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0), 0);
      const pendingExitBalance = (db.exitActions || [])
        .filter(request => request.memberId === member.id && request.status === "pending" && request.paymentMethod === "available_balance")
        .reduce((total, request) => total + Number(request.actionAmount || 0), 0);
      const memberPosition = db.positions.find(position => position.memberId === member.id);
      const childrenByParent = new Map();
      db.positions.forEach(position => {
        if (!memberPosition || position.planId !== memberPosition.planId || !position.parentMemberId) return;
        const children = childrenByParent.get(position.parentMemberId) || [];
        children.push(position.memberId);
        childrenByParent.set(position.parentMemberId, children);
      });
      const visitedDescendants = new Set([member.id]);
      const pendingDescendants = [...(childrenByParent.get(member.id) || [])];
      let descendantCount = 0;
      while (pendingDescendants.length) {
        const descendantId = pendingDescendants.pop();
        if (visitedDescendants.has(descendantId)) continue;
        visitedDescendants.add(descendantId);
        descendantCount += 1;
        pendingDescendants.push(...(childrenByParent.get(descendantId) || []));
      }
      data = {
        rules: getMatrixRules(),
        exits: getExitStatuses(db, member.id),
        rewardLedger: ledger.filter(entry => entry.memberId === member.id),
        earnedBalance,
        pendingExitBalance,
        descendantCount,
        pendingWithdrawal: (db.withdrawalRequests || [])
          .filter(request => request.memberId === member.id && request.status === "pending")
          .reduce((total, request) => total + Number(request.amount || 0), 0),
        productPlusClaims: (db.productPlusClaims || []).filter(claim => claim.memberId === member.id),
        productPlusEntitlements: getProductPlusEntitlements(db, member.id)
      };
      break;
    }
    case "saveSettings":
      {
        const updates = { ...(payload.settings || payload) };
        if (updates.adminPassword) {
          updates.adminPasswordHash = hashPassword(boundedText(updates.adminPassword, "Admin password", 128, 8));
          delete updates.adminPassword;
        }
        db.settings = { ...db.settings, ...updates };
      }
      addActivityLog(db, "system", "Settings updated.");
      shouldWrite = true;
      data = db.settings;
      break;
    case "getPendingRegistrations":
      data = db.pending.map(publicAccount);
      break;
    case "getExitActionRequests":
      data = (db.exitActions || []).map(action => {
        const member = db.members.find(item => item.id === action.memberId);
        return {
          ...action,
          fullName: member ? member.fullName : "Unknown",
          username: member ? member.username : "unknown"
        };
      });
      break;
    case "getWithdrawalRequests":
      data = (db.withdrawalRequests || []).map(request => {
        const member = db.members.find(item => item.id === request.memberId);
        return {
          ...request,
          fullName: member ? member.fullName : "Unknown",
          username: member ? member.username : "unknown"
        };
      });
      break;
    case "getUpgradeRequests":
      data = (db.upgradeRequests || []).map(request => { const member = db.members.find(item => item.id === request.memberId); const sponsor = member && member.sponsorId ? db.members.find(item => item.id === member.sponsorId) : null; return { ...request, fullName: member ? member.fullName : "Unknown", username: member ? member.username : "unknown", accountCode: member ? member.accountCode : "", walletAddress: member ? member.walletAddress : "", fixedParentId: sponsor ? sponsor.id : null, fixedParentName: sponsor ? sponsor.fullName : null, fixedParentCode: sponsor ? sponsor.accountCode : null }; });
      break;
    case "getMemberWithdrawalRequests":
      data = (db.withdrawalRequests || [])
        .filter(request => request.memberId === payload.memberId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case "getProductPlusClaims":
      data = (db.productPlusClaims || []).map(claim => {
        const member = db.members.find(item => item.id === claim.memberId);
        return {
          ...claim,
          fullName: member ? member.fullName : "Unknown",
          username: member ? member.username : "unknown"
        };
      });
      break;
    case "getMembers":
      data = db.members.map(publicAccount);
      break;
    case "getPositions":
      data = db.positions;
      break;
    case "getMemberById":
      data = publicAccount(db.members.find(item => item.id === payload.memberId));
      break;
    case "getMemberByUsername":
      data = publicAccount(findMemberByUsername(db, payload.username));
      break;
    case "getMemberByAccountCode":
      data = publicAccount(findMemberByAccountCode(db, payload.accountCode));
      break;
    case "getMemberByCredential": {
      const cleanCred = String(payload.emailOrWallet || "").trim().toLowerCase();
      data = publicAccount(db.members.find(item => item.email.trim().toLowerCase() === cleanCred || item.walletAddress.trim().toLowerCase() === cleanCred || String(item.accountCode || "").trim().toLowerCase() === cleanCred));
      break;
    }
    case "registerPending": {
      const memberData = payload.memberData || payload;
      const fullName = validatePersonName(memberData.fullName, "Full name");
      const username = boundedText(memberData.username, "Username", 30);
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error("Username contains unsupported characters.");
      const email = boundedText(memberData.email, "Email", 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      const phone = validateGcashNumber(memberData.phone);
      const wallet = validateF3Wallet(memberData.walletAddress);
      const password = boundedText(payload.password, "Password", 128, 8);
      const existsInMembers = db.members.some(item => item.username.toLowerCase() === username.toLowerCase() || item.email.toLowerCase() === email.toLowerCase() || item.walletAddress.toLowerCase() === wallet.toLowerCase());
      const existsInPending = db.pending.some(item => (item.status === "pending" || item.status === "active") && (item.username.toLowerCase() === username.toLowerCase() || item.email.toLowerCase() === email.toLowerCase() || item.walletAddress.toLowerCase() === wallet.toLowerCase()));
      if (existsInMembers || existsInPending) throw new Error("Username, Email, or Wallet Address is already registered or has a pending request.");
      const referralCode = String(memberData.referralCode || memberData.sponsorUsername || "").trim();
      const sponsor = referralCode ? (findMemberByAccountCode(db, referralCode) || findMemberByUsername(db, referralCode)) : null;
      if (referralCode && !sponsor) throw new Error("Upline Account ID / referral code was not found.");
      if (sponsor) {
        const sponsorPosition = db.positions.find(item => item.memberId === sponsor.id && item.planId === "power3-passive");
        if (!sponsorPosition) throw new Error("This referral code cannot accept members until its owner activates Entry.");
        if (getOccupiedChildCount(db, sponsor.id, "power3-passive") >= MATRIX_PLANS["power3-passive"].maxChildren) throw new Error("This upline already has all three direct positions reserved.");
      }
      const newRequest = {
        id: generateUUID(),
        accountCode: generateAccountCode(db),
        fullName,
        username,
        email,
        phone,
        walletAddress: wallet,
        passwordHash: hashPassword(password),
        sponsorId: sponsor ? sponsor.id : null,
        status: "registered",
        cumulativeF3Tokens: 0,
        createdAt: new Date().toISOString()
      };
      db.members.push(newRequest);
      addActivityLog(db, "registration", `New free account for ${newRequest.fullName} (${newRequest.username})`);
      shouldWrite = true;
      data = newRequest;
      break;
    }
    case "requestUpgrade": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      if (member.status === "active") throw new Error("Entry is already active.");
      const referenceNumber = String(payload.referenceNumber || "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{6,40}$/.test(referenceNumber)) throw new Error("Enter a valid GCash reference number.");
      if ((db.upgradeRequests || []).some(item => item.referenceNumber === referenceNumber)) throw new Error("This reference number is already in use.");
      if ((db.upgradeRequests || []).some(item => item.memberId === member.id && item.status === "pending")) throw new Error("You already have a pending Entry request.");
      const request = { id: generateUUID(), memberId: member.id, planId: "power3-passive", amount: 1200, referenceNumber, status: "pending", createdAt: new Date().toISOString() };
      db.upgradeRequests.push(request); shouldWrite = true; data = request;
      addActivityLog(db, "upgrade-request", `${member.fullName} requested Entry activation.`);
      break;
    }
    case "approveUpgrade": {
      const request = (db.upgradeRequests || []).find(item => item.id === payload.requestId);
      if (!request || request.status !== "pending") throw new Error("Upgrade request is no longer pending.");
      const member = db.members.find(item => item.id === request.memberId);
      const parentMemberId = member.sponsorId || payload.parentMemberId || null;
      if (parentMemberId) {
        const parentPosition = db.positions.find(item => item.memberId === parentMemberId && item.planId === request.planId);
        if (!parentPosition) throw new Error("The referral upline is not placed in this matrix.");
        if (getOccupiedChildCount(db, parentMemberId, request.planId, member.id) >= 3) throw new Error("Selected parent has no open slots.");
      } else if (db.positions.some(item => item.planId === request.planId && item.parentMemberId === null)) throw new Error("Select a parent because a root already exists.");
      member.status = "active"; member.approvedAt = new Date().toISOString(); member.cumulativeF3Tokens = 20;
      db.positions.push({ id: generateUUID(), memberId: member.id, planId: request.planId, parentMemberId, placedAt: member.approvedAt });
      ensureEntryRewardLedger(db, member); request.status = "approved"; request.approvedAt = member.approvedAt; shouldWrite = true; data = request;
      break;
    }
    case "rejectUpgrade": { const request = (db.upgradeRequests || []).find(item => item.id === payload.requestId); if (!request || request.status !== "pending") throw new Error("Upgrade request is no longer pending."); request.status="rejected"; request.rejectedAt=new Date().toISOString(); shouldWrite=true; data=request; break; }
    case "approveAndPlace": {
      const pendingIndex = db.pending.findIndex(item => item.id === payload.pendingId);
      if (pendingIndex === -1) throw new Error("Pending registration request not found.");
      const pending = db.pending[pendingIndex];
      if (pending.status !== "pending") throw new Error("This request is no longer pending.");

      const plan = MATRIX_PLANS[normalizePlanId(pending.requestedPlanId)];
      if (!plan) throw new Error("Invalid matrix plan selected.");

      const isDuplicate = db.members.some(item => item.username.toLowerCase() === pending.username.toLowerCase() || item.email.toLowerCase() === pending.email.toLowerCase() || item.walletAddress.toLowerCase() === pending.walletAddress.toLowerCase());
      if (isDuplicate) throw new Error("A member with these details has already been approved.");

      const parentMemberId = payload.parentMemberId || null;
      const isRoot = !parentMemberId;
      if (isRoot) {
        const rootExists = db.positions.some(item => item.planId === plan.id && item.parentMemberId === null);
        if (rootExists) throw new Error(`A root member already exists for the ${plan.name} plan. You must select a parent.`);
      } else {
        const parent = db.members.find(item => item.id === parentMemberId);
        if (!parent) throw new Error("Selected parent member does not exist.");
        const parentPosition = db.positions.find(item => item.memberId === parent.id && item.planId === plan.id);
        if (!parentPosition) throw new Error("Selected parent is not placed in the requested matrix plan.");
        const currentChildren = db.positions.filter(item => item.parentMemberId === parent.id && item.planId === plan.id);
        if (currentChildren.length >= plan.maxChildren) throw new Error(`Selected parent already has the maximum of ${plan.maxChildren} children in this plan.`);
      }

      const sponsor = pending.sponsorUsername ? findMemberByUsername(db, pending.sponsorUsername) : null;
      const newMember = {
        id: pending.id,
        accountCode: generateAccountCode(db),
        fullName: pending.fullName,
        username: pending.username,
        email: pending.email,
        phone: pending.phone,
        walletAddress: pending.walletAddress,
        sponsorId: sponsor ? sponsor.id : null,
        status: "active",
        createdAt: pending.createdAt,
        approvedAt: new Date().toISOString(),
        cumulativeF3Tokens: 20
      };
      db.members.push(newMember);
      db.positions.push({ id: generateUUID(), memberId: newMember.id, planId: plan.id, parentMemberId: isRoot ? null : parentMemberId, placedAt: new Date().toISOString() });
      ensureEntryRewardLedger(db, newMember);
      pending.status = "approved";
      db.pending[pendingIndex] = pending;
      addActivityLog(db, "approval", `Approved & placed member ${newMember.fullName} (${newMember.username}) in ${plan.name}`);
      shouldWrite = true;
      data = newMember;
      break;
    }
    case "requestExitAction": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      const exit = Number(payload.exit);
      const rules = getMatrixRules();
      const exitRule = (rules.exits || []).find(item => item.exit === exit);
      if (!exitRule) throw new Error("Exit rule not found.");
      if (exit > 1 && !(db.exitActions || []).some(action => action.memberId === member.id && action.exit === exit - 1 && action.status === "approved")) {
        throw new Error("The previous Exit must be approved first.");
      }
      const status = getExitStatuses(db, member.id).find(item => item.exit === exit);
      if (!status || status.status !== "qualified") throw new Error("This exit is not qualified for action yet.");
      const existing = (db.exitActions || []).find(action => action.memberId === member.id && action.exit === exit && (action.status === "pending" || action.status === "approved"));
      if (existing) throw new Error("An action request already exists for this exit.");
      const details = payload.details || {};
      const paymentMethod = String(details.paymentMethod || "").trim();
      if (exitRule.actionType === "reinvest") {
        validateF3Wallet(details.f3Wallet);
      } else if (paymentMethod === "available_balance") {
        if (getAvailableBalance(db, member.id) < Number(exitRule.actionAmount)) throw new Error("Not enough balance");
      } else {
        validatePersonName(details.gcashName, "GCash name");
        validateGcashNumber(details.gcashNumber);
        if (!/^[A-Za-z0-9-]{6,40}$/.test(String(details.referenceNumber || "").trim())) throw new Error("Enter a valid 6–40 character GCash reference.");
      }
      const request = {
        id: generateUUID(),
        memberId: member.id,
        exit,
        actionType: exitRule.actionType,
        actionAmount: exitRule.actionAmount,
        paymentMethod: exitRule.actionType === "reinvest" ? "f3_wallet" : (paymentMethod === "available_balance" ? "available_balance" : "gcash"),
        f3Wallet: String(details.f3Wallet || "").trim().slice(0, 52),
        gcashName: String(details.gcashName || "").trim().slice(0, 30),
        gcashNumber: paymentMethod === "available_balance" ? "" : String(details.gcashNumber || "").replace(/\D/g, ""),
        referenceNumber: String(details.referenceNumber || "").trim(),
        status: "pending",
        createdAt: new Date().toISOString()
      };
      db.exitActions.push(request);
      addActivityLog(db, "exit-request", `${member.fullName} requested ${exitRule.actionLabel} for Exit ${exit}.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "approveExitAction": {
      const request = (db.exitActions || []).find(item => item.id === payload.requestId);
      if (!request) throw new Error("Exit action request not found.");
      if (request.status !== "pending") throw new Error("This request is no longer pending.");
      const rules = getMatrixRules();
      const exitRule = (rules.exits || []).find(item => item.exit === request.exit);
      if (!exitRule) throw new Error("Exit rule not found.");
      if (request.paymentMethod === "available_balance") {
        const availableIncludingReservation = getAvailableBalance(db, request.memberId) + Number(request.actionAmount || 0);
        if (availableIncludingReservation < Number(request.actionAmount || 0)) throw new Error("Not enough balance");
        applyBalancePayment(db, request.memberId, request.actionAmount);
      }
      request.status = "approved";
      request.approvedAt = new Date().toISOString();
      createExitRewardLedger(db, request.memberId, exitRule, request.approvedAt);
      const member = db.members.find(item => item.id === request.memberId);
      addActivityLog(db, "exit-approval", `Approved Exit ${request.exit} ${exitRule.actionLabel} for ${member ? member.fullName : request.memberId}.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "rejectExitAction": {
      const request = (db.exitActions || []).find(item => item.id === payload.requestId);
      if (!request) throw new Error("Exit action request not found.");
      if (request.status !== "pending") throw new Error("This request is no longer pending.");
      request.status = "rejected";
      request.rejectedAt = new Date().toISOString();
      addActivityLog(db, "exit-rejection", `Rejected Exit ${request.exit} action request.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "requestWithdrawal": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid withdrawal amount.");
      const availableBalance = getAvailableBalance(db, member.id);
      if (amount > availableBalance) throw new Error("Withdrawal amount exceeds available balance.");
      const accountName = String(payload.accountName || "").trim();
      validatePersonName(accountName, "GCash account name");
      const gcashNumber = validateGcashNumber(payload.gcashNumber);
      if (String(payload.payoutDetails || "").trim().length > 240) throw new Error("Notes cannot exceed 240 characters.");
      const withdrawalCode = `WD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const request = {
        id: generateUUID(),
        memberId: member.id,
        amount,
        payoutMethod: payload.payoutMethod || "GCash",
        payoutDetails: payload.payoutDetails || "",
        accountName,
        gcashNumber,
        withdrawalCode,
        origins: getWithdrawalOrigins(db, member.id, amount),
        status: "pending",
        createdAt: new Date().toISOString()
      };
      db.withdrawalRequests.push(request);
      addActivityLog(db, "withdrawal-request", `${member.fullName} requested PHP ${amount.toLocaleString()} withdrawal.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "approveWithdrawal": {
      const request = (db.withdrawalRequests || []).find(item => item.id === payload.requestId);
      if (!request) throw new Error("Withdrawal request not found.");
      if (request.status !== "pending") throw new Error("This withdrawal is no longer pending.");
      let remaining = Number(request.amount || 0);
      const now = new Date();
      const dueRewards = (db.rewardLedger || [])
        .filter(entry => entry.memberId === request.memberId && entry.status === "due" && new Date(entry.dueAt) <= now)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
      for (const entry of dueRewards) {
        if (remaining <= 0) break;
        const available = Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0);
        if (available > 0) {
          const applied = Math.min(available, remaining);
          entry.withdrawnAmount = Number(entry.withdrawnAmount || 0) + applied;
          remaining -= applied;
        }
        if (Number(entry.withdrawnAmount || 0) >= Number(entry.amount || 0)) {
          entry.status = "paid";
          entry.paidWithdrawalId = request.id;
          entry.paidAt = new Date().toISOString();
        }
      }
      if (remaining > 0) throw new Error("Not enough due balance remains for this withdrawal.");
      request.status = "approved";
      request.approvedAt = new Date().toISOString();
      addActivityLog(db, "withdrawal-approval", `Approved PHP ${Number(request.amount).toLocaleString()} withdrawal.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "rejectWithdrawal": {
      const request = (db.withdrawalRequests || []).find(item => item.id === payload.requestId);
      if (!request) throw new Error("Withdrawal request not found.");
      if (request.status !== "pending") throw new Error("This withdrawal is no longer pending.");
      request.status = "rejected";
      request.rejectedAt = new Date().toISOString();
      addActivityLog(db, "withdrawal-rejection", "Rejected withdrawal request.");
      shouldWrite = true;
      data = request;
      break;
    }
    case "requestProductPlusClaim": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      const exit = Number(payload.exit);
      const spendAmount = Number(payload.spendAmount);
      if (!Number.isFinite(spendAmount) || spendAmount <= 0) throw new Error("Invalid product spend amount.");
      const entitlement = getProductPlusEntitlements(db, member.id).find(item => item.exit === exit);
      if (!entitlement || !entitlement.active) throw new Error("Products Plus entitlement is not active for this exit.");
      if (spendAmount > entitlement.availableVestedSpend) throw new Error("Claim amount exceeds the Products Plus amount vested so far.");
      const purchaseReference = boundedText(payload.reference, "Purchase reference", 60, 3);
      if (!/^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$/.test(purchaseReference)) throw new Error("Purchase reference contains unsupported characters.");
      const purchaseNotes = String(payload.notes || "").trim();
      if (purchaseNotes.length > 240) throw new Error("Purchase notes cannot exceed 240 characters.");
      const claim = {
        id: generateUUID(),
        memberId: member.id,
        exit,
        spendAmount,
        bonusPercent: entitlement.productBonusPercent,
        bonusAmount: spendAmount * (entitlement.productBonusPercent / 100),
        purchaseReference,
        purchaseNotes,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      db.productPlusClaims.push(claim);
      addActivityLog(db, "products-plus-request", `${member.fullName} requested Products Plus claim for Exit ${exit}.`);
      shouldWrite = true;
      data = claim;
      break;
    }
    case "approveProductPlusClaim": {
      const claim = (db.productPlusClaims || []).find(item => item.id === payload.claimId);
      if (!claim) throw new Error("Products Plus claim not found.");
      if (claim.status !== "pending") throw new Error("This claim is no longer pending.");
      claim.status = "approved";
      claim.approvedAt = new Date().toISOString();
      addActivityLog(db, "products-plus-approval", `Approved Products Plus claim for Exit ${claim.exit}.`);
      shouldWrite = true;
      data = claim;
      break;
    }
    case "rejectProductPlusClaim": {
      const claim = (db.productPlusClaims || []).find(item => item.id === payload.claimId);
      if (!claim) throw new Error("Products Plus claim not found.");
      if (claim.status !== "pending") throw new Error("This claim is no longer pending.");
      claim.status = "rejected";
      claim.rejectedAt = new Date().toISOString();
      addActivityLog(db, "products-plus-rejection", `Rejected Products Plus claim for Exit ${claim.exit}.`);
      shouldWrite = true;
      data = claim;
      break;
    }
    case "rejectPending": {
      const pending = db.pending.find(item => item.id === payload.pendingId);
      if (!pending) throw new Error("Pending registration request not found.");
      pending.status = "rejected";
      addActivityLog(db, "rejection", `Rejected registration request for ${pending.fullName} (${pending.username})`);
      shouldWrite = true;
      data = pending;
      break;
    }
    case "deleteMember": {
      const memberIndex = db.members.findIndex(item => item.id === payload.memberId);
      if (memberIndex === -1) throw new Error("Member not found.");
      if (db.positions.some(item => item.parentMemberId === payload.memberId)) throw new Error("Cannot delete this member because they currently have children placed under them in the matrix tree.");
      if (db.members.some(item => item.sponsorId === payload.memberId)) throw new Error("Cannot delete this member because referred accounts are reserved under them.");
      const relatedRecords = [
        [db.upgradeRequests || [], "upgrade requests"],
        [db.exitActions || [], "Exit requests"],
        [db.rewardLedger || [], "reward ledger entries"],
        [db.withdrawalRequests || [], "withdrawal requests"],
        [db.productPlusClaims || [], "Products Plus claims"]
      ];
      const related = relatedRecords.find(([records]) => records.some(item => item.memberId === payload.memberId));
      if (related) throw new Error(`Cannot delete this member because they have ${related[1]}. Financial and approval history must be retained.`);
      const [member] = db.members.splice(memberIndex, 1);
      db.positions = db.positions.filter(item => item.memberId !== payload.memberId);
      db.pending = db.pending.filter(item => item.id !== payload.memberId);
      addActivityLog(db, "deletion", `Deleted member ${member.fullName} (${member.username})`);
      shouldWrite = true;
      data = true;
      break;
    }
    case "getPositionByMemberId":
      data = db.positions.find(item => item.memberId === payload.memberId) || null;
      break;
    case "getEligibleParents": {
      const plan = MATRIX_PLANS[payload.planId];
      if (!plan) {
        data = [];
        break;
      }
      const planPositions = db.positions.filter(item => item.planId === payload.planId);
      data = planPositions
        .map(position => {
          const member = db.members.find(item => item.id === position.memberId);
          const children = planPositions.filter(item => item.parentMemberId === position.memberId);
          const reservedCount = getReservedChildren(db, position.memberId, payload.planId).length;
          return {
            memberId: position.memberId,
            fullName: member ? member.fullName : "Unknown",
            username: member ? member.username : "unknown",
            childrenCount: children.length + reservedCount,
            placedChildrenCount: children.length,
            reservedCount,
            maxChildren: plan.maxChildren,
            slotsLeft: plan.maxChildren - children.length - reservedCount
          };
        })
        .filter(parent => parent.slotsLeft > 0);
      break;
    }
    case "getRootMembers":
      data = db.positions
        .filter(item => item.planId === payload.planId && item.parentMemberId === null)
        .map(position => db.members.find(member => member.id === position.memberId))
        .filter(Boolean);
      break;
    case "getMemberTree":
      data = getMemberTree(db, payload.memberId, payload.planId);
      break;
    case "getActivityLogs":
      data = db.logs;
      break;
    case "resetAllData":
      Object.assign(db, clone(DEFAULT_DB));
      addActivityLog(db, "system", "Database reset complete.");
      shouldWrite = true;
      data = true;
      break;
    case "exportData":
      data = JSON.stringify(db, null, 2);
      break;
    case "importData": {
      const imported = JSON.parse(payload.jsonData);
      db.pending = imported.pending || [];
      db.members = imported.members || [];
      db.positions = imported.positions || [];
      db.logs = imported.logs || [];
      db.settings = imported.settings || { adminPassword: "admin123" };
      addActivityLog(db, "system", "Database imported successfully.");
      shouldWrite = true;
      data = true;
      break;
    }
    case "seedSampleData":
      seedSampleData(db);
      shouldWrite = true;
      data = true;
      break;
    default:
      throw new Error(`Unknown MatrixDB action: ${action}`);
  }

  if (shouldWrite) writeDatabase(db);
  return data;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON request body."));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = pathname === "/vendor/supabase.js"
    ? SUPABASE_BROWSER_FILE
    : (pathname === "/js/runtime-config.js" && process.env.MATRIX_MODE === "sandbox")
      ? SANDBOX_RUNTIME_CONFIG
      : (pathname === "/upgrade-entry.html" && process.env.MATRIX_MODE !== "sandbox")
        ? PRODUCTION_ENTRY_PAGE
        : (pathname === "/admin.html" && process.env.MATRIX_MODE !== "sandbox")
          ? PRODUCTION_ADMIN_PAGE
      : path.normalize(path.join(PUBLIC_DIR, pathname));
  const isApprovedExternalFile = filePath === SUPABASE_BROWSER_FILE || filePath === SANDBOX_RUNTIME_CONFIG;
  if ((!isApprovedExternalFile && !filePath.startsWith(PUBLIC_DIR)) || filePath.includes(`${path.sep}.git${path.sep}`) || filePath.startsWith(DATA_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

ensureDatabase();

http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && requestUrl.pathname.startsWith("/api/matrix/")) {
    const action = requestUrl.pathname.replace("/api/matrix/", "");
    try {
      const payload = await readJsonBody(request);
      const auth = getAuthSession(request);
      const adminActions = new Set(["saveSettings", "approveAndPlace", "rejectPending", "approveUpgrade", "rejectUpgrade", "approveExitAction", "rejectExitAction", "approveWithdrawal", "rejectWithdrawal", "approveProductPlusClaim", "rejectProductPlusClaim", "deleteMember", "resetAllData", "importData", "seedSampleData"]);
      const memberActions = new Set(["requestUpgrade", "requestExitAction", "requestWithdrawal", "requestProductPlusClaim"]);
      if (adminActions.has(action) && (!auth || auth.role !== "admin")) throw new Error("Administrator authentication is required.");
      if (memberActions.has(action) && (!auth || (auth.role !== "admin" && auth.memberId !== payload.memberId))) throw new Error("Member authentication is required.");
      const data = handleAction(action, payload, auth);
      sendJson(response, 200, { ok: true, data });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
}).listen(PORT, () => {
  console.log(`Matrix website running at http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
});
