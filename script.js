// Khóa lưu giỏ hàng trong localStorage
const CART_STORAGE_KEY = "moc_cafe_cart";
const SHIPPING_FEE = 25000;
const FREE_SHIP_THRESHOLD = 300000;

let activeCategory = "all";
let cart = loadCart();
let toastTimer = null;

// Định dạng tiền VNĐ dạng 120.000đ
function formatVND(amount) {
  return `${Number(amount).toLocaleString("vi-VN")}đ`;
}

// Đọc giỏ hàng từ localStorage
function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

// Lưu giỏ hàng vào localStorage
function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (error) {
    // Bỏ qua nếu trình duyệt chặn localStorage
  }
}

// Tìm sản phẩm theo id
function findProductById(productId) {
  return PRODUCTS.find((item) => item.id === productId);
}

// Hiển thị thông báo ngắn khi thêm vào giỏ
function showToast(message) {
  const toastEl = document.getElementById("toast");
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

// Render danh sách sản phẩm theo bộ lọc hiện tại
function renderProducts() {
  const listEl = document.getElementById("product-list");
  const filtered =
    activeCategory === "all"
      ? PRODUCTS
      : PRODUCTS.filter((p) => p.category === activeCategory);

  listEl.innerHTML = filtered
    .map(
      (product) => `
      <article class="product-card">
        <div class="product-thumb" style="background-color: ${product.bgColor};">
          <span class="product-category-tag">${product.categoryLabel}</span>
          <span aria-hidden="true">${product.emoji}</span>
        </div>
        <div class="product-body">
          <h3 class="product-title">${product.name}</h3>
          <p class="product-desc">${product.description}</p>
          <div class="product-footer">
            <span class="product-price">${formatVND(product.price)}</span>
            <button type="button" class="add-to-cart-btn" data-id="${product.id}">
              Thêm vào giỏ
            </button>
          </div>
        </div>
      </article>
    `
    )
    .join("");
}

// Thêm sản phẩm vào giỏ
function addToCart(productId) {
  const product = findProductById(productId);
  if (!product) return;

  const existing = cart.find((item) => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id: productId, qty: 1 });
  }

  saveCart();
  renderCart();
  showToast(`Đã thêm "${product.name}" vào giỏ hàng`);
}

// Tăng/giảm số lượng hoặc xóa món
function updateQuantity(productId, delta) {
  const index = cart.findIndex((item) => item.id === productId);
  if (index === -1) return;

  cart[index].qty += delta;
  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  }

  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter((item) => item.id !== productId);
  saveCart();
  renderCart();
}

// Render giỏ hàng, tạm tính, phí giao hàng và tổng tiền
function renderCart() {
  const countEl = document.getElementById("cart-count");
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  const summaryEl = document.getElementById("cart-summary");
  const formEl = document.getElementById("checkout-form");
  const subtotalEl = document.getElementById("subtotal-amount");
  const shippingEl = document.getElementById("shipping-amount");
  const totalEl = document.getElementById("total-amount");
  const hintEl = document.getElementById("free-ship-hint");

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  countEl.textContent = totalQty;

  if (cart.length === 0) {
    itemsEl.innerHTML = "";
    emptyEl.hidden = false;
    summaryEl.hidden = true;
    formEl.hidden = true;
    subtotalEl.textContent = "0đ";
    shippingEl.textContent = "0đ";
    totalEl.textContent = "0đ";
    hintEl.textContent = "";
    return;
  }

  emptyEl.hidden = true;
  summaryEl.hidden = false;
  formEl.hidden = false;

  let subtotal = 0;

  itemsEl.innerHTML = cart
    .map((cartItem) => {
      const product = findProductById(cartItem.id);
      if (!product) return "";
      const lineTotal = product.price * cartItem.qty;
      subtotal += lineTotal;

      return `
        <li class="cart-item">
          <div class="cart-item-emoji" style="background-color: ${product.bgColor};" aria-hidden="true">
            ${product.emoji}
          </div>
          <div>
            <div class="cart-item-name">${product.name}</div>
            <div class="cart-item-price">${formatVND(product.price)} × ${cartItem.qty} = <strong>${formatVND(lineTotal)}</strong></div>
          </div>
          <div class="cart-item-controls">
            <button type="button" class="qty-btn" data-action="dec" data-id="${product.id}" aria-label="Giảm số lượng">-</button>
            <span class="qty-value">${cartItem.qty}</span>
            <button type="button" class="qty-btn" data-action="inc" data-id="${product.id}" aria-label="Tăng số lượng">+</button>
            <button type="button" class="remove-btn" data-action="remove" data-id="${product.id}">Xóa</button>
          </div>
        </li>
      `;
    })
    .join("");

  const shipping = subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
  const total = subtotal + shipping;

  subtotalEl.textContent = formatVND(subtotal);
  shippingEl.textContent = shipping === 0 ? "Miễn phí (0đ)" : formatVND(shipping);
  totalEl.textContent = formatVND(total);

  if (shipping === 0) {
    hintEl.textContent = "🎉 Đơn hàng của bạn đã được miễn phí giao hàng!";
  } else {
    const remaining = FREE_SHIP_THRESHOLD - subtotal;
    hintEl.textContent = `Mua thêm ${formatVND(remaining)} để được miễn phí giao hàng.`;
  }
}

