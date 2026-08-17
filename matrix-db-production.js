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
    const [{ data, error }, pendingExitResponse, exitsResponse, scheduleResponse, productsResponse, vouchersResponse, notificationsResponse, addressesResponse, packagesResponse, ordersResponse, paymentMethodsResponse, timelineResponse] = await Promise.all([
      window.matrixSupabase.rpc("get_my_dashboard"),
      window.matrixSupabase.rpc("get_pending_exit_balance"),
      window.matrixSupabase.rpc("get_my_exit_statuses"),
      window.matrixSupabase.rpc("get_my_reward_schedule"),
      window.matrixSupabase.rpc("get_my_product_plus"),
      window.matrixSupabase.rpc("get_my_vouchers"),
      window.matrixSupabase.rpc("get_my_notifications"),
      window.matrixSupabase.rpc("get_my_shipping_addresses"),
      window.matrixSupabase.rpc("get_active_commerce_packages", { p_package_type: null }),
      window.matrixSupabase.rpc("get_my_commerce_orders"),
      window.matrixSupabase.rpc("get_active_payment_methods"),
      window.matrixSupabase.rpc("get_my_timeline_dashboard")
    ]);
    if (error) throw error;
    if (pendingExitResponse.error) throw pendingExitResponse.error;
    if (exitsResponse.error) throw exitsResponse.error;
    if (scheduleResponse.error) throw scheduleResponse.error;
    if (productsResponse.error) throw productsResponse.error;
    if (vouchersResponse.error) throw vouchersResponse.error;
    if (notificationsResponse.error) throw notificationsResponse.error;
    if (addressesResponse.error) throw addressesResponse.error;
    if (packagesResponse.error) throw packagesResponse.error;
    if (ordersResponse.error) throw ordersResponse.error;
    if (paymentMethodsResponse.error) throw paymentMethodsResponse.error;
    if (timelineResponse.error) throw timelineResponse.error;
    if (data) {
      data.pendingExitBalance = Number(pendingExitResponse.data || 0);
      data.exits = (exitsResponse.data || []).map(exit => ({ ...exit, ...(scheduleResponse.data[String(exit.exit)] || {}) }));
      data.productPlusEntitlements = productsResponse.data || [];
      data.vouchers = vouchersResponse.data || { balance: 0, history: [] };
      data.notifications = notificationsResponse.data || [];
      data.shippingAddresses = addressesResponse.data || [];
      data.commercePackages = packagesResponse.data || [];
      data.commerceOrders = ordersResponse.data || [];
      data.paymentMethods = paymentMethodsResponse.data || [];
      data.timelineDashboard = timelineResponse.data || null;
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
  async updateMyProfileDetails(details = {}) {
    const { data, error } = await window.matrixSupabase.rpc("update_my_profile_details", {
      p_full_name: details.fullName || "",
      p_username: details.username || "",
      p_phone: details.phone || "",
      p_wallet_address: details.walletAddress || ""
    });
    if (error) throw error;
    await this.refreshSessionData();
    return data;
  },
  getShippingAddresses() {
    return (state.dashboard && state.dashboard.shippingAddresses) || [];
  },
  async refreshShippingAddresses() {
    const { data, error } = await window.matrixSupabase.rpc("get_my_shipping_addresses");
    if (error) throw error;
    if (state.dashboard) state.dashboard.shippingAddresses = data || [];
    return data || [];
  },
  async saveShippingAddress(address = {}) {
    const { data, error } = await window.matrixSupabase.rpc("save_my_shipping_address", {
      p_address_id: address.id || null,
      p_full_name: address.fullName || "",
      p_phone: address.phone || "",
      p_region: address.region || "",
      p_province: address.province || "",
      p_city: address.city || "",
      p_barangay: address.barangay || "",
      p_street_address: address.streetAddress || "",
      p_postal_code: address.postalCode || "",
      p_notes: address.notes || "",
      p_is_default: Boolean(address.isDefault)
    });
    if (error) throw error;
    await this.refreshShippingAddresses();
    return data;
  },
  async deleteShippingAddress(addressId) {
    const { data, error } = await window.matrixSupabase.rpc("delete_my_shipping_address", { p_address_id: addressId });
    if (error) throw error;
    await this.refreshShippingAddresses();
    return data;
  },
  getCommercePackages() {
    return (state.dashboard && state.dashboard.commercePackages) || [];
  },
  getCommerceOrders() {
    return (state.dashboard && state.dashboard.commerceOrders) || [];
  },
  getPaymentMethods() {
    return (state.dashboard && state.dashboard.paymentMethods) || [];
  },
  async refreshCommerceOrders() {
    const { data, error } = await window.matrixSupabase.rpc("get_my_commerce_orders");
    if (error) throw error;
    if (state.dashboard) state.dashboard.commerceOrders = data || [];
    return data || [];
  },
  async requestCommerceOrder(details = {}) {
    const { data, error } = await window.matrixSupabase.rpc("request_commerce_order", {
      p_package_id: details.packageId,
      p_shipping_address_id: details.shippingAddressId,
      p_member_notes: details.memberNotes || ""
    });
    if (error) throw error;
    await this.refreshCommerceOrders();
    return data;
  },
  async submitCommerceOrderPayment(details = {}) {
    const { data, error } = await window.matrixSupabase.rpc("submit_commerce_order_payment", {
      p_order_id: details.orderId,
      p_payment_method_id: details.paymentMethodId,
      p_reference_number: details.referenceNumber || "",
      p_notes: details.notes || ""
    });
    if (error) throw error;
    await this.refreshCommerceOrders();
    return data;
  },
  async confirmCommerceOrderReceived(orderId) {
    const { data, error } = await window.matrixSupabase.rpc("confirm_commerce_order_received", { p_order_id: orderId });
    if (error) throw error;
    await this.refreshCommerceOrders();
    return data;
  },
  async requestWithdrawal() { throw new Error("Withdrawals are not available in this production release yet."); }
};

window.MatrixDB = MatrixDB;
window.MATRIX_USES_SUPABASE = true;
