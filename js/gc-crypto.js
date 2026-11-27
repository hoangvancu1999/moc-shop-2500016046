// Tiện ích mã hóa Web Crypto bảo vệ Discord ID & thông tin cá nhân khách hàng
// - Khách đặt lịch: mã hóa PII bằng RSA-OAEP Public Key (không ai ngoài Admin đọc được)
// - Admin đăng nhập: xác thực SHA-256 + mở khóa Private Key bằng AES-GCM (PBKDF2)

const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function sha256Hex(text) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return bufToHex(hash);
}

export function randomTokenHex(byteLen = 24) {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return bufToHex(arr.buffer);
}

async function deriveAesKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function createAdminVault(passphrase) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(privateKeyJwk))
  );

  return {
    publicKeyJwk,
    wrappedPrivateKey: {
      cipher: bufToBase64(cipherBuf),
      salt: bufToBase64(salt.buffer),
      iv: bufToBase64(iv.buffer)
    }
  };
}

export async function unlockAdminPrivateKey(wrappedPrivateKey, passphrase) {
  const salt = new Uint8Array(base64ToBuf(wrappedPrivateKey.salt));
  const iv = new Uint8Array(base64ToBuf(wrappedPrivateKey.iv));
  const cipher = base64ToBuf(wrappedPrivateKey.cipher);
  const aesKey = await deriveAesKey(passphrase, salt);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, cipher);
  const privateKeyJwk = JSON.parse(dec.decode(plainBuf));

  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

export async function encryptCustomerPii(publicKeyJwk, piiObject) {
  const pubKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  // Dùng khóa phiên AES-GCM để không bị giới hạn độ dài chuỗi ghi chú dài
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const iv = crypto.subtle.encrypt ? crypto.getRandomValues(new Uint8Array(12)) : new Uint8Array(12);

  const wrappedAes = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, rawAes);
  const cipherData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(piiObject))
  );

  return {
    v: 1,
    k: bufToBase64(wrappedAes),
    iv: bufToBase64(iv.buffer),
    d: bufToBase64(cipherData)
  };
}

export async function decryptCustomerPii(privateKey, encryptedPayload) {
  if (!encryptedPayload || !encryptedPayload.k) return null;
  const rawAes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBuf(encryptedPayload.k)
  );
  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(base64ToBuf(encryptedPayload.iv)) },
    aesKey,
    base64ToBuf(encryptedPayload.d)
  );
  return JSON.parse(dec.decode(plainBuf));
}

export function maskDisplayName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed.length <= 2) return trimmed[0] ? `${trimmed[0]}***` : "Người chơi";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`;
}
