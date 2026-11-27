import {
  db,
  auth,
  googleProvider,
  ADMIN_EMAILS,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  serverTimestamp
} from "./gc-firebase.js";
import {
  DEFAULT_PACKAGES,
  DEFAULT_MAPS,
  DEFAULT_SCHEDULE_CONFIG,
  ORDER_STATUS_META,
  formatCurrencyVND
} from "./gc-defaults.js";
import {
  sha256Hex,
  randomTokenHex,
  createAdminVault,
  unlockAdminPrivateKey,
  encryptCustomerPii,
  decryptCustomerPii
} from "./gc-crypto.js";

let adminToken = null;
let adminPrivateKey = null;
let isVaultInitialized = false;
let vaultDocData = null;

let shopAccounts = [];
let stockVaultMap = new Map();
let shopOrders = [];
let packages = [];
let maps = [];
let scheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG };
let orders = [];
let reviews = [];

function showToast(msg) {
  const el = document.getElementById("admin-toast");
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function adminPayload(data) {
  return adminToken ? { ...data, _adminToken: adminToken } : data;
}

async function checkVaultSetupState() {
  const errEl = document.getElementById("auth-error");
  errEl.hidden = true;
  try {
    const vaultSnap = await getDoc(doc(db, "gc_secrets", "vault"));
    if (vaultSnap.exists()) {
      isVaultInitialized = true;
      vaultDocData = vaultSnap.data();
      document.getElementById("auth-heading").textContent = "Đăng Nhập Quản Trị HcuGaming";
      document.getElementById("auth-desc").textContent =
        "Nhập mật khẩu Quản trị để quản lý Kho Account, duyệt tiền VietQR (MB Bank 0911507170) và lịch Game Cùng.";
      document.getElementById("admin-pass-confirm-wrap").hidden = true;
      document.getElementById("admin-login-btn").textContent = "Đăng nhập Quản trị";
    } else {
      isVaultInitialized = false;
      document.getElementById("auth-heading").textContent = "Khởi Tạo Mật Khẩu Quản Trị Lần Đầu";
      document.getElementById("auth-desc").textContent =
        "Tạo mật khẩu Quản trị (tối thiểu 6 ký tự) để sinh két mã hóa RSA-2048 bảo vệ Mật khẩu Acc Game & thông tin khách hàng.";
      document.getElementById("admin-pass-confirm-wrap").hidden = false;
      document.getElementById("admin-login-btn").textContent = "Khởi tạo & Vào trang Quản trị";
    }
  } catch (err) {
    console.error("Lỗi kiểm tra trạng thái vault:", err);
  }
}

async function handlePassphraseSubmit(e) {
  e.preventDefault();
  const pass = document.getElementById("admin-pass-input").value;
  const confirmPass = document.getElementById("admin-pass-confirm").value;
  const errEl = document.getElementById("auth-error");
  const btn = document.getElementById("admin-login-btn");

  errEl.hidden = true;
  if (pass.length < 6) {
    errEl.textContent = "Mật khẩu Quản trị cần tối thiểu 6 ký tự.";
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  try {
    const keyHash = await sha256Hex(pass);

    if (!isVaultInitialized) {
      if (pass !== confirmPass) {
        errEl.textContent = "Mật khẩu xác nhận không khớp.";
        errEl.hidden = false;
        return;
      }

      const { publicKeyJwk, wrappedPrivateKey } = await createAdminVault(pass);
      await setDoc(doc(db, "gc_secrets", "admin"), { keyHash, createdAt: serverTimestamp() });
      await setDoc(doc(db, "gc_secrets", "vault"), {
        publicKeyJwk,
        wrappedPrivateKey,
        createdAt: serverTimestamp()
      });
      vaultDocData = { publicKeyJwk, wrappedPrivateKey };
      isVaultInitialized = true;
    }

    const token = randomTokenHex(24);
    await setDoc(doc(db, "gc_admin_sessions", token), {
      keyHash,
      createdAt: serverTimestamp()
    });

    if (vaultDocData?.wrappedPrivateKey) {
      adminPrivateKey = await unlockAdminPrivateKey(vaultDocData.wrappedPrivateKey, pass);
    }

    adminToken = token;
    await enterDashboard();
  } catch (err) {
    console.error("Đăng nhập Admin thất bại:", err);
    errEl.textContent = "Mật khẩu Quản trị không chính xác hoặc không đủ quyền truy cập.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function ensureSeedDataIfEmpty() {
  const [accSnap, pkgSnap, mapSnap, cfgSnap] = await Promise.all([
    getDocs(collection(db, "shop_accounts")),
    getDocs(collection(db, "gc_packages")),
    getDocs(collection(db, "gc_maps")),
    getDoc(doc(db, "gc_config", "schedule"))
  ]);

  const initialAccs = typeof window.ACCOUNTS !== "undefined" ? window.ACCOUNTS : typeof ACCOUNTS !== "undefined" ? ACCOUNTS : [];
  if (accSnap.empty && initialAccs.length > 0) {
    for (const a of initialAccs) {
      await setDoc(doc(db, "shop_accounts", a.id), adminPayload({ ...a, sold: false, visible: true, deleted: false }));
    }
  }
  if (pkgSnap.empty) {
    for (const pkg of DEFAULT_PACKAGES) {
      await setDoc(doc(db, "gc_packages", pkg.id), adminPayload({ ...pkg, deleted: false }));
    }
  }
  if (mapSnap.empty) {
    for (const m of DEFAULT_MAPS) {
      await setDoc(doc(db, "gc_maps", m.id), adminPayload({ ...m, deleted: false }));
    }
  }
  if (!cfgSnap.exists()) {
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(DEFAULT_SCHEDULE_CONFIG));
  }
}

async function loadAllDashboardData() {
  await ensureSeedDataIfEmpty();

  const [accSnap, vaultStockSnap, shopOrdSnap, pkgSnap, mapSnap, cfgSnap, ordSnap, revSnap] =
    await Promise.all([
      getDocs(collection(db, "shop_accounts")),
      getDocs(collection(db, "shop_vault_stock")),
      getDocs(collection(db, "shop_orders")),
      getDocs(collection(db, "gc_packages")),
      getDocs(collection(db, "gc_maps")),
      getDoc(doc(db, "gc_config", "schedule")),
      getDocs(collection(db, "gc_orders")),
      getDocs(collection(db, "gc_reviews"))
    ]);

  shopAccounts = [];
  accSnap.forEach((d) => {
    const data = d.data();
    if (!data.deleted) shopAccounts.push({ id: d.id, ...data });
  });

  stockVaultMap = new Map();
  for (const d of vaultStockSnap.docs) {
    const raw = d.data();
    if (adminPrivateKey && raw.encryptedCredentials) {
      try {
        const creds = await decryptCustomerPii(adminPrivateKey, raw.encryptedCredentials);
        if (creds) stockVaultMap.set(d.id, creds);
      } catch (e) {
        // Bỏ qua nếu không giải mã được
      }
    }
  }

  shopOrders = [];
  for (const d of shopOrdSnap.docs) {
    const raw = d.data();
    let buyer = {
      tenKhach: "Khách mua Acc",
      soDienThoai: "(Mở khóa bằng mật khẩu Admin)",
      ingame: "",
      ghiChu: "",
      deliveryToken: ""
    };
    if (adminPrivateKey && raw.encryptedOrderBox) {
      try {
        const decBox = await decryptCustomerPii(adminPrivateKey, raw.encryptedOrderBox);
        if (decBox) buyer = decBox;
      } catch (e) {
        // Bỏ qua
      }
    } else if (auth.currentUser) {
      try {
        const pSnap = await getDoc(doc(db, "shop_orders_private", d.id));
        if (pSnap.exists()) buyer = pSnap.data();
      } catch (e) {
        // Bỏ qua
      }
    }
    shopOrders.push({ maDon: d.id, ...raw, buyer });
  }
  shopOrders.sort((a, b) => String(b.ngayTaoISO || "").localeCompare(String(a.ngayTaoISO || "")));

  packages = [];
  pkgSnap.forEach((d) => {
    const data = d.data();
    if (!data.deleted) packages.push({ id: d.id, ...data });
  });
  packages.sort((a, b) => (a.order || 99) - (b.order || 99));

  maps = [];
  mapSnap.forEach((d) => {
    const data = d.data();
    if (!data.deleted) maps.push({ id: d.id, ...data });
  });

  if (cfgSnap.exists()) {
    scheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, ...cfgSnap.data() };
  }

  orders = [];
  for (const d of ordSnap.docs) {
    const raw = d.data();
    let pii = {
      customerName: raw.maskedCustomer || "Khách hàng",
      discordId: "(Cần khóa giải mã)",
      gameId: "—",
      note: ""
    };

    if (adminPrivateKey && raw.encryptedPii) {
      try {
        const decrypted = await decryptCustomerPii(adminPrivateKey, raw.encryptedPii);
        if (decrypted) pii = decrypted;
      } catch (e) {
        // Bỏ qua
      }
    } else if (auth.currentUser) {
      try {
        const privSnap = await getDoc(doc(db, "gc_orders_private", d.id));
        if (privSnap.exists()) pii = privSnap.data();
      } catch (e) {
        // Bỏ qua
      }
    }

    orders.push({ bookingCode: d.id, ...raw, pii });
  }
  orders.sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));

  reviews = [];
  revSnap.forEach((d) => {
    const data = d.data();
    if (!data.deleted) reviews.push({ id: d.id, ...data });
  });

  renderKpis();
  renderShopOrdersTable();
  renderStockTable();
  renderOrdersTable();
  renderPackagesTable();
  renderScheduleAndMaps();
  renderCustomersTable();
  renderReviewsTable();
}

