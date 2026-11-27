// Dữ liệu Account Game (Liên Quân Mobile & Delta Force) và Dịch vụ Game của HcuGaming

const ACCOUNTS = [
  {
    id: "LQ-101",
    game: "lien-quan",
    gameLabel: "Liên Quân Mobile",
    title: "Acc Chiến Tướng 45 Sao • Nakroth Thứ Nguyên Vệ Thần",
    rank: "Chiến Tướng",
    stats: ["112 Tướng", "285 Skin", "Trắng thông tin"],
    description: "Tài khoản trắng thông tin Garena, sẵn Nakroth Thứ Nguyên Vệ Thần, Raz Muay Thái, bảng ngọc chuẩn 90, đổi mật khẩu ngay.",
    price: 890000,
    badge: "HOT",
    icon: "⚔️",
    themeColor: "#1a2844"
  },
  {
    id: "LQ-102",
    game: "lien-quan",
    gameLabel: "Liên Quân Mobile",
    title: "Acc Cao Thủ • Full Tướng Meta Đi Rừng & Xạ Thủ",
    rank: "Cao Thủ",
    stats: ["98 Tướng", "164 Skin", "Đổi thông tin 100%"],
    description: "Tỉ lệ thắng 64%, sẵn Violet Huyết Ma Thần, Hayate Tử Thần, Elsu Sứ Giả Tận Thế. Phù hợp leo rank hoặc đánh giải phong trào.",
    price: 450000,
    badge: "Sẵn sàng",
    icon: "🛡️",
    themeColor: "#1f2447"
  },
  {
    id: "LQ-103",
    game: "lien-quan",
    gameLabel: "Liên Quân Mobile",
    title: "Acc Tinh Anh • Khởi Đầu Ngon Bổ Rẻ Có Nhiều Bậc S+",
    rank: "Tinh Anh II",
    stats: ["65 Tướng", "78 Skin", "Bảo hành 7 ngày"],
    description: "Tài khoản sạch, uy tín cao (100 điểm uy tín), sẵn bộ tướng quốc dân Tulen, Liliana, Florentino, phù hợp cày từ đầu mùa.",
    price: 180000,
    badge: "Giá tốt",
    icon: "⚡",
    themeColor: "#172d3a"
  },
  {
    id: "LQ-104",
    game: "lien-quan",
    gameLabel: "Liên Quân Mobile",
    title: "Acc VIP Collector • 3 Skin SSS Hữu Hạn & Full Ngọc",
    rank: "Cao Thủ 22 Sao",
    stats: ["Full 118 Tướng", "410 Skin", "Hồ sơ sạch"],
    description: "Sở hữu Lauriel Thứ Nguyên, Butterfly Phượng Cửu Thiên, Tulen Chí Tôn Kiếm Tiên. Hỗ trợ giao dịch trung gian đổi SĐT/Email.",
    price: 1450000,
    badge: "VIP",
    icon: "👑",
    themeColor: "#2d1f3d"
  },
  {
    id: "DF-201",
    game: "delta-force",
    gameLabel: "Delta Force",
    title: "Acc Delta Force Operations • Kho Đồ Đỏ & 35M Tekniq",
    rank: "Level 55 • Pinnacle",
    stats: ["35M Tekniq Alloy", "Full Giáp Cấp 5-6", "M4A1 / SCAR-H Meta"],
    description: "Tài khoản chuyên chế độ Operations (Extraction), kho chứa mở rộng tối đa, sẵn nhiều chìa khóa phòng VIP và đạn vàng.",
    price: 750000,
    badge: "HOT",
    icon: "🎯",
    themeColor: "#142b2d"
  },
  {
    id: "DF-202",
    game: "delta-force",
    gameLabel: "Delta Force",
    title: "Acc Delta Force Chiến Trường • Full Phụ Kiện & Skin Súng",
    rank: "Level 42 • General",
    stats: ["Mở khóa toàn bộ Operator", "18 Skin Vũ Khí", "Chưa từng ban"],
    description: "Cày tay 100%, mở đủ các Operator mạnh cho cả Havoc Warfare và Operations, sẵn nhiều bản vẽ súng giảm giật chuẩn Esports.",
    price: 420000,
    badge: "Sẵn sàng",
    icon: "🔫",
    themeColor: "#1b2838"
  },
  {
    id: "DF-203",
    game: "delta-force",
    gameLabel: "Delta Force",
    title: "Acc Delta Force Tân Thủ • Sẵn Vốn & Súng Meta Dễ Bắn",
    rank: "Level 24",
    stats: ["8M Tekniq Alloy", "Sẵn 6 Bộ Gear", "Email trắng"],
    description: "Tài khoản sạch giao kèm email gốc, phù hợp cho anh em mới vào game hoặc làm acc phụ đi bắn squad cùng bạn bè.",
    price: 220000,
    badge: "Giá tốt",
    icon: "🪖",
    themeColor: "#1f2e24"
  },
  {
    id: "DF-204",
    game: "delta-force",
    gameLabel: "Delta Force",
    title: "Acc Delta Force Lão Bản • Full Tủ Đồ Đỏ & Thẻ Đen",
    rank: "Level 60 Max",
    stats: ["80M+ Tài sản", "Thẻ khóa Zero Dam / Space City", "Bảo hành trọn đời"],
    description: "Acc cực phẩm dành cho dân chơi hệ sưu tầm và kéo map khó. Giao dịch trực tiếp đổi toàn bộ thông tin bảo mật.",
    price: 1650000,
    badge: "VIP",
    icon: "💎",
    themeColor: "#2a2315"
  }
];

