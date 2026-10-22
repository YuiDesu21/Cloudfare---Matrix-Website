const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "timeline-matrix-production.js"), "utf8");
const start = source.indexOf("  function renderProductEntryProgress(isActive) {");
const end = source.indexOf("\n  async function submitActivation", start);
assert.ok(start !== -1 && end > start, "Standard entry progress renderer is available");

function render(progress) {
  const field = () => ({ textContent: "", hidden: false, style: {} });
  const elements = {
    productProgress: field(), productProgressLabel: field(), productProgressBar: field(),
    productApproved: field(), productPending: field(), productRemaining: field(), productEntryLink: field()
  };
  vm.runInNewContext(`${source.slice(start, end)}\nrenderProductEntryProgress(false);`, {
    elements,
    productEntryProgress: progress,
    Number, Math,
    money: amount => `PHP ${Number(amount).toFixed(2)}`
  });
  return elements;
}

const complete = render({ approvedAmount: 693, pendingAmount: 0, targetAmount: 693, remainingAmount: 0 });
assert.equal(complete.productRemaining.textContent, "PHP 0.00");
assert.equal(complete.productProgressBar.style.width, "100%");
assert.equal(complete.productEntryLink.textContent, "Continue Entry Purchases");

const fresh = render(null);
assert.equal(fresh.productRemaining.textContent, "PHP 693.00");
assert.equal(fresh.productEntryLink.textContent, "Buy Entry Products");
process.stdout.write("Standard entry progress preserves zero remaining and the fresh target.\n");
