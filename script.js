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
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
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
const auth = getAuth(firebaseApp);
auth.languageCode = "vi";

const CART_KEY = "hcugaming_cart";
const RECEIPTS_KEY = "hcugaming_receipts";
const MEMBER_EMAIL_DOMAIN = "member.hcugaming.web.app";

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

// Trạng thái Thành viên & Ví số dư
let authMode = "login"; // "login" | "register" | "forgot"
let currentMember = null; // { uid, username, balance, totalDeposited }
let memberDocUnsub = null;
let activeTopupCode = null;
let pendingBuyAccId = null;
let isRegisteringMember = false;

function formatVND(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")}đ`;
}

function usernameToInternalEmail(username) {
  return `${username.trim().toLowerCase()}@${MEMBER_EMAIL_DOMAIN}`;
}

function extractUsernameFromEmail(email) {
  if (!email) return "user";
  return email.split("@")[0];
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
    // Bỏ qua
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
  }, 2800);
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
  document.querySelectorAll(".tab-btn[data-game]").forEach((btn) => {
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
              <button type="button" class="btn ${isSold ? "btn-outline" : "btn-cyan"} btn-sm buy-acc-btn" data-id="${acc.id}" ${isSold ? "disabled" : ""}>
                ${isSold ? "Đã bán" : "⚡ Mua ngay"}
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

// === ĐĂNG KÝ, ĐĂNG NHẬP & QUÊN MẬT KHẨU QUA EMAIL ===
function openAuthModal(mode = "login") {
  setAuthMode(mode);
  document.getElementById("member-auth-error").hidden = true;
  document.getElementById("member-auth-success").hidden = true;
  document.getElementById("auth-overlay").hidden = false;
  document.getElementById("auth-modal").hidden = false;
}

function closeAuthModal() {
  document.getElementById("auth-overlay").hidden = true;
  document.getElementById("auth-modal").hidden = true;
}

function setAuthMode(mode) {
  authMode = mode; // "login" | "register" | "forgot"
  document.getElementById("tab-login-mode").classList.toggle("active", mode === "login");
  document.getElementById("tab-register-mode").classList.toggle("active", mode === "register");
  document.getElementById("tab-forgot-mode").classList.toggle("active", mode === "forgot");

  document.getElementById("member-auth-error").hidden = true;
  document.getElementById("member-auth-success").hidden = true;

  const userLabel = document.getElementById("m-username-label");
  const userInput = document.getElementById("m-username");
  const emailWrap = document.getElementById("m-email-wrap");
  const passWrap = document.getElementById("m-password-wrap");
  const confirmWrap = document.getElementById("m-confirm-wrap");
  const forgotQuick = document.getElementById("forgot-quick-link");
  const submitBtn = document.getElementById("member-auth-submit");

  if (mode === "login") {
    userLabel.innerHTML = `Tên tài khoản hoặc Email <span class="req">*</span>`;
    userInput.placeholder = "Ví dụ: vancudz hoặc email@gmail.com";
    emailWrap.hidden = true;
    passWrap.hidden = false;
    confirmWrap.hidden = true;
    forgotQuick.hidden = false;
    submitBtn.textContent = "Đăng nhập vào Shop";
  } else if (mode === "register") {
    userLabel.innerHTML = `Tên tài khoản (viết liền không dấu) <span class="req">*</span>`;
    userInput.placeholder = "Ví dụ: vancudz";
    emailWrap.hidden = false;
    passWrap.hidden = false;
    confirmWrap.hidden = false;
    forgotQuick.hidden = true;
    submitBtn.textContent = "Tạo tài khoản mới";
  } else {
    userLabel.innerHTML = `Nhập Email hoặc Tên tài khoản đã đăng ký <span class="req">*</span>`;
    userInput.placeholder = "Ví dụ: email@gmail.com hoặc vancudz";
    emailWrap.hidden = true;
    passWrap.hidden = true;
    confirmWrap.hidden = true;
    forgotQuick.hidden = true;
    submitBtn.textContent = "📧 Gửi link đặt lại mật khẩu về Email";
  }
}

function updateMemberHeaderUI() {
  const guestBtn = document.getElementById("open-auth-btn");
  const memberBar = document.getElementById("member-bar");

  if (!currentMember) {
    guestBtn.hidden = false;
    memberBar.hidden = true;
    return;
  }

  guestBtn.hidden = true;
  memberBar.hidden = false;
  document.getElementById("member-username").textContent = currentMember.username;
  document.getElementById("member-balance").textContent = formatVND(currentMember.balance);
  document.getElementById("topup-user-label").textContent = currentMember.username;
  document.getElementById("topup-balance-label").textContent = formatVND(currentMember.balance);
}

async function resolveIdentifierToEmail(identifier) {
  const clean = identifier.trim().toLowerCase();
  if (clean.includes("@")) {
    return { email: clean, isInternalFallback: clean.endsWith(`@${MEMBER_EMAIL_DOMAIN}`) };
  }
  // Tra cứu trong bảng usernames/{username}
  try {
    const uSnap = await getDoc(doc(db, "usernames", clean));
    if (uSnap.exists() && uSnap.data().email) {
      return { email: uSnap.data().email, isInternalFallback: false };
    }
  } catch (e) {
    // Bỏ qua
  }
  return { email: usernameToInternalEmail(clean), isInternalFallback: true };
}

async function handleMemberAuthSubmit(e) {
  e.preventDefault();
  const rawInput = document.getElementById("m-username").value.trim().toLowerCase();
  const rawEmail = document.getElementById("m-email").value.trim().toLowerCase();
  const pass = document.getElementById("m-password").value;
  const confirmPass = document.getElementById("m-confirm").value;
  const errEl = document.getElementById("member-auth-error");
  const okEl = document.getElementById("member-auth-success");
  const submitBtn = document.getElementById("member-auth-submit");

  errEl.hidden = true;
  okEl.hidden = true;

  // 1. Chế độ QUÊN MẬT KHẨU
  if (authMode === "forgot") {
    if (!rawInput) {
      errEl.textContent = "Vui lòng nhập Email hoặc Tên tài khoản của bạn.";
      errEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    try {
      const resolved = await resolveIdentifierToEmail(rawInput);
      if (resolved.isInternalFallback) {
        errEl.textContent =
          "Không tìm thấy Email khôi phục gắn với tên tài khoản này (hoặc tài khoản chưa được tạo). Vui lòng nhập đúng địa chỉ Email hoặc liên hệ Zalo Admin 0911507170.";
        errEl.hidden = false;
        return;
      }

      await sendPasswordResetEmail(auth, resolved.email);
      okEl.innerHTML = `✓ Đã gửi đường link đặt lại mật khẩu tới hộp thư <strong>${resolved.email}</strong>! Vui lòng kiểm tra Hộp thư đến (và cả mục Thư rác/Spam) rồi bấm vào link để tạo mật khẩu mới nhé.`;
      okEl.hidden = false;
    } catch (err) {
      console.error("Lỗi gửi mail đặt lại MK:", err);
      if (err.code === "auth/invalid-email") {
        errEl.textContent = "Địa chỉ Email không đúng định dạng.";
      } else {
        errEl.textContent = "Không thể gửi email khôi phục cho địa chỉ này. Vui lòng kiểm tra lại Email đã nhập.";
      }
      errEl.hidden = false;
    } finally {
      isRegisteringMember = false;
      submitBtn.disabled = false;
    }
    return;
  }

  // 2. Chế độ ĐĂNG KÝ MỚI
  if (authMode === "register") {
    if (!/^[a-z0-9_]{4,24}$/.test(rawInput)) {
      errEl.textContent = "Tên tài khoản chỉ gồm chữ thường, số hoặc dấu gạch dưới (4–24 ký tự).";
      errEl.hidden = false;
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      errEl.textContent = "Vui lòng nhập địa chỉ Email thật hợp lệ (ví dụ: tenban@gmail.com) để dùng khi quên mật khẩu.";
      errEl.hidden = false;
      return;
    }
    if (pass.length < 6) {
      errEl.textContent = "Mật khẩu phải có ít nhất 6 ký tự.";
      errEl.hidden = false;
      return;
    }
    if (pass !== confirmPass) {
      errEl.textContent = "Mật khẩu nhập lại không khớp.";
      errEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    isRegisteringMember = true;
    try {
      const existingUsername = await getDoc(doc(db, "usernames", rawInput));
      if (existingUsername.exists()) {
        errEl.textContent = "Tên tài khoản này đã có người đăng ký. Vui lòng chọn tên khác.";
        errEl.hidden = false;
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, rawEmail, pass);
      await Promise.all([
        setDoc(doc(db, "usernames", rawInput), {
          uid: cred.user.uid,
          username: rawInput,
          email: rawEmail,
          createdAtISO: new Date().toISOString()
        }),
        setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          username: rawInput,
          email: rawEmail,
          balance: 0,
          totalDeposited: 0,
          createdAt: serverTimestamp(),
          createdAtISO: new Date().toISOString()
        })
      ]);

      showToast(`🎉 Tạo tài khoản "${rawInput}" thành công!`);
      document.getElementById("member-auth-form").reset();
      closeAuthModal();

      if (pendingBuyAccId) {
        const targetId = pendingBuyAccId;
        pendingBuyAccId = null;
        setTimeout(() => openBuyNowModal(targetId), 350);
      }
    } catch (err) {
      console.error("Lỗi đăng ký:", err);
      if (err.code === "auth/email-already-in-use") {
        errEl.textContent = "Địa chỉ Email này đã được dùng cho một tài khoản khác. Bạn có thể bấm 'Quên MK' để lấy lại mật khẩu!";
      } else if (err.code === "auth/invalid-email") {
        errEl.textContent = "Địa chỉ Email không hợp lệ.";
      } else {
        errEl.textContent = "Không thể đăng ký lúc này, vui lòng thử lại.";
      }
      errEl.hidden = false;
    } finally {
      isRegisteringMember = false;
      submitBtn.disabled = false;
    }
    return;
  }

  // 3. Chế độ ĐĂNG NHẬP
  if (!rawInput || pass.length < 6) {
    errEl.textContent = "Vui lòng nhập đầy đủ Tên tài khoản/Email và Mật khẩu (tối thiểu 6 ký tự).";
    errEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  try {
    const resolved = await resolveIdentifierToEmail(rawInput);
    await signInWithEmailAndPassword(auth, resolved.email, pass);
    showToast("Đăng nhập thành công!");
    document.getElementById("member-auth-form").reset();
    closeAuthModal();

    if (pendingBuyAccId) {
      const targetId = pendingBuyAccId;
      pendingBuyAccId = null;
      setTimeout(() => openBuyNowModal(targetId), 350);
    }
  } catch (err) {
    console.error("Lỗi đăng nhập:", err);
    errEl.textContent = "Sai Tên tài khoản/Email hoặc Mật khẩu. Nếu quên mật khẩu, hãy bấm 'Quên mật khẩu?' nhé!";
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
}

// === NẠP TIỀN VÀO VÍ QUA VIETQR MB BANK ===
async function openTopupModal(prefillAmount = null) {
  if (!currentMember) {
    openAuthModal("login");
    showToast("Vui lòng đăng nhập tài khoản để nạp tiền vào ví!");
    return;
  }

  if (prefillAmount && prefillAmount >= 10000) {
    document.getElementById("topup-amount-input").value = prefillAmount;
  }
  document.getElementById("topup-step-select").hidden = false;
  document.getElementById("topup-qr-view").hidden = true;
  document.getElementById("topup-error").hidden = true;
  document.getElementById("topup-overlay").hidden = false;
  document.getElementById("topup-modal").hidden = false;
  await loadMemberTopupHistory();
}

function closeTopupModal() {
  document.getElementById("topup-overlay").hidden = true;
  document.getElementById("topup-modal").hidden = true;
}

async function handleCreateTopupQr() {
  if (!currentMember) return;
  const errEl = document.getElementById("topup-error");
  const amount = Math.round(Number(document.getElementById("topup-amount-input").value || 0));
  errEl.hidden = true;

  if (amount < 10000) {
    errEl.textContent = "Số tiền nạp tối thiểu là 10.000đ.";
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById("create-topup-qr-btn");
  btn.disabled = true;

  try {
    const topupCode = `NAP${Math.floor(100000 + Math.random() * 900000)}`;
    await setDoc(doc(db, "wallet_topups", topupCode), {
      topupCode,
      uid: currentMember.uid,
      username: currentMember.username,
      amount,
      status: "Pending",
      createdAt: serverTimestamp(),
      createdAtISO: new Date().toISOString()
    });

    activeTopupCode = topupCode;
    document.getElementById("topup-qr-img").src = buildVietQrUrl(amount, topupCode);
    document.getElementById("topup-qr-amt").textContent = formatVND(amount);
    document.getElementById("topup-qr-memo").textContent = topupCode;

    const repBtn = document.getElementById("topup-reported-btn");
    repBtn.disabled = false;
    repBtn.textContent = "✓ Tôi đã chuyển khoản";

    document.getElementById("topup-step-select").hidden = true;
    document.getElementById("topup-qr-view").hidden = false;
    await loadMemberTopupHistory();
  } catch (err) {
    console.error("Lỗi tạo lệnh nạp:", err);
    errEl.textContent = "Không thể tạo mã nạp lúc này, vui lòng thử lại.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function handleTopupReportedPaid() {
  if (!activeTopupCode) return;
  const repBtn = document.getElementById("topup-reported-btn");
  repBtn.disabled = true;
  try {
    await updateDoc(doc(db, "wallet_topups", activeTopupCode), { status: "Reported_Paid" });
    repBtn.textContent = "Đã báo Admin – Chờ cộng tiền...";
    showToast("Đã gửi thông báo nạp tiền! Số dư sẽ tự động cộng ngay khi Admin duyệt.");
    await loadMemberTopupHistory();
  } catch (err) {
    repBtn.disabled = false;
  }
}

async function loadMemberTopupHistory() {
  if (!currentMember) return;
  const listEl = document.getElementById("topup-history-list");
  try {
    const q = query(collection(db, "wallet_topups"), where("uid", "==", currentMember.uid));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach((d) => rows.push(d.data()));
    rows.sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));

    if (rows.length === 0) {
      listEl.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">Chưa có giao dịch nạp nào.</span>`;
      return;
    }

    listEl.innerHTML = rows
      .slice(0, 6)
      .map((r) => {
        const stLabel =
          r.status === "Approved"
            ? `<span style="color: var(--success); font-weight:700;">✓ Đã cộng</span>`
            : r.status === "Reported_Paid"
            ? `<span style="color: var(--gold);">⏳ Chờ duyệt</span>`
            : r.status === "Rejected"
            ? `<span style="color: var(--danger);">Đã hủy</span>`
            : `<span style="color: var(--text-muted);">Chờ CK</span>`;
        return `<div class="bank-row" style="font-size: 0.82rem; border-bottom: 1px solid var(--border); padding-bottom: 4px;">
          <span><strong>${r.topupCode}</strong> (${formatVND(r.amount)})</span>
          ${stLabel}
        </div>`;
      })
      .join("");
  } catch (e) {
    listEl.innerHTML = "";
  }
}

// === MUA ACCOUNT TỰ ĐỘNG TRỪ SỐ DƯ VÍ & MỞ KHÓA ACC TỨC THÌ ===
async function openBuyNowModal(accId) {
  await syncRemoteAccountsAndVault();
  const acc = catalogAccounts.find((a) => a.id === accId);
  if (!acc) return;

  if (acc.sold) {
    showToast("Tài khoản này vừa được bán!");
    renderAccounts();
    return;
  }

  if (!currentMember) {
    pendingBuyAccId = accId;
    openAuthModal("login");
    showToast("Hãy đăng nhập (hoặc đăng ký nhanh) để mua Acc bằng số dư ví!");
    return;
  }

  const bodyEl = document.getElementById("buy-now-body");
  const enough = currentMember.balance >= acc.price;
  const missing = Math.max(10000, acc.price - currentMember.balance);

  bodyEl.innerHTML = `
    <div class="bank-info-card">
      <div class="bank-row"><span>Mã Account:</span><strong class="neon-cyan">#${acc.id} (${acc.gameLabel})</strong></div>
      <div style="font-weight: 700; margin: 4px 0;">${acc.title}</div>
      <div class="bank-row"><span>Giá niêm yết:</span><strong class="neon-gold">${formatVND(acc.price)}</strong></div>
      <div class="bank-row"><span>Số dư ví của bạn:</span><strong>${formatVND(currentMember.balance)}</strong></div>
      ${
        enough
          ? `<div class="bank-row" style="border-top:1px dashed var(--border); padding-top:6px;">
               <span>Số dư còn lại sau mua:</span>
               <strong style="color: var(--success);">${formatVND(currentMember.balance - acc.price)}</strong>
             </div>`
          : `<div style="color: var(--danger); font-weight:700; margin-top:4px;">
               ⚠️ Số dư ví chưa đủ (cần nạp thêm ${formatVND(acc.price - currentMember.balance)}).
             </div>`
      }
    </div>
    <p id="buy-now-error" class="form-error" style="margin:0;" hidden></p>
    ${
      enough
        ? `<button type="button" id="confirm-wallet-buy-btn" class="btn btn-cyan btn-full">
             ⚡ Thanh toán ${formatVND(acc.price)} &amp; Nhận Tài Khoản Ngay
           </button>`
        : `<button type="button" id="go-topup-shortfall-btn" class="btn btn-gold btn-full">
             💰 Nạp thêm ${formatVND(missing)} qua VietQR ngay
           </button>`
    }
  `;

  document.getElementById("buy-now-overlay").hidden = false;
  document.getElementById("buy-now-modal").hidden = false;

  if (enough) {
    document.getElementById("confirm-wallet-buy-btn").addEventListener("click", () => {
      executeAtomicWalletPurchase(acc);
    });
  } else {
    document.getElementById("go-topup-shortfall-btn").addEventListener("click", () => {
      closeBuyNowModal();
      openTopupModal(missing);
    });
  }
}

function closeBuyNowModal() {
  document.getElementById("buy-now-overlay").hidden = true;
  document.getElementById("buy-now-modal").hidden = true;
}

async function executeAtomicWalletPurchase(acc) {
  const btn = document.getElementById("confirm-wallet-buy-btn");
  const errEl = document.getElementById("buy-now-error");
  btn.disabled = true;
  btn.textContent = "Đang trừ số dư & mở khóa tài khoản...";
  errEl.hidden = true;

  try {
    // Đảm bảo bản ghi shop_accounts/{acc.id} đã tồn tại trên Firestore trước khi chạy batch
    const accRef = doc(db, "shop_accounts", acc.id);
    const accSnap = await getDoc(accRef);
    if (!accSnap.exists()) {
      throw new Error("MISSING_CLOUD_STOCK");
    }
    if (accSnap.data().sold) {
      throw new Error("ALREADY_SOLD");
    }

    const userRef = doc(db, "users", currentMember.uid);
    const userSnap = await getDoc(userRef);
    const liveBalance = Number(userSnap.data()?.balance || 0);
    const price = Number(accSnap.data().price || acc.price);

    if (liveBalance < price) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    const purchaseId = `PUR-${Date.now()}-${acc.id}`;
    const batch = writeBatch(db);

    batch.update(userRef, {
      balance: liveBalance - price,
      lastPurchasedAccId: acc.id,
      updatedAtISO: new Date().toISOString()
    });

    batch.update(accRef, {
      sold: true,
      badge: "ĐÃ BÁN",
      buyerUid: currentMember.uid,
      soldAtISO: new Date().toISOString()
    });

    batch.set(doc(db, "user_purchases", purchaseId), {
      purchaseId,
      uid: currentMember.uid,
      username: currentMember.username,
      accId: acc.id,
      title: acc.title,
      price,
      createdAtISO: new Date().toISOString()
    });

    await batch.commit();

    // Đọc ngay Tài khoản + Mật khẩu từ két shop_account_secrets/{acc.id}
    let secretData = {
      loginUser: "Liên hệ Admin Zalo 0911507170 để nhận ngay (Chủ shop chưa gắn mật khẩu sẵn)",
      loginPass: "—",
      guideNote: "Đơn mua bằng số dư đã được ghi nhận thành công!"
    };
    const secretSnap = await getDoc(doc(db, "shop_account_secrets", acc.id));
    if (secretSnap.exists()) {
      secretData = secretSnap.data();
    }

    await syncRemoteAccountsAndVault();
    updateTabCounts();
    renderAccounts();

    document.getElementById("buy-now-body").innerHTML = `
      <div class="success-badge">🎉 MUA THÀNH CÔNG – TÀI KHOẢN ĐÃ MỞ KHÓA!</div>
      <div class="delivered-list">
        ${renderDeliveredCredentialsHTML([
          {
            id: acc.id,
            title: acc.title,
            loginUser: secretData.loginUser,
            loginPass: secretData.loginPass,
            guideNote: secretData.guideNote
          }
        ])}
      </div>
      <p style="font-size: 0.84rem; color: var(--gold);">
        📌 Tài khoản này cũng đã được lưu vĩnh viễn trong mục <strong>"🎒 Acc đã mua"</strong> của bạn!
      </p>
    `;
  } catch (err) {
    console.error("Lỗi mua bằng số dư:", err);
    if (err.message === "ALREADY_SOLD") {
      errEl.textContent = "Rất tiếc, tài khoản này vừa có người khác mua trước 1 giây.";
    } else if (err.message === "MISSING_CLOUD_STOCK") {
      errEl.textContent = "Tài khoản này đang chờ Admin đồng bộ kho lần đầu trong trang /admin.";
    } else {
      errEl.textContent = "Không thể hoàn tất giao dịch, vui lòng kiểm tra lại số dư và thử lại.";
    }
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = `⚡ Thanh toán ${formatVND(acc.price)} & Nhận Tài Khoản Ngay`;
  }
}

async function loadPurchasedBagModal() {
  const listEl = document.getElementById("purchased-accounts-list");
  if (!currentMember) {
    listEl.innerHTML = `<div style="font-size: 0.88rem; color: var(--text-muted);">Hãy đăng nhập tài khoản để xem các Account bạn đã mua.</div>`;
    return;
  }

  listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted);">Đang tải kho Acc đã mua của ${currentMember.username}...</div>`;
  try {
    const q = query(collection(db, "user_purchases"), where("uid", "==", currentMember.uid));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<div style="font-size: 0.88rem; color: var(--text-muted);">Bạn chưa mua Account nào bằng tài khoản <strong>${currentMember.username}</strong>.</div>`;
      return;
    }

    const items = [];
    for (const d of snap.docs) {
      const pur = d.data();
      let sec = { loginUser: "Liên hệ Zalo 0911507170", loginPass: "—", guideNote: "" };
      try {
        const sSnap = await getDoc(doc(db, "shop_account_secrets", pur.accId));
        if (sSnap.exists()) sec = sSnap.data();
      } catch (e) {
        // Bỏ qua
      }
      items.push({
        id: pur.accId,
        title: pur.title,
        loginUser: sec.loginUser,
        loginPass: sec.loginPass,
        guideNote: sec.guideNote
      });
    }

    listEl.innerHTML = renderDeliveredCredentialsHTML(items);
  } catch (err) {
    listEl.innerHTML = `<div class="form-error">Không thể tải danh sách lúc này.</div>`;
  }
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
      <button type="button" class="btn btn-cyan" id="modal-buy-btn" data-id="${acc.id}" ${isSold ? "disabled" : ""}>
        ${isSold ? "Tài khoản đã bán" : "⚡ Mua ngay bằng Số dư"}
      </button>
    </div>
  `;

  document.getElementById("detail-overlay").hidden = false;
  document.getElementById("detail-modal").hidden = false;

  if (!isSold) {
    document.getElementById("modal-buy-btn").addEventListener("click", () => {
      closeDetailModal();
      openBuyNowModal(acc.id);
    });
  }
}

function closeDetailModal() {
  document.getElementById("detail-overlay").hidden = true;
  document.getElementById("detail-modal").hidden = true;
}

// === GIỎ HÀNG DỊCH VỤ & ĐẶT ĐƠN VIETQR LẺ ===
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
      showToast(`Mã acc #${item.id} đã có trong giỏ`);
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({ id: itemId, qty: 1 });
  }

  saveCart();
  renderCart();
  showToast(`Đã thêm "${item.title}" vào giỏ`);
}

function updateCartQty(itemId, delta) {
  const index = cart.findIndex((c) => c.id === itemId);
  if (index === -1) return;

  const item = findCatalogItem(itemId);
  const nextQty = cart[index].qty + delta;

  if (nextQty <= 0) {
    cart.splice(index, 1);
  } else if (item && item.type === "account" && nextQty > 1) {
    showToast("Mỗi tài khoản game là duy nhất (tối đa 1)");
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
    return `<div class="cred-card">Đơn hàng đã xác nhận thanh toán!</div>`;
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
        ${it.guideNote ? `<div style="font-size: 0.82rem; color: var(--text-muted);">📌 ${it.guideNote}</div>` : ""}
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
        "⏳ <strong>Đã báo chuyển khoản!</strong> Chờ Admin xác nhận biến động số dư — giữ màn hình này để nhận Acc tự động.";
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
    errEl.textContent = "Không thể khởi tạo đơn hàng lúc này, vui lòng thử lại.";
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  }
}

async function checkClaimReceipt(rawInput, targetEl) {
  const parts = String(rawInput || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    targetEl.innerHTML = `<div class="form-error">Mã biên lai cần dạng <code>HCU-XXXXXX.xxxxxx</code>.</div>`;
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
      targetEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--gold); margin-top:6px;">Đơn ${maDon} đang chờ xác nhận chuyển khoản (${formatVND(
        ord.tongTien
      )} - Nội dung: ${ord.transferCode}).</div>`;
    }
  } catch (err) {
    targetEl.innerHTML = `<div class="form-error">Không thể kiểm tra lúc này.</div>`;
  }
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

  // Theo dõi trạng thái đăng nhập thành viên & lắng nghe số dư thời gian thực
  onAuthStateChanged(auth, async (user) => {
    if (memberDocUnsub) {
      memberDocUnsub();
      memberDocUnsub = null;
    }

    if (!user) {
      currentMember = null;
      updateMemberHeaderUI();
      return;
    }

    const fallbackUsername = extractUsernameFromEmail(user.email);
    const userRef = doc(db, "users", user.uid);
    let prevBalance = null;

    memberDocUnsub = onSnapshot(userRef, async (snap) => {
      if (!snap.exists()) {
        if (isRegisteringMember) return;
        await setDoc(userRef, {
          uid: user.uid,
          username: fallbackUsername,
          email: user.email || "",
          balance: 0,
          totalDeposited: 0,
          createdAt: serverTimestamp(),
          createdAtISO: new Date().toISOString()
        });
        return;
      }
      const data = snap.data();
      const nextBalance = Number(data.balance || 0);
      if (prevBalance !== null && nextBalance > prevBalance) {
        showToast(`🎉 Tài khoản của bạn vừa được cộng +${formatVND(nextBalance - prevBalance)}!`);
      }
      prevBalance = nextBalance;

      currentMember = {
        uid: user.uid,
        username: data.username || fallbackUsername,
        balance: nextBalance,
        totalDeposited: Number(data.totalDeposited || 0)
      };
      updateMemberHeaderUI();
    });
  });

  // Lọc Account & Dịch vụ
  document.querySelectorAll(".tab-btn[data-game]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn[data-game]").forEach((b) => b.classList.remove("active"));
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
    const buyBtn = e.target.closest(".buy-acc-btn");
    if (buyBtn) {
      openBuyNowModal(buyBtn.dataset.id);
    }
  });

  document.getElementById("service-grid").addEventListener("click", (e) => {
    const addBtn = e.target.closest(".add-btn");
    if (addBtn) addToCart(addBtn.dataset.id);
  });

  document.getElementById("cart-items").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "inc") updateCartQty(id, 1);
    if (action === "dec") updateCartQty(id, -1);
    if (action === "remove") removeCartItem(id);
  });

  // Sự kiện Auth Modal
  document.getElementById("open-auth-btn").addEventListener("click", () => openAuthModal("login"));
  document.getElementById("close-auth-btn").addEventListener("click", closeAuthModal);
  document.getElementById("auth-overlay").addEventListener("click", closeAuthModal);
  document.getElementById("tab-login-mode").addEventListener("click", () => setAuthMode("login"));
  document.getElementById("tab-register-mode").addEventListener("click", () => setAuthMode("register"));
  document.getElementById("tab-forgot-mode").addEventListener("click", () => setAuthMode("forgot"));
  document.getElementById("forgot-quick-link").addEventListener("click", () => setAuthMode("forgot"));
  document.getElementById("member-auth-form").addEventListener("submit", handleMemberAuthSubmit);
  document.getElementById("member-logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    showToast("Đã đăng xuất tài khoản.");
  });

  // Sự kiện Nạp tiền Modal
  document.getElementById("open-topup-btn").addEventListener("click", () => openTopupModal());
  document.getElementById("close-topup-btn").addEventListener("click", closeTopupModal);
  document.getElementById("topup-overlay").addEventListener("click", closeTopupModal);
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("topup-amount-input").value = btn.dataset.amt;
    });
  });
  document.getElementById("create-topup-qr-btn").addEventListener("click", handleCreateTopupQr);
  document.getElementById("topup-reported-btn").addEventListener("click", handleTopupReportedPaid);
  document.getElementById("topup-back-btn").addEventListener("click", () => {
    document.getElementById("topup-qr-view").hidden = true;
    document.getElementById("topup-step-select").hidden = false;
  });

  // Sự kiện Mua ngay Modal
  document.getElementById("close-buy-now-btn").addEventListener("click", closeBuyNowModal);
  document.getElementById("buy-now-overlay").addEventListener("click", closeBuyNowModal);

  // Sự kiện Chi tiết & Giỏ hàng
  document.getElementById("close-detail-btn").addEventListener("click", closeDetailModal);
  document.getElementById("detail-overlay").addEventListener("click", closeDetailModal);
  document.getElementById("open-cart-btn").addEventListener("click", openCart);
  document.getElementById("close-cart-btn").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("continue-btn").addEventListener("click", closeCart);
  document.getElementById("order-form").addEventListener("submit", handleOrderSubmit);
  document.getElementById("mark-paid-btn").addEventListener("click", async () => {
    if (!activeOrderMeta) return;
    const btn = document.getElementById("mark-paid-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "shop_orders", activeOrderMeta.maDon), {
        paymentStatus: "Customer_Marked_Paid"
      });
      showToast("Đã gửi thông báo chuyển khoản tới Admin!");
    } catch (e) {
      btn.disabled = false;
    }
  });

  // Kho Acc đã mua
  const openBag = async () => {
    document.getElementById("claim-lookup-result").innerHTML = "";
    document.getElementById("my-orders-overlay").hidden = false;
    document.getElementById("my-orders-modal").hidden = false;
    await loadPurchasedBagModal();
  };
  const closeBag = () => {
    document.getElementById("my-orders-overlay").hidden = true;
    document.getElementById("my-orders-modal").hidden = true;
  };
  document.getElementById("open-bag-btn").addEventListener("click", openBag);
  document.getElementById("close-my-orders-btn").addEventListener("click", closeBag);
  document.getElementById("my-orders-overlay").addEventListener("click", closeBag);
  document.getElementById("claim-lookup-btn").addEventListener("click", () => {
    checkClaimReceipt(
      document.getElementById("claim-input").value,
      document.getElementById("claim-lookup-result")
    );
  });
});