function renderKpis() {
  const shopPending = shopOrders.filter(
    (o) => o.paymentStatus === "Awaiting_Transfer" || o.paymentStatus === "Customer_Marked_Paid"
  ).length;
  const gcPending = orders.filter((o) => o.status === "Pending").length;

  const shopRevenue = shopOrders
    .filter((o) => o.paymentStatus === "Paid_Delivered")
    .reduce((s, o) => s + Number(o.tongTien || 0), 0);
  const gcRevenue = orders
    .filter((o) => o.status === "Paid" || o.status === "Completed")
    .reduce((s, o) => s + Number(o.price || 0), 0);

  const activeOrders = orders.filter((o) =>
    ["Confirmed", "Paid", "In Progress", "Completed"].includes(o.status)
  );
  const totalMinutes = activeOrders.reduce((sum, o) => sum + Number(o.duration || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1).replace(/\.0$/, "");

  const pkgCounter = {};
  orders
    .filter((o) => o.status !== "Cancelled")
    .forEach((o) => {
      const key = o.packageName || o.packageId;
      pkgCounter[key] = (pkgCounter[key] || 0) + 1;
    });

  let topPkgText = "Gói đặt nhiều nhất: Chưa có";
  let maxCount = 0;
  for (const [name, cnt] of Object.entries(pkgCounter)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      topPkgText = `Top: ${name} (${cnt})`;
    }
  }

  document.getElementById("kpi-shop-pending").textContent = String(shopPending);
  document.getElementById("kpi-pending").textContent = String(gcPending);
  document.getElementById("kpi-revenue").textContent = `${(shopRevenue + gcRevenue).toLocaleString("vi-VN")} VNĐ`;
  document.getElementById("kpi-hours").textContent = `${totalHours} giờ`;
  document.getElementById("kpi-top-pkg").textContent = topPkgText;
}

