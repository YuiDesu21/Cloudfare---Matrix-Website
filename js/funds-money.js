(function (root) {
  function parseCents(value) {
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(cents) ? cents : null;
  }
  function toCents(value) {
    const parsed = parseCents(String(value ?? "0"));
    return parsed === null ? 0 : parsed;
  }
  function toSignedCents(value) {
    const text = String(value ?? "0").trim();
    const cents = toCents(text.startsWith("-") ? text.slice(1) : text);
    return text.startsWith("-") && cents ? -cents : cents;
  }
  function centsToInput(cents) {
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  }
  function money(cents) {
    const amount = (Math.abs(cents) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${cents < 0 ? "-" : ""}PHP ${amount}`;
  }
  const api = { parseCents, toCents, toSignedCents, centsToInput, money };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatrixFundsMoney = api;
})(typeof window !== "undefined" ? window : globalThis);
