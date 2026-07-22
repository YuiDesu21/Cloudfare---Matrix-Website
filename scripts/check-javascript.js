const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const files = ["matrix-db.js", ...fs.readdirSync(path.join(root, "js")).filter(name => name.endsWith(".js")).map(name => `js/${name}`)];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} browser JavaScript files.`);
