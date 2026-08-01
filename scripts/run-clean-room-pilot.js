const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-clean-room-"));
const port = 5400 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}/api/matrix/`;
let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(action, body = {}, token = "") {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const requestHandle = http.request(`${baseUrl}${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { "X-Matrix-Auth": token } : {})
      }
    }, response => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { responseBody += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(responseBody) });
        } catch (error) {
          reject(new Error(`Invalid response from ${action}: ${responseBody}`));
        }
      });
    });
    requestHandle.on("error", reject);
    requestHandle.write(payload);
    requestHandle.end();
  });
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await request("getMatrixRules");
      if (result.body.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Pilot server did not start.");
}

async function registerMember({ fullName, username, email, phone, walletAddress, referralCode = "" }) {
  const result = await request("registerPending", {
    memberData: { fullName, username, email, phone, walletAddress, referralCode },
    password: "PilotPass1"
  });
  assert(result.body.ok, `Registration failed for ${username}: ${result.body.error}`);
  return result.body.data;
}

async function runPilot() {
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.mkdirSync(path.join(tempRoot, "data"));
  fs.copyFileSync(path.join(root, "data", "matrix-rules.json"), path.join(tempRoot, "data", "matrix-rules.json"));
  fs.writeFileSync(path.join(tempRoot, "data", "matrix-db.json"), "{}", "utf8");
  server = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), MATRIX_MODE: "sandbox" },
    stdio: "ignore",
    windowsHide: true
  });
  await waitForServer();

  const adminLogin = await request("authenticateAdmin", { password: "admin123", operatorName: "Clean Room Pilot" });
  assert(adminLogin.body.ok, "Admin authentication failed.");
  const adminToken = adminLogin.body.data.token;

  const rootMember = await registerMember({
    fullName: "Pilot Root", username: "pilotroot", email: "pilot.root@example.test",
    phone: "09171230001", walletAddress: "PilotWalletRoot"
  });
  const rootToken = rootMember.token;
  const rootId = rootMember.account.id;
  const rootCode = rootMember.account.accountCode;

  const rootEntry = await request("requestUpgrade", { memberId: rootId, referenceNumber: "PILOT-ENTRY-ROOT" }, rootToken);
  assert(rootEntry.body.ok, `Root Entry request failed: ${rootEntry.body.error}`);
  const rootApproved = await request("approveUpgrade", {
    requestId: rootEntry.body.data.id, parentMemberId: null, decisionNote: "Verified clean-room Entry payment reference."
  }, adminToken);
  assert(rootApproved.body.ok && rootApproved.body.data.status === "approved", "Root Entry approval failed.");

  const rootTimeline = await request("requestTimelineActivation", {
    memberId: rootId, paymentMethod: "gcash", gcashName: "Pilot Root", gcashNumber: "09171230001", referenceNumber: "PILOT-TIMELINE-ROOT"
  }, rootToken);
  assert(rootTimeline.body.ok, `Root Timeline request failed: ${rootTimeline.body.error}`);
  const rootTimelineApproved = await request("approveTimelineActivation", {
    requestId: rootTimeline.body.data.id, decisionNote: "Verified clean-room PHP 693 Timeline payment."
  }, adminToken);
  assert(rootTimelineApproved.body.ok && rootTimelineApproved.body.data.parentMemberId === null, "Root Timeline placement was not the first position.");

  const childMember = await registerMember({
    fullName: "Pilot Child", username: "pilotchild", email: "pilot.child@example.test",
    phone: "09171230002", walletAddress: "PilotWalletChild", referralCode: rootCode
  });
  const childToken = childMember.token;
  const childId = childMember.account.id;
  const childEntry = await request("requestUpgrade", { memberId: childId, referenceNumber: "PILOT-ENTRY-CHILD" }, childToken);
  assert(childEntry.body.ok, "Child Entry request failed.");
  const childApproved = await request("approveUpgrade", {
    requestId: childEntry.body.data.id, decisionNote: "Verified clean-room child Entry payment reference."
  }, adminToken);
  assert(childApproved.body.ok, "Child Entry approval failed.");
  const childTimeline = await request("requestTimelineActivation", {
    memberId: childId, paymentMethod: "gcash", gcashName: "Pilot Child", gcashNumber: "09171230002", referenceNumber: "PILOT-TIMELINE-CHILD"
  }, childToken);
  assert(childTimeline.body.ok, "Child Timeline request failed.");
  const childTimelineApproved = await request("approveTimelineActivation", {
    requestId: childTimeline.body.data.id, decisionNote: "Verified clean-room child Timeline payment."
  }, adminToken);
  assert(childTimelineApproved.body.ok && childTimelineApproved.body.data.parentMemberId === rootId, "Timeline did not place the second member under the first member.");
  const rootMainSummary = await request("getMemberMatrixSummary", { memberId: rootId, planId: "power3-passive" }, rootToken);
  const mainExitOne = rootMainSummary.body.data.exits.find(exit => Number(exit.exit) === 1);
  assert(mainExitOne.qualifiedDownlines === 1, "Timeline positions leaked into the Main Matrix downline count.");

  const duplicateMember = await registerMember({
    fullName: "Pilot Duplicate", username: "pilotduplicate", email: "pilot.duplicate@example.test",
    phone: "09171230003", walletAddress: "PilotWalletDuplicate"
  });
  const duplicateTimeline = await request("requestTimelineActivation", {
    memberId: duplicateMember.account.id, paymentMethod: "gcash", gcashName: "Pilot Duplicate", gcashNumber: "09171230003", referenceNumber: "PILOT-TIMELINE-CHILD"
  }, duplicateMember.token);
  assert(!duplicateTimeline.body.ok && /already associated/.test(duplicateTimeline.body.error), "Duplicate payment reference was not blocked.");

  const anonymousDirectory = await request("getMembers");
  assert(!anonymousDirectory.body.ok, "Anonymous directory access was allowed.");
  const crossAccountSummary = await request("getMemberMatrixSummary", { memberId: rootId, planId: "power3-passive" }, childToken);
  assert(!crossAccountSummary.body.ok, "Member could read another member's summary.");

  const decisions = await request("getApprovalDecisionHistory", {}, adminToken);
  assert(decisions.body.ok && decisions.body.data.length >= 4, "Approval decision history was not recorded.");
  const report = await request("getOperationsReport", {}, adminToken);
  assert(report.body.ok && report.body.data.audit.valid, "Operations report or audit integrity check failed.");

  const signedOut = await request("signOut", {}, childToken);
  assert(signedOut.body.ok, "Member sign-out failed.");
  const afterSignOut = await request("getMemberMatrixSummary", { memberId: childId, planId: "power3-passive" }, childToken);
  assert(!afterSignOut.body.ok, "Signed-out token remained valid.");

  return {
    freshDatabase: true,
    entryApproval: true,
    timelinePlacement: true,
    matrixCountsSeparated: true,
    duplicatePaymentBlocked: true,
    accessBoundaries: true,
    decisionHistory: true,
    auditIntegrity: true,
    serverSignOut: true,
    reconciliationExceptions: report.body.data.exceptions.length
  };
}

async function cleanup() {
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise(resolve => {
      server.once("exit", resolve);
      server.kill();
    });
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

runPilot()
  .then(result => {
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
