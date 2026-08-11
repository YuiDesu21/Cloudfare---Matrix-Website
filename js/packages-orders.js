document.addEventListener("DOMContentLoaded", async () => {
  const COMMERCE_PACKAGE_TYPES = [
    { id: "timeline_entry", label: "Timeline Entry" },
    { id: "matrix_1200_entry", label: "1200 Entry" },
    { id: "product_plus_requirement", label: "Product Plus Buy" },
    { id: "product_plus_voucher", label: "Voucher Packages" }
  ];

  const pageAlert = document.getElementById("packages-orders-alert");
  const content = document.getElementById("packages-orders-content");
  const commercePackagesCard = document.getElementById("commerce-packages-card");
  const commercePackageCount = document.getElementById("commerce-package-count");
  const commercePackageTabs = document.getElementById("commerce-package-tabs");
  const commercePackageList = document.getElementById("commerce-package-list");
  const commerceOrderCount = document.getElementById("commerce-order-count");
  const commerceOrderList = document.getElementById("commerce-order-list");
  const commerceOrderModal = document.getElementById("commerce-order-modal");
  const commerceOrderClose = document.getElementById("commerce-order-close");
  const commerceOrderSummary = document.getElementById("commerce-order-summary");
  const commerceOrderAlert = document.getElementById("commerce-order-alert");
  const commerceOrderForm = document.getElementById("commerce-order-form");
  const commerceOrderAddress = document.getElementById("commerce-order-address");
  const commerceOrderAddAddress = document.getElementById("commerce-order-add-address");
  const commerceOrderAddressPreview = document.getElementById("commerce-order-address-preview");
  const commerceOrderNotes = document.getElementById("commerce-order-notes");
  const commerceOrderNotesCount = document.getElementById("commerce-order-notes-count");
  const commerceOrderSubmit = document.getElementById("commerce-order-submit");
  const commercePaymentModal = document.getElementById("commerce-payment-modal");
  const commercePaymentClose = document.getElementById("commerce-payment-close");
  const commercePaymentSummary = document.getElementById("commerce-payment-summary");
  const commercePaymentAlert = document.getElementById("commerce-payment-alert");
  const commercePaymentForm = document.getElementById("commerce-payment-form");
  const commercePaymentMethod = document.getElementById("commerce-payment-method");
  const commercePaymentMethodPreview = document.getElementById("commerce-payment-method-preview");
  const commercePaymentReference = document.getElementById("commerce-payment-reference");
  const commercePaymentNotes = document.getElementById("commerce-payment-notes");
  const commercePaymentNotesCount = document.getElementById("commerce-payment-notes-count");
  const commercePaymentSubmit = document.getElementById("commerce-payment-submit");

  let member = null;
  let selectedCommercePackageType = "timeline_entry";
  let pendingCommercePackage = null;
  let pendingPaymentOrder = null;

  if (!window.MatrixDB) {
    showAccessError("Please sign in through your member dashboard before opening packages.");
    return;
  }

  try {
    if (window.MATRIX_USES_SUPABASE) await MatrixDB.initializeDatabase();
    member = await MatrixDB.getAuthenticatedMember();
    if (!member) {
      showAccessError("Your member session is no longer available. Please sign in again.");
      return;
    }
    content.style.display = "block";
    renderCommercePackagesPanel();
  } catch (error) {
    showAlert(error.message, "danger");
  }

  commerceOrderClose.addEventListener("click", closeCommerceOrderModal);
  commerceOrderModal.addEventListener("click", event => { if (event.target === commerceOrderModal) closeCommerceOrderModal(); });
  commerceOrderNotes.addEventListener("input", () => { commerceOrderNotesCount.textContent = commerceOrderNotes.value.length; });
  commerceOrderAddress.addEventListener("change", renderSelectedCommerceAddress);
  commerceOrderAddAddress.addEventListener("click", () => { window.location.href = "portal.html#profile"; });
  commerceOrderForm.addEventListener("submit", handleCommerceOrderSubmit);
  commercePaymentClose.addEventListener("click", closeCommercePaymentModal);
  commercePaymentModal.addEventListener("click", event => { if (event.target === commercePaymentModal) closeCommercePaymentModal(); });
  commercePaymentMethod.addEventListener("change", renderSelectedPaymentMethod);
  commercePaymentNotes.addEventListener("input", () => { commercePaymentNotesCount.textContent = commercePaymentNotes.value.length; });
  commercePaymentForm.addEventListener("submit", handleCommercePaymentSubmit);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeCommerceOrderModal();
    closeCommercePaymentModal();
  });

  function renderCommercePackagesPanel() {
    const summary = MatrixDB.getMemberMatrixSummary(member.id);
    const packages = MatrixDB.getCommercePackages();
    const orders = MatrixDB.getCommerceOrders();
    const visiblePackages = packages.filter(item => item.packageType === selectedCommercePackageType);
    commercePackageCount.textContent = `${packages.length} Package${packages.length === 1 ? "" : "s"}`;
    commercePackageTabs.innerHTML = COMMERCE_PACKAGE_TYPES.map(type => {
      const count = packages.filter(item => item.packageType === type.id).length;
      return `<button class="matrix-tab ${selectedCommercePackageType === type.id ? "active" : ""} ${count ? "" : "locked"}" type="button" data-commerce-type="${type.id}" role="tab" aria-selected="${selectedCommercePackageType === type.id}"><strong>${escapeHtml(type.label)}</strong><span class="matrix-tab-status"><span>${count}</span></span></button>`;
    }).join("");
    commercePackageTabs.querySelectorAll("[data-commerce-type]").forEach(button => {
      button.addEventListener("click", () => {
        selectedCommercePackageType = button.dataset.commerceType;
        renderCommercePackagesPanel();
      });
    });
    enableDragScroll(commercePackageTabs);

    if (!visiblePackages.length) {
      commercePackageList.innerHTML = `<div class="empty-state"><p>No active packages for this type yet.</p></div>`;
    } else {
      commercePackageList.innerHTML = visiblePackages.map(commercePackage => renderCommercePackageCard(commercePackage, summary)).join("");
      commercePackageList.querySelectorAll("[data-request-package-id]").forEach(button => {
        const commercePackage = visiblePackages.find(item => item.id === button.dataset.requestPackageId);
        button.addEventListener("click", () => openCommerceOrderModal(commercePackage));
      });
    }

    renderCommerceOrderHistory(orders);
  }

  function renderCommercePackageCard(commercePackage, summary) {
    const isVoucherPackage = commercePackage.packageType === "product_plus_voucher";
    const voucherBalanceValue = Number(summary && summary.vouchers ? summary.vouchers.balance : 0);
    const total = Number(commercePackage.totalPrice || 0);
    const canRequest = !isVoucherPackage || voucherBalanceValue >= total;
    const items = commercePackage.items || [];
    return `
      <article class="commerce-browser-package">
        <div class="commerce-browser-heading">
          <div>
            <span>${escapeHtml(commercePackage.packageTypeLabel)}</span>
            <h4>${escapeHtml(commercePackage.packageName)}</h4>
          </div>
          <strong>${isVoucherPackage ? `${formatNumber(total)} Vouchers` : `PHP ${formatNumber(total)}`}</strong>
        </div>
        ${commercePackage.description ? `<p>${escapeHtml(commercePackage.description)}</p>` : ""}
        <div class="commerce-browser-items">
          ${items.map(item => `
            <figure>
              ${item.photoData ? `<img src="${escapeHtml(item.photoData)}" alt="${escapeHtml(item.itemName)}">` : `<span>No Photo</span>`}
              <figcaption><strong>${escapeHtml(item.itemName)}</strong><small>${isVoucherPackage ? `${formatNumber(item.price)} vouchers` : `PHP ${formatNumber(item.price)}`}</small></figcaption>
            </figure>
          `).join("")}
        </div>
        <div class="commerce-browser-actions">
          ${isVoucherPackage ? `<span class="commerce-voucher-note">Voucher balance: PHP ${formatNumber(voucherBalanceValue)}</span>` : `<span>Shipping fee added after admin checks J&amp;T.</span>`}
          <button class="button button-primary button-small" type="button" data-request-package-id="${escapeHtml(commercePackage.id)}" ${canRequest ? "" : "disabled"}>${canRequest ? "Request Order" : "Need More Vouchers"}</button>
        </div>
      </article>
    `;
  }

  function renderCommerceOrderHistory(orders = []) {
    commerceOrderCount.textContent = `${orders.length} request${orders.length === 1 ? "" : "s"}`;
    if (!orders.length) {
      commerceOrderList.innerHTML = `<div class="empty-state"><p>No order requests yet.</p></div>`;
      return;
    }
    commerceOrderList.innerHTML = orders.slice(0, 8).map(order => {
      const packageSnapshot = order.packageSnapshot || {};
      const canPay = order.status === "approved_for_payment" && Number(order.amountDue || 0) > 0;
      return `
        <article class="product-plus-month ${order.status === "rejected" || order.status === "cancelled" ? "upcoming" : "vested"}">
          <div class="product-plus-month-index">${escapeHtml((order.orderCode || "ORD").replace("ORD-", ""))}</div>
          <div>
            <h5>${escapeHtml(packageSnapshot.packageName || "Package order")}: ${commerceOrderTotalLabel(order)}</h5>
            <p>${escapeHtml(order.packageTypeLabel)} &middot; ${commerceOrderStatusLabel(order.status)} &middot; ${formatDate(order.createdAt)}${order.shippingFee != null ? ` &middot; Shipping: PHP ${formatNumber(order.shippingFee)}` : ""}</p>
          </div>
          ${canPay ? `<button class="button button-primary button-small pay-commerce-order" type="button" data-pay-order-id="${escapeHtml(order.id)}">Pay Now</button>` : `<span class="withdrawal-status ${commerceOrderStatusClass(order.status)}">${escapeHtml(commerceOrderStatusLabel(order.status))}</span>`}
        </article>
      `;
    }).join("");
    commerceOrderList.querySelectorAll("[data-pay-order-id]").forEach(button => {
      const order = orders.find(item => item.id === button.dataset.payOrderId);
      button.addEventListener("click", () => openCommercePaymentModal(order));
    });
  }

  function openCommerceOrderModal(commercePackage) {
    pendingCommercePackage = commercePackage;
    const addresses = MatrixDB.getShippingAddresses();
    commerceOrderForm.reset();
    commerceOrderNotesCount.textContent = "0";
    commerceOrderAlert.style.display = "none";
    commerceOrderSubmit.disabled = addresses.length === 0;
    commerceOrderAddress.disabled = addresses.length === 0;
    commerceOrderAddAddress.hidden = addresses.length > 0;
    commerceOrderSummary.textContent = `${commercePackage.packageName} | ${commercePackage.packageType === "product_plus_voucher" ? `${formatNumber(commercePackage.totalPrice)} vouchers` : `PHP ${formatNumber(commercePackage.totalPrice)}`}`;
    commerceOrderAddress.innerHTML = addresses.length
      ? addresses.map(address => `<option value="${escapeHtml(address.id)}" ${address.isDefault ? "selected" : ""}>${escapeHtml(address.fullName)} - ${escapeHtml(address.city)}, ${escapeHtml(address.province)}</option>`).join("")
      : `<option value="">Add a shipping address first</option>`;
    renderSelectedCommerceAddress();
    commerceOrderModal.style.display = "flex";
    if (addresses.length) commerceOrderAddress.focus(); else commerceOrderAddAddress.focus();
  }

  function closeCommerceOrderModal() {
    if (!commerceOrderModal || commerceOrderModal.style.display === "none") return;
    commerceOrderModal.style.display = "none";
    pendingCommercePackage = null;
  }

  function openCommercePaymentModal(order) {
    pendingPaymentOrder = order;
    const paymentMethods = MatrixDB.getPaymentMethods();
    commercePaymentForm.reset();
    commercePaymentNotesCount.textContent = "0";
    commercePaymentAlert.style.display = "none";
    commercePaymentSubmit.disabled = paymentMethods.length === 0;
    commercePaymentMethod.disabled = paymentMethods.length === 0;
    commercePaymentSummary.textContent = `${order.orderCode} | Amount due: PHP ${formatNumber(order.amountDue || 0)}`;
    commercePaymentMethod.innerHTML = paymentMethods.length
      ? paymentMethods.map(method => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.methodName)} - ${escapeHtml(method.accountName)}</option>`).join("")
      : `<option value="">No active payment methods yet</option>`;
    renderSelectedPaymentMethod();
    commercePaymentModal.style.display = "flex";
    if (paymentMethods.length) commercePaymentMethod.focus();
  }

  function closeCommercePaymentModal() {
    if (!commercePaymentModal || commercePaymentModal.style.display === "none") return;
    commercePaymentModal.style.display = "none";
    pendingPaymentOrder = null;
  }

  function renderSelectedPaymentMethod() {
    const method = MatrixDB.getPaymentMethods().find(item => item.id === commercePaymentMethod.value);
    commercePaymentMethodPreview.innerHTML = method
      ? `<div>${method.qrImageData ? `<img src="${escapeHtml(method.qrImageData)}" alt="${escapeHtml(method.methodName)} QR code">` : `<span>No QR</span>`}</div><section><strong>${escapeHtml(method.methodName)}</strong><p>${escapeHtml(method.accountName)} &middot; ${escapeHtml(method.accountNumber)}</p>${method.instructions ? `<small>${escapeHtml(method.instructions)}</small>` : ""}</section>`
      : `<p>No active payment methods are available yet.</p>`;
  }

  function renderSelectedCommerceAddress() {
    const address = MatrixDB.getShippingAddresses().find(item => item.id === commerceOrderAddress.value);
    commerceOrderAddressPreview.innerHTML = address
      ? `<strong>${escapeHtml(address.fullName)}</strong><p>${escapeHtml(address.streetAddress)}, ${escapeHtml(address.barangay)}, ${escapeHtml(address.city)}, ${escapeHtml(address.province)}, ${escapeHtml(address.region)} ${escapeHtml(address.postalCode)}</p><span>${escapeHtml(address.phone)}</span>`
      : `<p>Add a shipping address in your profile before requesting this order.</p>`;
  }

  async function handleCommerceOrderSubmit(event) {
    event.preventDefault();
    if (!pendingCommercePackage) return;
    commerceOrderAlert.style.display = "none";
    commerceOrderSubmit.disabled = true;
    try {
      await MatrixDB.requestCommerceOrder({
        packageId: pendingCommercePackage.id,
        shippingAddressId: commerceOrderAddress.value,
        memberNotes: commerceOrderNotes.value.trim()
      });
      closeCommerceOrderModal();
      renderCommercePackagesPanel();
      commercePackagesCard.scrollIntoView({ behavior: "smooth", block: "start" });
      showAlert("Order request submitted. Admin will review the shipping fee next.", "success");
    } catch (error) {
      commerceOrderAlert.className = "alert alert-danger";
      commerceOrderAlert.textContent = error.message;
      commerceOrderAlert.style.display = "block";
    } finally {
      commerceOrderSubmit.disabled = false;
    }
  }

  async function handleCommercePaymentSubmit(event) {
    event.preventDefault();
    if (!pendingPaymentOrder) return;
    commercePaymentAlert.style.display = "none";
    commercePaymentSubmit.disabled = true;
    try {
      await MatrixDB.submitCommerceOrderPayment({
        orderId: pendingPaymentOrder.id,
        paymentMethodId: commercePaymentMethod.value,
        referenceNumber: commercePaymentReference.value.trim(),
        notes: commercePaymentNotes.value.trim()
      });
      closeCommercePaymentModal();
      renderCommercePackagesPanel();
      showAlert("Payment reference submitted. Admin will manually verify it next.", "success");
    } catch (error) {
      commercePaymentAlert.className = "alert alert-danger";
      commercePaymentAlert.textContent = error.message;
      commercePaymentAlert.style.display = "block";
    } finally {
      commercePaymentSubmit.disabled = false;
    }
  }

  function enableDragScroll(scroller) {
    if (scroller.dataset.dragReady === "true") return;
    scroller.dataset.dragReady = "true";
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    scroller.addEventListener("pointerdown", event => {
      if (event.pointerType === "touch" || event.target.closest("button, a, input, select, textarea")) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.setPointerCapture(event.pointerId);
      scroller.classList.add("dragging");
    });
    scroller.addEventListener("pointermove", event => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 5) moved = true;
      scroller.scrollLeft = startScroll - delta;
    });
    const endDrag = event => {
      if (!dragging) return;
      dragging = false;
      scroller.classList.remove("dragging");
      if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    };
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointercancel", endDrag);
    scroller.addEventListener("click", event => {
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      moved = false;
    }, true);
  }

  function commerceOrderTotalLabel(order) {
    if (Number(order.voucherAmount || 0) > 0) return `PHP ${formatNumber(order.voucherAmount)} vouchers`;
    const total = Number(order.amountDue || order.packageTotal || 0) + Number(order.shippingFee || 0);
    return `PHP ${formatNumber(total)}`;
  }

  function commerceOrderStatusLabel(status) {
    return ({
      pending_shipping_fee: "Pending Fee",
      approved_for_payment: "Approved",
      payment_submitted: "Payment Sent",
      payment_approved: "Payment Approved",
      shipped: "Shipped",
      received: "Received",
      rejected: "Rejected",
      cancelled: "Cancelled"
    })[status] || capitalize(status || "pending");
  }

  function commerceOrderStatusClass(status) {
    if (["received", "shipped", "payment_approved"].includes(status)) return "status-approved";
    if (["rejected", "cancelled"].includes(status)) return "status-rejected";
    return "status-pending";
  }

  function formatNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
  function formatDate(value) { return value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " "); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function showAlert(message, type) { pageAlert.className = `alert alert-${type}`; pageAlert.textContent = message; pageAlert.style.display = "block"; pageAlert.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function showAccessError(message) { showAlert(message, "danger"); window.setTimeout(() => { window.location.href = "portal.html"; }, 1400); }
});
