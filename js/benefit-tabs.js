document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-benefits]").forEach(section => {
    const tabs = [...section.querySelectorAll("[data-benefit-tab]")];
    const select = tab => {
      tabs.forEach(item => {
        const active = item === tab;
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
        document.getElementById(item.dataset.benefitTab).hidden = !active;
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        select(tabs[next]);
        tabs[next].focus();
      });
    });
    if (tabs.length) select(tabs.find(tab => `#${tab.dataset.benefitTab}` === window.location.hash) || tabs[0]);
  });
});

window.MatrixBenefits = {
  progress(eligible, total) {
    const max = Math.max(Number(total) || 0, 0);
    const count = Math.min(Math.max(Number(eligible) || 0, 0), max);
    const width = max ? count / max * 100 : 0;
    return `<div class="benefit-progress"><strong>${count} / ${max}</strong><span class="benefit-progress-track" aria-hidden="true"><i style="width:${width}%"></i></span></div>`;
  },
  state(label, kind) {
    const text = String(label).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
    return `<span class="benefit-state benefit-state-${kind === "active" ? "active" : kind === "pending" ? "pending" : "locked"}">${text}</span>`;
  }
};
