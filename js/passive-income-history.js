document.addEventListener("DOMContentLoaded", async () => {
  const alertBox = document.getElementById("income-history-alert");
  if (!window.MatrixDB) return showAccessError("Please sign in through the member portal first.");
  if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
  const memberId = window.MATRIX_USES_SUPABASE
    ? ((await MatrixDB.getAuthenticatedMember()) || {}).id
    : sessionStorage.getItem("matrix_logged_in_member_id");
  const member = memberId ? MatrixDB.getMemberById(memberId) : null;
  if (!member) return showAccessError("Your member session is no longer available. Please sign in again.");

  const summary = MatrixDB.getMemberMatrixSummary(member.id, "power3-passive");
  const timelineSummary = window.MATRIX_USES_SUPABASE ? null : MatrixDB.getMemberMatrixSummary(member.id, "timeline-power3");
  const entries = [
    ...(Array.isArray(summary && summary.rewardLedger) ? summary.rewardLedger : []),
    ...(Array.isArray(timelineSummary && timelineSummary.rewardLedger) ? timelineSummary.rewardLedger : [])
  ];
  const timeFilter = document.getElementById("income-time-filter");
  const statusFilter = document.getElementById("income-status-filter");
  const sourceFilter = document.getElementById("income-source-filter");
  document.getElementById("income-history-content").style.display = "block";
  document.getElementById("income-total").textContent = money(sum(entries));
  document.getElementById("income-due").textContent = money(sum(entries.filter(entry => displayStatus(entry) === "due")));
  document.getElementById("income-upcoming").textContent = money(sum(entries.filter(entry => displayStatus(entry) === "upcoming")));
  [timeFilter, statusFilter, sourceFilter].forEach(filter => filter.addEventListener("change", render));
  render();

  function render() {
    const filtered = entries.filter(entry => matchesTime(entry) && matchesStatus(entry) && matchesSource(entry));
    document.getElementById("income-result-count").textContent = `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;
    const list = document.getElementById("income-history-list");
    if (!filtered.length) {
      list.innerHTML = `<div class="portal-card withdrawal-empty"><strong>No matching income entries</strong><p>Try selecting a different time period, status, or source.</p></div>`;
      return;
    }
    list.innerHTML = [...filtered].sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt)).map(entry => {
      const status = displayStatus(entry);
      const source = sourceLabel(entry);
      const statusClass = status === "upcoming" ? "pending" : "approved";
      return `<article class="portal-card withdrawal-history-item"><div class="withdrawal-history-topline"><div><span class="withdrawal-reference-label">${escapeHtml(source)}</span><h2>${money(entry.amount)}</h2></div><span class="withdrawal-status status-${statusClass}">${capitalize(status)}</span></div><div class="withdrawal-history-details"><div><span>Income source</span><strong>${escapeHtml(entry.sourceLabel || source)}</strong></div><div><span>Due date</span><strong>${dateTime(entry.dueAt)}</strong></div><div><span>Ledger status</span><strong>${capitalize(status)}</strong></div><div><span>Paid date</span><strong>${entry.paidAt ? dateTime(entry.paidAt) : "-"}</strong></div></div></article>`;
    }).join("");
  }

  function displayStatus(entry) { if (entry.status === "paid" || entry.paidAt) return "paid"; return new Date(entry.dueAt) > new Date() ? "upcoming" : "due"; }
  function matchesStatus(entry) { return statusFilter.value === "all" || displayStatus(entry) === statusFilter.value; }
  function matchesSource(entry) {
    if (sourceFilter.value === "all") return true;
    if (sourceFilter.value === "timeline-matrix") return entry.sourceType === "timeline-matrix" || entry.sourceType === "timeline_matrix";
    return entry.sourceType === sourceFilter.value;
  }
  function sourceLabel(entry) {
    if (entry.sourceType === "entry") return "Entry Passive";
    if (entry.sourceType === "exit") return `Exit ${entry.exit} Passive`;
    if (entry.sourceType === "matrix") return `1200 Matrix Income Exit ${entry.exit}`;
    if (entry.sourceType === "timeline-matrix" || entry.sourceType === "timeline_matrix") return `Timeline Matrix Income Exit ${entry.exit}`;
    return entry.sourceType || "Income";
  }
  function matchesTime(entry) { const value = timeFilter.value; if (value === "all") return true; const due = new Date(entry.dueAt); const now = new Date(); if (value === "year") return due.getFullYear() === now.getFullYear(); const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - Number(value)); return due >= cutoff && due <= now; }
  function sum(items) { return items.reduce((total, entry) => total + Number(entry.amount || 0), 0); }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
  function dateTime(value) { return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-"; }
  function capitalize(value) { return String(value || "").replace(/^./, letter => letter.toUpperCase()); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function showAccessError(message) { alertBox.className = "alert alert-danger"; alertBox.textContent = message; alertBox.style.display = "block"; window.setTimeout(() => { window.location.href = "portal.html"; }, 1400); }
});
