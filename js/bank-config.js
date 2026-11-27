// Cấu hình tài khoản nhận thanh toán VietQR chính thức của HcuGaming
export const BANK_CONFIG = {
  bankId: "MB",
  bankName: "MB Bank (Quân Đội)",
  accountNo: "0911507170",
  accountName: "HOANG VAN CU",
  template: "compact2"
};

export function buildVietQrUrl(amount, transferCode) {
  const amt = Math.max(0, Math.round(Number(amount || 0)));
  const info = encodeURIComponent(String(transferCode || "").trim());
  const accName = encodeURIComponent(BANK_CONFIG.accountName);
  return `https://img.vietqr.io/image/${BANK_CONFIG.bankId}-${BANK_CONFIG.accountNo}-${BANK_CONFIG.template}.png?amount=${amt}&addInfo=${info}&accountName=${accName}`;
}
