// utils/storage.js
const fs = require("fs");
const path = require("path");

/* ------------------ Yol Tanımları ------------------ */

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

/* ------------------ Klasör / Dosya Helper ------------------ */

function ensureDir(p) {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    console.warn("⚠️  Dizin oluşturulamadı:", p, "-", e.message);
  }
}

function ensureFile(p, init = "[]") {
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, init, "utf8");
  } catch (e) {
    console.warn("⚠️  Dosya oluşturulamadı:", p, "-", e.message);
  }
}

function testWritable(p) {
  try {
    const testPath = path.join(p, ".rw-test-" + Date.now());
    fs.writeFileSync(testPath, "ok", "utf8");
    fs.unlinkSync(testPath);
    return true;
  } catch {
    return false;
  }
}

/* ------------------ DATA_DIR & UPLOAD_DIR Kurulumu ------------------ */

const ENV_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
let DATA_DIR = ENV_DATA_DIR || path.join(ROOT, "data");

ensureDir(DATA_DIR);

let writableData = testWritable(DATA_DIR);
if (!writableData && ENV_DATA_DIR) {
  const fallback = path.join(ROOT, "data");
  console.warn(
    "⚠️  DATA_DIR yazılabilir değil:",
    DATA_DIR,
    "→ ./data klasörüne geçiliyor:",
    fallback
  );
  DATA_DIR = fallback;
  ensureDir(DATA_DIR);
  writableData = testWritable(DATA_DIR);
}
if (!writableData) {
  console.warn(
    "⚠️  DATA_DIR hala yazılamıyor. Uygulama read-only modda, veriler kalıcı olmayabilir."
  );
}

const DEFAULT_UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : DEFAULT_UPLOAD_DIR;

ensureDir(PUBLIC_DIR);
ensureDir(UPLOAD_DIR);

const writableUploads = testWritable(UPLOAD_DIR);
if (!writableUploads) {
  console.warn("⚠️  UPLOAD_DIR yazılamıyor:", UPLOAD_DIR);
}

/* ------------------ JSON Dosya Yolları ------------------ */

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const USERS_FILE    = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const COUPONS_FILE  = path.join(DATA_DIR, "coupons.json");
const REVIEWS_FILE  = path.join(DATA_DIR, "reviews.json");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback.json");

[
  PRODUCTS_FILE,
  USERS_FILE,
  MESSAGES_FILE,
  COUPONS_FILE,
  REVIEWS_FILE,
  FEEDBACK_FILE
].forEach((f) => ensureFile(f, "[]"));

/* ------------------ JSON Helper ------------------ */

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8") || "[]");
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.warn("⚠️  JSON yazılamadı:", file, "-", e.message);
  }
}

/* ------------------ ÜRÜNLER ------------------ */

function parsePrice(text) {
  const priceText = String(text ?? "").trim();
  if (!priceText) return { price: null, priceText: "", purchasable: false };
  const num = Number(
    priceText.replace(/[₺\s]/g, "").replace(",", ".")
  );
  const isNum = Number.isFinite(num);
  return { price: isNum ? num : null, priceText: priceText || "", purchasable: !!isNum };
}

function normalizeProduct(p) {
  const out = { ...p };
  out.id    = String(out.id || `p${Date.now()}`);
  out.name  = String(out.name || "").trim();
  out.desc  = String(out.desc || "");
  out.image = out.image || "logo.png";

  if (out.priceText && !out.price) {
    const parsed = parsePrice(out.priceText);
    out.price       = parsed.price;
    out.priceText   = parsed.priceText;
    out.purchasable = parsed.purchasable;
  } else if (out.price) {
    const parsed = parsePrice(out.price);
    out.price       = parsed.price;
    out.priceText   = parsed.priceText;
    out.purchasable = parsed.purchasable;
  } else {
    out.price       = null;
    out.priceText   = "";
    out.purchasable = false;
  }
  return out;
}

function readProducts() {
  const raw = readJSON(PRODUCTS_FILE, []);
  return Array.isArray(raw) ? raw.map(normalizeProduct) : [];
}

function writeProducts(list) {
  const arr = Array.isArray(list) ? list.map(normalizeProduct) : [];
  writeJSON(PRODUCTS_FILE, arr);
}

/* ------------------ KULLANICILAR ------------------ */

