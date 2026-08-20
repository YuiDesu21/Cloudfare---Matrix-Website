document.addEventListener("DOMContentLoaded", async () => {
  const COMMERCE_PACKAGE_TYPES = [
    { id: "timeline_entry", label: "Timeline Entry" },
    { id: "matrix_1200_entry", label: "1200 Entry" },
    { id: "product_plus_requirement", label: "Product Plus Buy" },
    { id: "product_plus_voucher", label: "Voucher Products" }
  ];
  const PRODUCT_PLUS_TYPES = ["product_plus_requirement", "product_plus_voucher"];

  const pageAlert = document.getElementById("packages-orders-alert");
  const content = document.getElementById("packages-orders-content");
  const commercePackagesCard = document.getElementById("commerce-packages-card");
  const commercePackageCount = document.getElementById("commerce-package-count");
  const commercePackageTabs = document.getElementById("commerce-package-tabs");
  const commercePackageList = document.getElementById("commerce-package-list");
  const commerceOrderCount = document.getElementById("commerce-order-count");
  const commerceOrderList = document.getElementById("commerce-order-list");
  const commerceHistoryCount = document.getElementById("commerce-history-count");
  const commerceHistoryList = document.getElementById("commerce-history-list");
  const commerceOrderModal = document.getElementById("commerce-order-modal");
  const commerceOrderClose = document.getElementById("commerce-order-close");
  const commerceOrderSummary = document.getElementById("commerce-order-summary");
  const commerceOrderAlert = document.getElementById("commerce-order-alert");
  const commerceOrderForm = document.getElementById("commerce-order-form");
  const commerceOrderAddress = document.getElementById("commerce-order-address");
  const commerceOrderAddAddress = document.getElementById("commerce-order-add-address");
  const commerceOrderAddressPreview = document.getElementById("commerce-order-address-preview");
  const commerceOrderUplineGroup = document.getElementById("commerce-order-upline-group");
  const commerceOrderUplineCode = document.getElementById("commerce-order-upline-code");
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
  let pendingProductCartType = null;
  let pendingPaymentOrder = null;
  const productCarts = { product_plus_requirement: [], product_plus_voucher: [] };

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
    const products = MatrixDB.getCommerceProducts();
    const orders = MatrixDB.getCommerceOrders();
    const visiblePackages = packages.filter(item => item.packageType === selectedCommercePackageType);
    const visibleProducts = products.filter(item => item.productType === selectedCommercePackageType);
    commercePackageCount.textContent = `${packages.length + products.length} Item${packages.length + products.length === 1 ? "" : "s"}`;
    commercePackageTabs.innerHTML = COMMERCE_PACKAGE_TYPES.map(type => {
      const count = PRODUCT_PLUS_TYPES.includes(type.id)
        ? products.filter(item => item.productType === type.id).length
        : packages.filter(item => item.packageType === type.id).length;
      return `<button class="matrix-tab ${selectedCommercePackageType === type.id ? "active" : ""} ${count ? "" : "locked"}" type="button" data-commerce-type="${type.id}" role="tab" aria-selected="${selectedCommercePackageType === type.id}"><strong>${escapeHtml(type.label)}</strong><span class="matrix-tab-status"><span>${count}</span></span></button>`;
    }).join("");
    commercePackageTabs.querySelectorAll("[data-commerce-type]").forEach(button => {
      button.addEventListener("click", () => {
        selectedCommercePackageType = button.dataset.commerceType;
        renderCommercePackagesPanel();
      });
    });
    enableDragScroll(commercePackageTabs);

    if (PRODUCT_PLUS_TYPES.includes(selectedCommercePackageType)) {
      renderProductPlusShop(visibleProducts, summary, orders);
    } else if (!visiblePackages.length) {
      commercePackageList.innerHTML = `<div class="empty-state"><p>No active packages for this type yet.</p></div>`;
    } else {
      commercePackageList.innerHTML = visiblePackages.map(commercePackage => renderCommercePackageCard(commercePackage, summary, orders)).join("");
      commercePackageList.querySelectorAll("[data-request-package-id]").forEach(button => {
        const commercePackage = visiblePackages.find(item => item.id === button.dataset.requestPackageId);
        button.addEventListener("click", () => openCommerceOrderModal(commercePackage));
      });
    }

    renderCommerceOrderHistory(orders);
  }

  function renderCommercePackageCard(commercePackage, summary, orders = []) {
    const isVoucherPackage = commercePackage.packageType === "product_plus_voucher";
    const voucherBalanceValue = Number(summary && summary.vouchers ? summary.vouchers.balance : 0);
    const reservedVoucherValue = getReservedVoucherValue(orders);
    const availableVoucherValue = Math.max(voucherBalanceValue - reservedVoucherValue, 0);
    const total = Number(commercePackage.totalPrice || 0);
    const requestState = getCommercePackageRequestState(commercePackage, summary, orders, availableVoucherValue);
    const voucherHint = `Voucher available: PHP ${formatNumber(availableVoucherValue)}${reservedVoucherValue > 0 ? ` | Reserved: PHP ${formatNumber(reservedVoucherValue)}` : ""}${!requestState.canRequest && requestState.buttonLabel !== "Need More Vouchers" ? ` | ${requestState.hint}` : ""}`;
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
            <figure class="commerce-browser-product">
              ${item.photoData ? `<img class="${item.imageFit === "contain" ? "commerce-image-contain" : ""}" src="${escapeHtml(item.photoData)}" alt="${escapeHtml(item.itemName)}" loading="lazy">` : `<span>No Photo</span>`}
              <figcaption><strong>${escapeHtml(item.itemName)}${quantityBadge(item)}</strong><small>${isVoucherPackage ? `${formatNumber(item.price)} vouchers` : `PHP ${formatNumber(item.price)}`}${Number(item.quantity || 1) > 1 ? " each" : ""}</small></figcaption>
            </figure>
          `).join("")}
        </div>
        <div class="commerce-browser-actions">
          ${isVoucherPackage ? `<span class="commerce-voucher-note">${escapeHtml(voucherHint)}</span>` : `<span>${escapeHtml(requestState.hint)}</span>`}
          <button class="button button-primary button-small" type="button" data-request-package-id="${escapeHtml(commercePackage.id)}" ${requestState.canRequest ? "" : "disabled"}>${escapeHtml(requestState.buttonLabel)}</button>
        </div>
      </article>
    `;
  }

  function renderProductPlusShop(products, summary, orders = []) {
    const isVoucherMode = selectedCommercePackageType === "product_plus_voucher";
    const cart = productCarts[selectedCommercePackageType] || [];
    const voucherBalanceValue = Number(summary && summary.vouchers ? summary.vouchers.balance : 0);
    const reservedVoucherValue = getReservedVoucherValue(orders);
    const availableVoucherValue = Math.max(voucherBalanceValue - reservedVoucherValue, 0);
    const cartTotal = getProductCartTotal(selectedCommercePackageType);
    const canCheckout = cart.length > 0 && (!isVoucherMode || availableVoucherValue >= cartTotal);
    commercePackageList.innerHTML = `
      <div class="commerce-product-shop">
        <section class="commerce-product-grid">
          ${products.length ? products.map(product => renderCommerceProductCard(product, isVoucherMode)).join("") : `<div class="empty-state"><p>No active products for this type yet.</p></div>`}
        </section>
        <aside class="commerce-cart-panel">
          <div class="commerce-cart-heading">
            <div><span>${isVoucherMode ? "Voucher checkout" : "Buy requirement checkout"}</span><strong>Cart</strong></div>
            <b>${cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item${cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) === 1 ? "" : "s"}</b>
          </div>
          <div class="commerce-cart-lines">
            ${cart.length ? cart.map(item => renderCartLine(item, products, isVoucherMode)).join("") : `<p class="commerce-cart-empty">Add products to start checkout.</p>`}
          </div>
          <div class="commerce-cart-total"><span>${isVoucherMode ? "Voucher total" : "PHP total"}</span><strong>${isVoucherMode ? `${formatNumber(cartTotal)} vouchers` : `PHP ${formatNumber(cartTotal)}`}</strong></div>
          ${isVoucherMode ? `<p class="commerce-voucher-note">Available: PHP ${formatNumber(availableVoucherValue)}${reservedVoucherValue > 0 ? ` | Reserved: PHP ${formatNumber(reservedVoucherValue)}` : ""}</p>` : `<p class="commerce-voucher-note">Shipping fee is added after admin checks J&T.</p>`}
          <button class="button button-primary button-small commerce-cart-checkout" type="button" ${canCheckout ? "" : "disabled"}>${isVoucherMode && cartTotal > availableVoucherValue ? "Need More Vouchers" : "Request Checkout"}</button>
        </aside>
      </div>
    `;
    commercePackageList.querySelectorAll("[data-product-id]").forEach(card => {
      const product = products.find(item => item.id === card.dataset.productId);
      card.querySelectorAll("[data-qty-step]").forEach(button => button.addEventListener("click", () => {
        const input = card.querySelector(".commerce-product-qty");
        input.value = String(Math.max(1, Math.min(999, Number(input.value || 1) + Number(button.dataset.qtyStep))));
      }));
      card.querySelector(".add-product-cart").addEventListener("click", () => {
        addProductToCart(product, Number(card.querySelector(".commerce-product-qty").value || 1));
        renderCommercePackagesPanel();
      });
    });
    commercePackageList.querySelectorAll("[data-cart-product-id]").forEach(line => {
      line.querySelectorAll("[data-cart-action]").forEach(button => button.addEventListener("click", () => {
        updateCartLine(selectedCommercePackageType, line.dataset.cartProductId, button.dataset.cartAction);
        renderCommercePackagesPanel();
      }));
    });
    const checkout = commercePackageList.querySelector(".commerce-cart-checkout");
    if (checkout) checkout.addEventListener("click", () => openProductCartOrderModal(selectedCommercePackageType));
  }

  function renderCommerceProductCard(product, isVoucherMode) {
    return `
      <article class="commerce-product-card" data-product-id="${escapeHtml(product.id)}">
        ${product.photoData ? `<img src="${escapeHtml(product.photoData)}" alt="${escapeHtml(product.productName)}" loading="lazy">` : `<span class="commerce-product-empty">No Photo</span>`}
        <div class="commerce-product-body">
          <span>${escapeHtml(product.productTypeLabel)}</span>
          <h4>${escapeHtml(product.productName)}</h4>
          ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
          <strong>${isVoucherMode ? `${formatNumber(product.price)} vouchers` : `PHP ${formatNumber(product.price)}`}</strong>
        </div>
        <div class="commerce-product-actions">
          <div class="quantity-stepper" aria-label="Quantity">
            <button type="button" data-qty-step="-1">-</button>
            <input class="commerce-product-qty" type="number" min="1" max="999" step="1" value="1">
            <button type="button" data-qty-step="1">+</button>
          </div>
          <button class="button button-primary button-small add-product-cart" type="button">Add</button>
        </div>
      </article>
    `;
  }

  function renderCartLine(cartItem, products, isVoucherMode) {
    const product = products.find(item => item.id === cartItem.productId) || {};
    const price = Number(product.price || cartItem.price || 0);
    return `
      <div class="commerce-cart-line" data-cart-product-id="${escapeHtml(cartItem.productId)}">
        <div><strong>${escapeHtml(product.productName || cartItem.productName || "Product")}</strong><span>${cartItem.quantity} x ${isVoucherMode ? `${formatNumber(price)} vouchers` : `PHP ${formatNumber(price)}`}</span></div>
        <div class="commerce-cart-line-actions">
          <button type="button" data-cart-action="dec">-</button>
          <button type="button" data-cart-action="inc">+</button>
          <button type="button" data-cart-action="remove">Remove</button>
        </div>
      </div>
    `;
  }

  function addProductToCart(product, quantity) {
    if (!product) return;
    const cart = productCarts[selectedCommercePackageType];
    const existing = cart.find(item => item.productId === product.id);
    const nextQuantity = Math.max(1, Math.min(999, Number(quantity || 1)));
    if (existing) {
      existing.quantity = Math.min(999, Number(existing.quantity || 1) + nextQuantity);
    } else {
      cart.push({ productId: product.id, quantity: nextQuantity, price: Number(product.price || 0), productName: product.productName });
    }
  }

  function updateCartLine(type, productId, action) {
    const cart = productCarts[type] || [];
    const index = cart.findIndex(item => item.productId === productId);
    if (index < 0) return;
    if (action === "remove") cart.splice(index, 1);
    if (action === "inc") cart[index].quantity = Math.min(999, Number(cart[index].quantity || 1) + 1);
    if (action === "dec") {
      cart[index].quantity = Number(cart[index].quantity || 1) - 1;
      if (cart[index].quantity <= 0) cart.splice(index, 1);
    }
  }

  function getProductCartTotal(type) {
    const products = MatrixDB.getCommerceProducts();
    return (productCarts[type] || []).reduce((sum, item) => {
      const product = products.find(productItem => productItem.id === item.productId);
      return sum + Number(product ? product.price : item.price || 0) * Number(item.quantity || 1);
    }, 0);
  }

  function getCommercePackageRequestState(commercePackage, summary, orders, availableVoucherValue) {
    const activeStatuses = ["pending_shipping_fee", "approved_for_payment", "payment_submitted", "payment_approved", "shipped"];
    const hasActiveSamePackage = orders.some(order => order.packageId === commercePackage.id && activeStatuses.includes(order.status));
    const hasActiveSameType = orders.some(order => order.packageType === commercePackage.packageType && activeStatuses.includes(order.status));
    const isMainActive = Boolean(summary && summary.position);
    const isTimelineActive = Boolean(summary && summary.timelineDashboard && summary.timelineDashboard.isActive);
    const hasPendingTimelineRequest = Boolean(summary && summary.timelineDashboard && summary.timelineDashboard.pendingRequest);
    const total = Number(commercePackage.totalPrice || 0);

    if (commercePackage.packageType === "matrix_1200_entry" && isMainActive) return { canRequest: false, buttonLabel: "Already Active", hint: "Your PHP 1,200 Matrix is already active." };
    if (commercePackage.packageType === "timeline_entry" && isTimelineActive) return { canRequest: false, buttonLabel: "Already Active", hint: "Your Timeline Matrix is already active." };
    if (commercePackage.packageType === "timeline_entry" && hasPendingTimelineRequest) return { canRequest: false, buttonLabel: "Request Active", hint: "You already have a pending Timeline Matrix request." };
    if (["matrix_1200_entry", "timeline_entry"].includes(commercePackage.packageType) && hasActiveSameType) return { canRequest: false, buttonLabel: "Request Active", hint: "You already have an active request for this entry type." };
    if (hasActiveSamePackage) return { canRequest: false, buttonLabel: "Order Active", hint: "You already have an active order for this package." };
    if (commercePackage.packageType === "product_plus_voucher" && availableVoucherValue < total) return { canRequest: false, buttonLabel: "Need More Vouchers", hint: "Save more vouchers before requesting this package." };
    return { canRequest: true, buttonLabel: "Request Order", hint: "Shipping fee added after admin checks J&T." };
  }

  function getReservedVoucherValue(orders = []) {
    return orders
      .filter(order => order.packageType === "product_plus_voucher" && order.status === "pending_shipping_fee")
      .reduce((sum, order) => sum + Number(order.voucherAmount || 0), 0);
  }

  function renderCommerceOrderHistory(orders = []) {
    const activeOrders = orders.filter(order => order.status !== "received");
    const historyOrders = orders.filter(order => order.status === "received");
    commerceOrderCount.textContent = `${activeOrders.length} request${activeOrders.length === 1 ? "" : "s"}`;
    commerceHistoryCount.textContent = `${historyOrders.length} order${historyOrders.length === 1 ? "" : "s"}`;
    if (!activeOrders.length) {
      commerceOrderList.innerHTML = `<div class="empty-state"><p>No order requests yet.</p></div>`;
    } else {
      commerceOrderList.innerHTML = activeOrders.slice(0, 8).map(order => renderCommerceOrderCard(order, false)).join("");
    }
    commerceHistoryList.innerHTML = historyOrders.length
      ? historyOrders.slice(0, 12).map(order => renderCommerceOrderCard(order, true)).join("")
      : `<div class="empty-state"><p>No completed orders yet.</p></div>`;
    commerceOrderList.querySelectorAll("[data-pay-order-id]").forEach(button => {
      const order = activeOrders.find(item => item.id === button.dataset.payOrderId);
      button.addEventListener("click", () => openCommercePaymentModal(order));
    });
    commerceOrderList.querySelectorAll("[data-receive-order-id]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Mark this order as received?")) return;
        button.disabled = true;
        try {
          await MatrixDB.confirmCommerceOrderReceived(button.dataset.receiveOrderId);
          renderCommercePackagesPanel();
          showAlert("Order marked as received.", "success");
        } catch (error) {
          showAlert(error.message, "danger");
          button.disabled = false;
        }
      });
    });
  }

  function renderCommerceOrderCard(order, isHistory) {
    const packageSnapshot = order.packageSnapshot || {};
    const canPay = order.status === "approved_for_payment" && Number(order.amountDue || 0) > 0;
    const canReceive = order.status === "shipped";
    const adminNote = order.adminNotes ? `<p><strong>Admin note:</strong> ${escapeHtml(order.adminNotes)}</p>` : "";
    const payment = order.latestPayment || null;
    const paymentNote = payment ? `<p><strong>Payment:</strong> ${commercePaymentStatusLabel(payment.status)} &middot; ${escapeHtml(payment.referenceNumber || "-")}</p>` : "";
    const shippingNote = order.shippedAt
      ? `<p><strong>Shipping:</strong> ${escapeHtml(order.courierName || "J&T")}${order.trackingNumber ? ` &middot; ${escapeHtml(order.trackingNumber)}` : ""} &middot; ${formatDate(order.shippedAt)}${order.shippingNotes ? ` &middot; ${escapeHtml(order.shippingNotes)}` : ""}</p>`
      : "";
    const receivedNote = order.receivedAt ? `<p><strong>Received:</strong> ${formatDate(order.receivedAt)}</p>` : "";
    const action = canPay
      ? `<button class="button button-primary button-small pay-commerce-order" type="button" data-pay-order-id="${escapeHtml(order.id)}">Pay Now</button>`
      : canReceive
        ? `<button class="button button-primary button-small" type="button" data-receive-order-id="${escapeHtml(order.id)}">Order Received</button>`
        : `<span class="withdrawal-status ${commerceOrderStatusClass(order.status)}">${escapeHtml(commerceOrderStatusLabel(order.status))}</span>`;
    return `
      <article class="product-plus-month ${isHistory || order.status === "rejected" || order.status === "cancelled" ? "upcoming" : "vested"}">
        <div class="product-plus-month-index">${escapeHtml((order.orderCode || "ORD").replace("ORD-", ""))}</div>
        <div>
          <h5>${escapeHtml(packageSnapshot.packageName || "Package order")}: ${commerceOrderTotalLabel(order)}</h5>
          <p>${escapeHtml(order.packageTypeLabel)} &middot; ${commerceOrderStatusLabel(order.status)} &middot; ${formatDate(order.createdAt)}${order.shippingFee != null ? ` &middot; Shipping fee: PHP ${formatNumber(order.shippingFee)}` : ""}</p>
          ${adminNote}${paymentNote}${shippingNote}${receivedNote}
        </div>
        ${action}
      </article>
    `;
  }

  function openCommerceOrderModal(commercePackage) {
    pendingCommercePackage = commercePackage;
    pendingProductCartType = null;
    const addresses = MatrixDB.getShippingAddresses();
    commerceOrderForm.reset();
    commerceOrderNotesCount.textContent = "0";
    commerceOrderAlert.style.display = "none";
    const needsUplineCode = commercePackage.packageType === "matrix_1200_entry";
    commerceOrderUplineGroup.hidden = !needsUplineCode;
    commerceOrderUplineCode.required = needsUplineCode;
    commerceOrderUplineCode.value = "";
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

  function openProductCartOrderModal(productType) {
    const cart = productCarts[productType] || [];
    if (!cart.length) return;
    pendingCommercePackage = null;
    pendingProductCartType = productType;
    const addresses = MatrixDB.getShippingAddresses();
    commerceOrderForm.reset();
    commerceOrderNotesCount.textContent = "0";
    commerceOrderAlert.style.display = "none";
    commerceOrderUplineGroup.hidden = true;
    commerceOrderUplineCode.required = false;
    commerceOrderUplineCode.value = "";
    commerceOrderSubmit.disabled = addresses.length === 0;
    commerceOrderAddress.disabled = addresses.length === 0;
    commerceOrderAddAddress.hidden = addresses.length > 0;
    const total = getProductCartTotal(productType);
    const totalQuantity = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    commerceOrderSummary.textContent = `${totalQuantity} product${totalQuantity === 1 ? "" : "s"} | ${productType === "product_plus_voucher" ? `${formatNumber(total)} vouchers` : `PHP ${formatNumber(total)}`}`;
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
    pendingProductCartType = null;
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
    if (!pendingCommercePackage && !pendingProductCartType) return;
    commerceOrderAlert.style.display = "none";
    const matrixUplineCode = pendingCommercePackage && pendingCommercePackage.packageType === "matrix_1200_entry" ? commerceOrderUplineCode.value.trim().toUpperCase() : "";
    if (pendingCommercePackage && pendingCommercePackage.packageType === "matrix_1200_entry" && !matrixUplineCode) {
      commerceOrderAlert.className = "alert alert-danger";
      commerceOrderAlert.textContent = "Enter a 1200 Matrix upline code before requesting this package.";
      commerceOrderAlert.style.display = "block";
      commerceOrderUplineCode.focus();
      return;
    }
    commerceOrderSubmit.disabled = true;
    try {
      if (pendingProductCartType) {
        await MatrixDB.requestCommerceProductOrder({
          productType: pendingProductCartType,
          shippingAddressId: commerceOrderAddress.value,
          items: productCarts[pendingProductCartType].map(item => ({ productId: item.productId, quantity: item.quantity })),
          memberNotes: commerceOrderNotes.value.trim()
        });
        productCarts[pendingProductCartType] = [];
      } else {
        await MatrixDB.requestCommerceOrder({
          packageId: pendingCommercePackage.id,
          shippingAddressId: commerceOrderAddress.value,
          memberNotes: commerceOrderNotes.value.trim(),
          matrixUplineCode
        });
      }
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
    if (Number(order.voucherAmount || 0) > 0) {
      const shipping = Number(order.shippingFee || order.amountDue || 0);
      return shipping > 0 ? `PHP ${formatNumber(order.voucherAmount)} vouchers + PHP ${formatNumber(shipping)}` : `PHP ${formatNumber(order.voucherAmount)} vouchers`;
    }
    const total = Number(order.amountDue || order.packageTotal || 0);
    return `PHP ${formatNumber(total)}`;
  }

  function commerceOrderStatusLabel(status) {
    return ({
      pending_shipping_fee: "Pending Fee",
      approved_for_payment: "Ready to Pay",
      payment_submitted: "Payment Review",
      payment_approved: "Paid",
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
  function commercePaymentStatusLabel(status) {
    return ({ submitted: "For Review", approved: "Approved", rejected: "Rejected" })[status] || capitalize(status || "submitted");
  }

  function formatNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
  function formatDate(value) { return value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-"; }
  function capitalize(value) { const text = String(value || ""); return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " "); }
  function quantityBadge(item) { const quantity = Number(item && item.quantity || 1); return quantity > 1 ? `<span class="commerce-item-quantity">x${quantity.toLocaleString()}</span>` : ""; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function showAlert(message, type) { pageAlert.className = `alert alert-${type}`; pageAlert.textContent = message; pageAlert.style.display = "block"; pageAlert.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function showAccessError(message) { showAlert(message, "danger"); window.setTimeout(() => { window.location.href = "portal.html"; }, 1400); }
});
