const CART_KEY = "hcugaming_cart";

let activeGame = "all";
let activePriceRange = "all";
let searchQuery = "";
let activeServiceGroup = "all";
let cart = loadCart();
let toastTimer = null;

function formatVND(amount) {
  return `${Number(amount).toLocaleString("vi-VN")}đ`;
}

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (e) {
    // Bỏ qua nếu bị chặn
  }
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

function findCatalogItem(id) {
  const acc = ACCOUNTS.find((a) => a.id === id);
  if (acc) return { ...acc, type: "account" };
  const srv = SERVICES.find((s) => s.id === id);
  if (srv) return { ...srv, type: "service" };
  return null;
}

// Lọc và render Account Game
function renderAccounts() {
  const gridEl = document.getElementById("account-grid");
  const emptyEl = document.getElementById("account-empty");
  const q = searchQuery.trim().toLowerCase();

  const filtered = ACCOUNTS.filter((acc) => {
    if (activeGame !== "all" && acc.game !== activeGame) return false;

    if (activePriceRange === "under-300" && acc.price >= 300000) return false;
    if (activePriceRange === "300-800" && (acc.price < 300000 || acc.price > 800000)) return false;
    if (activePriceRange === "over-800" && acc.price <= 800000) return false;

    if (q) {
      const hay = `${acc.id} ${acc.title} ${acc.rank} ${acc.gameLabel} ${acc.stats.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    gridEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  gridEl.innerHTML = filtered
    .map(
      (acc) => `
      <article class="acc-card">
        ${
          acc.coverImage
            ? `<div class="acc-cover-wrap">
                 <img src="${acc.coverImage}" alt="${acc.title}" class="acc-cover-img" loading="lazy" />
                 <div class="acc-cover-overlay">
                   <div class="acc-cover-top">
                     <span class="acc-code">#${acc.id}</span>
                     <span class="acc-status">${acc.badge}</span>
                   </div>
                   <div class="acc-game-name">${acc.gameLabel}</div>
                 </div>
               </div>`
            : `<div class="acc-banner" style="background: linear-gradient(135deg, ${acc.themeColor}, #111827);">
                 <div class="acc-banner-left">
                   <span class="acc-icon" aria-hidden="true">${acc.icon}</span>
                   <div>
                     <div class="acc-game-name">${acc.gameLabel}</div>
                     <span class="acc-code">#${acc.id}</span>
                   </div>
                 </div>
                 <span class="acc-status">${acc.badge}</span>
               </div>`
        }

        <div class="acc-body">
          <div class="acc-rank">${acc.rank}</div>
          <h3 class="acc-title">${acc.title}</h3>
          <div class="acc-tags">
            ${acc.stats.map((st) => `<span class="acc-tag">${st}</span>`).join("")}
          </div>

          <div class="acc-footer">
            <span class="acc-price">${formatVND(acc.price)}</span>
            <div class="acc-actions">
              <button type="button" class="btn btn-outline btn-sm detail-btn" data-id="${acc.id}">Chi tiết</button>
              <button type="button" class="btn btn-cyan btn-sm add-btn" data-id="${acc.id}">Chọn mua</button>
            </div>
          </div>
        </div>
      </article>
    `
    )
    .join("");
}

function updateTabCounts() {
  const lqCount = ACCOUNTS.filter((a) => a.game === "lien-quan").length;
  const dfCount = ACCOUNTS.filter((a) => a.game === "delta-force").length;
  const lbCount = SERVICES.filter((s) => s.group === "keo-lao-ban").length;
  const ccCount = SERVICES.filter((s) => s.group === "choi-cung").length;

  const gameLabels = {
    all: `Tất cả (${ACCOUNTS.length})`,
    "lien-quan": `Liên Quân Mobile (${lqCount})`,
    "delta-force": `Delta Force (${dfCount})`
  };
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    if (gameLabels[btn.dataset.game]) {
      btn.textContent = gameLabels[btn.dataset.game];
    }
  });

  const serviceLabels = {
    all: `Tất cả dịch vụ (${SERVICES.length})`,
    "keo-lao-ban": `Kéo lão bản (${lbCount})`,
    "choi-cung": `Chơi game cùng (${ccCount})`
  };
  document.querySelectorAll(".service-tab-btn").forEach((btn) => {
    if (serviceLabels[btn.dataset.group]) {
      btn.textContent = serviceLabels[btn.dataset.group];
    }
  });
}

// Render Dịch vụ Game
function renderServices() {
  const gridEl = document.getElementById("service-grid");
  const emptyEl = document.getElementById("service-empty");
  const filtered =
    activeServiceGroup === "all"
      ? SERVICES
      : SERVICES.filter((s) => s.group === activeServiceGroup);

  if (filtered.length === 0) {
    gridEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  gridEl.innerHTML = filtered
    .map(
      (srv) => `
      <article class="service-card">
        <div class="service-top">
          <span class="service-icon" aria-hidden="true">${srv.icon}</span>
          <span class="service-pill">${srv.groupLabel}</span>
        </div>
        <div class="service-game">${srv.gameLabel}</div>
        <h3 class="service-title">${srv.title}</h3>
        <p class="service-desc">${srv.description}</p>
        <ul class="service-list">
          ${srv.highlights.map((h) => `<li>${h}</li>`).join("")}
        </ul>
        <div class="service-footer">
          <div class="service-price-wrap">
            <span class="service-price">${formatVND(srv.price)}</span>
            <span class="service-unit">/ ${srv.unit}</span>
          </div>
          <button type="button" class="btn btn-gold btn-sm add-btn" data-id="${srv.id}">Đặt dịch vụ</button>
        </div>
      </article>
    `
    )
    .join("");
}

// Mở modal chi tiết Account
function openDetailModal(accId) {
  const acc = ACCOUNTS.find((a) => a.id === accId);
  if (!acc) return;

  const images = Array.isArray(acc.gallery) && acc.gallery.length > 0
    ? acc.gallery
    : acc.coverImage
    ? [acc.coverImage]
    : [];

  document.getElementById("modal-code").textContent = `#${acc.id} • ${acc.gameLabel}`;
  document.getElementById("modal-body").innerHTML = `
    <h3 id="modal-title">${acc.title}</h3>
    <div class="acc-rank">Hạng / Cấp độ: ${acc.rank}</div>
    ${
      images.length > 0
        ? `<div class="modal-gallery">
             ${images.map((src, idx) => `<img src="${src}" alt="${acc.title} - ảnh ${idx + 1}" class="modal-gallery-img" />`).join("")}
           </div>`
        : ""
    }
    <p class="service-desc">${acc.description}</p>
    <div class="acc-tags">
      ${acc.stats.map((st) => `<span class="acc-tag">${st}</span>`).join("")}
    </div>
    <div class="acc-footer">
      <span class="acc-price">${formatVND(acc.price)}</span>
      <button type="button" class="btn btn-cyan" id="modal-add-btn" data-id="${acc.id}">Thêm vào đơn hàng</button>
    </div>
  `;

  document.getElementById("detail-overlay").hidden = false;
  document.getElementById("detail-modal").hidden = false;

  document.getElementById("modal-add-btn").addEventListener("click", () => {
    addToCart(acc.id);
    closeDetailModal();
  });
}

function closeDetailModal() {
  document.getElementById("detail-overlay").hidden = true;
  document.getElementById("detail-modal").hidden = true;
}

// Giỏ hàng
function addToCart(itemId) {
  const item = findCatalogItem(itemId);
  if (!item) return;

  const existing = cart.find((c) => c.id === itemId);
  if (existing) {
    if (item.type === "account") {
      showToast(`Mã acc #${item.id} đã có trong đơn hàng`);
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({ id: itemId, qty: 1 });
  }

  saveCart();
  renderCart();
  showToast(`Đã thêm "${item.title}" vào đơn hàng`);
}

function updateCartQty(itemId, delta) {
  const index = cart.findIndex((c) => c.id === itemId);
  if (index === -1) return;

  const item = findCatalogItem(itemId);
  const nextQty = cart[index].qty + delta;

  if (nextQty <= 0) {
    cart.splice(index, 1);
  } else if (item && item.type === "account" && nextQty > 1) {
    showToast("Mỗi tài khoản game là duy nhất (số lượng tối đa 1)");
    return;
  } else {
    cart[index].qty = nextQty;
  }

  saveCart();
  renderCart();
}

function removeCartItem(itemId) {
  cart = cart.filter((c) => c.id !== itemId);
  saveCart();
  renderCart();
}

function renderCart() {
  const badgeEl = document.getElementById("cart-count");
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  const summaryEl = document.getElementById("cart-summary");
  const formEl = document.getElementById("order-form");
  const qtyEl = document.getElementById("summary-qty");
  const totalEl = document.getElementById("summary-total");

  const totalQty = cart.reduce((sum, c) => sum + c.qty, 0);
  badgeEl.textContent = totalQty;

  if (cart.length === 0) {
    itemsEl.innerHTML = "";
    emptyEl.hidden = false;
    summaryEl.hidden = true;
    formEl.hidden = true;
    qtyEl.textContent = "0";
    totalEl.textContent = "0đ";
    return;
  }

  emptyEl.hidden = true;
  summaryEl.hidden = false;
  formEl.hidden = false;

  let grandTotal = 0;

  itemsEl.innerHTML = cart
    .map((entry) => {
      const item = findCatalogItem(entry.id);
      if (!item) return "";
      const lineTotal = item.price * entry.qty;
      grandTotal += lineTotal;

      return `
        <li class="cart-item">
          <div>
            <div class="cart-item-title">${item.type === "account" ? `[#${item.id}] ` : ""}${item.title}</div>
            <div class="cart-item-meta">${formatVND(item.price)} × ${entry.qty} = <strong>${formatVND(lineTotal)}</strong></div>
          </div>
          <div class="cart-controls">
            ${
              item.type === "service"
                ? `<button type="button" class="qty-btn" data-action="dec" data-id="${item.id}" aria-label="Giảm">-</button>
                   <span>${entry.qty}</span>
                   <button type="button" class="qty-btn" data-action="inc" data-id="${item.id}" aria-label="Tăng">+</button>`
                : ""
            }
            <button type="button" class="remove-btn" data-action="remove" data-id="${item.id}">Xóa</button>
          </div>
        </li>
      `;
    })
    .join("");

  qtyEl.textContent = totalQty;
  totalEl.textContent = formatVND(grandTotal);
}

function openCart() {
  document.getElementById("order-success").hidden = true;
  document.getElementById("cart-overlay").hidden = false;
  document.getElementById("cart-drawer").hidden = false;
}

function closeCart() {
  document.getElementById("cart-overlay").hidden = true;
  document.getElementById("cart-drawer").hidden = true;
}

function handleOrderSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("buyer-name").value.trim();
  const contact = document.getElementById("buyer-contact").value.trim();
  const consent = document.getElementById("buyer-consent").checked;
  const errEl = document.getElementById("order-error");

  let errMsg = "";
  const cleanPhone = contact.replace(/[\s.-]/g, "");
  if (cart.length === 0) {
    errMsg = "Đơn hàng đang trống, vui lòng chọn tài khoản hoặc dịch vụ.";
  } else if (!name) {
    errMsg = "Vui lòng nhập tên hoặc biệt danh của bạn.";
  } else if (!/^(0|\+84)\d{8,10}$/.test(cleanPhone)) {
    errMsg = "Vui lòng nhập số điện thoại hợp lệ (9–11 chữ số, bắt đầu bằng 0 hoặc +84).";
  } else if (!consent) {
    errMsg = "Vui lòng tick chọn đồng ý xác nhận thông tin liên hệ.";
  }

  if (errMsg) {
    errEl.textContent = errMsg;
    errEl.hidden = false;
    return;
  }

  errEl.hidden = true;
  const code = `HCU-${Math.floor(100000 + Math.random() * 900000)}`;
  document.getElementById("order-code").textContent = code;

  cart = [];
  saveCart();
  renderCart();

  document.getElementById("order-form").reset();
  document.getElementById("cart-empty").hidden = true;
  document.getElementById("order-success").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  // Lọc bỏ các mục cũ trong localStorage không còn tồn tại trong danh mục
  cart = cart.filter((c) => findCatalogItem(c.id) !== null);
  saveCart();

  updateTabCounts();
  renderAccounts();
  renderServices();
  renderCart();

  // Lọc game Account
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeGame = btn.dataset.game;
      renderAccounts();
    });
  });

  // Lọc giá & tìm kiếm
  document.getElementById("price-filter").addEventListener("change", (e) => {
    activePriceRange = e.target.value;
    renderAccounts();
  });

  document.getElementById("account-search").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderAccounts();
  });

  // Lọc Dịch vụ
  document.querySelectorAll(".service-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".service-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeServiceGroup = btn.dataset.group;
      renderServices();
    });
  });

  // Click trong Account Grid & Service Grid
  document.getElementById("account-grid").addEventListener("click", (e) => {
    const detailBtn = e.target.closest(".detail-btn");
    if (detailBtn) {
      openDetailModal(detailBtn.dataset.id);
      return;
    }
    const addBtn = e.target.closest(".add-btn");
    if (addBtn) {
      addToCart(addBtn.dataset.id);
    }
  });

  document.getElementById("service-grid").addEventListener("click", (e) => {
    const addBtn = e.target.closest(".add-btn");
    if (addBtn) {
      addToCart(addBtn.dataset.id);
    }
  });

  // Điều khiển giỏ hàng
  document.getElementById("cart-items").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "inc") updateCartQty(id, 1);
    if (action === "dec") updateCartQty(id, -1);
    if (action === "remove") removeCartItem(id);
  });

  // Modal & Drawer controls
  document.getElementById("close-detail-btn").addEventListener("click", closeDetailModal);
  document.getElementById("detail-overlay").addEventListener("click", closeDetailModal);
  document.getElementById("open-cart-btn").addEventListener("click", openCart);
  document.getElementById("close-cart-btn").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("continue-btn").addEventListener("click", closeCart);
  document.getElementById("order-form").addEventListener("submit", handleOrderSubmit);
});
