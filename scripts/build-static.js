const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const publicFiles = [
  "index.html",
  "portal.html",
  "exit-action.html",
  "withdrawal-request.html",
  "withdrawal-history.html",
  "passive-income-history.html",
  "styles.css",
  "portal.css",
  "_headers",
  "robots.txt"
];
const publicDirectories = ["assets"];
const publicJavaScript = ["portal.js", "runtime-config.js", "supabase-client.js", "withdrawals.js", "passive-income-history.js", "exit-action.js"];
const mappedProductionFiles = [
  ["upgrade-entry-production.html", "upgrade-entry.html"],
  ["admin-production.html", "admin.html"],
  ["js/upgrade-entry-production.js", "js/upgrade-entry-production.js"],
  ["js/admin-production.js", "js/admin-production.js"]
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const relativePath of publicFiles) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing public file: ${relativePath}`);
  fs.copyFileSync(source, path.join(output, relativePath));
}

for (const relativePath of publicDirectories) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing public directory: ${relativePath}`);
  fs.cpSync(source, path.join(output, relativePath), { recursive: true });
}

const javascriptOutput = path.join(output, "js");
fs.mkdirSync(javascriptOutput, { recursive: true });
for (const filename of publicJavaScript) {
  fs.copyFileSync(path.join(root, "js", filename), path.join(javascriptOutput, filename));
}
fs.copyFileSync(path.join(root, "matrix-db-production.js"), path.join(output, "matrix-db.js"));
for (const [sourceName, destinationName] of mappedProductionFiles) {
  const destination = path.join(output, destinationName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, sourceName), destination);
}

const supabaseBundle = path.join(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");
if (!fs.existsSync(supabaseBundle)) throw new Error("Supabase browser bundle is missing. Run npm install first.");
const vendorDirectory = path.join(output, "vendor");
fs.mkdirSync(vendorDirectory, { recursive: true });
fs.copyFileSync(supabaseBundle, path.join(vendorDirectory, "supabase.js"));

console.log(`Static deployment assembled in ${output}`);
