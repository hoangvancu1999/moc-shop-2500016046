import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { BANK_CONFIG, buildVietQrUrl } from "./js/bank-config.js";
import { encryptCustomerPii, randomTokenHex } from "./js/gc-crypto.js";

const firebaseConfig = {
  apiKey: "AIzaSyC06R-hiKFBGlhTWgX18O47ynSMd48Kmf8",
  authDomain: "moc-shop-2500016046.firebaseapp.com",
  projectId: "moc-shop-2500016046",
  storageBucket: "moc-shop-2500016046.firebasestorage.app",
  messagingSenderId: "101789182203",
  appId: "1:101789182203:web:8aac24a540218ad9fde85e"
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const CART_KEY = "hcugaming_cart";
const RECEIPTS_KEY = "hcugaming_receipts";

let activeGame = "all";
let activePriceRange = "all";
let searchQuery = "";
let activeServiceGroup = "all";
let catalogAccounts = [...ACCOUNTS];
let publicKeyJwk = null;
let cart = loadCart();
let toastTimer = null;
let activeOrderUnsub = null;
let activeOrderMeta = null;

function formatVND(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")}đ`;
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
    // Bỏ qua nếu trình duyệt chặn
  }
}

function loadSavedReceipts() {
  try {
    const raw = localStorage.getItem(RECEIPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveReceiptLocal(receipt) {
  const list = loadSavedReceipts().filter((r) => r.maDon !== receipt.maDon);
  list.unshift(receipt);
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(list.slice(0, 20)));
  } catch (e) {
    // Bỏ qua
  }
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

async function syncRemoteAccountsAndVault() {
  try {
    const [accSnap, vaultSnap] = await Promise.all([
      getDocs(collection(db, "shop_accounts")),
      getDoc(doc(db, "gc_secrets", "vault"))
    ]);

    if (vaultSnap.exists() && vaultSnap.data().publicKeyJwk) {
      publicKeyJwk = vaultSnap.data().publicKeyJwk;
    }

    if (!accSnap.empty) {
      const byId = new Map(ACCOUNTS.map((a) => [a.id, { ...a }]));
      accSnap.forEach((d) => {
        const data = d.data();
        if (data.deleted) {
          byId.delete(d.id);
        } else {
          const prev = byId.get(d.id) || {};
          byId.set(d.id, { ...prev, ...data, id: d.id });
        }
      });
      catalogAccounts = Array.from(byId.values());
    }
  } catch (err) {
    console.warn("Sử dụng danh mục cục bộ:", err);
  }
}

function findCatalogItem(id) {
  const acc = catalogAccounts.find((a) => a.id === id);
  if (acc) return { ...acc, type: "account" };
  const srv = SERVICES.find((s) => s.id === id);
  if (srv) return { ...srv, type: "service" };
  return null;
}

function updateTabCounts() {
  const visibleAccs = catalogAccounts.filter((a) => a.visible !== false);
  const lqCount = visibleAccs.filter((a) => a.game === "lien-quan").length;
  const dfCount = visibleAccs.filter((a) => a.game === "delta-force").length;
  const lbCount = SERVICES.filter((s) => s.group === "keo-lao-ban").length;
  const ccCount = SERVICES.filter((s) => s.group === "choi-cung").length;

  const gameLabels = {
    all: `Tất cả (${visibleAccs.length})`,
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

function renderAccounts() {
  const gridEl = document.getElementById("account-grid");
  const emptyEl = document.getElementById("account-empty");
  const q = searchQuery.trim().toLowerCase();

  const filtered = catalogAccounts.filter((acc) => {
    if (acc.visible === false) return false;
    if (activeGame !== "all" && acc.game !== activeGame) return false;
    if (activePriceRange === "under-300" && acc.price >= 300000) return false;
    if (activePriceRange === "300-800" && (acc.price < 300000 || acc.price > 800000)) return false;
    if (activePriceRange === "over-800" && acc.price <= 800000) return false;

    if (q) {
      const hay = `${acc.id} ${acc.title} ${acc.rank} ${acc.gameLabel} ${(acc.stats || []).join(" ")}`.toLowerCase();
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
    .map((acc) => {
      const isSold = Boolean(acc.sold);
      const badgeLabel = isSold ? "ĐÃ BÁN" : acc.badge || "Sẵn sàng";
      const badgeClass = isSold ? "acc-status sold" : "acc-status";
      return `
      <article class="acc-card">
        ${
          acc.coverImage
            ? `<div class="acc-cover-wrap">
                 <img src="${acc.coverImage}" alt="${acc.title}" class="acc-cover-img" loading="lazy" />
                 <div class="acc-cover-overlay">
                   <div class="acc-cover-top">
                     <span class="acc-code">#${acc.id}</span>
                     <span class="${badgeClass}">${badgeLabel}</span>
                   </div>
                   <div class="acc-game-name">${acc.gameLabel}</div>
                 </div>
               </div>`
            : `<div class="acc-banner" style="background: linear-gradient(135deg, ${acc.themeColor || "#1a2844"}, #111827);">
                 <div class="acc-banner-left">
                   <span class="acc-icon" aria-hidden="true">${acc.icon || "🎮"}</span>
                   <div>
                     <div class="acc-game-name">${acc.gameLabel}</div>
                     <span class="acc-code">#${acc.id}</span>
                   </div>
                 </div>
                 <span class="${badgeClass}">${badgeLabel}</span>
               </div>`
        }

        <div class="acc-body">
          <div class="acc-rank">${acc.rank || ""}</div>
          <h3 class="acc-title">${acc.title}</h3>
          <div class="acc-tags">
            ${(acc.stats || []).map((st) => `<span class="acc-tag">${st}</span>`).join("")}
          </div>

          <div class="acc-footer">
            <span class="acc-price">${formatVND(acc.price)}</span>
            <div class="acc-actions">
              <button type="button" class="btn btn-outline btn-sm detail-btn" data-id="${acc.id}">Chi tiết</button>
              <button type="button" class="btn ${isSold ? "btn-outline" : "btn-cyan"} btn-sm add-btn" data-id="${acc.id}" ${isSold ? "disabled" : ""}>
                ${isSold ? "Đã bán" : "Chọn mua"}
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
    })
    .join("");
}

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
          ${(srv.highlights || []).map((h) => `<li>${h}</li>`).join("")}
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

function openDetailModal(accId) {
  const acc = catalogAccounts.find((a) => a.id === accId);
  if (!acc) return;

  const images =
    Array.isArray(acc.gallery) && acc.gallery.length > 0
      ? acc.gallery
      : acc.coverImage
      ? [acc.coverImage]
      : [];

  const isSold = Boolean(acc.sold);
  document.getElementById("modal-code").textContent = `#${acc.id} • ${acc.gameLabel}`;
  document.getElementById("modal-body").innerHTML = `
    <h3 id="modal-title">${acc.title}</h3>
    <div class="acc-rank">Hạng / Cấp độ: ${acc.rank || ""}</div>
    ${
      images.length > 0
        ? `<div class="modal-gallery">
             ${images.map((src, idx) => `<img src="${src}" alt="${acc.title} - ảnh ${idx + 1}" class="modal-gallery-img" />`).join("")}
           </div>`
        : ""
    }
    <p class="service-desc">${acc.description || ""}</p>
    <div class="acc-tags">
      ${(acc.stats || []).map((st) => `<span class="acc-tag">${st}</span>`).join("")}
    </div>
    <div class="acc-footer">
      <span class="acc-price">${formatVND(acc.price)}</span>
      <button type="button" class="btn btn-cyan" id="modal-add-btn" data-id="${acc.id}" ${isSold ? "disabled" : ""}>
        ${isSold ? "Tài khoản đã bán" : "Mua ngay (VietQR)"}
      </button>
    </div>
  `;

  document.getElementById("detail-overlay").hidden = false;
  document.getElementById("detail-modal").hidden = false;

  if (!isSold) {
    document.getElementById("modal-add-btn").addEventListener("click", () => {
      addToCart(acc.id);
      closeDetailModal();
      openCart();
    });
  }
}

function closeDetailModal() {
  document.getElementById("detail-overlay").hidden = true;
  document.getElementById("detail-modal").hidden = true;
}

function addToCart(itemId) {
  const item = findCatalogItem(itemId);
  if (!item) return;
  if (item.type === "account" && item.sold) {
    showToast("Tài khoản này đã được bán!");
    return;
  }

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
    emptyEl.hidden = !document.getElementById("order-success").hidden ? true : false;
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
  if (cart.length > 0) {
    document.getElementById("order-success").hidden = true;
  }
  renderCart();
  document.getElementById("cart-overlay").hidden = false;
  document.getElementById("cart-drawer").hidden = false;
}

function closeCart() {
  document.getElementById("cart-overlay").hidden = true;
  document.getElementById("cart-drawer").hidden = true;
}

function renderDeliveredCredentialsHTML(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="cred-card">Đơn hàng đã xác nhận thanh toán! Admin đang gửi thông tin chi tiết cho bạn.</div>`;
  }
  return items
    .map(
      (it) => `
      <div class="cred-card">
        <strong class="neon-cyan">[#${it.id}] ${it.title || ""}</strong>
        <div>Tài khoản đăng nhập:</div>
        <div class="cred-line"><span>${it.loginUser || "—"}</span></div>
        <div>Mật khẩu:</div>
        <div class="cred-line"><span>${it.loginPass || "—"}</span></div>
        ${it.guideNote ? `<div style="font-size: 0.82rem; color: var(--text-muted);">📌 Hướng dẫn: ${it.guideNote}</div>` : ""}
      </div>
    `
    )
    .join("");
}

function watchOrderPaymentAndDelivery(maDon, deliveryToken) {
  if (activeOrderUnsub) activeOrderUnsub();

  activeOrderUnsub = onSnapshot(doc(db, "shop_orders", maDon), async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const statusTextEl = document.getElementById("payment-live-status");
    const markBtn = document.getElementById("mark-paid-btn");

    if (data.paymentStatus === "Customer_Marked_Paid") {
      statusTextEl.innerHTML =
        "⏳ <strong>Đã báo chuyển khoản!</strong> Hệ thống đang chờ Admin xác nhận biến động số dư — giữ nguyên màn hình này để nhận Acc tự động.";
      markBtn.disabled = true;
      markBtn.textContent = "Đã gửi thông báo chuyển khoản";
    } else if (data.paymentStatus === "Paid_Delivered") {
      try {
        const delivSnap = await getDoc(doc(db, "shop_deliveries", deliveryToken));
        const items = delivSnap.exists() ? delivSnap.data().items : [];
        document.getElementById("payment-pending-box").hidden = true;
        document.getElementById("delivered-items-list").innerHTML = renderDeliveredCredentialsHTML(items);
        document.getElementById("account-delivered-box").hidden = false;
        await syncRemoteAccountsAndVault();
        updateTabCounts();
        renderAccounts();
      } catch (err) {
        console.error("Lỗi tải hộp nhận Acc:", err);
      }
    }
  });
}

async function handleOrderSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("buyer-name").value.trim();
  const contact = document.getElementById("buyer-contact").value.trim();
  const ingame = document.getElementById("buyer-ingame").value.trim();
  const payment = document.getElementById("buyer-payment").value;
  const note = document.getElementById("buyer-note").value.trim();
  const consent = document.getElementById("buyer-consent").checked;
  const errEl = document.getElementById("order-error");
  const submitBtn = document.getElementById("submit-order-btn");

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
  const numCode = Math.floor(100000 + Math.random() * 900000);
  const code = `HCU-${numCode}`;
  const transferCode = `HCU${numCode}`;
  const deliveryToken = randomTokenHex(16);
  const receiptCode = `${code}.${deliveryToken}`;

  const orderItems = [];
  let totalQty = 0;
  let grandTotal = 0;

  for (const entry of cart) {
    const item = findCatalogItem(entry.id);
    if (!item) continue;
    if (item.type === "account" && item.sold) {
      errEl.textContent = `Tài khoản #${item.id} vừa có người mua trước. Vui lòng chọn tài khoản khác.`;
      errEl.hidden = false;
      return;
    }
    const lineTotal = item.price * entry.qty;
    totalQty += entry.qty;
    grandTotal += lineTotal;
    orderItems.push({
      id: item.id,
      title: item.title,
      type: item.type,
      price: item.price,
      qty: entry.qty,
      lineTotal
    });
  }

  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang tạo mã VietQR thanh toán...";

  try {
    // Tải lại khóa công khai mới nhất nếu có
    if (!publicKeyJwk) {
      const vSnap = await getDoc(doc(db, "gc_secrets", "vault"));
      if (vSnap.exists() && vSnap.data().publicKeyJwk) {
        publicKeyJwk = vSnap.data().publicKeyJwk;
      }
    }

    let encryptedOrderBox = null;
    if (publicKeyJwk) {
      encryptedOrderBox = await encryptCustomerPii(publicKeyJwk, {
        tenKhach: name,
        soDienThoai: contact,
        ingame,
        ghiChu: note,
        deliveryToken
      });
    } else {
      await setDoc(doc(db, "shop_orders_private", code), {
        tenKhach: name,
        soDienThoai: contact,
        ingame,
        ghiChu: note,
        deliveryToken,
        createdAt: serverTimestamp()
      });
    }

    // Lưu vào shop_orders (phục vụ VietQR & mở khóa Acc tự động) và donhang (lịch sử đơn)
    await setDoc(doc(db, "shop_orders", code), {
      maDon: code,
      transferCode,
      hinhThucThanhToan: payment,
      danhSachMon: orderItems,
      soMon: totalQty,
      tamTinh: grandTotal,
      tongTien: grandTotal,
      paymentStatus: "Awaiting_Transfer",
      encryptedOrderBox,
      createdAt: serverTimestamp(),
      ngayTaoISO: new Date().toISOString()
    });

    await addDoc(collection(db, "donhang"), {
      maDon: code,
      tenKhach: name,
      soDienThoai: contact,
      ingame,
      hinhThucThanhToan: `${BANK_CONFIG.bankName} VietQR (${transferCode})`,
      ghiChu: note,
      danhSachMon: orderItems,
      soMon: totalQty,
      tamTinh: grandTotal,
      tongTien: grandTotal,
      thoiGian: serverTimestamp(),
      ngayTaoISO: new Date().toISOString()
    });

    saveReceiptLocal({
      maDon: code,
      deliveryToken,
      receiptCode,
      tongTien: grandTotal,
      transferCode,
      summary: orderItems.map((i) => i.title).join(", "),
      createdAtISO: new Date().toISOString()
    });

    activeOrderMeta = { maDon: code, deliveryToken };

    // Hiển thị VietQR MB Bank HOANG VAN CU
    document.getElementById("order-code").textContent = code;
    document.getElementById("vietqr-img").src = buildVietQrUrl(grandTotal, transferCode);
    document.getElementById("qr-amount").textContent = formatVND(grandTotal);
    document.getElementById("qr-memo").textContent = transferCode;
    document.getElementById("buyer-receipt-code").textContent = receiptCode;

    const markBtn = document.getElementById("mark-paid-btn");
    markBtn.disabled = false;
    markBtn.textContent = "✓ Tôi đã chuyển khoản – Báo Admin duyệt ngay";

    document.getElementById("payment-pending-box").hidden = false;
    document.getElementById("account-delivered-box").hidden = true;

    cart = [];
    saveCart();
    document.getElementById("order-form").reset();
    document.getElementById("order-success").hidden = false;
    renderCart();

    watchOrderPaymentAndDelivery(code, deliveryToken);
  } catch (err) {
    console.error("Lỗi tạo đơn VietQR:", err);
    errEl.textContent =
      "Không thể khởi tạo đơn hàng lúc này. Vui lòng kiểm tra mạng và thử lại (hoặc nhắn Zalo 0911507170).";
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  }
}

async function handleMarkPaidClick() {
  if (!activeOrderMeta) return;
  const btn = document.getElementById("mark-paid-btn");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "shop_orders", activeOrderMeta.maDon), {
      paymentStatus: "Customer_Marked_Paid"
    });
    showToast("Đã gửi thông báo chuyển khoản tới Admin!");
  } catch (err) {
    btn.disabled = false;
    showToast("Đơn hàng đã được cập nhật trạng thái trước đó.");
  }
}

// Tra cứu & Nhận Acc đã mua
async function checkClaimReceipt(rawInput, targetEl) {
  const parts = String(rawInput || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    targetEl.innerHTML = `<div class="form-error">Mã nhận Acc không đúng định dạng (cần dạng <code>HCU-XXXXXX.xxxxxx</code>).</div>`;
    return;
  }
  const [maDon, token] = parts;
  targetEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted);">Đang kiểm tra ${maDon}...</div>`;

  try {
    const ordSnap = await getDoc(doc(db, "shop_orders", maDon));
    if (!ordSnap.exists()) {
      targetEl.innerHTML = `<div class="form-error">Không tìm thấy đơn hàng ${maDon}.</div>`;
      return;
    }
    const ord = ordSnap.data();
    if (ord.paymentStatus === "Paid_Delivered") {
      const delivSnap = await getDoc(doc(db, "shop_deliveries", token));
      if (!delivSnap.exists()) {
        targetEl.innerHTML = `<div class="form-error">Khóa bí mật không khớp với đơn ${maDon}.</div>`;
        return;
      }
      targetEl.innerHTML = `<div class="delivered-list" style="margin: 10px 0;">${renderDeliveredCredentialsHTML(
        delivSnap.data().items
      )}</div>`;
    } else {
      const qrUrl = buildVietQrUrl(ord.tongTien, ord.transferCode);
      targetEl.innerHTML = `
        <div class="bank-info-card" style="margin: 10px 0;">
          <div>Đơn <strong>${maDon}</strong> đang ở trạng thái: <strong class="neon-gold">${
        ord.paymentStatus === "Customer_Marked_Paid" ? "Chờ Admin xác nhận tiền về" : "Chờ chuyển khoản"
      }</strong></div>
          <div>Số tiền: <strong>${formatVND(ord.tongTien)}</strong> • Nội dung CK: <strong class="neon-cyan">${
        ord.transferCode
      }</strong> (MB Bank 0911507170 - HOANG VAN CU)</div>
          <img src="${qrUrl}" alt="VietQR" style="width: 180px; border-radius: 8px; margin-top: 6px; background:#fff; padding:6px;" />
        </div>
      `;
    }
  } catch (err) {
    targetEl.innerHTML = `<div class="form-error">Không thể kiểm tra lúc này, vui lòng thử lại.</div>`;
  }
}

function renderSavedReceiptsModal() {
  const listEl = document.getElementById("saved-receipts-list");
  const receipts = loadSavedReceipts();
  if (receipts.length === 0) {
    listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted);">Chưa có đơn hàng nào lưu trên trình duyệt này.</div>`;
    return;
  }

  listEl.innerHTML = receipts
    .map(
      (r) => `
      <div class="bank-info-card">
        <div class="bank-row">
          <strong class="neon-cyan">${r.maDon}</strong>
          <strong>${formatVND(r.tongTien)}</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${r.summary || ""}</div>
        <button type="button" class="btn btn-outline btn-sm view-saved-receipt-btn" data-receipt="${r.receiptCode}" style="margin-top:4px;">
          Xem trạng thái / Nhận Acc
        </button>
      </div>
    `
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  await syncRemoteAccountsAndVault();
  cart = cart.filter((c) => {
    const item = findCatalogItem(c.id);
    return item !== null && !item.sold;
  });
  saveCart();

  updateTabCounts();
  renderAccounts();
  renderServices();
  renderCart();

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeGame = btn.dataset.game;
      renderAccounts();
    });
  });

  document.getElementById("price-filter").addEventListener("change", (e) => {
    activePriceRange = e.target.value;
    renderAccounts();
  });

  document.getElementById("account-search").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderAccounts();
  });

  document.querySelectorAll(".service-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".service-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeServiceGroup = btn.dataset.group;
      renderServices();
    });
  });

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

  document.getElementById("cart-items").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "inc") updateCartQty(id, 1);
    if (action === "dec") updateCartQty(id, -1);
    if (action === "remove") removeCartItem(id);
  });

  document.getElementById("close-detail-btn").addEventListener("click", closeDetailModal);
  document.getElementById("detail-overlay").addEventListener("click", closeDetailModal);
  document.getElementById("open-cart-btn").addEventListener("click", openCart);
  document.getElementById("close-cart-btn").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("continue-btn").addEventListener("click", closeCart);
  document.getElementById("order-form").addEventListener("submit", handleOrderSubmit);
  document.getElementById("mark-paid-btn").addEventListener("click", handleMarkPaidClick);

  // Modal Nhận Acc
  const openMyOrders = () => {
    renderSavedReceiptsModal();
    document.getElementById("claim-lookup-result").innerHTML = "";
    document.getElementById("my-orders-overlay").hidden = false;
    document.getElementById("my-orders-modal").hidden = false;
  };
  const closeMyOrders = () => {
    document.getElementById("my-orders-overlay").hidden = true;
    document.getElementById("my-orders-modal").hidden = true;
  };

  document.getElementById("open-my-orders-btn").addEventListener("click", openMyOrders);
  document.getElementById("close-my-orders-btn").addEventListener("click", closeMyOrders);
  document.getElementById("my-orders-overlay").addEventListener("click", closeMyOrders);

  document.getElementById("claim-lookup-btn").addEventListener("click", () => {
    checkClaimReceipt(
      document.getElementById("claim-input").value,
      document.getElementById("claim-lookup-result")
    );
  });

  document.getElementById("saved-receipts-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-saved-receipt-btn");
    if (!btn) return;
    document.getElementById("claim-input").value = btn.dataset.receipt;
    checkClaimReceipt(btn.dataset.receipt, document.getElementById("claim-lookup-result"));
  });
});