const SERVICES = [
  {
    id: "DV-LB-01",
    group: "keo-lao-ban",
    groupLabel: "Kéo lão bản",
    gameLabel: "Delta Force",
    title: "Kéo Lão Bản Delta Force – Map Zero Dam / Brakkesh",
    unit: "1 Trận (bao Extract)",
    description: "Team Pro 2–3 người bảo kê lão bản loot đồ đỏ/vàng, mở phòng khóa VIP, cam kết thoát map an toàn 100%.",
    highlights: ["Bao an toàn Extract", "Nhường toàn bộ đồ giá trị", "Chơi tay 100%, không hack"],
    price: 90000,
    icon: "🚁"
  },
  {
    id: "DV-LB-02",
    group: "keo-lao-ban",
    groupLabel: "Kéo lão bản",
    gameLabel: "Delta Force",
    title: "Combo Kéo Lão Bản VIP – Cam Kết Đạt 10M Tài Sản",
    unit: "1 Gói hoàn thành",
    description: "Kéo liên tục đến khi tài sản kho của lão bản tăng đủ 10.000.000 Tekniq Alloy. Có voice call phối hợp trực tiếp.",
    highlights: ["Cam kết đủ 10M giá trị đồ", "Hỗ trợ chọn trang bị chuẩn", "Hoàn tiền nếu không đạt"],
    price: 350000,
    icon: "💰"
  },
  {
    id: "DV-LB-03",
    group: "keo-lao-ban",
    groupLabel: "Kéo lão bản",
    gameLabel: "Liên Quân Mobile",
    title: "Kéo Lão Bản Leo Rank Liên Quân (Ngồi Chơi Cùng Team)",
    unit: "5 Trận thắng",
    description: "Không cần giao acc! Bạn tự cầm acc đánh cùng đội hình 4 cao thủ/chiến tướng của HcuGaming, leo sao nhanh và vui.",
    highlights: ["Không cần đưa mật khẩu", "Team call chiến thuật chuẩn", "Tỉ lệ thắng cao"],
    price: 150000,
    icon: "🏆"
  },
  {
    id: "DV-CC-01",
    group: "choi-cung",
    groupLabel: "Kiếm người chơi cùng",
    gameLabel: "Liên Quân Mobile",
    title: "Thuê Bạn Chơi Cùng Liên Quân (Duo / Team 5 Có Mic)",
    unit: "1 Giờ chơi cùng",
    description: "Tìm đồng đội kỹ năng tốt, vui vẻ, không toxic để đánh rank hoặc đấu thường. Hỗ trợ đánh mọi vị trí bạn cần.",
    highlights: ["Có mic Discord / In-game", "Đúng giờ, nhiệt tình", "Chọn vị trí linh hoạt"],
    price: 50000,
    icon: "🎧"
  },
  {
    id: "DV-CC-02",
    group: "choi-cung",
    groupLabel: "Kiếm người chơi cùng",
    gameLabel: "Delta Force",
    title: "Lập Squad Bắn Delta Force Operations (Có Callout Chuẩn)",
    unit: "1 Giờ chơi cùng",
    description: "Không còn cảnh đi lẻ bị hội đồng! Ghép ngay cùng đồng đội biết đọc map, chia sẻ loot công bằng và cover nhau cực gắt.",
    highlights: ["Callout vị trí địch chuẩn", "Giao tiếp Discord mượt mà", "Phù hợp mọi mức rank"],
    price: 60000,
    icon: "🎖️"
  },
  {
    id: "DV-CC-03",
    group: "choi-cung",
    groupLabel: "Kiếm người chơi cùng",
    gameLabel: "Liên Quân & Delta Force",
    title: "Gói Đồng Hành Buổi Tối (3 Giờ Chơi Liên Tiếp)",
    unit: "1 Buổi (3 Giờ)",
    description: "Đặt lịch chơi cùng suốt 3 tiếng buổi tối (19h–23h), thoải mái đổi qua lại giữa Liên Quân và Delta Force theo ý bạn.",
    highlights: ["Tiết kiệm 20% so với lẻ giờ", "Ưu tiên giữ slot đẹp", "Hỗ trợ hướng dẫn mẹo chơi"],
    price: 130000,
    icon: "🌙"
  }
];
