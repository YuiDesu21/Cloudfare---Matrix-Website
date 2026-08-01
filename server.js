const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const MIN_WITHDRAWAL_AMOUNT = 1000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "matrix-db.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const AUDIT_LOG_FILE = path.join(DATA_DIR, "operational-audit.ndjson");
const MAX_DATABASE_BACKUPS = 50;
const MATRIX_RULES_FILE = path.join(DATA_DIR, "matrix-rules.json");
const SUPABASE_BROWSER_FILE = path.join(__dirname, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");
const SANDBOX_RUNTIME_CONFIG = path.join(__dirname, "js", "runtime-config.sandbox.js");
const PRODUCTION_ENTRY_PAGE = path.join(__dirname, "upgrade-entry-production.html");
const PRODUCTION_ADMIN_PAGE = path.join(__dirname, "admin-production.html");
const AUTH_SESSIONS = new Map();
const LOGIN_ATTEMPTS = new Map();
const LEGACY_SANDBOX_PASSWORD = "member123";
const MEMBER_SESSION_MS = 4 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 2 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

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

function validatePassword(value, label = "Password") {
  const password = boundedText(value, label, 128, 10);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error(`${label} must contain at least one letter and one number.`);
  }
  return password;
}

function createAuthSession(role, memberId = null, operatorName = null, authVersion = 0) {
  const token = crypto.randomBytes(32).toString("hex");
  AUTH_SESSIONS.set(token, {
    role,
    memberId,
    operatorName: operatorName || null,
    sessionRef: crypto.createHash("sha256").update(token).digest("hex").slice(0, 12),
    authVersion: Number(authVersion || 0),
    expiresAt: Date.now() + (role === "admin" ? ADMIN_SESSION_MS : MEMBER_SESSION_MS)
  });
  return token;
}

function requestClientKey(request) {
  const address = String(request.socket?.remoteAddress || "local");
  return address.replace(/^::ffff:/, "");
}

function loginAttemptKey(context, role, credential) {
  return `${role}:${context?.clientKey || "unknown"}:${String(credential || "").trim().toLowerCase()}`;
}

function assertLoginAllowed(context, role, credential) {
  const key = loginAttemptKey(context, role, credential);
  const attempt = LOGIN_ATTEMPTS.get(key);
  if (!attempt) return;
  if (Date.now() - attempt.firstFailureAt > LOGIN_WINDOW_MS) {
    LOGIN_ATTEMPTS.delete(key);
    return;
  }
  if (attempt.count >= LOGIN_MAX_FAILURES) {
    const waitMinutes = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (Date.now() - attempt.firstFailureAt)) / 60000));
    throw new Error(`Too many sign-in attempts. Try again in about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`);
  }
}

function recordLoginFailure(context, role, credential) {
  const key = loginAttemptKey(context, role, credential);
  const now = Date.now();
  const previous = LOGIN_ATTEMPTS.get(key);
  const attempt = !previous || now - previous.firstFailureAt > LOGIN_WINDOW_MS
    ? { count: 0, firstFailureAt: now }
    : previous;
  attempt.count += 1;
  LOGIN_ATTEMPTS.set(key, attempt);
}