function renderShopOrdersTable() {
  const tbody = document.getElementById("shop-orders-tbody");
  if (shopOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có đơn mua Account nào qua VietQR.</td></tr>`;
    return;
  }

  tbody.innerHTML = shopOrders
    .map((o) => {
      let badgeHtml = `<span class="status-pill status-pending">Chờ chuyển khoản</span>`;
      if (o.paymentStatus === "Customer_Marked_Paid") {
        badgeHtml = `<span class="status-pill status-confirmed">⚡ Khách báo đã CK!</span>`;
      } else if (o.paymentStatus === "Paid_Delivered") {
        badgeHtml = `<span class="status-pill status-completed">✓ Đã giao Acc</span>`;
      } else if (o.paymentStatus === "Cancelled") {
        badgeHtml = `<span class="status-pill status-cancelled">Đã hủy</span>`;
      }

      const itemsStr = (o.danhSachMon || []).map((i) => `[#${i.id}] ${i.title}`).join("<br/>");
      const canDeliver = o.paymentStatus !== "Paid_Delivered" && o.paymentStatus !== "Cancelled";

      return `
        <tr>
          <td>
            <strong>${o.maDon}</strong><br/>
            <code style="color: var(--tac-cyan);">CK: ${o.transferCode || ""}</code>
          </td>
          <td>
            <strong>${o.buyer.tenKhach}</strong><br/>
            <span style="color: var(--tac-green); font-size: 0.82rem;">Zalo/SĐT: ${o.buyer.soDienThoai}</span>
            ${o.buyer.ghiChu ? `<br/><span style="color: var(--tac-amber); font-size: 0.8rem;">Ghi chú: ${o.buyer.ghiChu}</span>` : ""}
          </td>
          <td style="font-size: 0.85rem;">${itemsStr}</td>
          <td><strong style="color: var(--tac-amber);">${Number(o.tongTien || 0).toLocaleString("vi-VN")} VNĐ</strong></td>
          <td>${badgeHtml}</td>
          <td>
            ${
              canDeliver
                ? `<div style="display:flex; gap:6px; flex-wrap:wrap;">
                     <button type="button" class="btn btn-primary btn-sm approve-deliver-btn" data-code="${o.maDon}">
                       ✓ Đã nhận tiền &amp; Giao Acc
                     </button>
                     <button type="button" class="btn btn-danger btn-sm cancel-shop-order-btn" data-code="${o.maDon}">
                       Hủy
                     </button>
                   </div>`
                : `<span style="font-size: 0.82rem; color: var(--text-muted);">Hoàn tất</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderStockTable() {
  const tbody = document.getElementById("stock-tbody");
  if (shopAccounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có Account nào trong kho.</td></tr>`;
    return;
  }

  tbody.innerHTML = shopAccounts
    .map((a) => {
      const creds = stockVaultMap.get(a.id);
      const hasCreds = Boolean(creds && creds.loginUser && creds.loginPass);
      return `
        <tr>
          <td><strong>#${a.id}</strong></td>
          <td>
            <strong>${a.title}</strong><br/>
            <span style="font-size: 0.8rem; color: var(--text-muted);">${a.gameLabel || a.game} • ${a.rank || ""}</span>
          </td>
          <td><strong style="color: var(--tac-green);">${Number(a.price || 0).toLocaleString("vi-VN")} VNĐ</strong></td>
          <td>
            ${
              hasCreds
                ? `<span class="status-pill status-completed">✓ Đã gắn TK/MK (${creds.loginUser})</span>`
                : `<span class="status-pill status-pending">⚠️ Chưa gắn TK/MK</span>`
            }
          </td>
          <td>
            ${
              a.sold
                ? `<span class="status-pill status-cancelled">ĐÃ BÁN</span>`
                : `<span class="status-pill status-confirmed">Đang bán</span>`
            }
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn btn-outline btn-sm edit-acc-btn" data-id="${a.id}">Sửa / Gắn MK</button>
              <button type="button" class="btn btn-danger btn-sm del-acc-btn" data-id="${a.id}">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function handleApproveAndDeliver(maDon) {
  const order = shopOrders.find((o) => o.maDon === maDon);
  if (!order) return;

  if (!order.buyer.deliveryToken) {
    alert("Đơn này được tạo trước khi khởi tạo két mã hóa Admin nên chưa có khóa nhận tự động. Hãy gửi Acc trực tiếp qua Zalo khách hàng nhé!");
    return;
  }

  const deliveredItems = [];
  for (const item of order.danhSachMon || []) {
    if (item.type === "account") {
      let creds = stockVaultMap.get(item.id);
      if (!creds || !creds.loginUser || !creds.loginPass) {
        const u = prompt(`Mã #${item.id} chưa gắn sẵn TK trong kho. Nhập Tài khoản đăng nhập để giao ngay cho khách:`);
        if (!u) return;
        const p = prompt(`Nhập Mật khẩu của #${item.id}:`);
        if (!p) return;
        creds = {
          loginUser: u.trim(),
          loginPass: p.trim(),
          guideNote: "Vui lòng đăng nhập kiểm tra và đổi mật khẩu ngay để bảo mật tài khoản!"
        };
        if (vaultDocData?.publicKeyJwk) {
          const encCreds = await encryptCustomerPii(vaultDocData.publicKeyJwk, creds);
          await setDoc(doc(db, "shop_vault_stock", item.id), adminPayload({ encryptedCredentials: encCreds }));
        }
      }
      deliveredItems.push({
        id: item.id,
        title: item.title,
        loginUser: creds.loginUser,
        loginPass: creds.loginPass,
        guideNote: creds.guideNote || ""
      });
    } else {
      deliveredItems.push({
        id: item.id,
        title: item.title,
        loginUser: "Dịch vụ đã xác nhận thanh toán",
        loginPass: "Liên hệ Zalo 0911507170 để bắt đầu",
        guideNote: ""
      });
    }
  }

  // 1. Ghi thông tin tài khoản vào hộp nhận bí mật shop_deliveries/{deliveryToken}
  await setDoc(
    doc(db, "shop_deliveries", order.buyer.deliveryToken),
    adminPayload({
      maDon,
      items: deliveredItems,
      deliveredAtISO: new Date().toISOString()
    })
  );

  // 2. Đổi trạng thái đơn sang Paid_Delivered (màn hình khách tự động mở khóa ngay lập tức!)
  await updateDoc(doc(db, "shop_orders", maDon), adminPayload({ paymentStatus: "Paid_Delivered" }));

  // 3. Đánh dấu các Account trong đơn thành ĐÃ BÁN (sold: true)
  for (const item of order.danhSachMon || []) {
    if (item.type === "account") {
      await setDoc(
        doc(db, "shop_accounts", item.id),
        adminPayload({ sold: true, badge: "ĐÃ BÁN" }),
        { merge: true }
      );
    }
  }

  showToast(`🎉 Đã xác nhận tiền về & gửi Acc tự động lên màn hình khách (Đơn ${maDon})!`);
  await loadAllDashboardData();
}

function renderOrdersTable() {
  const filterVal = document.getElementById("filter-order-status").value;
  const tbody = document.getElementById("orders-tbody");

  const list = filterVal === "all" ? orders : orders.filter((o) => o.status === filterVal);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có đơn đặt lịch nào khớp bộ lọc.</td></tr>`;
    return;
  }

  const statuses = ["Pending", "Confirmed", "Paid", "In Progress", "Completed", "Cancelled"];

  tbody.innerHTML = list
    .map((o) => {
      const st = ORDER_STATUS_META[o.status] || { label: o.status, css: "status-pending" };
      return `
        <tr>
          <td><strong>${o.bookingCode}</strong></td>
          <td>
            <strong>${o.pii.customerName}</strong><br/>
            <span style="color: var(--tac-cyan); font-size: 0.82rem;">Discord: ${o.pii.discordId}</span>
            ${o.pii.gameId ? `<br/><span style="color: var(--text-muted); font-size: 0.8rem;">Game ID: ${o.pii.gameId}</span>` : ""}
            ${o.pii.note ? `<br/><span style="color: var(--tac-amber); font-size: 0.8rem;">Ghi chú: ${o.pii.note}</span>` : ""}
          </td>
          <td>
            <strong>${o.packageName}</strong><br/>
            <span style="color: var(--text-muted); font-size: 0.82rem;">${o.gameMode} • ${o.mapName} (${o.format || "Duo"})</span>
          </td>
          <td>${o.playDate}<br/><strong>${o.startTime}</strong> (${o.duration}p)</td>
          <td>${formatCurrencyVND(o.price, o.isCustomPrice)}</td>
          <td><span class="status-pill ${st.css}">${o.status}</span></td>
          <td>
            <select class="order-status-select" data-code="${o.bookingCode}" style="background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font-size: 0.82rem;">
              ${statuses
                .map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s} (${ORDER_STATUS_META[s].label})</option>`)
                .join("")}
            </select>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderPackagesTable() {
  const tbody = document.getElementById("pkgs-tbody");
  tbody.innerHTML = packages
    .map(
      (p) => `
      <tr>
        <td><strong>${p.name}</strong><br/><span style="font-size: 0.8rem; color: var(--text-muted);">${p.description}</span></td>
        <td>${p.durationLabel || `${p.durationMinutes} phút`}</td>
        <td>${(p.modes || []).join(", ")}</td>
        <td><strong style="color: var(--tac-green);">${formatCurrencyVND(p.price, p.isCustomPrice)}</strong></td>
        <td>${p.visible !== false ? `<span class="status-pill status-completed">Đang hiện</span>` : `<span class="status-pill status-cancelled">Đang ẩn</span>`}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline btn-sm edit-pkg-btn" data-id="${p.id}">Sửa / Giá</button>
            <button type="button" class="btn btn-danger btn-sm del-pkg-btn" data-id="${p.id}">Xóa</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

function renderScheduleAndMaps() {
  document.getElementById("cfg-open").value = scheduleConfig.openHour ?? 8;
  document.getElementById("cfg-close").value = scheduleConfig.closeHour ?? 23;
  document.getElementById("cfg-discord").value = scheduleConfig.discordInviteUrl || "https://discord.gg/hcugaming";

  const blockedEl = document.getElementById("blocked-slots-list");
  const blocked = scheduleConfig.blockedSlots || [];
  if (blocked.length === 0) {
    blockedEl.innerHTML = `<span style="font-size: 0.85rem; color: var(--text-muted);">Chưa có khung giờ nào bị khóa bận thủ công.</span>`;
  } else {
    blockedEl.innerHTML = blocked
      .map(
        (slot) => `
        <span class="pkg-chip" style="display: inline-flex; align-items: center; gap: 6px; color: #fca5a5;">
          🔒 ${slot.replace("|", " lúc ")}
          <button type="button" class="unblock-btn" data-slot="${slot}" style="background:none; border:none; color:#fff; cursor:pointer; font-weight:800;">✕</button>
        </span>
      `
      )
      .join("");
  }

  const mapsTbody = document.getElementById("maps-tbody");
  mapsTbody.innerHTML = maps
    .map(
      (m) => `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.mode}</td>
        <td>${m.active !== false ? `<span class="status-pill status-completed">Hoạt động</span>` : `<span class="status-pill status-cancelled">Đã ẩn</span>`}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm toggle-map-btn" data-id="${m.id}">
            ${m.active !== false ? "Ẩn bản đồ" : "Kích hoạt lại"}
          </button>
        </td>
      </tr>
    `
    )
    .join("");
}

function renderCustomersTable() {
  const tbody = document.getElementById("customers-tbody");
  const byContact = new Map();

  shopOrders.forEach((o) => {
    const key = o.buyer.soDienThoai || o.maDon;
    const prev = byContact.get(key) || {
      name: o.buyer.tenKhach,
      contact: o.buyer.soDienThoai,
      gameId: o.buyer.ingame || "—",
      count: 0,
      spent: 0,
      lastDate: (o.ngayTaoISO || "").slice(0, 10)
    };
    prev.count += 1;
    if (o.paymentStatus === "Paid_Delivered") prev.spent += Number(o.tongTien || 0);
    byContact.set(key, prev);
  });

  orders.forEach((o) => {
    const key = o.pii.discordId || o.bookingCode;
    const prev = byContact.get(key) || {
      name: o.pii.customerName,
      contact: o.pii.discordId,
      gameId: o.pii.gameId || "—",
      count: 0,
      spent: 0,
      lastDate: o.playDate
    };
    prev.count += 1;
    if (o.status === "Paid" || o.status === "Completed") prev.spent += Number(o.price || 0);
    byContact.set(key, prev);
  });

  const list = Array.from(byContact.values());
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có dữ liệu khách hàng.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td style="color: var(--tac-cyan);">${c.contact}</td>
        <td>${c.gameId}</td>
        <td>${c.count} đơn</td>
        <td>${c.spent.toLocaleString("vi-VN")} VNĐ</td>
        <td>${c.lastDate}</td>
      </tr>
    `
    )
    .join("");
}

function renderReviewsTable() {
  const tbody = document.getElementById("reviews-tbody");
  if (reviews.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có đánh giá nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = reviews
    .map(
      (r) => `
      <tr>
        <td><strong>${r.bookingCode}</strong></td>
        <td>${r.maskedName}</td>
        <td style="color: var(--tac-amber); font-weight:800;">${Number(r.averageRating || 5).toFixed(1)} ★</td>
        <td>${r.comment}</td>
        <td>${r.visible !== false ? `<span class="status-pill status-completed">Hiển thị</span>` : `<span class="status-pill status-cancelled">Đã ẩn</span>`}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline btn-sm toggle-rev-btn" data-id="${r.id}">
              ${r.visible !== false ? "Ẩn" : "Hiện"}
            </button>
            <button type="button" class="btn btn-danger btn-sm del-rev-btn" data-id="${r.id}">Xóa</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

async function enterDashboard() {
  document.getElementById("admin-auth-view").hidden = true;
  document.getElementById("admin-dashboard-view").hidden = false;
  document.getElementById("admin-logout-btn").hidden = false;
  await loadAllDashboardData();
}

document.addEventListener("DOMContentLoaded", async () => {
  await checkVaultSetupState();

  onAuthStateChanged(auth, async (user) => {
    if (user && ADMIN_EMAILS.includes(user.email)) {
      await enterDashboard();
    }
  });

  document.getElementById("admin-pass-form").addEventListener("submit", handlePassphraseSubmit);

  document.getElementById("google-login-btn").addEventListener("click", async () => {
    const errEl = document.getElementById("auth-error");
    errEl.hidden = true;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (!ADMIN_EMAILS.includes(cred.user.email)) {
        await signOut(auth);
        errEl.textContent = "Tài khoản Google này không nằm trong danh sách Quản trị viên.";
        errEl.hidden = false;
      }
    } catch (err) {
      errEl.textContent =
        "Google Sign-In chưa được bật trên Firebase Console — bạn hãy dùng Mật khẩu Quản trị ở ô phía trên nhé!";
      errEl.hidden = false;
    }
  });

  document.getElementById("admin-logout-btn").addEventListener("click", async () => {
    adminToken = null;
    adminPrivateKey = null;
    if (auth.currentUser) await signOut(auth);
    document.getElementById("admin-dashboard-view").hidden = true;
    document.getElementById("admin-auth-view").hidden = false;
    document.getElementById("admin-logout-btn").hidden = true;
    document.getElementById("admin-pass-form").reset();
    await checkVaultSetupState();
  });

  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".admin-pane").forEach((p) => (p.hidden = true));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).hidden = false;
    });
  });

  // Duyệt đơn mua Acc VietQR
  document.getElementById("refresh-shop-orders-btn").addEventListener("click", loadAllDashboardData);
  document.getElementById("shop-orders-tbody").addEventListener("click", async (e) => {
    const approveBtn = e.target.closest(".approve-deliver-btn");
    if (approveBtn) {
      await handleApproveAndDeliver(approveBtn.dataset.code);
      return;
    }
    const cancelBtn = e.target.closest(".cancel-shop-order-btn");
    if (cancelBtn) {
      await updateDoc(
        doc(db, "shop_orders", cancelBtn.dataset.code),
        adminPayload({ paymentStatus: "Cancelled" })
      );
      showToast("Đã hủy đơn hàng.");
      await loadAllDashboardData();
    }
  });

  // Quản lý Kho Account & Gắn Mật Khẩu
  document.getElementById("new-acc-btn").addEventListener("click", () => {
    document.getElementById("acc-stock-form").reset();
    document.getElementById("sa-id").readOnly = false;
    document.getElementById("acc-form-title").textContent = "Đăng Account Mới & Gắn Mật Khẩu";
    document.getElementById("acc-stock-form").hidden = false;
  });

  document.getElementById("cancel-acc-btn").addEventListener("click", () => {
    document.getElementById("acc-stock-form").hidden = true;
  });

  document.getElementById("stock-tbody").addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-acc-btn");
    if (editBtn) {
      const a = shopAccounts.find((x) => x.id === editBtn.dataset.id);
      if (!a) return;
      const creds = stockVaultMap.get(a.id) || {};
      document.getElementById("sa-id").value = a.id;
      document.getElementById("sa-id").readOnly = true;
      document.getElementById("sa-game").value = a.game || "lien-quan";
      document.getElementById("sa-title").value = a.title || "";
      document.getElementById("sa-price").value = a.price || 0;
      document.getElementById("sa-rank").value = a.rank || "";
      document.getElementById("sa-cover").value = a.coverImage || "";
      document.getElementById("sa-stats").value = (a.stats || []).join(", ");
      document.getElementById("sa-desc").value = a.description || "";
      document.getElementById("sa-login-user").value = creds.loginUser || "";
      document.getElementById("sa-login-pass").value = creds.loginPass || "";
      document.getElementById("sa-guide-note").value =
        creds.guideNote || "Đăng nhập kiểm tra đúng skin rồi đổi mật khẩu ngay nhé!";
      document.getElementById("sa-sold").value = String(Boolean(a.sold));
      document.getElementById("acc-form-title").textContent = `Cập nhật & Gắn Mật Khẩu: #${a.id}`;
      document.getElementById("acc-stock-form").hidden = false;
      return;
    }

    const delBtn = e.target.closest(".del-acc-btn");
    if (delBtn) {
      await updateDoc(
        doc(db, "shop_accounts", delBtn.dataset.id),
        adminPayload({ deleted: true, visible: false })
      );
      showToast("Đã xóa Account khỏi kho.");
      await loadAllDashboardData();
    }
  });

  document.getElementById("acc-stock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("sa-id").value.trim().toUpperCase();
    const game = document.getElementById("sa-game").value;
    const isSold = document.getElementById("sa-sold").value === "true";
    const cover = document.getElementById("sa-cover").value.trim();
    const existing = shopAccounts.find((x) => x.id === id) || {};

    const accDoc = {
      ...existing,
      id,
      game,
      gameLabel: game === "delta-force" ? "Delta Force" : "Liên Quân Mobile",
      title: document.getElementById("sa-title").value.trim(),
      price: Number(document.getElementById("sa-price").value || 0),
      rank: document.getElementById("sa-rank").value.trim(),
      coverImage: cover,
      stats: document
        .getElementById("sa-stats")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      description: document.getElementById("sa-desc").value.trim(),
      sold: isSold,
      badge: isSold ? "ĐÃ BÁN" : existing.badge && existing.badge !== "ĐÃ BÁN" ? existing.badge : "VIP",
      visible: true,
      deleted: false
    };

    await setDoc(doc(db, "shop_accounts", id), adminPayload(accDoc), { merge: true });

    const loginUser = document.getElementById("sa-login-user").value.trim();
    const loginPass = document.getElementById("sa-login-pass").value.trim();
    const guideNote = document.getElementById("sa-guide-note").value.trim();

    if (loginUser && loginPass && vaultDocData?.publicKeyJwk) {
      const encryptedCredentials = await encryptCustomerPii(vaultDocData.publicKeyJwk, {
        loginUser,
        loginPass,
        guideNote
      });
      await setDoc(doc(db, "shop_vault_stock", id), adminPayload({ encryptedCredentials }));
    }

    document.getElementById("acc-stock-form").hidden = true;
    showToast(`Đã lưu Account #${id} và két mật khẩu thành công!`);
    await loadAllDashboardData();
  });

  // Lịch Game Cùng
  document.getElementById("filter-order-status").addEventListener("change", renderOrdersTable);
  document.getElementById("refresh-orders-btn").addEventListener("click", loadAllDashboardData);

  document.getElementById("orders-tbody").addEventListener("change", async (e) => {
    const sel = e.target.closest(".order-status-select");
    if (!sel) return;
    const code = sel.dataset.code;
    const nextStatus = sel.value;
    await updateDoc(doc(db, "gc_orders", code), adminPayload({ status: nextStatus }));
    showToast(`Đã cập nhật trạng thái đơn ${code} → ${nextStatus}`);
    await loadAllDashboardData();
  });

  // Gói Game Cùng
  document.getElementById("new-pkg-btn").addEventListener("click", () => {
    document.getElementById("pkg-form").reset();
    document.getElementById("p-id").value = "";
    document.getElementById("pkg-form-title").textContent = "Thêm gói dịch vụ mới";
    document.getElementById("pkg-form").hidden = false;
  });

  document.getElementById("cancel-pkg-btn").addEventListener("click", () => {
    document.getElementById("pkg-form").hidden = true;
  });

  document.getElementById("pkgs-tbody").addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-pkg-btn");
    if (editBtn) {
      const p = packages.find((x) => x.id === editBtn.dataset.id);
      if (!p) return;
      document.getElementById("p-id").value = p.id;
      document.getElementById("p-name").value = p.name;
      document.getElementById("p-audience").value = p.audience || "";
      document.getElementById("p-duration").value = String(p.durationMinutes || 60);
      document.getElementById("p-price").value = p.price || 0;
      document.getElementById("p-custom-price").checked = Boolean(p.isCustomPrice);
      document.getElementById("p-modes").value = (p.modes || []).join(", ");
      document.getElementById("p-visible").value = String(p.visible !== false);
      document.getElementById("p-desc").value = p.description || "";
      document.getElementById("pkg-form-title").textContent = `Chỉnh sửa: ${p.name}`;
      document.getElementById("pkg-form").hidden = false;
      return;
    }

    const delBtn = e.target.closest(".del-pkg-btn");
    if (delBtn) {
      await updateDoc(doc(db, "gc_packages", delBtn.dataset.id), adminPayload({ deleted: true, visible: false }));
      showToast("Đã xóa gói dịch vụ.");
      await loadAllDashboardData();
    }
  });

  document.getElementById("pkg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("p-id").value || `pkg-${Date.now()}`;
    const isCustom = document.getElementById("p-custom-price").checked;
    const dur = Number(document.getElementById("p-duration").value);
    const modes = document
      .getElementById("p-modes")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const pkgData = {
      id,
      name: document.getElementById("p-name").value.trim(),
      audience: document.getElementById("p-audience").value.trim(),
      badge: document.getElementById("p-audience").value.trim(),
      durationMinutes: dur,
      durationLabel: isCustom ? "Theo thỏa thuận" : `${dur} phút`,
      allowedDurations: isCustom ? [30, 60, 90, 120] : [dur],
      price: isCustom ? 0 : Number(document.getElementById("p-price").value || 0),
      isCustomPrice: isCustom,
      modes: modes.length ? modes : ["Operations", "Warfare"],
      formats: ["Solo cùng người đồng hành", "Duo", "Squad"],
      levels: ["Mới bắt đầu", "Cơ bản", "Trung cấp", "Nâng cao"],
      description: document.getElementById("p-desc").value.trim(),
      visible: document.getElementById("p-visible").value === "true",
      deleted: false
    };

    await setDoc(doc(db, "gc_packages", id), adminPayload(pkgData), { merge: true });
    document.getElementById("pkg-form").hidden = true;
    showToast("Đã lưu gói dịch vụ thành công!");
    await loadAllDashboardData();
  });

  document.getElementById("schedule-config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    scheduleConfig.openHour = Number(document.getElementById("cfg-open").value);
    scheduleConfig.closeHour = Number(document.getElementById("cfg-close").value);
    scheduleConfig.discordInviteUrl = document.getElementById("cfg-discord").value.trim();
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
    showToast("Đã lưu cấu hình lịch hoạt động & Discord!");
  });

  document.getElementById("add-block-btn").addEventListener("click", async () => {
    const d = document.getElementById("block-date").value;
    const t = document.getElementById("block-time").value;
    if (!d || !t) return;
    const key = `${d}|${t}`;
    const next = Array.from(new Set([...(scheduleConfig.blockedSlots || []), key]));
    scheduleConfig.blockedSlots = next;
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
    showToast(`Đã khóa lịch bận: ${d} lúc ${t}`);
    renderScheduleAndMaps();
  });

  document.getElementById("blocked-slots-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".unblock-btn");
    if (!btn) return;
    scheduleConfig.blockedSlots = (scheduleConfig.blockedSlots || []).filter((s) => s !== btn.dataset.slot);
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
    showToast("Đã mở khóa khung giờ!");
    renderScheduleAndMaps();
  });

  document.getElementById("add-map-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-map-name").value.trim();
    const mode = document.getElementById("new-map-mode").value;
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + mode.toLowerCase();
    await setDoc(doc(db, "gc_maps", id), adminPayload({ id, name, mode, active: true, deleted: false }));
    document.getElementById("new-map-name").value = "";
    showToast(`Đã thêm bản đồ ${name} (${mode})`);
    await loadAllDashboardData();
  });

  document.getElementById("maps-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".toggle-map-btn");
    if (!btn) return;
    const m = maps.find((x) => x.id === btn.dataset.id);
    if (!m) return;
    await updateDoc(doc(db, "gc_maps", m.id), adminPayload({ active: m.active === false }));
    showToast(`Đã cập nhật trạng thái bản đồ ${m.name}`);
    await loadAllDashboardData();
  });

  document.getElementById("reviews-tbody").addEventListener("click", async (e) => {
    const toggleBtn = e.target.closest(".toggle-rev-btn");
    if (toggleBtn) {
      const r = reviews.find((x) => x.id === toggleBtn.dataset.id);
      if (!r) return;
      await updateDoc(doc(db, "gc_reviews", r.id), adminPayload({ visible: r.visible === false }));
      showToast("Đã cập nhật hiển thị đánh giá.");
      await loadAllDashboardData();
      return;
    }

    const delBtn = e.target.closest(".del-rev-btn");
    if (delBtn) {
      await updateDoc(doc(db, "gc_reviews", delBtn.dataset.id), adminPayload({ deleted: true, visible: false }));
      showToast("Đã xóa đánh giá.");
      await loadAllDashboardData();
    }
  });
});
