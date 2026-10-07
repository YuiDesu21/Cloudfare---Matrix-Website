const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "matrix-db-production.js"), "utf8");
let sessionUserId = "member-b";
const window = {
  matrixSupabase: {
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
        error: null
      })
    }
  }
};
const { MatrixDB, state } = vm.runInNewContext(`${source}\n({ MatrixDB, state })`, { window });

async function run() {
  state.member = { id: "member-a" };
  state.dashboard = { member: state.member };
  state.position = { memberId: "member-a" };
  let refreshes = 0;
  MatrixDB.refreshSessionData = async () => {
    refreshes += 1;
    state.member = { id: sessionUserId };
    return state.member;
  };

  const switchedMember = await MatrixDB.getAuthenticatedMember();
  assert.equal(switchedMember.id, "member-b");
  assert.equal(refreshes, 1);
  await MatrixDB.getAuthenticatedMember();
  assert.equal(refreshes, 1, "Matching sessions should use the cache.");

  sessionUserId = null;
  assert.equal(await MatrixDB.getAuthenticatedMember(), null);
  assert.equal(state.member, null);
  assert.equal(state.dashboard, null);
  assert.equal(state.position, null);
  console.log("Auth cache follows the current session and clears on sign-out.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
