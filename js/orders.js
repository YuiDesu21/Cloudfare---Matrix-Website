document.addEventListener("DOMContentLoaded", async () => {
  const alert = document.getElementById("orders-alert");
  const content = document.getElementById("orders-content");
  const loading = document.getElementById("orders-loading");
  const list = document.getElementById("orders-list");
  const search = document.getElementById("orders-search");
  const filters = Array.from(document.querySelectorAll("[data-order-filter]"));
  const completed = new Set(["received"]);
  const cancelled = new Set(["rejected", "cancelled"]);
  const statusLabels = {
    pending_shipping_fee: "Shipping review",
    approved_for_payment: "Ready to pay",
    payment_submitted: "Payment review",
    payment_approved: "Paid",
    shipped: "Shipped",
    received: "Received",
    rejected: "Rejected",
    cancelled: "Cancelled"
  };
  const statusDescriptions = {
    pending_shipping_fee: "Shipping fee is being reviewed.",
    approved_for_payment: "Shipping is set. Payment is ready.",
    payment_submitted: "Payment is awaiting review.",
    payment_approved: "Payment confirmed. Awaiting shipment.",
    shipped: "Shipped. Confirm receipt after delivery."
  };
  let orders = [];
  let filter = "all";

  try {
    if (!window.MatrixDB) throw new Error("Orders are temporarily unavailable. Please reload the page.");
    if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
    const member = await MatrixDB.getAuthenticatedMember();
    if (!member) {
      window.location.replace("portal.html?returnTo=orders.html");
      return;
    }
    orders = typeof MatrixDB.refreshCommerceOrders === "function"
      ? await MatrixDB.refreshCommerceOrders()
      : MatrixDB.getCommerceOrders();
    orders = Array.isArray(orders) ? orders : [];
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    document.getElementById("orders-total").textContent = orders.length;
    document.getElementById("orders-active").textContent = orders.filter(order => !completed.has(order.status) && !cancelled.has(order.status)).length;
    document.getElementById("orders-completed").textContent = orders.filter(order => completed.has(order.status)).length;
    content.hidden = false;
    render();
  } catch (error) {
    alert.textContent = error.message || "Orders could not be loaded. Please try again.";
    alert.hidden = false;
  } finally {
    loading.hidden = true;
  }

  filters.forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.orderFilter;
    filters.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    render();
  }));
  search.addEventListener("input", render);

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = orders.filter(order => {
      if (filter === "active" && (completed.has(order.status) || cancelled.has(order.status))) return false;
      if (filter === "completed" && !completed.has(order.status)) return false;
      if (filter === "cancelled" && !cancelled.has(order.status)) return false;
      const snapshot = order.packageSnapshot || {};
      const itemNames = (Array.isArray(snapshot.items) ? snapshot.items : []).map(item => item.itemName || item.productName || "");
      return !query || [order.orderCode, snapshot.packageName, order.packageTypeLabel, ...itemNames]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
    document.getElementById("orders-count").textContent = `${visible.length} order${visible.length === 1 ? "" : "s"}`;
    list.innerHTML = visible.length ? visible.map(renderOrder).join("")
      : `<div class="orders-empty"><strong>${orders.length ? "No matching orders" : "No orders yet"}</strong><p>${orders.length ? "Try another search or status." : "Your purchases will appear here after you request an order."}</p></div>`;
  }

  function renderOrder(order) {
    const name = order.packageSnapshot && order.packageSnapshot.packageName || "Product order";
    const source = order.orderPurpose === "shop" ? "Shop" : order.orderPurpose === "budget_qualification" ? "Budget Plan" : order.packageType === "product_plus_requirement" || order.packageType === "product_plus_voucher" ? "Product Plus" : "Entry Orders";
    const amount = order.amountDue == null ? order.packageTotal : order.amountDue;
    const manageHref = source === "Product Plus" ? "packages-orders.html?type=product_plus_requirement" : "packages-orders.html";
    const canPay = order.status === "approved_for_payment" && Number(order.amountDue || 0) > 0;
    const needsAction = canPay || order.status === "shipped";
    const actionLabel = order.status === "shipped" ? "Confirm receipt" : "Pay now";
    const statusDescription = order.status === "approved_for_payment" && !canPay
      ? "Shipping is set. Awaiting the next order update."
      : statusDescriptions[order.status];
    const statusLabel = order.status === "approved_for_payment" && !canPay ? "No payment due" : statusLabels[order.status] || "Pending";
    const address = order.shippingAddressSnapshot || {};
    const items = (Array.isArray(order.packageSnapshot?.items) ? order.packageSnapshot.items : []).map(item =>
      `<div><span>${escapeHtml(item.itemName || item.productName || "Product")}${Number(item.quantity || 1) > 1 ? ` x ${Number(item.quantity)}` : ""}</span><strong>PHP ${money(Number(item.price || 0) * Number(item.quantity || 1))}</strong></div>`).join("");
    const actionHref = `${manageHref}${manageHref.includes("?") ? "&" : "?"}order=${encodeURIComponent(order.id)}${source === "Shop" ? "&source=shop" : ""}`;
    return `<article class="orders-item">
      <div class="orders-item-main"><div class="orders-item-icon" aria-hidden="true">${escapeHtml(source.charAt(0))}</div><div class="orders-item-copy"><small>${escapeHtml(source)} · ${escapeHtml(order.orderCode || "Order")}</small><h3>${escapeHtml(name)}</h3><span>${formatDate(order.createdAt)}</span>${statusDescription ? `<span class="orders-item-next">${escapeHtml(statusDescription)}</span>` : ""}</div><div class="orders-item-meta"><strong>PHP ${money(amount)}</strong><span class="withdrawal-status ${cancelled.has(order.status) ? "status-rejected" : completed.has(order.status) || order.status === "shipped" || order.status === "payment_approved" ? "status-approved" : "status-pending"}">${escapeHtml(statusLabel)}</span></div></div>
      <div class="orders-item-bottom"><details><summary>Order details</summary><div class="orders-details">${items}<div><span>Products</span><strong>PHP ${money(order.packageTotal)}</strong></div>${order.shippingFee == null ? "" : `<div><span>Shipping</span><strong>PHP ${money(order.shippingFee)}</strong></div>`}${Number(order.voucherAmount || 0) ? `<div><span>Vouchers used</span><strong>PHP ${money(order.voucherAmount)}</strong></div>` : ""}${address.fullName ? `<div><span>Deliver to</span><strong>${escapeHtml(address.fullName)}${address.city ? `, ${escapeHtml(address.city)}` : ""}</strong></div>` : ""}${order.adminNotes ? `<p><strong>Admin note:</strong> ${escapeHtml(order.adminNotes)}</p>` : ""}</div></details>${needsAction ? `<a href="${actionHref}">${actionLabel}</a>` : ""}</div>
    </article>`;
  }

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
  function money(value) { return Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }); }
});
