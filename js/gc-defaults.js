// Dữ liệu khởi tạo chuẩn cho dịch vụ GAME CÙNG – PLAY TOGETHER (Delta Force)
// Admin có thể chỉnh sửa, thêm, ẩn hoặc xóa trực tiếp từ trang /admin (lưu trên Cloud Firestore)

export const DEFAULT_PACKAGES = [
  {
    id: "pkg-lam-quen",
    order: 1,
    name: "Gói 1: Làm quen cùng đồng đội",
    durationMinutes: 30,
    durationLabel: "30 phút",
    allowedDurations: [30],
    description: "Chơi cùng, giao lưu, hướng dẫn thao tác cơ bản.",
    audience: "Người mới",
    modes: ["Operations", "Warfare", "Detonation"],
    formats: ["Solo cùng người đồng hành", "Duo"],
    levels: ["Mới bắt đầu", "Cơ bản"],
    price: 29000,
    isCustomPrice: false,
    badge: "Người mới",
    visible: true
  },
  {
    id: "pkg-operations",
    order: 2,
    name: "Gói 2: Đồng hành Operations",
    durationMinutes: 60,
    durationLabel: "60 phút",
    allowedDurations: [60, 120],
    description: "Cùng khám phá bản đồ, tìm hiểu khu vực, phối hợp di chuyển và trải nghiệm Operations.",
    audience: "Người chơi Operations",
    modes: ["Operations"],
    formats: ["Solo cùng người đồng hành", "Duo", "Squad"],
    levels: ["Mới bắt đầu", "Cơ bản", "Trung cấp", "Nâng cao"],
    price: 49000,
    isCustomPrice: false,
    badge: "Phổ biến",
    visible: true
  },
  {
    id: "pkg-warfare",
    order: 3,
    name: "Gói 3: Đồng hành Warfare",
    durationMinutes: 60,
    durationLabel: "60 phút",
    allowedDurations: [60, 120],
    description: "Chơi cùng trong Warfare, phối hợp đội hình, hỗ trợ mục tiêu và giao lưu.",
    audience: "Người chơi Warfare",
    modes: ["Warfare", "Detonation"],
    formats: ["Solo cùng người đồng hành", "Duo", "Squad"],
    levels: ["Mới bắt đầu", "Cơ bản", "Trung cấp", "Nâng cao"],
    price: 49000,
    isCustomPrice: false,
    badge: "Sôi động",
    visible: true
  },
  {
    id: "pkg-squad",
    order: 4,
    name: "Gói 4: Squad đồng hành",
    durationMinutes: 90,
    durationLabel: "90 phút",
    allowedDurations: [90, 120],
    description: "Tham gia tổ đội, phối hợp chiến thuật và chơi nhiều trận.",
    audience: "Người muốn chơi theo nhóm",
    modes: ["Operations", "Warfare", "Detonation"],
    formats: ["Duo", "Squad"],
    levels: ["Cơ bản", "Trung cấp", "Nâng cao"],
    price: 79000,
    isCustomPrice: false,
    badge: "Tổ đội Tactical",
    visible: true
  },
  {
    id: "pkg-custom",
    order: 5,
    name: "Gói 5: Buổi chơi tùy chỉnh",
    durationMinutes: 120,
    durationLabel: "Theo thỏa thuận",
    allowedDurations: [30, 60, 90, 120],
    description: "Khách hàng chọn chế độ, bản đồ và thời lượng.",
    audience: "Tùy chỉnh theo nhu cầu",
    modes: ["Operations", "Warfare", "Detonation"],
    formats: ["Solo cùng người đồng hành", "Duo", "Squad"],
    levels: ["Mới bắt đầu", "Cơ bản", "Trung cấp", "Nâng cao"],
    price: 0,
    isCustomPrice: true,
    badge: "Linh hoạt",
    visible: true
  }
];

export const DEFAULT_MAPS = [
  // Operations
  { id: "zero-dam", name: "Zero Dam", mode: "Operations", active: true },
  { id: "layali-grove", name: "Layali Grove", mode: "Operations", active: true },
  { id: "space-city", name: "Space City", mode: "Operations", active: true },
  { id: "brakkesh", name: "Brakkesh", mode: "Operations", active: true },
  { id: "tide-prison", name: "Tide Prison", mode: "Operations", active: true },
  { id: "az3-nuclear-plant", name: "AZ3 Nuclear Plant", mode: "Operations", active: true },
  // Warfare & Detonation
  { id: "ascension", name: "Ascension", mode: "Warfare", active: true },
  { id: "cracked", name: "Cracked", mode: "Warfare", active: true },
  { id: "threshold", name: "Threshold", mode: "Warfare", active: true },
  { id: "shafted", name: "Shafted", mode: "Warfare", active: true },
  { id: "trench-lines", name: "Trench Lines", mode: "Warfare", active: true },
  { id: "knife-edge", name: "Knife Edge", mode: "Warfare", active: true },
  { id: "trainwreck", name: "Trainwreck", mode: "Warfare", active: true },
  { id: "cyclone", name: "Cyclone", mode: "Warfare", active: true },
  { id: "fault", name: "Fault", mode: "Warfare", active: true },
  { id: "monument", name: "Monument", mode: "Warfare", active: true },
  { id: "aftershock", name: "Aftershock", mode: "Warfare", active: true },
  { id: "coliseum", name: "Coliseum", mode: "Warfare", active: true },
  { id: "the-mog", name: "The Mog", mode: "Warfare", active: true },
  { id: "zenith-port", name: "Zenith Port", mode: "Warfare", active: true },
  // Detonation tactical zones
  { id: "cracked-detonation", name: "Cracked (Detonation)", mode: "Detonation", active: true },
  { id: "threshold-detonation", name: "Threshold (Detonation)", mode: "Detonation", active: true },
  { id: "shafted-detonation", name: "Shafted (Detonation)", mode: "Detonation", active: true }
];

export const DEFAULT_SCHEDULE_CONFIG = {
  openHour: 8,
  closeHour: 23,
  slotIntervalMinutes: 30,
  blockedSlots: [], // Mảng các chuỗi "YYYY-MM-DD|HH:mm" do Admin khóa lịch bận
  discordInviteUrl: "https://discord.gg/hcugaming"
};

export const ORDER_STATUS_META = {
  Pending: { label: "Chờ xác nhận", css: "status-pending" },
  Confirmed: { label: "Đã xác nhận", css: "status-confirmed" },
  Paid: { label: "Đã thanh toán", css: "status-paid" },
  "In Progress": { label: "Đang diễn ra", css: "status-progress" },
  Completed: { label: "Hoàn thành", css: "status-completed" },
  Cancelled: { label: "Đã hủy", css: "status-cancelled" }
};

export function formatCurrencyVND(amount, isCustom = false) {
  if (isCustom) return "Liên hệ";
  return `${Number(amount || 0).toLocaleString("vi-VN")} VNĐ`;
}
