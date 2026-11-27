// Danh sách 8 sản phẩm của Mộc Café chia 2 nhóm: Cà phê hạt & Dụng cụ pha chế
const PRODUCTS = [
  {
    id: "cf-arabica-cau-dat",
    name: "Cà phê hạt Arabica Cầu Đất",
    category: "ca-phe-hat",
    categoryLabel: "Cà phê hạt",
    description: "Rang vừa, hương hoa quả chín và vị chua thanh nhẹ nhàng, phù hợp pha máy hoặc Pour Over.",
    price: 185000,
    emoji: "☕",
    bgColor: "#EFE3D3"
  },
  {
    id: "cf-robusta-bmt",
    name: "Cà phê hạt Robusta Buôn Ma Thuột",
    category: "ca-phe-hat",
    categoryLabel: "Cà phê hạt",
    description: "Rang đậm truyền thống, vị đắng dịu, hậu ngọt sâu và hàm lượng caffeine cao cho ly cà phê sữa đá.",
    price: 120000,
    emoji: "🫘",
    bgColor: "#E8D5C4"
  },
  {
    id: "cf-moc-house-blend",
    name: "Mộc House Blend (70/30)",
    category: "ca-phe-hat",
    categoryLabel: "Cà phê hạt",
    description: "Phối trộn cân bằng 70% Robusta và 30% Arabica, thơm nồng nàn, đậm đà cho cả pha phin lẫn pha máy.",
    price: 155000,
    emoji: "🌿",
    bgColor: "#EAE0D0"
  },
  {
    id: "cf-espresso-dark",
    name: "Cà phê hạt Espresso Rang Đậm",
    category: "ca-phe-hat",
    categoryLabel: "Cà phê hạt",
    description: "Hương sô-cô-la đen và caramel rõ nét, lớp crema dày mịn, lý tưởng cho Espresso và Latte.",
    price: 210000,
    emoji: "✨",
    bgColor: "#E5D3C0"
  },
  {
    id: "dc-phin-nhom",
    name: "Phin nhôm truyền thống cao cấp",
    category: "dung-cu-pha-che",
    categoryLabel: "Dụng cụ pha chế",
    description: "Chất liệu nhôm dày giữ nhiệt tốt, lỗ lọc đều giúp chiết xuất cà phê đậm đà chuẩn vị Việt.",
    price: 85000,
    emoji: "🫖",
    bgColor: "#F2E7D8"
  },
  {
    id: "dc-v60-bo",
    name: "Bộ phễu lọc Pour Over V60",
    category: "dung-cu-pha-che",
    categoryLabel: "Dụng cụ pha chế",
    description: "Phễu thủy tinh kèm bình server 400ml và 40 tờ giấy lọc, giúp tách hương vị cà phê tinh tế.",
    price: 290000,
    emoji: "⏳",
    bgColor: "#ECE0D1"
  },
  {
    id: "dc-am-co-ngong",
    name: "Ấm rót cổ ngỗng Inox 600ml",
    category: "dung-cu-pha-che",
    categoryLabel: "Dụng cụ pha chế",
    description: "Vòi rót nhỏ giúp kiểm soát dòng nước ổn định khi pha thủ công, tay cầm cách nhiệt chắc chắn.",
    price: 340000,
    emoji: "🫗",
    bgColor: "#E9DDD0"
  },
  {
    id: "dc-coi-xay-tay",
    name: "Cối xay cà phê tay lưỡi thép",
    category: "dung-cu-pha-che",
    categoryLabel: "Dụng cụ pha chế",
    description: "Lưỡi xay thép không gỉ chỉnh được nhiều cỡ mịn, nhỏ gọn dễ mang theo khi du lịch hoặc tại nhà.",
    price: 260000,
    emoji: "⚙️",
    bgColor: "#EFE4D6"
  }
];
