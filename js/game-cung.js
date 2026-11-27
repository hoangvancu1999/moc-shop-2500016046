import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  serverTimestamp
} from "./gc-firebase.js";
import {
  DEFAULT_PACKAGES,
  DEFAULT_MAPS,
  DEFAULT_SCHEDULE_CONFIG,
  ORDER_STATUS_META,
  formatCurrencyVND
} from "./gc-defaults.js";
import { encryptCustomerPii, maskDisplayName } from "./gc-crypto.js";

let packages = [...DEFAULT_PACKAGES];
let maps = [...DEFAULT_MAPS];
let scheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG };
let existingOrders = [];
let publicKeyJwk = null;

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHMM(totalMin) {
  const h = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const m = String(totalMin % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function buildTimeSlotOptions() {
  const slots = [];
  const start = (scheduleConfig.openHour ?? 8) * 60;
  const end = (scheduleConfig.closeHour ?? 23) * 60;
  const step = scheduleConfig.slotIntervalMinutes || 30;
  for (let t = start; t <= end - step; t += step) {
    slots.push(minutesToHHMM(t));
  }
  return slots;
}

// Kiểm tra khung giờ [date, startTime, durationMinutes] có trống không
function checkSlotAvailability(dateStr, startTimeStr, durationMin) {
  if (!dateStr || !startTimeStr) {
    return { available: false, pendingInput: true, message: "Hãy chọn Ngày chơi và Giờ bắt đầu để kiểm tra lịch trống." };
  }

  const startMin = parseTimeToMinutes(startTimeStr);
  const dur = Number(durationMin || 60);
  const endMin = startMin + dur;
  const step = scheduleConfig.slotIntervalMinutes || 30;

  // Kiểm tra các khung giờ Admin đã khóa bận thủ công
  const blockedSet = new Set(scheduleConfig.blockedSlots || []);
  for (let t = startMin; t < endMin; t += step) {
    const key = `${dateStr}|${minutesToHHMM(t)}`;
    if (blockedSet.has(key)) {
      return {
        available: false,
        pendingInput: false,
        message: `✕ Khung giờ ${minutesToHHMM(t)} ngày ${dateStr} đã được Admin khóa lịch bận. Vui lòng chọn khung giờ khác.`
      };
    }
  }

  // Kiểm tra trùng với các đơn đang hoạt động (khác Cancelled)
  for (const ord of existingOrders) {
    if (ord.status === "Cancelled" || ord.playDate !== dateStr) continue;
    const oStart = parseTimeToMinutes(ord.startTime);
    const oEnd = oStart + Number(ord.duration || 60);
    if (startMin < oEnd && endMin > oStart) {
      return {
        available: false,
        pendingInput: false,
        message: `✕ Khung giờ ${startTimeStr} – ${minutesToHHMM(endMin)} ngày ${dateStr} đã có người đặt (${ord.startTime} – ${minutesToHHMM(oEnd)}). Vui lòng chọn giờ khác.`
      };
    }
  }

  return {
    available: true,
    pendingInput: false,
    message: `✓ Khung giờ ${startTimeStr} – ${minutesToHHMM(endMin)} ngày ${dateStr} hiện đang TRỐNG. Bạn có thể gửi yêu cầu đặt lịch!`
  };
}

async function loadInitialData() {
  try {
    const [pkgSnap, mapSnap, cfgSnap, ordSnap, vaultSnap] = await Promise.all([
      getDocs(collection(db, "gc_packages")),
      getDocs(collection(db, "gc_maps")),
      getDoc(doc(db, "gc_config", "schedule")),
      getDocs(collection(db, "gc_orders")),
      getDoc(doc(db, "gc_secrets", "vault"))
    ]);

    if (!pkgSnap.empty) {
      const loadedPkgs = [];
      pkgSnap.forEach((d) => {
        const data = d.data();
        if (!data.deleted) loadedPkgs.push({ id: d.id, ...data });
      });
      loadedPkgs.sort((a, b) => (a.order || 99) - (b.order || 99));
      if (loadedPkgs.length > 0) packages = loadedPkgs;
    }

    if (!mapSnap.empty) {
      const loadedMaps = [];
      mapSnap.forEach((d) => {
        const data = d.data();
        if (!data.deleted) loadedMaps.push({ id: d.id, ...data });
      });
      if (loadedMaps.length > 0) maps = loadedMaps;
    }

    if (cfgSnap.exists()) {
      scheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, ...cfgSnap.data() };
    }

    existingOrders = [];
    ordSnap.forEach((d) => existingOrders.push({ bookingCode: d.id, ...d.data() }));

    if (vaultSnap.exists() && vaultSnap.data().publicKeyJwk) {
      publicKeyJwk = vaultSnap.data().publicKeyJwk;
    }
  } catch (err) {
    console.warn("Sử dụng dữ liệu mặc định do chưa đồng bộ từ Firestore:", err);
  }

  if (scheduleConfig.discordInviteUrl) {
    const linkEl = document.getElementById("discord-join-link");
    if (linkEl) linkEl.href = scheduleConfig.discordInviteUrl;
  }
}

function populateSelectControls() {
  const slots = buildTimeSlotOptions();
  const fTime = document.getElementById("f-time");
  const bTime = document.getElementById("b-time");
  const fDate = document.getElementById("f-date");
  const bDate = document.getElementById("b-date");

  const minDate = todayISO();
  fDate.min = minDate;
  bDate.min = minDate;
  bDate.value = minDate;

  fTime.innerHTML = `<option value="">Chọn giờ...</option>` + slots.map((s) => `<option value="${s}">${s}</option>`).join("");
  bTime.innerHTML = slots.map((s) => `<option value="${s}">${s}</option>`).join("");
  if (slots.includes("20:00")) bTime.value = "20:00";

  populateFilterMaps("all");
  populateBookingMaps(document.getElementById("b-mode").value);
  populateBookingPackages();
}

function getActiveMaps(modeFilter = "all") {
  return maps.filter((m) => m.active !== false && (modeFilter === "all" || m.mode === modeFilter));
}

function populateFilterMaps(mode) {
  const fMap = document.getElementById("f-map");
  const current = fMap.value;
  const active = getActiveMaps(mode);
  fMap.innerHTML =
    `<option value="all">Tất cả bản đồ (${active.length})</option>` +
    active.map((m) => `<option value="${m.id}">${m.name} (${m.mode})</option>`).join("");
  if (active.some((m) => m.id === current)) fMap.value = current;
}

function populateBookingMaps(mode) {
  const bMap = document.getElementById("b-map");
  const active = getActiveMaps(mode);
  bMap.innerHTML = active.map((m) => `<option value="${m.name}">${m.name}</option>`).join("");
}

function populateBookingPackages() {
  const bPkg = document.getElementById("b-package");
  const visiblePkgs = packages.filter((p) => p.visible !== false);
  bPkg.innerHTML = visiblePkgs
    .map((p) => `<option value="${p.id}">${p.name} — ${formatCurrencyVND(p.price, p.isCustomPrice)}</option>`)
    .join("");
}

function renderPackages() {
  const mode = document.getElementById("f-mode").value;
  const mapId = document.getElementById("f-map").value;
  const duration = document.getElementById("f-duration").value;
  const format = document.getElementById("f-format").value;
  const level = document.getElementById("f-level").value;
  const dateVal = document.getElementById("f-date").value;
  const timeVal = document.getElementById("f-time").value;

  // Nếu chọn bản đồ cụ thể, lấy mode của bản đồ đó để đối chiếu với gói
  const selectedMapObj = mapId !== "all" ? maps.find((m) => m.id === mapId) : null;

  const filtered = packages.filter((pkg) => {
    if (pkg.visible === false) return false;
    if (mode !== "all" && Array.isArray(pkg.modes) && !pkg.modes.includes(mode)) return false;
    if (selectedMapObj && Array.isArray(pkg.modes) && !pkg.modes.includes(selectedMapObj.mode)) return false;
    if (duration !== "all") {
      const durNum = Number(duration);
      const allowed = Array.isArray(pkg.allowedDurations) ? pkg.allowedDurations : [pkg.durationMinutes];
      if (!allowed.includes(durNum)) return false;
    }
    if (format !== "all" && Array.isArray(pkg.formats) && !pkg.formats.includes(format)) return false;
    if (level !== "all" && Array.isArray(pkg.levels) && !pkg.levels.includes(level)) return false;
    return true;
  });

  // Hiển thị trạng thái kiểm tra khung giờ trên thanh lọc nếu người dùng chọn ngày + giờ
  const slotBanner = document.getElementById("filter-slot-banner");
  if (dateVal && timeVal) {
    const checkDur = duration !== "all" ? Number(duration) : 60;
    const res = checkSlotAvailability(dateVal, timeVal, checkDur);
    slotBanner.hidden = false;
    slotBanner.className = `slot-status-box ${res.available ? "slot-ok" : "slot-busy"}`;
    slotBanner.textContent = res.message;
  } else {
    slotBanner.hidden = true;
  }

  const gridEl = document.getElementById("package-grid");
  const emptyEl = document.getElementById("package-empty");

  if (filtered.length === 0) {
    gridEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  gridEl.innerHTML = filtered
    .map(
      (pkg) => `
      <article class="pkg-card">
        <div class="pkg-top">
          <span class="pkg-duration">⏱ ${pkg.durationLabel || `${pkg.durationMinutes} phút`}</span>
          <span class="pkg-badge">${pkg.badge || pkg.audience}</span>
        </div>
        <h3 class="pkg-title">${pkg.name}</h3>
        <p class="pkg-desc">${pkg.description}</p>
        <div class="pkg-meta">
          <span class="pkg-chip">Đối tượng: ${pkg.audience}</span>
          ${(pkg.modes || []).map((m) => `<span class="pkg-chip">${m}</span>`).join("")}
        </div>
        <div class="pkg-bottom">
          <span class="pkg-price">${formatCurrencyVND(pkg.price, pkg.isCustomPrice)}</span>
          <button type="button" class="btn btn-primary btn-sm select-pkg-btn" data-id="${pkg.id}">
            Chọn gói &amp; Đặt lịch
          </button>
        </div>
      </article>
    `
    )
    .join("");
}

function updateBookingSlotCheckUI() {
  const dateVal = document.getElementById("b-date").value;
  const timeVal = document.getElementById("b-time").value;
  const durVal = document.getElementById("b-duration").value;
  const box = document.getElementById("booking-slot-check");

  const res = checkSlotAvailability(dateVal, timeVal, durVal);
  box.className = `slot-status-box ${res.pendingInput ? "" : res.available ? "slot-ok" : "slot-busy"}`;
  box.textContent = res.message;
  return res;
}

function selectPackageForBooking(pkgId) {
  const pkg = packages.find((p) => p.id === pkgId);
  if (!pkg) return;

  const bPkg = document.getElementById("b-package");
  bPkg.value = pkg.id;

  if (pkg.durationMinutes && [30, 60, 90, 120].includes(Number(pkg.durationMinutes))) {
    document.getElementById("b-duration").value = String(pkg.durationMinutes);
  }

  // Đồng bộ các bộ lọc người dùng đã chọn sang form đặt lịch
  const fMode = document.getElementById("f-mode").value;
  if (fMode !== "all") {
    document.getElementById("b-mode").value = fMode;
  } else if (Array.isArray(pkg.modes) && pkg.modes.length === 1) {
    document.getElementById("b-mode").value = pkg.modes[0];
  }
  populateBookingMaps(document.getElementById("b-mode").value);

  const fMap = document.getElementById("f-map").value;
  if (fMap !== "all") {
    const mapObj = maps.find((m) => m.id === fMap);
    if (mapObj) {
      document.getElementById("b-mode").value = mapObj.mode;
      populateBookingMaps(mapObj.mode);
      document.getElementById("b-map").value = mapObj.name;
    }
  }

  const fDate = document.getElementById("f-date").value;
  if (fDate) document.getElementById("b-date").value = fDate;

  const fTime = document.getElementById("f-time").value;
  if (fTime) document.getElementById("b-time").value = fTime;

  const fFormat = document.getElementById("f-format").value;
  if (fFormat !== "all") document.getElementById("b-format").value = fFormat;

  const fLevel = document.getElementById("f-level").value;
  if (fLevel !== "all") document.getElementById("b-level").value = fLevel;

  updateBookingSlotCheckUI();
  document.getElementById("dat-lich").scrollIntoView({ behavior: "smooth" });
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("booking-error");
  const okEl = document.getElementById("booking-success");
  const submitBtn = document.getElementById("submit-booking-btn");

  errEl.hidden = true;
  okEl.hidden = true;

  const customerName = document.getElementById("b-name").value.trim();
  const discordId = document.getElementById("b-discord").value.trim();
  const gameId = document.getElementById("b-gameid").value.trim();
  const pkgId = document.getElementById("b-package").value;
  const gameMode = document.getElementById("b-mode").value;
  const mapName = document.getElementById("b-map").value;
  const playDate = document.getElementById("b-date").value;
  const startTime = document.getElementById("b-time").value;
  const duration = Number(document.getElementById("b-duration").value || 60);
  const format = document.getElementById("b-format").value;
  const skillLevel = document.getElementById("b-level").value;
  const note = document.getElementById("b-note").value.trim();
  const consent = document.getElementById("b-rule-consent").checked;

  if (!customerName) {
    errEl.textContent = "Vui lòng nhập họ tên hoặc biệt danh của bạn.";
    errEl.hidden = false;
    return;
  }
  if (discordId.length < 2) {
    errEl.textContent = "Vui lòng nhập Discord ID hợp lệ để kết nối phòng Voice.";
    errEl.hidden = false;
    return;
  }
  if (!playDate || !startTime) {
    errEl.textContent = "Vui lòng chọn đầy đủ Ngày chơi và Giờ bắt đầu.";
    errEl.hidden = false;
    return;
  }
  if (!consent) {
    errEl.textContent = "Vui lòng tick đồng ý với Quy tắc hoạt động trước khi đặt lịch.";
    errEl.hidden = false;
    return;
  }

  // Kiểm tra lại lịch trống mới nhất từ Firestore trước khi lưu (Bước 4)
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang kiểm tra lịch trống & gửi yêu cầu...";

  try {
    const freshSnap = await getDocs(collection(db, "gc_orders"));
    existingOrders = [];
    freshSnap.forEach((d) => existingOrders.push({ bookingCode: d.id, ...d.data() }));

    const slotRes = checkSlotAvailability(playDate, startTime, duration);
    updateBookingSlotCheckUI();
    if (!slotRes.available) {
      errEl.textContent = slotRes.message;
      errEl.hidden = false;
      return;
    }

    const pkg = packages.find((p) => p.id === pkgId) || packages[0];
    const bookingCode = `GC-${Math.floor(100000 + Math.random() * 900000)}`;

    let encryptedPii = null;
    if (publicKeyJwk) {
      encryptedPii = await encryptCustomerPii(publicKeyJwk, {
        customerName,
        discordId,
        gameId,
        note
      });
    } else {
      // Dự phòng nếu Admin chưa khởi tạo vault lần đầu: cất vào collection riêng tư cấm đọc công khai
      await setDoc(doc(db, "gc_orders_private", bookingCode), {
        customerName,
        discordId,
        gameId,
        note,
        createdAt: serverTimestamp()
      });
    }

    const orderDoc = {
      bookingCode,
      packageId: pkg.id,
      packageName: pkg.name,
      price: pkg.isCustomPrice ? 0 : Number(pkg.price || 0),
      isCustomPrice: Boolean(pkg.isCustomPrice),
      gameMode,
      mapName,
      playDate,
      startTime,
      duration,
      format,
      skillLevel,
      maskedCustomer: maskDisplayName(customerName),
      encryptedPii,
      status: "Pending", // Quy tắc bắt buộc: Chờ Admin kiểm tra và xác nhận
      reviewed: false,
      createdAt: serverTimestamp(),
      createdAtISO: new Date().toISOString()
    };

    await setDoc(doc(db, "gc_orders", bookingCode), orderDoc);
    existingOrders.push(orderDoc);

    document.getElementById("booking-form").reset();
    document.getElementById("b-date").value = playDate;
    populateBookingMaps(document.getElementById("b-mode").value);
    updateBookingSlotCheckUI();

    okEl.innerHTML = `
      <strong>✓ Đã gửi yêu cầu đặt lịch thành công!</strong><br/>
      Mã lịch hẹn của bạn: <strong style="color: #fff; font-size: 1.05rem;">${bookingCode}</strong> —
      Trạng thái hiện tại: <span class="status-pill status-pending">Pending – Chờ xác nhận</span>.<br/>
      Bước tiếp theo: Hãy lưu lại mã <strong>${bookingCode}</strong> và tham gia <a href="#discord" style="color: #6ee7b7; font-weight:700;">Discord bên dưới</a> để nhận thông báo khi Admin xác nhận lịch!
    `;
    okEl.hidden = false;
    document.getElementById("lookup-code-input").value = bookingCode;
  } catch (err) {
    console.error("Lỗi đặt lịch Game Cùng:", err);
    errEl.textContent = "Không thể gửi yêu cầu đặt lịch lúc này. Vui lòng thử lại hoặc liên hệ Zalo 0911507170.";
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Kiểm tra lịch & Gửi yêu cầu đặt lịch";
  }
}

async function handleLookupOrder() {
  const codeInput = document.getElementById("lookup-code-input");
  const resultEl = document.getElementById("lookup-result");
  const reviewCard = document.getElementById("review-form-card");
  const code = codeInput.value.trim().toUpperCase();

  if (!code) return;
  resultEl.hidden = false;
  resultEl.innerHTML = `<span style="color: var(--text-muted);">Đang tra cứu mã ${code}...</span>`;

  try {
    const snap = await getDoc(doc(db, "gc_orders", code));
    if (!snap.exists()) {
      resultEl.innerHTML = `<div class="alert-msg alert-error">Không tìm thấy mã đặt lịch <strong>${code}</strong>.</div>`;
      reviewCard.hidden = true;
      return;
    }

    const ord = snap.data();
    const st = ORDER_STATUS_META[ord.status] || { label: ord.status, css: "status-pending" };

    let actionHint = "";
    if (ord.status === "Pending") {
      actionHint = "Admin đang kiểm tra lịch trống. Vui lòng chờ xác nhận trước khi vào ca chơi.";
    } else if (ord.status === "Confirmed" || ord.status === "Paid" || ord.status === "In Progress") {
      actionHint = "Lịch của bạn đã được xác nhận! Hãy mở mục Discord bên dưới để vào phòng Voice trước 10 phút.";
    } else if (ord.status === "Completed" && !ord.reviewed) {
      actionHint = "🎉 Buổi chơi đã hoàn thành! Form đánh giá 5 sao phía dưới đã được mở khóa cho mã đơn của bạn.";
    } else if (ord.status === "Completed" && ord.reviewed) {
      actionHint = "Cảm ơn bạn đã gửi đánh giá xác thực cho buổi chơi này!";
    }

    resultEl.innerHTML = `
      <div class="channel-box" style="display: grid; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>${ord.bookingCode}</strong>
          <span class="status-pill ${st.css}">${ord.status} – ${st.label}</span>
        </div>
        <div style="font-size: 0.88rem; color: var(--text-muted);">
          ${ord.packageName} • ${ord.gameMode} (${ord.mapName})<br/>
          Lịch hẹn: <strong>${ord.playDate} lúc ${ord.startTime}</strong> (${ord.duration} phút)
        </div>
        ${actionHint ? `<div style="font-size: 0.85rem; color: var(--tac-green);">${actionHint}</div>` : ""}
      </div>
    `;

    if (ord.status === "Completed" && !ord.reviewed) {
      document.getElementById("r-booking-code").value = ord.bookingCode;
      document.getElementById("review-order-label").textContent = `${ord.bookingCode} (${ord.packageName})`;
      reviewCard.hidden = false;
      reviewCard.scrollIntoView({ behavior: "smooth" });
    } else {
      reviewCard.hidden = true;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="alert-msg alert-error">Lỗi tra cứu đơn. Vui lòng thử lại.</div>`;
  }
}

async function loadVerifiedReviews() {
  const listEl = document.getElementById("reviews-list");
  const emptyEl = document.getElementById("reviews-empty");

  try {
    const snap = await getDocs(collection(db, "gc_reviews"));
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.verified === true && data.visible !== false && !data.deleted) {
        items.push({ id: d.id, ...data });
      }
    });

    items.sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));

    if (items.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = items
      .map((rv) => {
        const avg = Number(rv.averageRating || 5).toFixed(1);
        const stars = "★".repeat(Math.round(Number(rv.averageRating || 5)));
        return `
          <article class="review-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>${rv.maskedName || "Người chơi"}</strong>
              <span class="verified-tag">✓ Đơn hoàn thành (${rv.bookingCode})</span>
            </div>
            <div class="stars">${stars} <strong>${avg}/5</strong></div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">
              Đồng hành: ${rv.ratings?.companion}★ • Giao tiếp: ${rv.ratings?.comm}★ • Thái độ: ${rv.ratings?.attitude}★ • Đúng giờ: ${rv.ratings?.punctual}★ • Hài lòng: ${rv.ratings?.satisfaction}★
            </div>
            <p style="font-size: 0.92rem;">"${rv.comment}"</p>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${rv.packageName || "Game Cùng Delta Force"}</div>
          </article>
        `;
      })
      .join("");
  } catch (err) {
    console.warn("Không thể tải danh sách đánh giá:", err);
  }
}

async function handleReviewSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("review-msg");
  const btn = document.getElementById("submit-review-btn");
  const bookingCode = document.getElementById("r-booking-code").value.trim();
  const rawName = document.getElementById("r-display-name").value.trim();
  const comment = document.getElementById("r-comment").value.trim();

  const ratings = {
    companion: Number(document.getElementById("r-companion").value),
    comm: Number(document.getElementById("r-comm").value),
    attitude: Number(document.getElementById("r-attitude").value),
    punctual: Number(document.getElementById("r-punctual").value),
    satisfaction: Number(document.getElementById("r-satisfaction").value)
  };
  const averageRating =
    (ratings.companion + ratings.comm + ratings.attitude + ratings.punctual + ratings.satisfaction) / 5;

  if (!bookingCode || !comment) return;

  btn.disabled = true;
  btn.textContent = "Đang xác thực & gửi đánh giá...";
  msgEl.hidden = true;

  try {
    const ordSnap = await getDoc(doc(db, "gc_orders", bookingCode));
    if (!ordSnap.exists() || ordSnap.data().status !== "Completed") {
      throw new Error("Đơn hàng chưa ở trạng thái Hoàn thành (Completed).");
    }

    const ordData = ordSnap.data();
    await addDoc(collection(db, "gc_reviews"), {
      bookingCode,
      packageName: ordData.packageName,
      maskedName: maskDisplayName(rawName),
      ratings,
      averageRating,
      comment,
      verified: true,
      visible: true,
      createdAt: serverTimestamp(),
      createdAtISO: new Date().toISOString()
    });

    await updateDoc(doc(db, "gc_orders", bookingCode), { reviewed: true });

    msgEl.className = "alert-msg alert-success";
    msgEl.textContent = "✓ Cảm ơn bạn! Đánh giá xác thực của bạn đã được ghi nhận và hiển thị.";
    msgEl.hidden = false;
    document.getElementById("review-form").reset();
    await loadVerifiedReviews();
    setTimeout(() => {
      document.getElementById("review-form-card").hidden = true;
    }, 1800);
  } catch (err) {
    console.error("Lỗi gửi đánh giá:", err);
    msgEl.className = "alert-msg alert-error";
    msgEl.textContent = "Chỉ đơn hàng đã Hoàn thành (Completed) và chưa đánh giá mới được gửi nhận xét.";
    msgEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Gửi đánh giá xác thực";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadInitialData();
  populateSelectControls();
  renderPackages();
  updateBookingSlotCheckUI();
  await loadVerifiedReviews();

  // Sự kiện bộ lọc 6 tiêu chí
  document.getElementById("f-mode").addEventListener("change", (e) => {
    populateFilterMaps(e.target.value);
    renderPackages();
  });
  ["f-map", "f-duration", "f-format", "f-level", "f-date", "f-time"].forEach((id) => {
    document.getElementById(id).addEventListener("change", renderPackages);
  });

  document.getElementById("reset-filters-btn").addEventListener("click", () => {
    document.getElementById("f-mode").value = "all";
    populateFilterMaps("all");
    document.getElementById("f-duration").value = "all";
    document.getElementById("f-format").value = "all";
    document.getElementById("f-level").value = "all";
    document.getElementById("f-date").value = "";
    document.getElementById("f-time").value = "";
    renderPackages();
  });

  // Chọn gói từ card
  document.getElementById("package-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".select-pkg-btn");
    if (btn) selectPackageForBooking(btn.dataset.id);
  });

  // Sự kiện form đặt lịch
  document.getElementById("b-mode").addEventListener("change", (e) => {
    populateBookingMaps(e.target.value);
  });
  document.getElementById("b-package").addEventListener("change", (e) => {
    const pkg = packages.find((p) => p.id === e.target.value);
    if (pkg && [30, 60, 90, 120].includes(Number(pkg.durationMinutes))) {
      document.getElementById("b-duration").value = String(pkg.durationMinutes);
      updateBookingSlotCheckUI();
    }
  });
  ["b-date", "b-time", "b-duration"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateBookingSlotCheckUI);
  });

  document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);
  document.getElementById("lookup-btn").addEventListener("click", handleLookupOrder);
  document.getElementById("review-form").addEventListener("submit", handleReviewSubmit);
});
