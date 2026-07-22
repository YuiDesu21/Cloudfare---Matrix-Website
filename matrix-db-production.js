/** Supabase-only production data adapter. Local JSON and sandbox controls are intentionally excluded. */
const MATRIX_PLANS = {
  "power3-passive": { id: "power3-passive", name: "Power of Three Passive Income", maxChildren: 3, price: 20, pesoValue: 1200 }
};

const state = { dashboard: null, member: null, position: null };

const MatrixDB = {
  MATRIX_PLANS,
  async initializeDatabase() {
    const { data, error } = await window.matrixSupabase.auth.getSession();
    if (error) throw error;
    if (data.session) await this.refreshSessionData();
    return true;
  },
  async refreshSessionData() {
    const [{ data, error }, pendingExitResponse, exitsResponse, scheduleResponse, productsResponse, vouchersResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_pending_exit_balance"),
      window.matrixSupabase.rpc("get_my_exit_statuses"),
      window.matrixSupabase.rpc("get_my_reward_schedule"),
      window.matrixSupabase.rpc("get_my_product_plus"),
      window.matrixSupabase.rpc("get_my_vouchers")
    ]);
    if (error) throw error;
    if (pendingExitResponse.error) throw pendingExitResponse.error;
    if (exitsResponse.error) throw exitsResponse.error;
    if (scheduleResponse.error) throw scheduleResponse.error;
    if (productsResponse.error) throw productsResponse.error;
    if (vouchersResponse.error) throw vouchersResponse.error;
    if (data) {
      data.pendingExitBalance = Number(pendingExitResponse.data || 0);
      data.exits = (exitsResponse.data || []).map(exit => ({ ...exit, ...(scheduleResponse.data[String(exit.exit)] || {}) }));
      data.productPlusEntitlements = productsResponse.data || [];
      data.vouchers = vouchersResponse.data || { balance: 0, history: [] };
    }
    if (data && data.rules && data.rules.entry) Object.assign(data.rules.entry, { holdPesoValue: 1200, tokenHoldingAllocation: 900, matrixAllocation: 300 });
    state.dashboard = data;
    state.member = data ? data.member : null;
    state.position = data ? data.position : null;
    return state.member;
  },
  async signIn(email, password) {
    const { error } = await window.matrixSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return this.refreshSessionData();
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
    state.dashboard = null; state.member = null; state.position = null;
  },
  async acceptAdminInvitation(token) {
    const { data, error } = await window.matrixSupabase.rpc("accept_admin_invitation", { p_token: token });
    if (error) throw error;
    await this.refreshSessionData();
    return data;
  },
  async getAuthenticatedMember() {
    const { data, error } = await window.matrixSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) return null;
    return state.member || this.refreshSessionData();
  },
  getSettings() { return {}; },
  getMatrixRules() {
    return (state.dashboard && state.dashboard.rules) || {
      programName: "Matrix Power of Three Passive Income", matrixId: "power3-passive",
      matrixName: "Power of Three Passive Income", maxDirectDownlines: 3,
      entry: { holdF3: 20, holdPesoValue: 1200, tokenHoldingAllocation: 900, matrixAllocation: 300, passiveIncome: 231, passiveMonths: 3 }, exits: []
    };
  },
  getMemberMatrixSummary(memberId) { return state.member && state.member.id === memberId ? state.dashboard : null; },
  getMembers() { return state.member ? [state.member] : []; },
  getPositions() { return state.position ? [state.position] : []; },
  getMemberById(memberId) { return state.member && state.member.id === memberId ? state.member : null; },
  getPositionByMemberId(memberId) { return state.position && state.position.memberId === memberId ? state.position : null; },
  getPendingRegistrations() { return []; },
  getMemberByAccountCode() { return null; },
  async getMemberTree(memberId) {
    const { data, error } = await window.matrixSupabase.rpc("get_matrix_level", { p_root_member_id: memberId });
    if (error) throw error;
    return data;
  },
  async requestExitAction(memberId, exit, details = {}) {
    if (!state.member || state.member.id !== memberId) throw new Error("You may only request your own Exit.");
    const { data, error } = await window.matrixSupabase.rpc("request_exit_action", {
      p_exit_number: Number(exit), p_payment_method: details.paymentMethod || "gcash", p_f3_wallet: details.f3Wallet || "",
      p_gcash_name: details.gcashName || "", p_gcash_number: details.gcashNumber || "", p_reference_number: details.referenceNumber || ""
    });
    if (error) throw error;
    await this.refreshSessionData();
    return data;
  },
  async requestProductPlusClaim(memberId, exit, spendAmount, details = {}) {
    if (!state.member || state.member.id !== memberId) throw new Error("You may only submit your own Products Plus claim.");
    const { data, error } = await window.matrixSupabase.rpc("request_product_plus_claim", {
      p_exit_number: Number(exit), p_spend_amount: Number(spendAmount),
      p_purchase_reference: details.reference || "", p_purchase_notes: details.notes || ""
    });
    if (error) throw error;
    await this.refreshSessionData();
    return data;
  },
  async requestWithdrawal() { throw new Error("Withdrawals are not available in this production release yet."); }
};

window.MatrixDB = MatrixDB;
window.MATRIX_USES_SUPABASE = true;
