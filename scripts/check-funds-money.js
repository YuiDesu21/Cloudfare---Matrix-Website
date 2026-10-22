const assert = require("node:assert/strict");
const { parseCents, toCents, toSignedCents, centsToInput, money } = require("../js/funds-money.js");

assert.equal(parseCents("0.01"), 1);
assert.equal(parseCents("1250.50"), 125050);
assert.equal(parseCents("1250.50"), toCents("1250.50"));
assert.equal(centsToInput(125050), "1250.50");
assert.equal(money(125050), "PHP 1,250.50");
assert.equal(toSignedCents("-600.00"), -60000);
assert.equal(toSignedCents("600.00"), 60000);
assert.equal(toSignedCents("-invalid"), 0);
assert.equal(money(-60000), "-PHP 600.00");
for (const invalid of ["", "0.001", "-1", "1e3", "1,000", "NaN", "1.2.3", "9007199254740992"]) {
  assert.equal(parseCents(invalid), null, `${invalid} must be rejected`);
}
assert.equal(parseCents("0"), 0);
assert.equal(toCents(null), 0);
console.log("Funds currency parsing rejects invalid precision and unsafe amounts.");
