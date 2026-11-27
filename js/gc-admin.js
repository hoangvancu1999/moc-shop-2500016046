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
  decryptCustomerPii
} from "./gc-crypto.js";

let adminToken = null;
let adminPrivateKey = null;
let isVaultInitialized = false;
let vaultDocData = null;

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
  }, 2600);
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
      document.getElementById("auth-heading").textContent = "Đăng Nhập Quản Trị Game Cùng";
      document.getElementById("auth-desc").textContent =
        "Nhập mật khẩu Quản trị để quản lý gói dịch vụ, xác nhận lịch và giải mã Discord ID khách hàng.";
      document.getElementById("admin-pass-confirm-wrap").hidden = true;
      document.getElementById("admin-login-btn").textContent = "Đăng nhập Quản trị";
    } else {
      isVaultInitialized = false;
      document.getElementById("auth-heading").textContent = "Khởi Tạo Mật Khẩu Quản Trị Lần Đầu";
      document.getElementById("auth-desc").textContent =
        "Tạo mật khẩu Quản trị (tối thiểu 6 ký tự) để sinh cặp khóa mã hóa bảo vệ Discord ID khách hàng trên Cloud Firestore.";
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
  const [pkgSnap, mapSnap, cfgSnap] = await Promise.all([
    getDocs(collection(db, "gc_packages")),
    getDocs(collection(db, "gc_maps")),
    getDoc(doc(db, "gc_config", "schedule"))
  ]);

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

  const [pkgSnap, mapSnap, cfgSnap, ordSnap, revSnap] = await Promise.all([
    getDocs(collection(db, "gc_packages")),
    getDocs(collection(db, "gc_maps")),
    getDoc(doc(db, "gc_config", "schedule")),
    getDocs(collection(db, "gc_orders")),
    getDocs(collection(db, "gc_reviews"))
  ]);

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
        // Đơn cũ tạo bằng khóa khác
      }
    } else if (auth.currentUser) {
      try {
        const privSnap = await getDoc(doc(db, "gc_orders_private", d.id));
        if (privSnap.exists()) pii = privSnap.data();
      } catch (e) {
        // Bỏ qua nếu không có
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
  renderOrdersTable();
  renderPackagesTable();
  renderScheduleAndMaps();
  renderCustomersTable();
  renderReviewsTable();
}

function renderKpis() {
  const pendingCount = orders.filter((o) => o.status === "Pending").length;
  const paidOrders = orders.filter((o) => o.status === "Paid" || o.status === "Completed");
  const activeOrders = orders.filter((o) =>
    ["Confirmed", "Paid", "In Progress", "Completed"].includes(o.status)
  );

  const revenue = paidOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);
  const totalMinutes = activeOrders.reduce((sum, o) => sum + Number(o.duration || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1).replace(/\.0$/, "");

  const pkgCounter = {};
  orders
    .filter((o) => o.status !== "Cancelled")
    .forEach((o) => {
      const key = o.packageName || o.packageId;
      pkgCounter[key] = (pkgCounter[key] || 0) + 1;
    });

  let topPkgText = "Chưa có đơn";
  let maxCount = 0;
  for (const [name, cnt] of Object.entries(pkgCounter)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      topPkgText = `${name} (${cnt} đơn)`;
    }
  }

  document.getElementById("kpi-pending").textContent = String(pendingCount);
  document.getElementById("kpi-revenue").textContent = `${revenue.toLocaleString("vi-VN")} VNĐ`;
  document.getElementById("kpi-hours").textContent = `${totalHours} giờ`;
  document.getElementById("kpi-top-pkg").textContent = topPkgText;
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
            <div style="display: flex; gap: 6px; align-items: center;">
              <select class="order-status-select" data-code="${o.bookingCode}" style="background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font-size: 0.82rem;">
                ${statuses
                  .map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s} (${ORDER_STATUS_META[s].label})</option>`)
                  .join("")}
              </select>
            </div>
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
  const byDiscord = new Map();

  orders.forEach((o) => {
    const key = o.pii.discordId || o.bookingCode;
    const prev = byDiscord.get(key) || {
      name: o.pii.customerName,
      discordId: o.pii.discordId,
      gameId: o.pii.gameId || "—",
      count: 0,
      spent: 0,
      lastDate: o.playDate
    };
    prev.count += 1;
    if (o.status === "Paid" || o.status === "Completed") {
      prev.spent += Number(o.price || 0);
    }
    if (o.playDate > prev.lastDate) prev.lastDate = o.playDate;
    byDiscord.set(key, prev);
  });

  const list = Array.from(byDiscord.values());
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có dữ liệu khách hàng.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td style="color: var(--tac-cyan);">${c.discordId}</td>
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