function clearLoginFailures(context, role, credential) {
  LOGIN_ATTEMPTS.delete(loginAttemptKey(context, role, credential));
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

function invalidateAuthSession(auth) {
  for (const [token, session] of AUTH_SESSIONS) {
    if (session === auth || (auth.sessionRef && session.sessionRef === auth.sessionRef)) {
      AUTH_SESSIONS.delete(token);
      return;
    }
  }
}

function assertSessionCurrent(db, auth) {
  const expectedVersion = auth.role === "admin"
    ? Number(db.settings.adminAuthVersion || 0)
    : Number((db.members || []).find(member => member.id === auth.memberId)?.authVersion || 0);
  if (Number(auth.authVersion || 0) !== expectedVersion) {
    invalidateAuthSession(auth);
    throw new Error("Your session has expired. Please sign in again.");
  }
}

const MATRIX_PLANS = {
  "power3-passive": { id: "power3-passive", name: "Power of Three Passive Income", maxChildren: 3, price: 20, pesoValue: 1200 },
  "timeline-power3": { id: "timeline-power3", name: "Power of Three Timeline Matrix", maxChildren: 3, price: 693, pesoValue: 693 }
};

const TIMELINE_RULES = {
  programName: "Power of Three Timeline Matrix",
  matrixId: "timeline-power3",
  matrixName: "Power of Three Timeline Matrix",
  maxDirectDownlines: 3,
  entry: { name: "Timeline Entry", price: 693, startsOn: "Admin activation approval" },
  exits: [
    { exit: 1, requiredDownlineExit: 0, productSpend: 856, productBonusAmount: 185, productMonths: 1, matrixIncome: 100, matrixMonths: 3 },
    { exit: 2, requiredDownlineExit: 1, productSpend: 1633, productBonusAmount: 404, productMonths: 1, matrixIncome: 195, matrixMonths: 3 },
    { exit: 3, requiredDownlineExit: 2, productSpend: 1838, productBonusAmount: 525, productMonths: 1, matrixIncome: 236, matrixMonths: 4 },
    { exit: 4, requiredDownlineExit: 3, productSpend: 1607.65, productBonusAmount: 470, productMonths: 2, matrixIncome: 324, matrixMonths: 5 },
    { exit: 5, requiredDownlineExit: 4, productSpend: 2143, productBonusAmount: 626, productMonths: 3, matrixIncome: 607, matrixMonths: 6 },
    { exit: 6, requiredDownlineExit: 5, productSpend: 2481, productBonusAmount: 747, productMonths: 6, matrixIncome: 729, matrixMonths: 10 },
    { exit: 7, requiredDownlineExit: 6, productSpend: 2437, productBonusAmount: 818, productMonths: 10, matrixIncome: 1166, matrixMonths: 15 },
    { exit: 8, requiredDownlineExit: 7, productSpend: 2815, productBonusAmount: 974, productMonths: 20, matrixIncome: 2296, matrixMonths: 20 },
    { exit: 9, requiredDownlineExit: 8, productSpend: 4079, productBonusAmount: 1451, productMonths: 30, matrixIncome: 3936, matrixMonths: 30 },
    { exit: 10, requiredDownlineExit: 9, productSpend: 4634, productBonusAmount: 1721, productMonths: 50, matrixIncome: 5904, matrixMonths: 60 },
    { exit: 11, requiredDownlineExit: 10, productSpend: 4312, productBonusAmount: 1695, productMonths: 75, matrixIncome: 8857, matrixMonths: 100 },
    { exit: 12, requiredDownlineExit: 11, productSpend: 6467, productBonusAmount: 2542, productMonths: 100, matrixIncome: 14171, matrixMonths: 150 },
    { exit: 13, requiredDownlineExit: 12, productSpend: 9700, productBonusAmount: 3814, productMonths: 300, matrixIncome: 15943, matrixMonths: 300 }
  ].map(rule => ({
    ...rule,
    requirementRank: rule.exit === 1 ? "3 direct timeline downlines active" : `3 direct timeline downlines completed Exit ${rule.exit - 1}`,
    actionType: "auto",
    actionLabel: "Automatic Unlock",
    actionAmount: 0,
    passiveIncome: 0,
    passiveMonths: 0,
    productBonusPercent: rule.productSpend ? Number(((rule.productBonusAmount / rule.productSpend) * 100).toFixed(4)) : 0
  }))
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

function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

function normalizePaymentReference(value) {
  const reference = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(reference)) throw new Error("Enter a valid GCash reference number.");
  return reference;
}

function validateDecisionNote(value, label = "Decision note") {
  const note = boundedText(value, label, 240, 5);
  if (!/[\p{L}\p{N}]/u.test(note)) throw new Error(`${label} must include a meaningful verification detail.`);
  return note;
}

function adminActor(auth) {
  return auth && auth.role === "admin" ? (auth.operatorName || "Local administrator") : "System";
}

function recordDecision(record, status, note, auth, metadata = {}) {
  const decision = {
    id: generateUUID(),
    status,
    note: validateDecisionNote(note),
    decidedAt: new Date().toISOString(),
    decidedBy: adminActor(auth),
    sessionRef: auth && auth.sessionRef ? auth.sessionRef : null,
    ...metadata
  };
  record.decisionHistory = [...(record.decisionHistory || []), decision].slice(-20);
  record.latestDecision = decision;
  return decision;
}

function getPaymentReferenceEntries(db) {
  return [
    ...(db.upgradeRequests || []).map(request => ({ request, workflow: "entry", referenceNumber: request.referenceNumber })),
    ...(db.timelineRequests || []).filter(request => request.paymentMethod === "gcash").map(request => ({ request, workflow: "timeline", referenceNumber: request.referenceNumber })),
    ...(db.exitActions || []).filter(request => request.paymentMethod === "gcash").map(request => ({ request, workflow: "exit", referenceNumber: request.referenceNumber }))
  ].filter(item => String(item.referenceNumber || "").trim());
}

function assertPaymentReferenceAvailable(db, referenceNumber, memberId, workflow) {
  const matching = getPaymentReferenceEntries(db).find(item =>
    String(item.referenceNumber || "").trim().toUpperCase() === referenceNumber &&
    (item.request.status !== "rejected" || item.request.memberId !== memberId || item.workflow !== workflow)
  );
  if (matching) throw new Error("This payment reference is already associated with another request.");
}

function syncPaymentReferenceRegistry(db) {
  const grouped = new Map();
  for (const item of getPaymentReferenceEntries(db)) {
    const reference = String(item.referenceNumber || "").trim().toUpperCase();
    if (!reference) continue;
    const entries = grouped.get(reference) || [];
    entries.push({ requestId: item.request.id, memberId: item.request.memberId, workflow: item.workflow, status: item.request.status });
    grouped.set(reference, entries);
  }
  const registry = [...grouped.entries()].map(([referenceNumber, entries]) => ({
    referenceNumber,
    entries,
    collision: entries.length > 1
  }));
  const changed = JSON.stringify(db.paymentReferences || []) !== JSON.stringify(registry);
  db.paymentReferences = registry;
  return changed;
}

function syncIdentityReviews(db) {
  const reviews = [];
  const members = db.members || [];
  const phones = new Map();
  for (const member of members) {
    const normalizedPhone = normalizePhoneNumber(member.phone);
    if (!/^09\d{9}$/.test(normalizedPhone)) {
      reviews.push({ id: `invalid-phone:${member.id}`, type: "invalid-phone", value: String(member.phone || ""), memberIds: [member.id], status: "open" });
      continue;
    }
    const linkedMembers = phones.get(normalizedPhone) || [];
    linkedMembers.push(member.id);
    phones.set(normalizedPhone, linkedMembers);
  }
  for (const [phone, memberIds] of phones) {
    if (memberIds.length > 1) reviews.push({ id: `shared-phone:${phone}`, type: "shared-phone", value: phone, memberIds, status: "open" });
  }
  for (const paymentReference of db.paymentReferences || []) {
    if (paymentReference.collision) {
      reviews.push({
        id: `payment-reference:${paymentReference.referenceNumber}`,
        type: "duplicate-payment-reference",
        value: paymentReference.referenceNumber,
        memberIds: [...new Set(paymentReference.entries.map(entry => entry.memberId))],
        status: "open"
      });
    }
  }
  reviews.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  const changed = JSON.stringify(db.identityReviews || []) !== JSON.stringify(reviews);
  db.identityReviews = reviews;
  return changed;
}

const DEFAULT_DB = {
  pending: [],
  members: [],
  positions: [],
  exitActions: [],
  rewardLedger: [],
  withdrawalRequests: [],
  upgradeRequests: [],
  timelineRequests: [],
  timelineExitProgress: [],
  productPlusClaims: [],
  voucherLedger: [],
  paymentReferences: [],
  identityReviews: [],
  approvalReversals: [],
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

function publicMemberPreview(member) {
  if (!member) return null;
  return {
    id: member.id,
    accountCode: member.accountCode,
    fullName: member.fullName,
    username: member.username,
    status: member.status
  };
}

function getAccountById(db, memberId) {
  return [...(db.members || []), ...(db.pending || [])].find(account => account.id === memberId) || null;
}

function canViewMatrixTree(db, viewerMemberId, rootMemberId, planId) {
  if (viewerMemberId === rootMemberId) return true;
  let parentMemberId = (db.positions || []).find(position =>
    position.memberId === viewerMemberId && position.planId === planId
  )?.parentMemberId;
  while (parentMemberId) {
    if (parentMemberId === rootMemberId) return true;
    parentMemberId = (db.positions || []).find(position =>
      position.memberId === parentMemberId && position.planId === planId
    )?.parentMemberId;
  }
  const visited = new Set();
  const stack = [viewerMemberId];
  while (stack.length) {
    const currentMemberId = stack.pop();
    if (visited.has(currentMemberId)) continue;
    visited.add(currentMemberId);
    const children = (db.positions || []).filter(position =>
      position.planId === planId && position.parentMemberId === currentMemberId
    );
    for (const child of children) {
      if (child.memberId === rootMemberId) return true;
      stack.push(child.memberId);
    }
  }
  return false;
}

function assertActionAuthorization(db, action, payload, auth) {
  const publicActions = new Set([
    "initializeDatabase", "authenticateMember", "authenticateAdmin", "getMatrixRules",
    "getMemberByAccountCode", "registerPending"
  ]);
  if (publicActions.has(action)) return;
  if (!auth) throw new Error("Sign in is required.");
  assertSessionCurrent(db, auth);
  if (auth.role === "admin") return;
  if (auth.role !== "member") throw new Error("Your session is not authorized for this action.");
  if (action === "signOut") return;

  const ownMemberActions = new Set([
    "getMemberMatrixSummary", "getMemberWithdrawalRequests", "getPositionByMemberId",
    "requestUpgrade", "requestTimelineActivation", "requestExitAction", "requestWithdrawal",
    "requestProductPlusClaim"
  ]);
  if (ownMemberActions.has(action)) {
    if (!payload.memberId || payload.memberId !== auth.memberId) throw new Error("You may only access your own account.");
    return;
  }

  if (action === "getMemberById") {
    const viewer = getAccountById(db, auth.memberId);
    if (payload.memberId === auth.memberId || viewer?.sponsorId === payload.memberId) return;
    throw new Error("You may only view your own profile or direct sponsor.");
  }

  if (action === "getMemberTree") {
    if (canViewMatrixTree(db, auth.memberId, payload.memberId, payload.planId)) return;
    throw new Error("You may only view your own matrix branch.");
  }

  throw new Error("Administrator access is required.");
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
  if (!Number.isInteger(db.settings.adminAuthVersion)) {
    db.settings.adminAuthVersion = 0;
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
    if (!Number.isInteger(member.authVersion)) {
      member.authVersion = 0;
      changed = true;
    }
  }
  for (const pending of db.pending || []) {
    if (!pending.passwordHash) {
      pending.passwordHash = hashPassword(LEGACY_SANDBOX_PASSWORD);
      changed = true;
    }
    if (!Number.isInteger(pending.authVersion)) {
      pending.authVersion = 0;
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
  if (ensureTimelineProgression(db)) changed = true;
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
  for (const collectionName of ["upgradeRequests", "timelineRequests", "timelineExitProgress", "exitActions", "withdrawalRequests", "productPlusClaims", "voucherLedger"]) {
    const validRecords = (db[collectionName] || []).filter(record => memberIds.has(record.memberId));
    if (validRecords.length !== (db[collectionName] || []).length) {
      db[collectionName] = validRecords;
      changed = true;
    }
  }
  if (syncPaymentReferenceRegistry(db)) changed = true;
  if (syncIdentityReviews(db)) changed = true;
  if (changed) writeDatabase(db);
}

function readDatabase() {
  ensureDataDirectoryOnly();
  try {
    return normalizeDatabasePayload(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch (error) {
    const recovered = recoverLatestDatabaseBackup();
    if (recovered) return recovered;
    throw new Error(`Matrix database could not be read: ${error.message}`);
  }
}

function normalizeDatabasePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Database payload must be an object.");
  const normalized = { ...clone(DEFAULT_DB), ...value };
  for (const key of Object.keys(DEFAULT_DB)) {
    if (key === "settings") {
      if (!normalized.settings || typeof normalized.settings !== "object" || Array.isArray(normalized.settings)) throw new Error("Database settings are invalid.");
      continue;
    }
    if (!Array.isArray(normalized[key])) throw new Error(`Database collection ${key} is invalid.`);
  }
  return normalized;
}

function recoverLatestDatabaseBackup() {
  ensureDataDirectoryOnly();
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith(".json"))
    .sort()
    .reverse();
  for (const backupName of backups) {
    const backupPath = path.join(BACKUP_DIR, backupName);
    try {
      const recovered = normalizeDatabasePayload(JSON.parse(fs.readFileSync(backupPath, "utf8")));
      fs.copyFileSync(backupPath, DB_FILE);
      appendOperationalAudit({ action: "database-recovery", actor: { role: "system" }, metadata: { backup: backupName } });
      return recovered;
    } catch (error) {
      // Try the next older backup when this snapshot is incomplete or corrupt.
    }
  }
  return null;
}

function backupCurrentDatabase() {
  if (!fs.existsSync(DB_FILE)) return null;
  const current = fs.readFileSync(DB_FILE, "utf8");
  normalizeDatabasePayload(JSON.parse(current));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `matrix-db-${timestamp}-${crypto.randomBytes(3).toString("hex")}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, backupName), current, "utf8");
  const backups = fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith(".json")).sort();
  while (backups.length > MAX_DATABASE_BACKUPS) {
    fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  }
  return backupName;
}

function writeDatabase(db, auditRecord = null) {
  ensureDataDirectoryOnly();
  const serialized = JSON.stringify(normalizeDatabasePayload(db), null, 2);
  const backupName = backupCurrentDatabase();
  const tempFile = `${DB_FILE}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const descriptor = fs.openSync(tempFile, "w");
  try {
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(tempFile, DB_FILE);
  if (auditRecord) appendOperationalAudit({ ...auditRecord, metadata: { ...(auditRecord.metadata || {}), backup: backupName } });
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

function getRulesForPlan(planId) {
  return planId === "timeline-power3" ? TIMELINE_RULES : getMatrixRules();
}

function getMemberPosition(db, memberId, planId = null) {
  return (db.positions || []).find(position => position.memberId === memberId && (!planId || position.planId === planId));
}

function getApprovedExitLevelForPlan(db, memberId, planId) {
  if (planId === "timeline-power3") {
    return (db.timelineExitProgress || [])
      .filter(action => action.memberId === memberId && action.status === "active")
      .reduce((highest, action) => Math.max(highest, Number(action.exit || 0)), 0);
  }
  return getApprovedExitLevel(db, memberId);
}

function countQualifiedDirectDownlinesForPlan(db, memberId, requiredDownlineExit, planId) {
  const directChildren = (db.positions || []).filter(position => position.parentMemberId === memberId && position.planId === planId);
  return directChildren.filter(position => getApprovedExitLevelForPlan(db, position.memberId, planId) >= requiredDownlineExit).length;
}

function createTimelineExitRewardLedger(db, memberId, exitRule, unlockedAt = new Date().toISOString()) {
  const matrixExists = (db.rewardLedger || []).some(entry => entry.memberId === memberId && entry.sourceType === "timeline-matrix" && entry.exit === exitRule.exit);
  if (!matrixExists && Number(exitRule.matrixIncome || 0) > 0) {
    for (let month = 1; month <= Number(exitRule.matrixMonths || 0); month += 1) {
      db.rewardLedger.push({
        id: generateUUID(),
        memberId,
        planId: "timeline-power3",
        sourceType: "timeline-matrix",
        sourceLabel: `Timeline Exit ${exitRule.exit} Matrix Income`,
        exit: exitRule.exit,
        amount: exitRule.matrixIncome,
        dueAt: monthlyAnniversary(unlockedAt, month).toISOString(),
        status: "due",
        createdAt: new Date().toISOString()
      });
    }
  }
}

function ensureTimelineProgression(db) {
  let changed = false;
  db.timelineExitProgress = db.timelineExitProgress || [];
  db.rewardLedger = db.rewardLedger || [];
  const timelinePositions = (db.positions || []).filter(position => position.planId === "timeline-power3");
  const byMember = new Map(db.timelineExitProgress.map(progress => [`${progress.memberId}:${progress.exit}`, progress]));

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const position of timelinePositions) {
      for (const exitRule of TIMELINE_RULES.exits) {
        const key = `${position.memberId}:${exitRule.exit}`;
        if (byMember.has(key)) continue;
        const previousExitActive = exitRule.exit === 1 || byMember.has(`${position.memberId}:${exitRule.exit - 1}`);
        const qualifiedDownlines = countQualifiedDirectDownlinesForPlan(db, position.memberId, exitRule.requiredDownlineExit, "timeline-power3");
        if (!previousExitActive || qualifiedDownlines < TIMELINE_RULES.maxDirectDownlines) continue;
        const progress = {
          id: generateUUID(),
          memberId: position.memberId,
          exit: exitRule.exit,
          status: "active",
          qualifiedDownlines,
          requiredDownlines: TIMELINE_RULES.maxDirectDownlines,
          approvedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
        db.timelineExitProgress.push(progress);
        byMember.set(key, progress);
        createTimelineExitRewardLedger(db, position.memberId, exitRule, progress.approvedAt);
        changed = true;
        progressed = true;
      }
    }
  }

  return changed;
}

function getTimelineExitStatuses(db, memberId) {
  ensureTimelineProgression(db);
  return TIMELINE_RULES.exits.map(exitRule => {
    const qualifiedDownlines = countQualifiedDirectDownlinesForPlan(db, memberId, exitRule.requiredDownlineExit, "timeline-power3");
    const activeAction = (db.timelineExitProgress || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "active");
    const previousExitIsActive = exitRule.exit === 1 || (db.timelineExitProgress || []).some(action =>
      action.memberId === memberId && action.exit === exitRule.exit - 1 && action.status === "active"
    );
    let status = "locked";
    if (activeAction) status = "active";
    else if (previousExitIsActive && qualifiedDownlines >= TIMELINE_RULES.maxDirectDownlines) status = "qualified";
    return {
      ...exitRule,
      qualifiedDownlines,
      requiredDownlines: TIMELINE_RULES.maxDirectDownlines,
      status,
      approvedAt: activeAction ? activeAction.approvedAt : null
    };
  });
}

function getNextTimelineParentId(db) {
  const positions = (db.positions || [])
    .filter(position => position.planId === "timeline-power3")
    .sort((a, b) => new Date(a.placedAt || 0) - new Date(b.placedAt || 0));
  if (!positions.length) return null;
  const parent = positions.find(position =>
    (db.positions || []).filter(child => child.planId === "timeline-power3" && child.parentMemberId === position.memberId).length < MATRIX_PLANS["timeline-power3"].maxChildren
  );
  if (!parent) throw new Error("No available Timeline Matrix placement slot was found.");
  return parent.memberId;
}

function getApprovedExitLevel(db, memberId) {
  return (db.exitActions || [])
    .filter(action => action.memberId === memberId && action.status === "approved")
    .reduce((highest, action) => Math.max(highest, Number(action.exit || 0)), 0);
}

function countQualifiedDirectDownlines(db, memberId, requiredDownlineExit) {
  const directChildren = (db.positions || []).filter(position =>
    position.parentMemberId === memberId && position.planId === "power3-passive"
  );
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

function monthlyAnniversary(approvalAt, monthNumber) {
  const dueDate = new Date(approvalAt || new Date().toISOString());
  dueDate.setMonth(dueDate.getMonth() + monthNumber);
  return dueDate;
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

function getProductPlusEntitlements(db, memberId, planId = "power3-passive") {
  const rules = getRulesForPlan(planId);
  const statuses = planId === "timeline-power3" ? getTimelineExitStatuses(db, memberId) : getExitStatuses(db, memberId);
  const claims = db.productPlusClaims || [];
  return (rules.exits || [])
    .filter(exitRule => exitRule.productSpend > 0)
    .map(exitRule => {
      const status = statuses.find(item => item.exit === exitRule.exit);
      const approvedAction = planId === "timeline-power3"
        ? (db.timelineExitProgress || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "active")
        : (db.exitActions || []).find(action => action.memberId === memberId && action.exit === exitRule.exit && action.status === "approved");
      const productBaseSpend = Number(exitRule.productSpend || 0);
      const monthlyBonus = Number(exitRule.productBonusAmount || 0) || productBaseSpend * (Number(exitRule.productBonusPercent || 0) / 100);
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
      const planClaims = memberClaims.filter(claim => (claim.planId || "power3-passive") === planId);
      const approvedSpend = memberClaims
        .filter(claim => (claim.planId || "power3-passive") === planId)
        .filter(claim => claim.status === "approved")
        .reduce((total, claim) => total + Number(claim.spendAmount || 0), 0);
      const pendingSpend = planClaims
        .filter(claim => claim.status === "pending")
        .reduce((total, claim) => total + Number(claim.spendAmount || 0), 0);
      return {
        planId,
        exit: exitRule.exit,
        active: Boolean(approvedAction),
        productSpend: monthlySpend,
        productBaseSpend,
        monthlyBonus,
        productBonusAmount: monthlyBonus,
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
        status: approvedAction || status && status.status === "active" ? "active" : "locked"
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
  const pendingTimelineActivations = (db.timelineRequests || [])
    .filter(request => request.memberId === memberId && request.status === "pending" && request.paymentMethod === "available_balance")
    .reduce((total, request) => total + Number(request.amount || 0), 0);
  const available = dueRewards.reduce((total, entry) => total + Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0), 0) - pendingWithdrawals - pendingExitBuys - pendingTimelineActivations;
  return Math.max(available, 0);
}

function getVoucherWallet(db, memberId) {
  const history = (db.voucherLedger || [])
    .filter(entry => entry.memberId === memberId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const balance = history.reduce((total, entry) => total + Number(entry.amount || 0), 0);
  return {
    balance,
    history: history.map(entry => ({
      id: entry.id,
      type: entry.entryType || entry.type,
      amount: entry.amount,
      reference: entry.reference,
      notes: entry.notes,
      createdAt: entry.createdAt
    }))
  };
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
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getLastAuditHash() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) return "";
  const entries = fs.readFileSync(AUDIT_LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
  if (!entries.length) return "";
  try {
    return String(JSON.parse(entries[entries.length - 1]).hash || "");
  } catch (error) {
    return "";
  }
}

function appendOperationalAudit(entry) {
  ensureDataDirectoryOnly();
  const record = {
    id: generateUUID(),
    createdAt: new Date().toISOString(),
    previousHash: getLastAuditHash(),
    ...entry
  };
  const hashPayload = JSON.stringify({ ...record, hash: undefined });
  record.hash = crypto.createHash("sha256").update(hashPayload).digest("hex");
  const descriptor = fs.openSync(AUDIT_LOG_FILE, "a");
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readOperationalAudit() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
  return fs.readFileSync(AUDIT_LOG_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function getAuditIntegritySummary() {
  try {
    const entries = readOperationalAudit();
    let previousHash = "";
    for (const entry of entries) {
      const expectedHash = crypto.createHash("sha256")
        .update(JSON.stringify({ ...entry, hash: undefined }))
        .digest("hex");
      if (entry.previousHash !== previousHash || entry.hash !== expectedHash) {
        return { valid: false, entries: entries.length, issue: `Audit chain mismatch at ${entry.id || "an unknown record"}.` };
      }
      previousHash = entry.hash;
    }
    return { valid: true, entries: entries.length, issue: null };
  } catch (error) {
    return { valid: false, entries: 0, issue: "Audit log could not be read." };
  }
}

function getOperationsReport(db) {
  const now = new Date();
  const rewards = db.rewardLedger || [];
  const withdrawals = db.withdrawalRequests || [];
  const approvalCollections = [
    ["Entry", db.upgradeRequests || []],
    ["Timeline", db.timelineRequests || []],
    ["Exit", db.exitActions || []],
    ["Withdrawal", withdrawals]
  ];
  const dueRewards = rewards.filter(entry => entry.status === "due" && new Date(entry.dueAt) <= now);
  const availableRewards = dueRewards.reduce((sum, entry) => sum + Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0), 0);
  const scheduledRewards = rewards
    .filter(entry => entry.status !== "paid" && new Date(entry.dueAt) > now)
    .reduce((sum, entry) => sum + Math.max(Number(entry.amount || 0) - Number(entry.withdrawnAmount || 0), 0), 0);
  const approvedWithdrawals = withdrawals.filter(request => request.status === "approved");
  const pendingWithdrawals = withdrawals.filter(request => request.status === "pending");
  const activationVolume = [...(db.upgradeRequests || []), ...(db.timelineRequests || [])]
    .filter(request => request.status === "approved")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const exceptions = [];

  for (const entry of rewards) {
    if (Number(entry.withdrawnAmount || 0) > Number(entry.amount || 0)) {
      exceptions.push({ category: "Reward ledger", severity: "high", reference: entry.id, detail: "Withdrawn amount exceeds the scheduled reward amount." });
    }
    if (entry.status === "paid" && Number(entry.withdrawnAmount || 0) < Number(entry.amount || 0)) {
      exceptions.push({ category: "Reward ledger", severity: "high", reference: entry.id, detail: "Reward is marked paid before its full amount was recorded." });
    }
  }
  for (const request of approvedWithdrawals) {
    const originTotal = (request.origins || []).reduce((sum, origin) => sum + Number(origin.amount || 0), 0);
    if (Math.abs(originTotal - Number(request.amount || 0)) > 0.009) {
      exceptions.push({ category: "Withdrawal", severity: "high", reference: request.withdrawalCode || request.id, detail: "Recorded withdrawal origins do not equal the approved amount." });
    }
    if (!request.latestDecision?.note) {
      exceptions.push({ category: "Withdrawal", severity: "medium", reference: request.withdrawalCode || request.id, detail: "Approved payout has no recorded decision evidence." });
    }
  }
  for (const [workflow, records] of approvalCollections) {
    for (const record of records.filter(item => item.status === "approved" || item.status === "rejected")) {
      if (!record.latestDecision?.note) {
        exceptions.push({ category: "Approval evidence", severity: "medium", reference: record.id, detail: `${workflow} record has no recorded decision evidence.` });
      }
    }
  }
  const activeMemberIds = new Set((db.members || []).filter(member => member.status === "active").map(member => member.id));
  for (const position of db.positions || []) {
    if (!activeMemberIds.has(position.memberId)) {
      exceptions.push({ category: "Matrix placement", severity: "high", reference: position.id, detail: "Placement belongs to a member that is not active." });
    }
  }
  for (const review of db.identityReviews || []) {
    if (review.status === "open") {
      exceptions.push({ category: "Identity review", severity: "medium", reference: review.id, detail: `${review.type.replace(/-/g, " ")} requires administrator review.` });
    }
  }
  const audit = getAuditIntegritySummary();
  if (!audit.valid) exceptions.push({ category: "Audit trail", severity: "high", reference: "operational-audit", detail: audit.issue });
  const decisionCount = approvalCollections.reduce((sum, [, records]) => sum + records.filter(record => (record.decisionHistory || []).length > 0).length, 0);
  return {
    generatedAt: now.toISOString(),
    metrics: {
      availableRewards,
      scheduledRewards,
      approvedPayouts: approvedWithdrawals.reduce((sum, request) => sum + Number(request.amount || 0), 0),
      pendingPayouts: pendingWithdrawals.reduce((sum, request) => sum + Number(request.amount || 0), 0),
      activationVolume,
      activeMembers: activeMemberIds.size,
      recordedDecisions: decisionCount,
      auditEntries: audit.entries
    },
    audit,
    exceptions: exceptions.sort((a, b) => a.severity.localeCompare(b.severity) || a.category.localeCompare(b.category))
  };
}

function buildAuditRecord(action, payload, auth) {
  const targetId = payload.memberId || payload.requestId || payload.pendingId || payload.claimId || null;
  return {
    action,
    actor: auth ? {
      role: auth.role,
      memberId: auth.memberId || null,
      operatorName: auth.role === "admin" ? adminActor(auth) : null,
      sessionRef: auth.sessionRef || null
    } : { role: "system" },
    targetId: targetId ? String(targetId) : null,
    metadata: {}
  };
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

function getApprovalRequest(db, workflow, requestId) {
  const collections = {
    entry: db.upgradeRequests || [],
    timeline: db.timelineRequests || [],
    exit: db.exitActions || [],
    withdrawal: db.withdrawalRequests || []
  };
  const request = (collections[workflow] || []).find(item => item.id === requestId);
  if (!request) throw new Error("Approval record was not found.");
  return request;
}

function hasIrreversibleEntryHistory(db, memberId, planId) {
  const hasChildren = (db.positions || []).some(position => position.planId === planId && position.parentMemberId === memberId);
  const hasPaidReward = (db.rewardLedger || []).some(entry =>
    entry.memberId === memberId && entry.planId === planId && (Number(entry.withdrawnAmount || 0) > 0 || entry.status === "paid")
  );
  const hasApprovedExit = planId === "power3-passive" && (db.exitActions || []).some(action =>
    action.memberId === memberId && action.status === "approved"
  );
  return hasChildren || hasPaidReward || hasApprovedExit;
}

function reverseApprovedRequest(db, workflow, request, reason, auth) {
  const member = db.members.find(item => item.id === request.memberId);
  if (workflow === "withdrawal") {
    throw new Error("Approved withdrawals cannot be reversed here because payout may already have been sent. Record a reconciliation adjustment instead.");
  }
  if (workflow === "entry" || workflow === "timeline") {
    const planId = workflow === "entry" ? "power3-passive" : "timeline-power3";
    if (hasIrreversibleEntryHistory(db, request.memberId, planId)) {
      throw new Error("This activation has descendants or paid rewards and must be handled through reconciliation, not automatic reversal.");
    }
    db.positions = (db.positions || []).filter(position => !(position.memberId === request.memberId && position.planId === planId));
    db.rewardLedger = (db.rewardLedger || []).filter(entry => !(entry.memberId === request.memberId && entry.planId === planId));
    if (workflow === "entry" && member) {
      member.status = "registered";
      member.approvedAt = null;
      member.cumulativeF3Tokens = 0;
    }
    if (workflow === "timeline") {
      db.timelineExitProgress = (db.timelineExitProgress || []).filter(entry => entry.memberId !== request.memberId);
    }
  }
  if (workflow === "exit") {
    const hasLaterExit = (db.exitActions || []).some(item =>
      item.memberId === request.memberId && item.status === "approved" && Number(item.exit) > Number(request.exit)
    );
    const exitRewards = (db.rewardLedger || []).filter(entry =>
      entry.memberId === request.memberId && entry.planId === "power3-passive" && Number(entry.exit) === Number(request.exit)
    );
    if (hasLaterExit || exitRewards.some(entry => Number(entry.withdrawnAmount || 0) > 0 || entry.status === "paid")) {
      throw new Error("This Exit approval has later activity or paid rewards and must be handled through reconciliation, not automatic reversal.");
    }
    db.rewardLedger = (db.rewardLedger || []).filter(entry => !exitRewards.includes(entry));
  }
  request.status = "reversed";
  request.reversedAt = new Date().toISOString();
  recordDecision(request, "reversed", reason, auth, { reversedDecisionId: request.latestDecision ? request.latestDecision.id : null });
  db.approvalReversals.push({
    id: generateUUID(),
    workflow,
    requestId: request.id,
    memberId: request.memberId,
    status: "completed",
    reason: request.latestDecision.note,
    reversedAt: request.reversedAt,
    reversedBy: adminActor(auth)
  });
  return request;
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

    for (const referredMember of includeChildren && planId !== "timeline-power3" ? getReservedChildren(db, currentMemberId, planId) : []) {
      children.push({
        id: referredMember.id,
        fullName: referredMember.fullName,
        username: referredMember.username,
        accountCode: referredMember.accountCode,
        isReferralPending: true,
        matrixStage: { label: "Not Registered", status: "registered", exit: 0 },
        children: []
      });
    }

    const openSlots = includeChildren && planId !== "timeline-power3" ? Math.max(plan.maxChildren - children.length, 0) : 0;
    for (let index = 0; index < openSlots; index += 1) {
      children.push({ isOpenSlot: true, label: "Open Spot" });
    }

    const progressedExits = (planId === "timeline-power3" ? getTimelineExitStatuses(db, currentMemberId) : getExitStatuses(db, currentMemberId))
      .filter(exit => exit.status !== "locked")
      .sort((a, b) => Number(b.exit) - Number(a.exit));
    const currentExit = progressedExits[0] || null;

    return {
      id: currentMember.id,
      fullName: currentMember.fullName,
      username: currentMember.username,
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

function handleAction(action, payload, auth = null, context = {}) {
  ensureDatabase();
  const db = readDatabase();
  assertActionAuthorization(db, action, payload, auth);
  let shouldWrite = false;
  let data;

  switch (action) {
    case "authenticateMember": {
      const credential = String(payload.credential || "").trim().toLowerCase();
      assertLoginAllowed(context, "member", credential);
      const account = [...(db.members || []), ...(db.pending || [])].find(item =>
        String(item.email || "").toLowerCase() === credential ||
        String(item.walletAddress || "").toLowerCase() === credential
      );
      if (!account || !passwordMatches(payload.password, account.passwordHash)) {
        recordLoginFailure(context, "member", credential);
        throw new Error("Incorrect email, wallet address, or password.");
      }
      clearLoginFailures(context, "member", credential);
      data = { token: createAuthSession("member", account.id, null, account.authVersion), account: { ...account, passwordHash: undefined } };
      break;
    }
    case "authenticateAdmin": {
      assertLoginAllowed(context, "admin", "control-panel");
      if (!passwordMatches(payload.password, db.settings.adminPasswordHash)) {
        recordLoginFailure(context, "admin", "control-panel");
        throw new Error("Incorrect admin password. Please try again.");
      }
      clearLoginFailures(context, "admin", "control-panel");
      const operatorName = payload.operatorName
        ? validatePersonName(payload.operatorName, "Operator name")
        : "Local administrator";
      data = { token: createAuthSession("admin", null, operatorName, db.settings.adminAuthVersion), operatorName };
      break;
    }
    case "signOut":
      invalidateAuthSession(auth);
      data = true;
      break;
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
      if (ensureTimelineProgression(db)) shouldWrite = true;
      const planId = payload.planId || "power3-passive";
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
      const pendingTimelineBalance = (db.timelineRequests || [])
        .filter(request => request.memberId === member.id && request.status === "pending" && request.paymentMethod === "available_balance")
        .reduce((total, request) => total + Number(request.amount || 0), 0);
      const memberPosition = db.positions.find(position => position.memberId === member.id && position.planId === planId);
      const positionNumber = memberPosition
        ? db.positions
          .filter(position => position.planId === planId)
          .sort((a, b) => new Date(a.placedAt || 0) - new Date(b.placedAt || 0))
          .findIndex(position => position.memberId === member.id) + 1
        : 0;
      const childrenByParent = new Map();
      db.positions.forEach(position => {
        if (!memberPosition || position.planId !== planId || !position.parentMemberId) return;
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
        rules: getRulesForPlan(planId),
        planId,
        isTimelineActive: Boolean(getMemberPosition(db, member.id, "timeline-power3")),
        pendingTimelineRequest: (db.timelineRequests || []).find(request => request.memberId === member.id && request.status === "pending") || null,
        exits: planId === "timeline-power3" ? getTimelineExitStatuses(db, member.id) : getExitStatuses(db, member.id),
        rewardLedger: ledger.filter(entry => entry.memberId === member.id && (planId === "power3-passive" ? !entry.planId || entry.planId === "power3-passive" : entry.planId === planId)),
        earnedBalance,
        pendingExitBalance,
        pendingTimelineBalance,
        descendantCount,
        referralCount: (db.members || []).filter(account => account.sponsorId === member.id).length,
        position: memberPosition || null,
        positionNumber,
        pendingWithdrawal: (db.withdrawalRequests || [])
          .filter(request => request.memberId === member.id && request.status === "pending")
          .reduce((total, request) => total + Number(request.amount || 0), 0),
        productPlusClaims: (db.productPlusClaims || []).filter(claim => claim.memberId === member.id && (claim.planId || "power3-passive") === planId),
        productPlusEntitlements: getProductPlusEntitlements(db, member.id, planId),
        vouchers: getVoucherWallet(db, member.id)
      };
      break;
    }
    case "saveSettings":
      {
        const updates = { ...(payload.settings || payload) };
        if (updates.adminPassword) {
          updates.adminPasswordHash = hashPassword(validatePassword(updates.adminPassword, "Admin password"));
          updates.adminAuthVersion = Number(db.settings.adminAuthVersion || 0) + 1;
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
    case "getTimelineRequests":
      data = (db.timelineRequests || []).map(request => {
        const member = db.members.find(item => item.id === request.memberId);
        return {
          ...request,
          fullName: member ? member.fullName : "Unknown",
          username: member ? member.username : "unknown",
          accountCode: member ? member.accountCode : "",
          availableBalance: member ? getAvailableBalance(db, member.id) + (request.status === "pending" && request.paymentMethod === "available_balance" ? Number(request.amount || 0) : 0) : 0
        };
      });
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
    case "getIdentityReviews":
      data = (db.identityReviews || []).map(review => ({
        ...review,
        members: review.memberIds.map(memberId => {
          const member = db.members.find(item => item.id === memberId);
          return member ? {
            id: member.id,
            accountCode: member.accountCode,
            fullName: member.fullName,
            username: member.username,
            phone: member.phone
          } : null;
        }).filter(Boolean)
      }));
      break;
    case "getApprovalDecisionHistory": {
      const records = [
        ["entry", db.upgradeRequests || []],
        ["timeline", db.timelineRequests || []],
        ["exit", db.exitActions || []],
        ["withdrawal", db.withdrawalRequests || []]
      ].flatMap(([workflow, requests]) => requests
        .filter(request => (request.decisionHistory || []).length > 0)
        .map(request => {
          const member = db.members.find(item => item.id === request.memberId);
          return {
            workflow,
            requestId: request.id,
            status: request.status,
            amount: Number(request.amount || request.actionAmount || 0),
            exit: request.exit || null,
            createdAt: request.createdAt,
            latestDecision: request.latestDecision || null,
            fullName: member ? member.fullName : "Unknown member",
            accountCode: member ? member.accountCode : "",
            username: member ? member.username : ""
          };
        }))
        .sort((a, b) => new Date(b.latestDecision?.decidedAt || b.createdAt) - new Date(a.latestDecision?.decidedAt || a.createdAt));
      data = records.slice(0, 100);
      break;
    }
    case "getMembers":
      data = db.members.map(publicAccount);
      break;
    case "getPositions":
      data = db.positions;
      break;
    case "getMemberById":
      {
        const account = getAccountById(db, payload.memberId);
        data = auth && auth.role === "member" && payload.memberId !== auth.memberId
          ? publicMemberPreview(account)
          : publicAccount(account);
      }
      break;
    case "getMemberByUsername":
      data = publicMemberPreview(findMemberByUsername(db, payload.username));
      break;
    case "getMemberByAccountCode":
      data = publicMemberPreview(findMemberByAccountCode(db, payload.accountCode));
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
      const password = validatePassword(payload.password);
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
        authVersion: 0,
        sponsorId: sponsor ? sponsor.id : null,
        status: "registered",
        cumulativeF3Tokens: 0,
        createdAt: new Date().toISOString()
      };
      db.members.push(newRequest);
      addActivityLog(db, "registration", `New free account for ${newRequest.fullName} (${newRequest.username})`);
      shouldWrite = true;
      data = { account: publicAccount(newRequest), token: createAuthSession("member", newRequest.id, null, newRequest.authVersion) };
      break;
    }
    case "requestUpgrade": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      if (member.status === "active") throw new Error("Entry is already active.");
      const referenceNumber = normalizePaymentReference(payload.referenceNumber);
      assertPaymentReferenceAvailable(db, referenceNumber, member.id, "entry");
      if ((db.upgradeRequests || []).some(item => item.memberId === member.id && item.status === "pending")) throw new Error("You already have a pending Entry request.");
      const request = { id: generateUUID(), memberId: member.id, planId: "power3-passive", amount: 1200, referenceNumber, status: "pending", createdAt: new Date().toISOString() };
      db.upgradeRequests.push(request); shouldWrite = true; data = request;
      addActivityLog(db, "upgrade-request", `${member.fullName} requested Entry activation.`);
      break;
    }
    case "requestTimelineActivation": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      if (getMemberPosition(db, member.id, "timeline-power3")) throw new Error("Timeline Matrix is already active for this account.");
      if ((db.timelineRequests || []).some(item => item.memberId === member.id && item.status === "pending")) throw new Error("You already have a pending Timeline Matrix request.");
      const paymentMethod = String(payload.paymentMethod || "gcash").trim();
      const amount = TIMELINE_RULES.entry.price;
      const request = {
        id: generateUUID(),
        memberId: member.id,
        planId: "timeline-power3",
        amount,
        paymentMethod: paymentMethod === "available_balance" ? "available_balance" : "gcash",
        gcashName: "",
        gcashNumber: "",
        referenceNumber: "",
        status: "pending",
        createdAt: new Date().toISOString()
      };
      if (request.paymentMethod === "available_balance") {
        if (getAvailableBalance(db, member.id) < amount) throw new Error("Not enough available balance for Timeline activation.");
      } else {
        request.gcashName = validatePersonName(payload.gcashName, "GCash name");
        request.gcashNumber = validateGcashNumber(payload.gcashNumber);
        request.referenceNumber = normalizePaymentReference(payload.referenceNumber);
        assertPaymentReferenceAvailable(db, request.referenceNumber, member.id, "timeline");
      }
      db.timelineRequests.push(request);
      addActivityLog(db, "timeline-request", `${member.fullName} requested Timeline Matrix activation.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "approveTimelineActivation": {
      const request = (db.timelineRequests || []).find(item => item.id === payload.requestId);
      if (!request || request.status !== "pending") throw new Error("Timeline request is no longer pending.");
      const member = db.members.find(item => item.id === request.memberId);
      if (!member) throw new Error("Member not found.");
      if (getMemberPosition(db, member.id, "timeline-power3")) throw new Error("Timeline Matrix is already active for this account.");
      if (request.paymentMethod === "available_balance") {
        const availableIncludingReservation = getAvailableBalance(db, member.id) + Number(request.amount || 0);
        if (availableIncludingReservation < Number(request.amount || 0)) throw new Error("Not enough available balance.");
        applyBalancePayment(db, member.id, request.amount);
      }
      const placedAt = new Date().toISOString();
      const parentMemberId = getNextTimelineParentId(db);
      db.positions.push({ id: generateUUID(), memberId: member.id, planId: "timeline-power3", parentMemberId, placedAt });
      request.status = "approved";
      request.approvedAt = placedAt;
      request.parentMemberId = parentMemberId;
      recordDecision(request, "approved", payload.decisionNote, auth);
      ensureTimelineProgression(db);
      addActivityLog(db, "timeline-approval", `Approved Timeline Matrix activation for ${member.fullName}.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "rejectTimelineActivation": {
      const request = (db.timelineRequests || []).find(item => item.id === payload.requestId);
      if (!request || request.status !== "pending") throw new Error("Timeline request is no longer pending.");
      request.status = "rejected";
      request.rejectedAt = new Date().toISOString();
      recordDecision(request, "rejected", payload.decisionNote, auth);
      addActivityLog(db, "timeline-rejection", "Rejected Timeline Matrix activation request.");
      shouldWrite = true;
      data = request;
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
      ensureEntryRewardLedger(db, member); request.status = "approved"; request.approvedAt = member.approvedAt; recordDecision(request, "approved", payload.decisionNote, auth); shouldWrite = true; data = request;
      break;
    }
    case "rejectUpgrade": { const request = (db.upgradeRequests || []).find(item => item.id === payload.requestId); if (!request || request.status !== "pending") throw new Error("Upgrade request is no longer pending."); request.status="rejected"; request.rejectedAt=new Date().toISOString(); recordDecision(request, "rejected", payload.decisionNote, auth); shouldWrite=true; data=request; break; }
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
      recordDecision(pending, "approved", payload.decisionNote, auth);
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
        normalizePaymentReference(details.referenceNumber);
      }
      const resolvedPaymentMethod = exitRule.actionType === "reinvest"
        ? "f3_wallet"
        : paymentMethod === "available_balance" ? "available_balance" : "gcash";
      const request = {
        id: generateUUID(),
        memberId: member.id,
        exit,
        actionType: exitRule.actionType,
        actionAmount: exitRule.actionAmount,
        paymentMethod: resolvedPaymentMethod,
        f3Wallet: String(details.f3Wallet || "").trim().slice(0, 52),
        gcashName: String(details.gcashName || "").trim().slice(0, 30),
        gcashNumber: resolvedPaymentMethod === "gcash" ? String(details.gcashNumber || "").replace(/\D/g, "") : "",
        referenceNumber: resolvedPaymentMethod === "gcash" ? normalizePaymentReference(details.referenceNumber) : "",
        status: "pending",
        createdAt: new Date().toISOString()
      };
      if (request.paymentMethod === "gcash") assertPaymentReferenceAvailable(db, request.referenceNumber, member.id, "exit");
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
      recordDecision(request, "approved", payload.decisionNote, auth);
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
      recordDecision(request, "rejected", payload.decisionNote, auth);
      addActivityLog(db, "exit-rejection", `Rejected Exit ${request.exit} action request.`);
      shouldWrite = true;
      data = request;
      break;
    }
    case "requestWithdrawal": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_AMOUNT) throw new Error(`Withdrawal amount must be at least PHP ${MIN_WITHDRAWAL_AMOUNT.toLocaleString()}.`);
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
      recordDecision(request, "approved", payload.decisionNote, auth);
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
      recordDecision(request, "rejected", payload.decisionNote, auth);
      addActivityLog(db, "withdrawal-rejection", "Rejected withdrawal request.");
      shouldWrite = true;
      data = request;
      break;
    }
    case "requestProductPlusClaim": {
      const member = db.members.find(item => item.id === payload.memberId);
      if (!member) throw new Error("Member not found.");
      const exit = Number(payload.exit);
      const planId = payload.planId || "power3-passive";
      const spendAmount = Number(payload.spendAmount);
      if (!Number.isFinite(spendAmount) || spendAmount <= 0) throw new Error("Invalid product spend amount.");
      const entitlement = getProductPlusEntitlements(db, member.id, planId).find(item => item.exit === exit);
      if (!entitlement || !entitlement.active) throw new Error("Products Plus entitlement is not active for this exit.");
      if (spendAmount > entitlement.availableVestedSpend) throw new Error("Claim amount exceeds the Products Plus amount vested so far.");
      const purchaseReference = boundedText(payload.reference, "Purchase reference", 60, 3);
      if (!/^[A-Za-z0-9][A-Za-z0-9 _./#-]{2,59}$/.test(purchaseReference)) throw new Error("Purchase reference contains unsupported characters.");
      const purchaseNotes = String(payload.notes || "").trim();
      if (purchaseNotes.length > 240) throw new Error("Purchase notes cannot exceed 240 characters.");
      const claim = {
        id: generateUUID(),
        memberId: member.id,
        planId,
        exit,
        spendAmount,
        bonusPercent: entitlement.productBonusPercent,
        bonusAmount: entitlement.productBaseSpend ? spendAmount * (Number(entitlement.productBonusAmount || 0) / Number(entitlement.productBaseSpend || 1)) : spendAmount * (entitlement.productBonusPercent / 100),
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
      db.voucherLedger = db.voucherLedger || [];
      db.voucherLedger.push({
        id: generateUUID(),
        memberId: claim.memberId,
        claimId: claim.id,
        planId: claim.planId || "power3-passive",
        entryType: "credit",
        amount: Number(claim.bonusAmount || 0),
        reference: `${claim.planId === "timeline-power3" ? "Timeline" : "Power"} Products Plus Exit ${claim.exit}`,
        notes: "Approved purchase bonus",
        createdAt: claim.approvedAt
      });
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
      recordDecision(pending, "rejected", payload.decisionNote, auth);
      addActivityLog(db, "rejection", `Rejected registration request for ${pending.fullName} (${pending.username})`);
      shouldWrite = true;
      data = pending;
      break;
    }
    case "reverseApprovalDecision": {
      const workflow = String(payload.workflow || "").trim();
      const request = getApprovalRequest(db, workflow, String(payload.requestId || ""));
      const reason = validateDecisionNote(payload.decisionNote, "Reversal reason");
      if (request.status === "rejected") {
        request.status = "pending";
        request.reopenedAt = new Date().toISOString();
        recordDecision(request, "reopened", reason, auth, { reversedDecisionId: request.latestDecision ? request.latestDecision.id : null });
        db.approvalReversals.push({
          id: generateUUID(), workflow, requestId: request.id, memberId: request.memberId,
          status: "reopened", reason, reversedAt: request.reopenedAt, reversedBy: adminActor(auth)
        });
        addActivityLog(db, "approval-reopened", `Reopened ${workflow} request ${request.id.slice(0, 8)} for review.`);
      } else if (request.status === "approved") {
        reverseApprovedRequest(db, workflow, request, reason, auth);
        addActivityLog(db, "approval-reversed", `Reversed ${workflow} approval ${request.id.slice(0, 8)}.`);
      } else {
        throw new Error("Only approved or rejected requests can be reversed.");
      }
      shouldWrite = true;
      data = request;
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
      data = db.positions.find(item => item.memberId === payload.memberId && (!payload.planId || item.planId === payload.planId)) || null;
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
    case "getOperationsReport":
      data = getOperationsReport(db);
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

  if (shouldWrite) {
    syncPaymentReferenceRegistry(db);
    syncIdentityReviews(db);
    writeDatabase(db, buildAuditRecord(action, payload, auth));
  }
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
      const adminActions = new Set(["saveSettings", "approveAndPlace", "rejectPending", "approveUpgrade", "rejectUpgrade", "approveTimelineActivation", "rejectTimelineActivation", "approveExitAction", "rejectExitAction", "approveWithdrawal", "rejectWithdrawal", "approveProductPlusClaim", "rejectProductPlusClaim", "reverseApprovalDecision", "deleteMember", "resetAllData", "importData", "seedSampleData"]);
      const memberActions = new Set(["requestUpgrade", "requestTimelineActivation", "requestExitAction", "requestWithdrawal", "requestProductPlusClaim"]);
      if (adminActions.has(action) && (!auth || auth.role !== "admin")) throw new Error("Administrator authentication is required.");
      if (memberActions.has(action) && (!auth || (auth.role !== "admin" && auth.memberId !== payload.memberId))) throw new Error("Member authentication is required.");
      const data = handleAction(action, payload, auth, { clientKey: requestClientKey(request) });
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
