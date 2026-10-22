document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".matrix-tabs[role=tablist]").forEach(list => {
    const tabs = () => [...list.querySelectorAll(":scope > [role=tab]")];
    const sync = () => {
      const items = tabs();
      const selected = items.find(tab => tab.getAttribute("aria-selected") === "true") || items[0];
      items.forEach(tab => { tab.tabIndex = tab === selected ? 0 : -1; });
    };

    list.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const items = tabs();
      const index = items.indexOf(event.target.closest("[role=tab]"));
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
      items[next].click();
      queueMicrotask(() => {
        sync();
        tabs().find(tab => tab.getAttribute("aria-selected") === "true")?.focus();
      });
    });
    list.addEventListener("click", () => queueMicrotask(sync));
    new MutationObserver(sync).observe(list, { childList: true });
    sync();
  });
});