function normalizeUser(u) {
  const copy = { ...u };
  copy.id = String(copy.id || "u" + Date.now());

  // isApproved → isVerified migrasyonu
  if (typeof copy.isVerified !== "boolean") {
    if (typeof copy.isApproved === "boolean") {
      copy.isVerified = copy.isApproved;
    } else if (copy.verifiedAt) {
      copy.isVerified = true;
    } else {
      copy.isVerified = false;
    }
  }
  delete copy.isApproved;

  copy.email       = String(copy.email || "").trim().toLowerCase();
  copy.displayName = String(copy.displayName || copy.email.split("@")[0] || "").trim();
  copy.fullName    = copy.fullName ? String(copy.fullName).trim() : null;
  copy.phone       = copy.phone    ? String(copy.phone).trim()    : null;
  copy.city        = copy.city     ? String(copy.city).trim()     : null;
  copy.district    = copy.district ? String(copy.district).trim() : null;
  copy.address     = copy.address  ? String(copy.address).trim()  : null;
  copy.zip         = copy.zip      ? String(copy.zip).trim()      : null;
  copy.notes       = copy.notes    ? String(copy.notes).trim()    : null;

  copy.isAdmin     = !!copy.isAdmin;

  copy.createdAt         = copy.createdAt || new Date().toISOString();
  copy.lastLoginAt       = copy.lastLoginAt || null;
  copy.lastLoginIp       = copy.lastLoginIp || null;
  copy.verificationToken = copy.verificationToken || null;
  copy.verifiedAt        = copy.verifiedAt || null;

  return copy;
}

function readUsers() {
  const raw = readJSON(USERS_FILE, []);
  return Array.isArray(raw) ? raw.map(normalizeUser) : [];
}

function writeUsers(list) {
  const arr = Array.isArray(list) ? list.map(normalizeUser) : [];
  writeJSON(USERS_FILE, arr);
}

/* ------------------ MESAJLAR (contact + order) ------------------ */

function readMessages() {
  const raw = readJSON(MESSAGES_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function writeMessages(list) {
  writeJSON(MESSAGES_FILE, Array.isArray(list) ? list : []);
}

/* ------------------ KUPONLAR ------------------ */

function readCoupons() {
  const raw = readJSON(COUPONS_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function writeCoupons(list) {
  writeJSON(COUPONS_FILE, Array.isArray(list) ? list : []);
}

/* ------------------ YORUMLAR ------------------ */

function normalizeReview(r) {
  const copy = { ...r };
  copy.id = String(copy.id || "r" + Date.now());

  // isApproved → approved, geri uyumluluk için isApproved da tutuluyor
  if (typeof copy.approved !== "boolean") {
    if (typeof copy.isApproved === "boolean") {
      copy.approved = copy.isApproved;
    } else {
      copy.approved = false;
    }
  }
  copy.isApproved = copy.approved;

  copy.productId   = String(copy.productId || "").trim();
  copy.userId      = copy.userId ? String(copy.userId) : null;
  copy.userEmail   = copy.userEmail ? String(copy.userEmail).trim().toLowerCase() : null;
  copy.displayName = String(copy.displayName || "Kullanıcı").trim();
  copy.rating      = Number(copy.rating || 0);
  copy.comment     = String(copy.comment || "").trim();
  copy.photos      = Array.isArray(copy.photos) ? copy.photos : [];
  copy.anonymous   = !!copy.anonymous;

  copy.createdAt   = copy.createdAt || new Date().toISOString();
  copy.updatedAt   = copy.updatedAt || null;

  return copy;
}

function readReviews() {
  const raw = readJSON(REVIEWS_FILE, []);
  return Array.isArray(raw) ? raw.map(normalizeReview) : [];
}

function writeReviews(list) {
  const arr = Array.isArray(list) ? list.map(normalizeReview) : [];
  writeJSON(REVIEWS_FILE, arr);
}

/* ------------------ FEEDBACK ------------------ */

function readFeedback() {
  const raw = readJSON(FEEDBACK_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function writeFeedback(list) {
  writeJSON(FEEDBACK_FILE, Array.isArray(list) ? list : []);
}

/* ------------------ Export ------------------ */

module.exports = {
  ROOT,
  PUBLIC_DIR,
  DATA_DIR,
  UPLOAD_DIR,

  PRODUCTS_FILE,
  USERS_FILE,
  MESSAGES_FILE,
  COUPONS_FILE,
  REVIEWS_FILE,
  FEEDBACK_FILE,

  readJSON,
  writeJSON,

  readProducts,
  writeProducts,
  parsePrice,

  readUsers,
  writeUsers,

  readMessages,
  writeMessages,

  readCoupons,
  writeCoupons,

  readReviews,
  writeReviews,

  readFeedback,
  writeFeedback
};
