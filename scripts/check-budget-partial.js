const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "budget-plan.js"), "utf8");
const plan = {
  isActive: true, rank: 1, entryCredit: 150, investmentCredit: 300, canInvest: true,
  passiveIncome: [], rules: [{
    rank: 1, name: "Overcomer", reachedAt: "2026-10-21", monthlyPassive: 231,
    passiveMonths: 3, investmentAmount: 300, investmentMonths: 3, contractMonths: 3
  }]
};
const failed = { data: null, error: { message: "Temporarily unavailable" } };

async function render(responses) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", className: "", hidden: true, disabled: false, value: "1",
      style: {}, listeners: {}, attributes: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector() { return element("progress-meter"); }
    });
    return elements.get(id);
  }
  let boot;
  const client = {
    auth: { async getSession() { return { data: { session: { user: { id: "member" } } } }; } },
    rpc(name) { return Promise.resolve(responses[name] || failed); },
    from(name) {
      const builder = {
        select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; },
        single() { return this; },
        then(resolve, reject) { return Promise.resolve(responses[name] || failed).then(resolve, reject); }
      };
      return builder;
    }
  };
  const context = {
    document: {
      addEventListener(_type, handler) { boot = handler; },
      getElementById: element,
      querySelector() { return element("hero-entry-amount"); },
      querySelectorAll() { return []; }
    },
    window: { matrixSupabase: client, location: { replace() {}, reload() {} } },
    MatrixBenefits: { progress: () => "progress", state: label => label },
    Date, Intl, Math, Number
  };
  vm.runInNewContext(source, context);
  await boot();
  return element;
}

async function check() {
  const core = { data: plan, error: null };
  const unavailable = await render({ get_my_budget_plan_dashboard: core });
  assert.equal(unavailable("budget-content").hidden, false);
  assert.equal(unavailable("budget-summary-earnings").textContent, "Unavailable");
  assert.equal(unavailable("budget-summary-investment").textContent, "Unavailable");
  assert.equal(unavailable("budget-token-submit").disabled, true);
  assert.match(unavailable("budget-investment-rows").innerHTML, /Unavailable<\/button>/);
  assert.match(unavailable("budget-investment-rows").innerHTML, /disabled/);

  const methodsMissing = await render({
    get_my_budget_plan_dashboard: core,
    get_my_member_funds_dashboard: { data: { investments: [], matrixBalances: { "budget-plan": 12 }, investmentAvailable: 500 }, error: null },
    budget_investment_requests: { data: [], error: null },
    budget_plan_token_settings: { data: { unit_price: 60 }, error: null },
    budget_plan_token_requests: { data: [], error: null },
    get_my_dashboard: { data: { member: { walletAddress: "F3-WALLET" } }, error: null }
  });
  assert.equal(methodsMissing("budget-content").hidden, false);
  assert.equal(methodsMissing("budget-summary-earnings").textContent, "PHP 12.00");
  assert.equal(methodsMissing("budget-token-submit").disabled, true);
  assert.match(methodsMissing("budget-investment-rows").innerHTML, /Request Investment<\/button>/);
  assert.doesNotMatch(methodsMissing("budget-investment-rows").innerHTML, /data-budget-invest-rank="1" disabled/);

  const activeRoot = await render({
    get_my_budget_plan_dashboard: { data: {
      ...plan, rank: 0, entryCredit: 0, investmentCredit: 0, qualificationValue: 0, canInvest: false,
      rules: [{ rank: 0, name: "Challenger", reachedAt: "2026-10-21" }, plan.rules[0]]
    }, error: null },
    get_my_member_funds_dashboard: { data: { investments: [], matrixBalances: {}, investmentAvailable: 0 }, error: null },
    budget_investment_requests: { data: [], error: null }
  });
  assert.equal(activeRoot("budget-progress-title").textContent, "Investment Qualification");
  assert.equal(activeRoot("budget-progress-value").textContent, "PHP 0.00 / PHP 450");
  assert.match(activeRoot("budget-eligibility-note").textContent, /Overcomer rank and PHP 450/);
  assert.match(activeRoot("budget-summary-investment-detail").textContent, /PHP 450.00 more/);

  const coreMissing = await render({});
  assert.equal(coreMissing("budget-content").hidden, true);
  assert.equal(coreMissing("budget-alert").className, "alert alert-danger");
  process.stdout.write("Budget partial loading keeps the plan visible and affected actions disabled.\n");
}

check().catch(error => { console.error(error); process.exitCode = 1; });
