/**
 * Matrix Database API Client
 * Keeps the original MatrixDB method names while delegating persistence to server.js.
 */

const MATRIX_PLANS = {
  "power3-passive": { id: "power3-passive", name: "Power of Three Passive Income", maxChildren: 3, price: 20, pesoValue: 1200 }
};

function callMatrixApi(action, payload = {}) {
  const request = new XMLHttpRequest();
  request.open("POST", `/api/matrix/${action}`, false);
  request.setRequestHeader("Content-Type", "application/json");
  const authToken = sessionStorage.getItem("matrix_admin_auth_token") || sessionStorage.getItem("matrix_auth_token");
  if (authToken) request.setRequestHeader("X-Matrix-Auth", authToken);

  try {
    request.send(JSON.stringify(payload));
  } catch (error) {
    throw new Error("Matrix API is unavailable. Start the server with `node server.js` and open http://localhost:3000.");
  }

  if (request.status < 200 || request.status >= 300) {
    let message = "Matrix API request failed.";
    try {
      const parsed = JSON.parse(request.responseText);
      message = parsed.error || message;
    } catch (error) {
      message = request.responseText || message;
    }
    throw new Error(message);
  }

  const response = JSON.parse(request.responseText);
  if (!response.ok) {
    throw new Error(response.error || "Matrix API request failed.");
  }
  return response.data;
}

const LocalMatrixDB = {
  MATRIX_PLANS,

  initializeDatabase() {
    return callMatrixApi("initializeDatabase");
  },

  authenticateMember(credential, password) {
    const result = callMatrixApi("authenticateMember", { credential, password });
    sessionStorage.setItem("matrix_auth_token", result.token);
    return result.account;
  },

  authenticateAdmin(password) {
    const result = callMatrixApi("authenticateAdmin", { password });
    sessionStorage.setItem("matrix_admin_auth_token", result.token);
    return true;
  },

  getSettings() {
    return callMatrixApi("getSettings");
  },

  getMatrixRules() {
    return callMatrixApi("getMatrixRules");
  },

  getMemberMatrixSummary(memberId) {
    return callMatrixApi("getMemberMatrixSummary", { memberId });
  },

  saveSettings(settings) {
    return callMatrixApi("saveSettings", { settings });
  },

  getPendingRegistrations() {
    return callMatrixApi("getPendingRegistrations");
  },

  getExitActionRequests() {
    return callMatrixApi("getExitActionRequests");
  },

  getWithdrawalRequests() {
    return callMatrixApi("getWithdrawalRequests");
  },
  getUpgradeRequests() { return callMatrixApi("getUpgradeRequests"); },
  requestUpgrade(memberId, referenceNumber) { return callMatrixApi("requestUpgrade", { memberId, referenceNumber }); },
  approveUpgrade(requestId, parentMemberId) { return callMatrixApi("approveUpgrade", { requestId, parentMemberId }); },
  rejectUpgrade(requestId) { return callMatrixApi("rejectUpgrade", { requestId }); },

  getMemberWithdrawalRequests(memberId) {
    return callMatrixApi("getMemberWithdrawalRequests", { memberId });
  },

  getProductPlusClaims() {
    return callMatrixApi("getProductPlusClaims");
  },

  getMembers() {
    return callMatrixApi("getMembers");
  },

  getPositions() {
    return callMatrixApi("getPositions");
  },

  getMemberById(memberId) {
    return callMatrixApi("getMemberById", { memberId });
  },

  getMemberByUsername(username) {
    return callMatrixApi("getMemberByUsername", { username });
  },

  getMemberByAccountCode(accountCode) {
    return callMatrixApi("getMemberByAccountCode", { accountCode });
  },

  getMemberByCredential(emailOrWallet) {
    return callMatrixApi("getMemberByCredential", { emailOrWallet });
  },

  registerPending(memberData, password) {
    return callMatrixApi("registerPending", { memberData, password });
  },

  approveAndPlace(pendingId, parentMemberId) {
    return callMatrixApi("approveAndPlace", { pendingId, parentMemberId });
  },

  rejectPending(pendingId) {
    return callMatrixApi("rejectPending", { pendingId });
  },

  requestExitAction(memberId, exit, details = {}) {
    return callMatrixApi("requestExitAction", { memberId, exit, details });
  },

  approveExitAction(requestId) {
    return callMatrixApi("approveExitAction", { requestId });
  },

  rejectExitAction(requestId) {
    return callMatrixApi("rejectExitAction", { requestId });
  },

  requestWithdrawal(memberId, amount, payoutDetails = "", payoutMethod = "GCash", accountName = "", gcashNumber = "") {
    return callMatrixApi("requestWithdrawal", { memberId, amount, payoutDetails, payoutMethod, accountName, gcashNumber });
  },

  approveWithdrawal(requestId) {
    return callMatrixApi("approveWithdrawal", { requestId });
  },

  rejectWithdrawal(requestId) {
    return callMatrixApi("rejectWithdrawal", { requestId });
  },

  requestProductPlusClaim(memberId, exit, spendAmount, details = {}) {
    return callMatrixApi("requestProductPlusClaim", { memberId, exit, spendAmount, reference: details.reference || "", notes: details.notes || "" });
  },

  approveProductPlusClaim(claimId) {
    return callMatrixApi("approveProductPlusClaim", { claimId });
  },

  rejectProductPlusClaim(claimId) {
    return callMatrixApi("rejectProductPlusClaim", { claimId });
  },

  deleteMember(memberId) {
    return callMatrixApi("deleteMember", { memberId });
  },

  getPositionByMemberId(memberId) {
    return callMatrixApi("getPositionByMemberId", { memberId });
  },

  getEligibleParents(planId) {
    return callMatrixApi("getEligibleParents", { planId });
  },

  getRootMembers(planId) {
    return callMatrixApi("getRootMembers", { planId });
  },

  getMemberTree(memberId, planId) {
    return callMatrixApi("getMemberTree", { memberId, planId });
  },

  getActivityLogs() {
    return callMatrixApi("getActivityLogs");
  },

  resetAllData() {
    return callMatrixApi("resetAllData");
  },

  exportData() {
    return callMatrixApi("exportData");
  },

  importData(jsonData) {
    return callMatrixApi("importData", { jsonData });
  },

  seedSampleData() {
    return callMatrixApi("seedSampleData");
  }
};