// Mở / đóng ngăn kéo giỏ hàng
function openCart() {
  document.getElementById("order-success").hidden = true;
  document.getElementById("cart-overlay").hidden = false;
  document.getElementById("cart-drawer").hidden = false;
}

function closeCart() {
  document.getElementById("cart-overlay").hidden = true;
  document.getElementById("cart-drawer").hidden = true;
}

// Tạo mã đơn hàng ngẫu nhiên dạng MC-123456
function generateOrderCode() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `MC-${randomNum}`;
}

// Xử lý đặt hàng COD
function handleCheckoutSubmit(event) {
  event.preventDefault();

  const nameInput = document.getElementById("customer-name");
  const phoneInput = document.getElementById("customer-phone");
  const addressInput = document.getElementById("customer-address");
  const consentCheckbox = document.getElementById("consent-checkbox");
  const errorEl = document.getElementById("form-error");

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const address = addressInput.value.trim();

  let errorMessage = "";
  if (cart.length === 0) {
    errorMessage = "Giỏ hàng đang trống, vui lòng thêm sản phẩm trước khi đặt hàng.";
  } else if (!name) {
    errorMessage = "Vui lòng nhập họ tên người nhận.";
  } else if (!/^[0-9+\s.-]{9,15}$/.test(phone)) {
    errorMessage = "Vui lòng nhập số điện thoại hợp lệ (9–15 ký tự số).";
  } else if (!address) {
    errorMessage = "Vui lòng nhập địa chỉ giao hàng.";
  } else if (!consentCheckbox.checked) {
    errorMessage = "Vui lòng tick chọn đồng ý cho cửa hàng dùng thông tin này để giao hàng.";
  }

  if (errorMessage) {
    errorEl.textContent = errorMessage;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;

  // Tạo mã đơn, xóa giỏ hàng và hiển thị lời cảm ơn
  const orderCode = generateOrderCode();
  document.getElementById("order-code").textContent = orderCode;

  cart = [];
  saveCart();
  renderCart();

  document.getElementById("checkout-form").reset();
  document.getElementById("cart-empty").hidden = true;
  document.getElementById("order-success").hidden = false;
}

// Gắn sự kiện khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", () => {
  renderProducts();
  renderCart();

  // Bộ lọc nhóm sản phẩm
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCategory = btn.dataset.category;
      renderProducts();
    });
  });

  // Thêm vào giỏ hàng
  document.getElementById("product-list").addEventListener("click", (event) => {
    const btn = event.target.closest(".add-to-cart-btn");
    if (!btn) return;
    addToCart(btn.dataset.id);
  });

  // Tăng/giảm/xóa trong giỏ hàng
  document.getElementById("cart-items").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "inc") updateQuantity(id, 1);
    if (action === "dec") updateQuantity(id, -1);
    if (action === "remove") removeFromCart(id);
  });

  // Mở / đóng giỏ hàng
  document.getElementById("open-cart-btn").addEventListener("click", openCart);
  document.getElementById("close-cart-btn").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("continue-shopping-btn").addEventListener("click", closeCart);

  // Đặt hàng COD
  document.getElementById("checkout-form").addEventListener("submit", handleCheckoutSubmit);
});
