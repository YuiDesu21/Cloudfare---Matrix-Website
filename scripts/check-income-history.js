const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "passive-income-history.js"), "utf8");
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: "all", style: {}, textContent: "", innerHTML: "", listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  return elements.get(id);
}

let onReady;
const document = {
  addEventListener(event, callback) { if (event === "DOMContentLoaded") onReady = callback; },
  getElementById: element
};
const yesterday = new Date(Date.now() - 86400000).toISOString();
const tomorrow = new Date(Date.now() + 86400000).toISOString();
const window = {
  MATRIX_USES_SUPABASE: true,
  MatrixDB: true,
  matrixSupabase: { rpc: async () => ({ data: { passiveIncome: [
    { amount: 100, transferredAmount: 40, sourceLabel: "Budget Plan Promoter", dueAt: yesterday, status: "available" },
    { amount: 100, transferredAmount: 100, sourceLabel: "Budget Plan Promoter", dueAt: yesterday, status: "transferred" }
  ] }, error: null }) }
};
const MatrixDB = {
  initializeDatabase: async () => {},
  getAuthenticatedMember: async () => ({ id: "member-1" }),
  getMemberById: () => ({ id: "member-1" }),
  getMemberMatrixSummary: () => ({
    rewardLedger: [
      { amount: 200, withdrawnAmount: 50, sourceType: "matrix", sourceLabel: "Premium Plan", dueAt: yesterday, status: "due" },
      { amount: 200, withdrawnAmount: 0, sourceType: "patronizing_income", sourceLabel: "Patronizing Income Month 1", dueAt: yesterday, status: "due" },
      { amount: 50, withdrawnAmount: 50, sourceType: "timeline_matrix", sourceLabel: "Standard Plan transfer", dueAt: yesterday, status: "paid", paidAt: null },
      { amount: 40, withdrawnAmount: 40, sourceType: "matrix", sourceLabel: "Premium Plan payout", dueAt: yesterday, status: "paid", paidAt: yesterday }
    ],
    patronizingDashboard: { months: [
      { month: 1, amount: 200, requiredPurchase: 1000, dueAt: yesterday, status: "unlocked" },
      { month: 2, amount: 200, requiredPurchase: 1000, dueAt: yesterday, status: "reflected" },
      { month: 3, amount: 200, requiredPurchase: 1000, dueAt: tomorrow, status: "upcoming" }
    ] }
  })
};
vm.runInNewContext(source, { document, window, MatrixDB, sessionStorage: {}, console });

onReady().then(() => {
  assert.equal(element("income-total").textContent, "PHP 1,090");
  assert.equal(element("income-due").textContent, "PHP 410");
  assert.equal(element("income-upcoming").textContent, "PHP 200");
  assert.match(element("income-history-list").innerHTML, /Remaining to transfer/);
  assert.ok(element("income-history-list").innerHTML.indexOf("Patronizing Income Month 3") > element("income-history-list").innerHTML.indexOf("Patronizing Income Month 2"));
  element("income-source-filter").value = "patronizing-income";
  element("income-source-filter").listeners.change();
  assert.equal(element("income-result-count").textContent, "3 entries");
  element("income-status-filter").value = "locked";
  element("income-status-filter").listeners.change();
  assert.equal(element("income-result-count").textContent, "1 entry");
  assert.match(element("income-history-list").innerHTML, /Monthly purchase requirement/);
  element("income-status-filter").value = "upcoming";
  element("income-status-filter").listeners.change();
  assert.match(element("income-history-list").innerHTML, /Monthly purchase requirement/);
  element("income-source-filter").value = "all";
  element("income-status-filter").value = "transferred";
  element("income-status-filter").listeners.change();
  assert.equal(element("income-result-count").textContent, "2 entries");
  assert.match(element("income-history-list").innerHTML, /Transferred/);
  element("income-status-filter").value = "paid";
  element("income-status-filter").listeners.change();
  assert.equal(element("income-result-count").textContent, "1 entry");
  console.log("Income history shows Patronizing locked months without duplicates and classifies Main Funds transfers correctly.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
