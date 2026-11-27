import {
  db,
  auth,
  ADMIN_EMAILS,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
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

let members = [];
let topups = [];
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
  }, 3200);
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
        "Nhập mật khẩu Quản trị để duyệt Nạp tiền thành viên, quản lý Kho Account và lịch Game Cùng.";
      document.getElementById("admin-pass-confirm-wrap").hidden = true;
      document.getElementById("admin-login-btn").textContent = "Đăng nhập Quản trị";
    } else {
      isVaultInitialized = false;
      document.getElementById("auth-heading").textContent = "Khởi Tạo Mật Khẩu Quản Trị Lần Đầu";
      document.getElementById("auth-desc").textContent =
        "Tạo mật khẩu Quản trị (tối thiểu 6 ký tự) để sinh két mã hóa bảo vệ Mật khẩu Acc Game & thông tin khách hàng.";
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

  const [
    usersSnap,
    topupsSnap,
    accSnap,
    vaultStockSnap,
    shopOrdSnap,
    pkgSnap,
    mapSnap,
    cfgSnap,
    ordSnap,
    revSnap
  ] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "wallet_topups")),
    getDocs(collection(db, "shop_accounts")),
    getDocs(collection(db, "shop_vault_stock")),
    getDocs(collection(db, "shop_orders")),
    getDocs(collection(db, "gc_packages")),
    getDocs(collection(db, "gc_maps")),
    getDoc(doc(db, "gc_config", "schedule")),
    getDocs(collection(db, "gc_orders")),
    getDocs(collection(db, "gc_reviews"))
  ]);

  members = [];
  usersSnap.forEach((d) => members.push({ uid: d.id, ...d.data() }));
  members.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

  topups = [];
  topupsSnap.forEach((d) => topups.push({ topupCode: d.id, ...d.data() }));
  topups.sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));

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
        // Bỏ qua
      }
    }
  }

  shopOrders = [];
  for (const d of shopOrdSnap.docs) {
    const raw = d.data();
    let buyer = { tenKhach: "Khách lẻ", soDienThoai: "—", deliveryToken: "" };
    if (adminPrivateKey && raw.encryptedOrderBox) {
      try {
        const decBox = await decryptCustomerPii(adminPrivateKey, raw.encryptedOrderBox);
        if (decBox) buyer = decBox;
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
    let pii = { customerName: raw.maskedCustomer || "Khách hàng", discordId: "—", gameId: "—", note: "" };
    if (adminPrivateKey && raw.encryptedPii) {
      try {
        const decrypted = await decryptCustomerPii(adminPrivateKey, raw.encryptedPii);
        if (decrypted) pii = decrypted;
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
  renderTopupsAndMembers();
  renderStockTable();
  renderShopOrdersTable();
  renderOrdersTable();
  renderPackagesTable();
  renderScheduleAndMaps();
  renderReviewsTable();
}

function renderKpis() {
  const pendingTopups = topups.filter(
    (t) => t.status === "Pending" || t.status === "Reported_Paid"
  ).length;
  const approvedTopupSum = topups
    .filter((t) => t.status === "Approved")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const gcPending = orders.filter((o) => o.status === "Pending").length;

  document.getElementById("kpi-topup-pending").textContent = String(pendingTopups);
  document.getElementById("kpi-members-count").textContent = String(members.length);
  document.getElementById("kpi-revenue").textContent = `${approvedTopupSum.toLocaleString("vi-VN")} VNĐ`;
  document.getElementById("kpi-pending").textContent = `${gcPending} lịch`;
}

function renderTopupsAndMembers() {
  const tBody = document.getElementById("topups-tbody");
  if (topups.length === 0) {
    tBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có yêu cầu nạp tiền nào.</td></tr>`;
  } else {
    tBody.innerHTML = topups
      .map((t) => {
        let stHtml = `<span class="status-pill status-pending">Chờ CK</span>`;
        if (t.status === "Reported_Paid") {
          stHtml = `<span class="status-pill status-confirmed">⚡ Khách báo đã CK!</span>`;
        } else if (t.status === "Approved") {
          stHtml = `<span class="status-pill status-completed">✓ Đã cộng tiền</span>`;
        } else if (t.status === "Rejected") {
          stHtml = `<span class="status-pill status-cancelled">Đã từ chối</span>`;
        }

        const actionable = t.status === "Pending" || t.status === "Reported_Paid";
        return `
          <tr>
            <td><strong style="color: var(--tac-cyan);">${t.topupCode}</strong></td>
            <td><strong>${t.username}</strong></td>
            <td><strong style="color: var(--tac-amber);">${Number(t.amount || 0).toLocaleString("vi-VN")} VNĐ</strong></td>
            <td style="font-size: 0.8rem;">${(t.createdAtISO || "").replace("T", " ").slice(0, 16)}</td>
            <td>${stHtml}</td>
            <td>
              ${
                actionable
                  ? `<div style="display:flex; gap:6px;">
                       <button type="button" class="btn btn-primary btn-sm approve-topup-btn" data-code="${t.topupCode}">
                         ✓ Duyệt &amp; Cộng +${Number(t.amount || 0).toLocaleString("vi-VN")}đ
                       </button>
                       <button type="button" class="btn btn-danger btn-sm reject-topup-btn" data-code="${t.topupCode}">Hủy</button>
                     </div>`
                  : `<span style="font-size: 0.8rem; color: var(--text-muted);">Hoàn tất</span>`
              }
            </td>
          </tr>
        `;
      })
      .join("");
  }

  const mBody = document.getElementById("members-tbody");
  if (members.length === 0) {
    mBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Chưa có thành viên đăng ký.</td></tr>`;
  } else {
    mBody.innerHTML = members
      .map(
        (m) => `
        <tr>
          <td><strong>${m.username}</strong></td>
          <td><strong style="color: var(--tac-green);">${Number(m.balance || 0).toLocaleString("vi-VN")} VNĐ</strong></td>
          <td>${Number(m.totalDeposited || 0).toLocaleString("vi-VN")} VNĐ</td>
          <td style="font-size: 0.8rem;">${(m.createdAtISO || "").slice(0, 10)}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm adjust-bal-btn" data-uid="${m.uid}">
              ➕ Cộng / Sửa số dư
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  }
}

async function handleApproveTopup(topupCode) {
  const t = topups.find((x) => x.topupCode === topupCode);
  if (!t || t.status === "Approved") return;

  const userRef = doc(db, "users", t.uid);
  const uSnap = await getDoc(userRef);
  const currentBal = uSnap.exists() ? Number(uSnap.data().balance || 0) : 0;
  const currentDep = uSnap.exists() ? Number(uSnap.data().totalDeposited || 0) : 0;
  const addAmt = Number(t.amount || 0);

  await setDoc(
    userRef,
    adminPayload({
      balance: currentBal + addAmt,
      totalDeposited: currentDep + addAmt,
      updatedAtISO: new Date().toISOString()
    }),
    { merge: true }
  );

  await updateDoc(doc(db, "wallet_topups", topupCode), adminPayload({ status: "Approved" }));
  showToast(`🎉 Đã cộng +${addAmt.toLocaleString("vi-VN")} VNĐ vào tài khoản "${t.username}"!`);
  await loadAllDashboardData();
}

async function handleManualBalanceAdjust(uid) {
  const m = members.find((x) => x.uid === uid);
  if (!m) return;
  const raw = prompt(
    `Số dư hiện tại của "${m.username}" là ${Number(m.balance || 0).toLocaleString("vi-VN")} VNĐ.\nNhập số tiền muốn CỘNG THÊM (ví dụ: 100000, hoặc nhập số âm để trừ):`,
    "100000"
  );
  if (raw === null) return;
  const delta = Math.round(Number(raw));
  if (Number.isNaN(delta) || delta === 0) return;

  const nextBal = Math.max(0, Number(m.balance || 0) + delta);
  const nextDep = delta > 0 ? Number(m.totalDeposited || 0) + delta : Number(m.totalDeposited || 0);

  await updateDoc(
    doc(db, "users", uid),
    adminPayload({
      balance: nextBal,
      totalDeposited: nextDep,
      updatedAtISO: new Date().toISOString()
    })
  );
  showToast(`Đã cập nhật số dư của "${m.username}" thành ${nextBal.toLocaleString("vi-VN")} VNĐ!`);
  await loadAllDashboardData();
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
                ? `<span class="status-pill status-completed">✓ Sẵn sàng nhả tự động (${creds.loginUser})</span>`
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

function renderShopOrdersTable() {
  const tbody = document.getElementById("shop-orders-tbody");
  if (shopOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có đơn lẻ nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = shopOrders
    .map((o) => {
      let badgeHtml = `<span class="status-pill status-pending">Chờ CK</span>`;
      if (o.paymentStatus === "Customer_Marked_Paid") {
        badgeHtml = `<span class="status-pill status-confirmed">⚡ Khách báo đã CK!</span>`;
      } else if (o.paymentStatus === "Paid_Delivered") {
        badgeHtml = `<span class="status-pill status-completed">✓ Đã giao</span>`;
      } else if (o.paymentStatus === "Cancelled") {
        badgeHtml = `<span class="status-pill status-cancelled">Đã hủy</span>`;
      }
      const itemsStr = (o.danhSachMon || []).map((i) => `[#${i.id}] ${i.title}`).join("<br/>");
      const canDeliver = o.paymentStatus !== "Paid_Delivered" && o.paymentStatus !== "Cancelled";

      return `
        <tr>
          <td><strong>${o.maDon}</strong><br/><code style="color:var(--tac-cyan);">${o.transferCode || ""}</code></td>
          <td><strong>${o.buyer.tenKhach}</strong><br/><span style="font-size:0.8rem;">${o.buyer.soDienThoai}</span></td>
          <td style="font-size:0.84rem;">${itemsStr}</td>
          <td><strong>${Number(o.tongTien || 0).toLocaleString("vi-VN")} VNĐ</strong></td>
          <td>${badgeHtml}</td>
          <td>
            ${
              canDeliver
                ? `<button type="button" class="btn btn-primary btn-sm approve-deliver-btn" data-code="${o.maDon}">✓ Duyệt &amp; Giao</button>`
                : `Hoàn tất`
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

async function handleApproveAndDeliver(maDon) {
  const order = shopOrders.find((o) => o.maDon === maDon);
  if (!order || !order.buyer.deliveryToken) return;

  const deliveredItems = [];
  for (const item of order.danhSachMon || []) {
    const creds = stockVaultMap.get(item.id) || {
      loginUser: "Liên hệ Zalo 0911507170",
      loginPass: "—",
      guideNote: ""
    };
    deliveredItems.push({ id: item.id, title: item.title, ...creds });
  }

  await setDoc(
    doc(db, "shop_deliveries", order.buyer.deliveryToken),
    adminPayload({ maDon, items: deliveredItems, deliveredAtISO: new Date().toISOString() })
  );
  await updateDoc(doc(db, "shop_orders", maDon), adminPayload({ paymentStatus: "Paid_Delivered" }));
  showToast(`Đã duyệt & giao đơn ${maDon}!`);
  await loadAllDashboardData();
}

function renderOrdersTable() {
  const filterVal = document.getElementById("filter-order-status").value;
  const tbody = document.getElementById("orders-tbody");
  const list = filterVal === "all" ? orders : orders.filter((o) => o.status === filterVal);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có đơn đặt lịch.</td></tr>`;
    return;
  }

  const statuses = ["Pending", "Confirmed", "Paid", "In Progress", "Completed", "Cancelled"];
  tbody.innerHTML = list
    .map((o) => {
      const st = ORDER_STATUS_META[o.status] || { label: o.status, css: "status-pending" };
      return `
        <tr>
          <td><strong>${o.bookingCode}</strong></td>
          <td><strong>${o.pii.customerName}</strong><br/><span style="color:var(--tac-cyan); font-size:0.82rem;">Discord: ${o.pii.discordId}</span></td>
          <td><strong>${o.packageName}</strong><br/><span style="font-size:0.8rem; color:var(--text-muted);">${o.gameMode} • ${o.mapName}</span></td>
          <td>${o.playDate} <strong>${o.startTime}</strong> (${o.duration}p)</td>
          <td>${formatCurrencyVND(o.price, o.isCustomPrice)}</td>
          <td><span class="status-pill ${st.css}">${o.status}</span></td>
          <td>
            <select class="order-status-select" data-code="${o.bookingCode}" style="background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:5px 8px; font-size:0.82rem;">
              ${statuses.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
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
        <td><strong>${p.name}</strong></td>
        <td>${p.durationLabel || `${p.durationMinutes} phút`}</td>
        <td>${(p.modes || []).join(", ")}</td>
        <td><strong style="color: var(--tac-green);">${formatCurrencyVND(p.price, p.isCustomPrice)}</strong></td>
        <td>${p.visible !== false ? "Hiện" : "Ẩn"}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-outline btn-sm edit-pkg-btn" data-id="${p.id}">Sửa</button>
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
  blockedEl.innerHTML = blocked.length
    ? blocked
        .map(
          (slot) =>
            `<span class="pkg-chip" style="color:#fca5a5;">🔒 ${slot.replace("|", " ")} <button type="button" class="unblock-btn" data-slot="${slot}" style="background:none;border:none;color:#fff;cursor:pointer;">✕</button></span>`
        )
        .join("")
    : `<span style="font-size:0.85rem; color:var(--text-muted);">Chưa có khung giờ khóa bận.</span>`;

  document.getElementById("maps-tbody").innerHTML = maps
    .map(
      (m) => `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.mode}</td>
        <td>${m.active !== false ? "Hoạt động" : "Đã ẩn"}</td>
        <td><button type="button" class="btn btn-outline btn-sm toggle-map-btn" data-id="${m.id}">${
        m.active !== false ? "Ẩn" : "Bật"
      }</button></td>
      </tr>
    `
    )
    .join("");
}

function renderReviewsTable() {
  const tbody = document.getElementById("reviews-tbody");
  tbody.innerHTML = reviews.length
    ? reviews
        .map(
          (r) => `
        <tr>
          <td><strong>${r.bookingCode}</strong></td>
          <td>${r.maskedName}</td>
          <td>${Number(r.averageRating || 5).toFixed(1)} ★</td>
          <td>${r.comment}</td>
          <td>${r.visible !== false ? "Hiện" : "Ẩn"}</td>
          <td><button type="button" class="btn btn-outline btn-sm toggle-rev-btn" data-id="${r.id}">${
            r.visible !== false ? "Ẩn" : "Hiện"
          }</button></td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Chưa có đánh giá.</td></tr>`;
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

  // Duyệt Nạp tiền & Chỉnh số dư thành viên
  document.getElementById("refresh-topups-btn").addEventListener("click", loadAllDashboardData);
  document.getElementById("topups-tbody").addEventListener("click", async (e) => {
    const appBtn = e.target.closest(".approve-topup-btn");
    if (appBtn) {
      await handleApproveTopup(appBtn.dataset.code);
      return;
    }
    const rejBtn = e.target.closest(".reject-topup-btn");
    if (rejBtn) {
      await updateDoc(doc(db, "wallet_topups", rejBtn.dataset.code), adminPayload({ status: "Rejected" }));
      showToast("Đã từ chối yêu cầu nạp.");
      await loadAllDashboardData();
    }
  });

  document.getElementById("members-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".adjust-bal-btn");
    if (btn) await handleManualBalanceAdjust(btn.dataset.uid);
  });

  // Kho Account & Két Mật Khẩu tự động
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
      await updateDoc(doc(db, "shop_accounts", delBtn.dataset.id), adminPayload({ deleted: true, visible: false }));
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

    if (loginUser && loginPass) {
      // 1. Ghi vào shop_account_secrets/{id} (chỉ mở khóa cho đúng buyerUid đã trừ tiền ví hợp lệ!)
      await setDoc(
        doc(db, "shop_account_secrets", id),
        adminPayload({ loginUser, loginPass, guideNote })
      );
      // 2. Ghi bản mã hóa RSA vào shop_vault_stock/{id} để hiển thị trên bảng Admin
      if (vaultDocData?.publicKeyJwk) {
        const encryptedCredentials = await encryptCustomerPii(vaultDocData.publicKeyJwk, {
          loginUser,
          loginPass,
          guideNote
        });
        await setDoc(doc(db, "shop_vault_stock", id), adminPayload({ encryptedCredentials }));
      }
    }

    document.getElementById("acc-stock-form").hidden = true;
    showToast(`Đã lưu Account #${id} & sẵn sàng nhả Acc tự động 24/7!`);
    await loadAllDashboardData();
  });

  // Đơn lẻ & các tab khác
  document.getElementById("refresh-shop-orders-btn").addEventListener("click", loadAllDashboardData);
  document.getElementById("shop-orders-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".approve-deliver-btn");
    if (btn) await handleApproveAndDeliver(btn.dataset.code);
  });

  document.getElementById("filter-order-status").addEventListener("change", renderOrdersTable);
  document.getElementById("refresh-orders-btn").addEventListener("click", loadAllDashboardData);
  document.getElementById("orders-tbody").addEventListener("change", async (e) => {
    const sel = e.target.closest(".order-status-select");
    if (!sel) return;
    await updateDoc(doc(db, "gc_orders", sel.dataset.code), adminPayload({ status: sel.value }));
    showToast("Đã cập nhật trạng thái lịch chơi.");
    await loadAllDashboardData();
  });

  document.getElementById("new-pkg-btn").addEventListener("click", () => {
    document.getElementById("pkg-form").reset();
    document.getElementById("p-id").value = "";
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
      document.getElementById("pkg-form").hidden = false;
      return;
    }
    const delBtn = e.target.closest(".del-pkg-btn");
    if (delBtn) {
      await updateDoc(doc(db, "gc_packages", delBtn.dataset.id), adminPayload({ deleted: true, visible: false }));
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
    await setDoc(
      doc(db, "gc_packages", id),
      adminPayload({
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
      }),
      { merge: true }
    );
    document.getElementById("pkg-form").hidden = true;
    await loadAllDashboardData();
  });

  document.getElementById("schedule-config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    scheduleConfig.openHour = Number(document.getElementById("cfg-open").value);
    scheduleConfig.closeHour = Number(document.getElementById("cfg-close").value);
    scheduleConfig.discordInviteUrl = document.getElementById("cfg-discord").value.trim();
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
    showToast("Đã lưu cấu hình!");
  });

  document.getElementById("add-block-btn").addEventListener("click", async () => {
    const d = document.getElementById("block-date").value;
    const t = document.getElementById("block-time").value;
    if (!d || !t) return;
    scheduleConfig.blockedSlots = Array.from(new Set([...(scheduleConfig.blockedSlots || []), `${d}|${t}`]));
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
    renderScheduleAndMaps();
  });
  document.getElementById("blocked-slots-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".unblock-btn");
    if (!btn) return;
    scheduleConfig.blockedSlots = (scheduleConfig.blockedSlots || []).filter((s) => s !== btn.dataset.slot);
    await setDoc(doc(db, "gc_config", "schedule"), adminPayload(scheduleConfig));
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
    await loadAllDashboardData();
  });
  document.getElementById("maps-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".toggle-map-btn");
    if (!btn) return;
    const m = maps.find((x) => x.id === btn.dataset.id);
    if (!m) return;
    await updateDoc(doc(db, "gc_maps", m.id), adminPayload({ active: m.active === false }));
    await loadAllDashboardData();
  });
  document.getElementById("reviews-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".toggle-rev-btn");
    if (!btn) return;
    const r = reviews.find((x) => x.id === btn.dataset.id);
    if (!r) return;
    await updateDoc(doc(db, "gc_reviews", r.id), adminPayload({ visible: r.visible === false }));
    await loadAllDashboardData();
  });
});
