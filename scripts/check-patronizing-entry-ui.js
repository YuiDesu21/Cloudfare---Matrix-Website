const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "patronizing-income.js"), "utf8");

async function renderEntry({ pendingTokenRequest = null, pendingProductEntryOrder = null, orders = [] } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: "", textContent: "", hidden: false, style: {},
      addEventListener() {}, querySelectorAll() { return []; }
    });
    return elements.get(id);
  };
  let boot;
  const dashboard = {
    entry: null, pendingTokenRequest, pendingProductEntryOrder, exits: [],
    plans: [
      { planCode: "f3_token_12", entryType: "f3_token", f3Tokens: 12, entryAmount: 720, durationMonths: 24, monthlyRequirement: 1000, monthlyIncome: 200 },
      { planCode: "products_5818", entryType: "product", entryAmount: 5818, durationMonths: 24, monthlyRequirement: 1000, monthlyIncome: 200 },
      { planCode: "products_2800", entryType: "product", entryAmount: 2800, durationMonths: 24, monthlyRequirement: 1000, monthlyIncome: 200 }
    ]
  };
  const MatrixDB = {
    async getAuthenticatedMember() { return { id: "member" }; },
    getPatronizingDashboard() { return dashboard; },
    getCommerceOrders() { return orders; }
  };
  const context = {
    document: { addEventListener(_type, handler) { boot = handler; }, getElementById: element },
    window: { MatrixDB, MATRIX_USES_SUPABASE: false },
    MatrixDB,
    MatrixBenefits: { state() { return ""; } },
    Number, String, Boolean, Array, Date
  };
  vm.runInNewContext(source, context);
  await boot();
  return element("patronizing-entry-options").innerHTML;
}

async function check() {
  const fresh = await renderEntry();
  assert.match(fresh, /href="packages-orders\.html\?purpose=patronizing_entry_product"/);
  assert.match(fresh, /href="packages-orders\.html\?purpose=patronizing_entry_package"/);
  assert.match(fresh, /Package Entry[\s\S]*Buy qualifying packages/);

  const pendingToken = await renderEntry({ pendingTokenRequest: { id: "pending" } });
  assert.doesNotMatch(pendingToken, /href="#"|href="packages-orders\.html/);
  assert.match(pendingToken, /disabled>Choose Products<\/button>/);
  assert.match(pendingToken, /disabled>Choose Packages<\/button>/);

  const continuing = await renderEntry({ orders: [{ orderPurpose: "patronizing_entry_product", status: "payment_submitted", packageTotal: 200 }] });
  assert.match(continuing, /href="packages-orders\.html\?purpose=patronizing_entry_product">Continue Entry<\/a>/);
  assert.doesNotMatch(continuing, /href="packages-orders\.html\?purpose=patronizing_entry_package"/);
  assert.match(continuing, /disabled>Choose Packages<\/button>/);

  const dashboardOnly = await renderEntry({ pendingProductEntryOrder: { orderPurpose: "patronizing_entry_package", status: "payment_submitted" } });
  assert.match(dashboardOnly, /href="packages-orders\.html\?purpose=patronizing_entry_package"/);
  assert.doesNotMatch(dashboardOnly, /href="packages-orders\.html\?purpose=patronizing_entry_product"/);
  assert.match(dashboardOnly, /disabled>Choose Products<\/button>/);
  process.stdout.write("Patronizing entry choices preserve valid routes and disable unavailable ones.\n");
}

check().catch(error => { console.error(error); process.exitCode = 1; });