const supabaseState = {
  dashboard: null,
  member: null,
  position: null
};

const SupabaseMatrixDB = {
  MATRIX_PLANS,

  async initializeDatabase() {
    const { data, error } = await window.matrixSupabase.auth.getSession();
    if (error) throw error;
    if (data.session) await this.refreshSessionData();
    return true;
  },

  async refreshSessionData() {
    const [{ data, error }, pendingExitResponse, exitsResponse, scheduleResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_pending_exit_balance"),
      window.matrixSupabase.rpc("get_my_exit_statuses"),
      window.matrixSupabase.rpc("get_my_reward_schedule")
    ]);
    if (error) throw error;
    if (pendingExitResponse.error) throw pendingExitResponse.error;
    if (exitsResponse.error) throw exitsResponse.error;
    if (scheduleResponse.error) throw scheduleResponse.error;
    if (data) {
      data.pendingExitBalance = Number(pendingExitResponse.data || 0);
      data.exits = (exitsResponse.data || []).map(exit => ({ ...exit, ...(scheduleResponse.data[String(exit.exit)] || {}) }));
    }
    if (data && data.rules && data.rules.entry) Object.assign(data.rules.entry, { holdPesoValue: 1200, passiveAllocation: 900, matrixAllocation: 300 });
    supabaseState.dashboard = data;
    supabaseState.member = data ? data.member : null;
    supabaseState.position = data ? data.position : null;
    return supabaseState.member;
  },

  async signIn(email, password) {
    const { error } = await window.matrixSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return this.refreshSessionData();
  },
  async requestPasswordReset(email) {
    const redirectTo = `${window.location.origin}/portal.html?mode=reset-password`;
    const { error } = await window.matrixSupabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    return true;
  },
  async updatePassword(password) {
    const { error } = await window.matrixSupabase.auth.updateUser({ password });
    if (error) throw error;
    return true;
  },

  async signUp(memberData, password) {
    const { data, error } = await window.matrixSupabase.auth.signUp({
      email: memberData.email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/portal.html`,
        data: {
          full_name: memberData.fullName,
          username: memberData.username,
          phone: memberData.phone,
          wallet_address: memberData.walletAddress,
          referral_code: memberData.referralCode || ""
        }
      }
    });
    if (error) throw error;
    if (data.session) await this.refreshSessionData();
    return { user: data.user, session: data.session, requiresEmailConfirmation: !data.session };
  },

  async signOut() {
    const { error } = await window.matrixSupabase.auth.signOut();
    if (error) throw error;
    supabaseState.dashboard = null;
    supabaseState.member = null;
    supabaseState.position = null;
  },

  async getAuthenticatedMember() {
    const { data, error } = await window.matrixSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) return null;
    return supabaseState.member || this.refreshSessionData();
  },

  getSettings() { return {}; },
  getMatrixRules() {
    return (supabaseState.dashboard && supabaseState.dashboard.rules) || {
      programName: "Matrix Power of Three Passive Income",
      matrixId: "power3-passive",
      matrixName: "Power of Three Passive Income",
      maxDirectDownlines: 3,
      entry: { holdF3: 20, holdPesoValue: 1200, passiveAllocation: 900, matrixAllocation: 300, passiveIncome: 231, passiveMonths: 3 },
      exits: []
    };
  },
  getMemberMatrixSummary(memberId) {
    if (!supabaseState.member || supabaseState.member.id !== memberId) return null;
    return supabaseState.dashboard;
  },
  getMembers() { return supabaseState.member ? [supabaseState.member] : []; },
  getPositions() { return supabaseState.position ? [supabaseState.position] : []; },
  getMemberById(memberId) { return supabaseState.member && supabaseState.member.id === memberId ? supabaseState.member : null; },
  getPositionByMemberId(memberId) { return supabaseState.position && supabaseState.position.memberId === memberId ? supabaseState.position : null; },
  getPendingRegistrations() { return []; },
  getMemberByAccountCode() { return null; },

  async getMemberTree(memberId) {
    const { data, error } = await window.matrixSupabase.rpc("get_matrix_level", { p_root_member_id: memberId });
    if (error) throw error;
    return data;
  },

  async requestExitAction(memberId, exit, details = {}) {
    if (!supabaseState.member || supabaseState.member.id !== memberId) throw new Error("You may only request your own Exit.");
    const { data, error } = await window.matrixSupabase.rpc("request_exit_action", {
      p_exit_number: Number(exit), p_payment_method: details.paymentMethod || "gcash", p_f3_wallet: details.f3Wallet || "",
      p_gcash_name: details.gcashName || "", p_gcash_number: details.gcashNumber || "", p_reference_number: details.referenceNumber || ""
    });
    if (error) throw error;
    await this.refreshSessionData();
    return data;
  },
  async requestProductPlusClaim() { throw new Error("Products Plus requests are being migrated to the secure Supabase workflow."); },
  async requestWithdrawal() { throw new Error("Withdrawals are being migrated to the secure Supabase workflow."); }
};

const useSupabase = Boolean(
  window.MATRIX_CONFIG &&
  window.MATRIX_CONFIG.dataBackend === "supabase" &&
  window.matrixSupabase
);

window.MatrixDB = useSupabase ? SupabaseMatrixDB : LocalMatrixDB;
window.MATRIX_USES_SUPABASE = useSupabase;
