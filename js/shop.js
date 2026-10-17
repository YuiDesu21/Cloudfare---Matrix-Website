document.addEventListener("DOMContentLoaded", async () => {
  const client = window.matrixSupabase;
  const productList = document.getElementById("shop-products");
  const search = document.getElementById("shop-search");
  const count = document.getElementById("shop-count");
  const cartList = document.getElementById("shop-cart-items");
  const cartPanel = document.querySelector(".shop-cart");
  const shopShell = document.querySelector(".shop-shell");
  const cartCount = document.getElementById("shop-cart-count");
  const subtotalText = document.getElementById("shop-cart-subtotal");
  const dueText = document.getElementById("shop-cart-due");
  const memberCheckout = document.getElementById("shop-member-checkout");
  const signInLink = document.getElementById("shop-sign-in");
  const accountLink = document.getElementById("shop-account-link");
  const addressSelect = document.getElementById("shop-address");
  const voucherInput = document.getElementById("shop-voucher-amount");
  const voucherHint = document.getElementById("shop-voucher-hint");
  const checkoutButton = document.getElementById("shop-checkout");
  const alertBox = document.getElementById("shop-alert");
  const cartKey = "matrix-shop-cart";
  const budgetRates = new Map();
  let approvedBudgetCredit = 0;
  let budgetEntryNeeded = false;
  let products = [];
  let voucherAvailable = 0;
  let memberSignedIn = false;
  let checkoutReady = false;
  let cart = readCart();

  if (new URLSearchParams(window.location.search).get("purpose") === "budget_qualification") {
    window.history.replaceState(null, "", "shop.html");
  }

  if (!client) {
    showAlert("The shop is temporarily unavailable.", "danger");
    return;
  }

  const { data: catalog, error: catalogError } = await client.rpc("get_public_shop_products");
  if (catalogError) {
    showAlert("Products could not be loaded. Please try again shortly.", "danger");
    return;
  }
  products = Array.isArray(catalog) ? catalog : [];

  const { data: sessionResult } = await client.auth.getSession();
  memberSignedIn = Boolean(sessionResult && sessionResult.session);
  if (memberSignedIn) {
    accountLink.textContent = "Dashboard";
    accountLink.href = "portal.html";
    signInLink.hidden = true;
    memberCheckout.hidden = false;
    const [eligibleResult, ratesResult, budgetResult] = await Promise.all([
        client.rpc("get_active_commerce_products", { p_product_type: "product_plus_requirement" }),
        client.from("budget_plan_categories").select("category,qualification_percent"),
        client.rpc("get_my_budget_plan_dashboard")
    ]);
    if (eligibleResult.error || ratesResult.error || budgetResult.error) {
      showAlert("Budget Plan progress could not be loaded. Please refresh the page.", "danger");
    } else {
      const eligible = new Map((eligibleResult.data || []).filter(item => item.budgetCategory).map(item => [item.id, item.budgetCategory]));
      (ratesResult.data || []).forEach(item => budgetRates.set(item.category, Number(item.qualification_percent)));
      products = products.map(item => ({ ...item, budgetCategory: eligible.get(item.id) || null }));
      approvedBudgetCredit = Number(budgetResult.data.entryCredit || 0);
      budgetEntryNeeded = !budgetResult.data.isActive && approvedBudgetCredit < 150;
      document.getElementById("shop-budget-progress").hidden = !budgetEntryNeeded;
      document.getElementById("shop-budget-cart-note").hidden = !budgetEntryNeeded;
    }
    const [addressesResult, vouchersResult, ordersResult] = await Promise.all([
      client.rpc("get_my_shipping_addresses"),
      client.rpc("get_my_vouchers"),
      client.rpc("get_my_commerce_orders")
    ]);
    if (addressesResult.error || vouchersResult.error || ordersResult.error) {
      showAlert("Checkout details could not be loaded. Please refresh the page.", "danger");
      checkoutButton.disabled = true;
    } else {
      const addresses = Array.isArray(addressesResult.data) ? addressesResult.data : [];
      addressSelect.innerHTML = addresses.length
        ? addresses.map(address => `<option value="${escapeHtml(address.id)}" ${address.isDefault ? "selected" : ""}>${escapeHtml([address.streetAddress, address.city, address.province].filter(Boolean).join(", "))}</option>`).join("")
        : '<option value="">Add a shipping address first</option>';
      const pendingReserved = (Array.isArray(ordersResult.data) ? ordersResult.data : [])
        .filter(order => order.status === "pending_shipping_fee" && (order.packageType === "product_plus_voucher" || order.orderPurpose === "shop"))
        .reduce((sum, order) => sum + Number(order.voucherAmount || 0), 0);
      voucherAvailable = Math.max(0, Number(vouchersResult.data && vouchersResult.data.balance || 0) - pendingReserved);
      voucherHint.textContent = `Available: ${money(voucherAvailable)}. Eligible products only.`;
      checkoutReady = !eligibleResult.error && !ratesResult.error && !budgetResult.error;
    }
  }
  cart = cart.filter(item => products.some(product => product.id === item.id));
  persistCart();

  search.addEventListener("input", renderProducts);
  voucherInput.addEventListener("input", renderCart);
  productList.addEventListener("click", event => {
    const button = event.target.closest("[data-shop-add]");
    if (!button) return;
    const product = products.find(item => item.id === button.dataset.shopAdd);
    if (!product) return;
    const existing = cart.find(item => item.id === product.id);
    if (existing) existing.quantity = Math.min(existing.quantity + 1, 999);
    else cart.push({ id: product.id, quantity: 1 });
    persistCart();
    renderCart();
  });
  cartList.addEventListener("click", event => {
    const button = event.target.closest("[data-cart-id]");
    if (!button) return;
    const item = cart.find(entry => entry.id === button.dataset.cartId);
    if (!item) return;
    if (button.dataset.cartAction === "remove") cart = cart.filter(entry => entry.id !== item.id);
    if (button.dataset.cartAction === "increase") item.quantity = Math.min(item.quantity + 1, 999);
    if (button.dataset.cartAction === "decrease") item.quantity -= 1;
    cart = cart.filter(entry => entry.quantity > 0);
    persistCart();
    renderCart();
  });
  checkoutButton.addEventListener("click", async () => {
    const totals = calculateTotals();
    const voucherAmount = Number(voucherInput.value || 0);
    if (!cart.length || !addressSelect.value) return;
    if (!Number.isFinite(voucherAmount) || voucherAmount < 0 || voucherAmount > totals.eligible || voucherAmount > voucherAvailable) {
      showAlert("Voucher amount exceeds your eligible products or available balance.", "danger");
      return;
    }
    checkoutButton.disabled = true;
    const orderDetails = {
      p_shipping_address_id: addressSelect.value,
      p_items: cart.map(item => ({ productId: item.id, quantity: item.quantity })),
      p_member_notes: document.getElementById("shop-order-notes").value.trim()
    };
    orderDetails.p_voucher_amount = voucherAmount;
    const { error } = await client.rpc(voucherAmount === 0 ? "request_budget_shop_order" : "request_shop_order", orderDetails);
    if (error) {
      showAlert(error.message, "danger");
      checkoutButton.disabled = false;
      return;
    }
    cart = [];
    persistCart();
    window.location.assign("orders.html");
  });

  renderProducts();
  renderCart();
  const centerCart = () => {
    if (window.innerWidth <= 800) {
      cartPanel.style.removeProperty("--shop-cart-top");
      cartPanel.style.removeProperty("--shop-cart-start");
      return;
    }
    const top = Math.max(96, (window.innerHeight - cartPanel.offsetHeight) / 2);
    const shellTop = shopShell.getBoundingClientRect().top + window.scrollY;
    cartPanel.style.setProperty("--shop-cart-top", `${top}px`);
    cartPanel.style.setProperty("--shop-cart-start", `${Math.max(0, top - shellTop)}px`);
  };
  new ResizeObserver(centerCart).observe(cartPanel);
  window.addEventListener("resize", centerCart);
  centerCart();

  function renderProducts() {
    const query = search.value.trim().toLowerCase();
    const visible = products.filter(product => `${product.name} ${product.description || ""}`.toLowerCase().includes(query));
    count.textContent = `${visible.length} product${visible.length === 1 ? "" : "s"}`;
    productList.innerHTML = visible.length ? visible.map(product => {
      const image = /^(?:data:image\/(?:png|jpeg|webp|gif);base64,|assets\/products\/[a-z0-9-]+\.(?:jpg|png)$)/i.test(product.photoData || "") ? product.photoData : "";
      const percent = budgetRates.get(product.budgetCategory) || 0;
      const category = { pc: "PC", groceries: "Groceries", lifestyle: "Lifestyle" }[product.budgetCategory] || product.budgetCategory;
      return `<article class="shop-product">
        <div class="shop-product-media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">` : '<span>Photo unavailable</span>'}</div>
        <div class="shop-product-body"><h2>${escapeHtml(product.name)}</h2>${budgetEntryNeeded ? `<small class="shop-budget-product-rate">${percent ? `${escapeHtml(category)} · ${percent}% qualifies · ${money(product.price * percent / 100)} credit each` : "No Budget entry credit"}</small>` : ""}<p>${escapeHtml(product.description || "")}</p>
          <div class="shop-product-bottom"><strong>${money(product.price)}</strong><button class="button button-primary button-small" type="button" data-shop-add="${escapeHtml(product.id)}">Add to cart</button></div>
        </div>
      </article>`;
    }).join("") : '<p class="shop-empty">No products found.</p>';
  }

  function renderCart() {
    const totals = calculateTotals();
    const voucherAmount = Number(voucherInput.value || 0);
    const validVoucher = Number.isFinite(voucherAmount) && voucherAmount >= 0 && voucherAmount <= totals.eligible && voucherAmount <= voucherAvailable;
    cartCount.textContent = `${totals.quantity} item${totals.quantity === 1 ? "" : "s"}`;
    subtotalText.textContent = money(totals.subtotal);
    dueText.textContent = money(Math.max(0, totals.subtotal - (validVoucher ? voucherAmount : 0)));
    voucherInput.max = String(Math.min(totals.eligible, voucherAvailable));
    voucherInput.setCustomValidity(validVoucher ? "" : "Voucher amount exceeds the eligible balance.");
    cartList.innerHTML = cart.length ? cart.map(item => {
      const product = products.find(entry => entry.id === item.id);
      if (!product) return "";
      return `<div class="shop-cart-item"><div><strong>${escapeHtml(product.name)}</strong><small>${money(product.price)}${budgetEntryNeeded ? ` | ${budgetRates.get(product.budgetCategory) ? `${budgetRates.get(product.budgetCategory)}% Budget credit` : "No Budget credit"}` : product.voucherEligible ? " | Voucher-eligible" : ""}</small></div>
        <div class="shop-cart-item-actions"><button type="button" data-cart-id="${escapeHtml(item.id)}" data-cart-action="decrease" aria-label="Remove one ${escapeHtml(product.name)}">-</button><span>${item.quantity}</span><button type="button" data-cart-id="${escapeHtml(item.id)}" data-cart-action="increase" aria-label="Add one ${escapeHtml(product.name)}">+</button><button type="button" data-cart-id="${escapeHtml(item.id)}" data-cart-action="remove" aria-label="Remove ${escapeHtml(product.name)}">Remove</button></div></div>`;
    }).join("") : '<p class="shop-cart-empty">Your cart is empty.</p>';
    if (budgetEntryNeeded) renderBudgetProgress(validVoucher ? voucherAmount : 0);
    checkoutButton.disabled = !memberSignedIn || !checkoutReady || !cart.length || !addressSelect.value || !validVoucher;
  }

  function renderBudgetProgress(voucherAmount) {
    const cartCredit = cart.reduce((sum, item) => {
      const product = products.find(entry => entry.id === item.id);
      if (!product) return sum;
      return sum + Math.round(Number(product.price) * item.quantity * Number(budgetRates.get(product.budgetCategory) || 0)) / 100;
    }, 0);
    const qualifyingCartCredit = voucherAmount > 0 ? 0 : cartCredit;
    const projected = Math.min(150, approvedBudgetCredit + qualifyingCartCredit);
    document.getElementById("shop-budget-total").textContent = `${money(projected)} / PHP 150.00`;
    document.getElementById("shop-budget-remaining").textContent = projected >= 150 ? "Entry target met after approval" : `${money(150 - projected)} remaining`;
    document.getElementById("shop-budget-breakdown").textContent = `Approved ${money(approvedBudgetCredit)} · This cart ${money(qualifyingCartCredit)} estimated${voucherAmount > 0 ? " (voucher orders do not qualify)" : ""}`;
    document.getElementById("shop-budget-bar").style.width = `${projected / 150 * 100}%`;
    document.querySelector("#shop-budget-progress [role=progressbar]").setAttribute("aria-valuenow", String(projected));
  }

  function calculateTotals() {
    return cart.reduce((totals, item) => {
      const product = products.find(entry => entry.id === item.id);
      if (!product) return totals;
      const price = Number(product.price || 0) * item.quantity;
      totals.subtotal += price;
      totals.quantity += item.quantity;
      if (product.voucherEligible) totals.eligible += price;
      return totals;
    }, { subtotal: 0, eligible: 0, quantity: 0 });
  }

  function readCart() {
    try {
      const saved = sessionStorage.getItem(cartKey);
      const legacy = sessionStorage.getItem("matrix-shop-budget-cart");
      const parsed = JSON.parse(saved || legacy || "[]");
      if (!saved && legacy) sessionStorage.removeItem("matrix-shop-budget-cart");
      return Array.isArray(parsed) ? parsed.filter(item => typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 999) : [];
    } catch (_error) {
      return [];
    }
  }
  function persistCart() { sessionStorage.setItem(cartKey, JSON.stringify(cart)); }
  function showAlert(message, type) {
    alertBox.hidden = false;
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.scrollIntoView({ block: "nearest" });
  }
  function money(value) { return `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
});
