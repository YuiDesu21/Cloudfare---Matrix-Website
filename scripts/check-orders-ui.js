const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: "", innerHTML: "", textContent: "", hidden: true, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
  });
  return elements.get(id);
}

const filters = ["all", "active", "completed", "cancelled"].map(orderFilter => ({
  dataset: { orderFilter }, listeners: {},
  addEventListener(type, handler) { this.listeners[type] = handler; },
  setAttribute() {}
}));
let boot;
const orders = [
  {
    id: "shop-1", orderCode: "ORD-SHOP-1", orderPurpose: "shop",
    packageSnapshot: { packageName: "Shop purchase", items: [{ itemName: "PC Soap", price: 64, quantity: 2 }] },
    packageTotal: 128, amountDue: 128, status: "approved_for_payment", createdAt: "2026-10-21T00:00:00Z"
  },
  {
    id: "entry-2", orderCode: "ORD-ENTRY-2", packageTypeLabel: "Standard Plan",
    packageSnapshot: { packageName: "Entry package", items: [] },
    packageTotal: 693, status: "received", createdAt: "2026-10-20T00:00:00Z"
  }
];
const context = {
  document: {
    addEventListener(_type, handler) { boot = handler; },
    getElementById: element,
    querySelectorAll() { return filters; }
  },
  window: { MatrixDB: true, MATRIX_USES_SUPABASE: false, location: { replace() {} } },
  MatrixDB: {
    async getAuthenticatedMember() { return { id: "member" }; },
    async refreshCommerceOrders() { return orders; }
  },
  Date, Number, String, Array, Set
};

vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "orders.js"), "utf8"), context);

async function check() {
  await boot();
  assert.equal(element("orders-loading").hidden, true);
  assert.equal(element("orders-content").hidden, false);
  assert.match(element("orders-list").innerHTML, /packages-orders\.html\?order=shop-1/);
  assert.match(element("orders-list").innerHTML, /order=shop-1&amp;source=shop|order=shop-1&source=shop/);
  assert.doesNotMatch(element("orders-list").innerHTML, /View in Entry Orders/);
  assert.match(element("orders-list").innerHTML, /PC Soap/);
  assert.match(element("orders-list").innerHTML, />Pay now</);
  orders[0].amountDue = 0;
  element("orders-search").listeners.input();
  assert.doesNotMatch(element("orders-list").innerHTML, />Pay now</);
  assert.match(element("orders-list").innerHTML, /No payment due/);
  orders[0].amountDue = 128;

  orders[0].status = "payment_approved";
  element("orders-search").listeners.input();
  assert.match(element("orders-list").innerHTML, /Payment confirmed\. Awaiting shipment\./);
  orders[0].status = "shipped";
  element("orders-search").listeners.input();
  assert.match(element("orders-list").innerHTML, />Confirm receipt</);
  orders[0].status = "approved_for_payment";

  element("orders-search").value = "soap";
  element("orders-search").listeners.input();
  assert.equal(element("orders-count").textContent, "1 order");
  assert.doesNotMatch(element("orders-list").innerHTML, /Entry package/);

  element("orders-search").value = "";
  filters[2].listeners.click();
  assert.equal(element("orders-count").textContent, "1 order");
  assert.doesNotMatch(element("orders-list").innerHTML, />Pay now|>Confirm receipt/);
  context.MatrixDB.refreshCommerceOrders = async () => { throw new Error("Orders unavailable"); };
  element("orders-loading").hidden = false;
  await boot();
  assert.equal(element("orders-loading").hidden, true);
  assert.equal(element("orders-alert").hidden, false);
  process.stdout.write("Orders search, action links, and completed history passed.\n");
}

check().catch(error => { console.error(error); process.exitCode = 1; });
