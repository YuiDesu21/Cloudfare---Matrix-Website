const fs = require("fs");

const source = fs.readFileSync("js/runtime-config.js", "utf8");
const url = source.match(/supabaseUrl:\s*"([^"]+)/)?.[1];
const key = source.match(/supabasePublishableKey:\s*"([^"]+)/)?.[1];
if (!url || !key) throw new Error("Supabase public configuration is missing.");

fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
  .then(async response => {
    const settings = await response.json();
    if (!response.ok) throw new Error(settings.message || settings.msg || `HTTP ${response.status}`);
    console.log(`Supabase Auth reachable; signup is ${settings.disable_signup ? "disabled" : "enabled"}.`);
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
