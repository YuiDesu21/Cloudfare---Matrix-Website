const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function loadShop({ budgetFails = false, addressFails = false, mobile = false } = {}) {
  const elements = new Map();
  const calls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", innerHTML: "",
      hidden: id === "shop-budget-progress" || id === "shop-budget-cart-note" || id === "shop-orders-link", disabled: false,
      style: { setProperty() {}, removeProperty() {} }, listeners: {}, offsetHeight: 400,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute() {}, setCustomValidity() {}, scrollIntoView() { this.scrolledIntoView = true; },
      focus() { this.focused = true; },
      getBoundingClientRect() { return { top: 1000, bottom: 1400 }; }
    });
    return elements.get(id);
  }
  let boot;
  let destination = "";
  const client = {
    auth: { async getSession() { return { data: { session: { user: { id: "member" } } } }; } },
    from(table) {
      assert.equal(table, "budget_plan_categories");
      return { async select() { return { data: [{ category: "pc", qualification_percent: 25 }], error: null }; } };
    },
    async rpc(name) {
      calls.push(name);
      if (name === "get_public_shop_products") return { data: [{ id: "product-1", name: "PC Product", price: 100, voucherEligible: true }], error: null };
      if (name === "get_active_commerce_products") return { data: [{ id: "product-1", budgetCategory: "pc" }], error: null };
      if (name === "get_my_budget_plan_dashboard") return budgetFails
        ? { data: null, error: { message: "Unavailable" } }
        : { data: { entryCredit: 0, isActive: false }, error: null };
      if (name === "get_my_shipping_addresses") return addressFails
        ? { data: null, error: { message: "Unavailable" } }
        : { data: [{ id: "address-1", streetAddress: "Street", city: "City", province: "Province", isDefault: true }], error: null };
      if (name === "get_my_vouchers") return { data: { balance: 50 }, error: null };
      if (name === "get_my_commerce_orders") return { data: [], error: null };
      if (name === "request_budget_shop_order" || name === "request_shop_order") {
        return { data: { id: "order-1" }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  const context = {
    document: {
      addEventListener(_type, handler) { boot = handler; }, getElementById: element,
      querySelector(selector) { return element(selector); }
    },
    window: {
      matrixSupabase: client, innerWidth: mobile ? 390 : 1000, innerHeight: 800, scrollY: 0,
      location: { search: "", assign(url) { destination = url; } },
      addEventListener() {}, history: { replaceState() {} }
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    ResizeObserver: class { observe() {} }, URLSearchParams, Number, Array, Map, Math
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "shop.js"), "utf8"), context);
  await boot();
  element("shop-address").value = addressFails ? "" : "address-1";
  element(".shop-cart").offsetHeight = 400;
  element("shop-products").listeners.click({ target: { closest() { return { dataset: { shopAdd: "product-1" } }; } } });
  return { element, calls, destination: () => destination };
}

async function check() {
  const normal = await loadShop();
  assert.equal(normal.element("shop-checkout").disabled, false);
  assert.equal(normal.element("shop-orders-link").hidden, false);
  assert.equal(normal.element("shop-budget-progress").hidden, false);
  assert.equal(normal.element("shop-mobile-cart").hidden, true);

  const degraded = await loadShop({ budgetFails: true });
  assert.equal(degraded.element("shop-budget-progress").hidden, true);
  assert.match(degraded.element("shop-alert").textContent, /preview is unavailable/i);
  assert.equal(degraded.element("shop-checkout").disabled, false);
  degraded.element("shop-voucher-amount").value = "60";
  degraded.element("shop-voucher-amount").listeners.input();
  assert.equal(degraded.element("shop-checkout").disabled, true);
  degraded.element("shop-voucher-amount").value = "0";
  degraded.element("shop-voucher-amount").listeners.input();
  assert.equal(degraded.element("shop-checkout").disabled, false);
  await degraded.element("shop-checkout").listeners.click();
  assert.ok(degraded.calls.includes("request_budget_shop_order"));
  assert.equal(degraded.destination(), "orders.html");

  const voucherOrder = await loadShop({ budgetFails: true });
  voucherOrder.element("shop-voucher-amount").value = "20";
  voucherOrder.element("shop-voucher-amount").listeners.input();
  assert.equal(voucherOrder.element("shop-checkout").disabled, false);
  await voucherOrder.element("shop-checkout").listeners.click();
  assert.ok(voucherOrder.calls.includes("request_shop_order"));
  assert.ok(!voucherOrder.calls.includes("request_budget_shop_order"));

  const noAddress = await loadShop({ budgetFails: true, addressFails: true });
  assert.equal(noAddress.element("shop-checkout").disabled, true);
  const mobile = await loadShop({ mobile: true });
  assert.equal(mobile.element("shop-mobile-cart").hidden, false);
  assert.match(mobile.element("shop-mobile-cart-summary").textContent, /1 item.*PHP 100\.00/);
  mobile.element("shop-mobile-cart").listeners.click();
  assert.equal(mobile.element(".shop-cart").scrolledIntoView, true);
  assert.equal(mobile.element(".shop-cart").focused, true);
  mobile.element("shop-cart-items").listeners.click({ target: { closest() { return { dataset: { cartId: "product-1", cartAction: "remove" } }; } } });
  assert.equal(mobile.element("shop-mobile-cart").hidden, true);
  process.stdout.write("Shop checkout tolerates missing Budget preview while preserving address and voucher checks.\n");
}

check().catch(error => { console.error(error); process.exitCode = 1; });
