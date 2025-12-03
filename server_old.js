// server.js — Mavern (Simplified Admin: only legacy panel, no JWT admin)

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const multer = require("multer");
const mime = require("mime-types");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

/* ---------------------------- Güvenlik / Temel ---------------------------- */
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" }
  })
);

app.use(cors({ origin: true, credentials: false }));
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// HTTP -> HTTPS (Render vb.)
app.use((req, res, next) => {
  const proto = req.get("x-forwarded-proto");
  if (proto && proto !== "https") {
    const host = req.get("host");
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  }
  next();
});

/* ------------------------------- Dosya yolları ---------------------------- */
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

/* ----- Yardımcı: dizin/ dosya oluşturma ve yazılabilirlik testi ----- */
// Bu fonksiyonlar asla sunucuyu çökertmez, sadece uyarı basar.
function ensureDir(p) {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    console.warn("⚠️  Dizin oluşturulamadı, veriler kalıcı olmayabilir:", p, "-", e.message);
  }
}
function ensureFile(p, init = "[]") {
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, init, "utf8");
  } catch (e) {
    console.warn("⚠️  Dosya oluşturulamadı, veriler kalıcı olmayabilir:", p, "-", e.message);
  }
}
function testWritable(dirOrFilePath) {
  try {
    const stat = fs.lstatSync(dirOrFilePath);
    const isDir = stat.isDirectory();
    const testPath = isDir
      ? path.join(dirOrFilePath, ".rw-test-" + Date.now())
      : dirOrFilePath + ".rw-test-" + Date.now();
    fs.writeFileSync(testPath, "ok", "utf8");
    fs.unlinkSync(testPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * DATA_DIR seçim mantığı:
 * 1) ENV.DATA_DIR varsa onu dener.
 * 2) Yazılabilir değilse projedeki ./data klasörüne otomatik döner.
 */
const ENV_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
let DATA_DIR = ENV_DATA_DIR || path.join(ROOT, "data");

ensureDir(DATA_DIR);
let writableData = testWritable(DATA_DIR);

if (!writableData && ENV_DATA_DIR) {
  const fallback = path.join(ROOT, "data");
  if (fallback !== DATA_DIR) {
    console.warn(
      "⚠️  DATA_DIR yazılabilir değil:",
      DATA_DIR,
      "→ Yerel ./data klasörüne geçiliyor:",
      fallback
    );
    DATA_DIR = fallback;
    ensureDir(DATA_DIR);
    writableData = testWritable(DATA_DIR);
  }
}

if (!writableData) {
  console.warn(
    "⚠️  DATA_DIR hala yazılamıyor. Uygulama read-only çalışacak, kayıt/ürün/yorumlar kalıcı olmayabilir."
  );
}

// Varsayılan UPLOAD_DIR kalıcı diske alındı (DATA_DIR/uploads)
const DEFAULT_UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : DEFAULT_UPLOAD_DIR;

// JSON dosyaları
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const COUPONS_FILE  = path.join(DATA_DIR, "coupons.json");
const USERS_FILE    = path.join(DATA_DIR, "users.json");
const REVIEWS_FILE  = path.join(DATA_DIR, "reviews.json");

// klasör/dosya init (overwrite yapmaz)
ensureDir(DATA_DIR);
ensureDir(PUBLIC_DIR);
ensureDir(UPLOAD_DIR);
ensureFile(PRODUCTS_FILE, "[]");
ensureFile(MESSAGES_FILE, "[]");
ensureFile(COUPONS_FILE,  "[]");
ensureFile(USERS_FILE,    "[]");
ensureFile(REVIEWS_FILE,  "[]");

// Yazılabilirlik logları
const writableUploads = testWritable(UPLOAD_DIR);
if (!writableData) {
  console.warn(
    "⚠️  DATA_DIR yazılabilir değil:",
    DATA_DIR,
    " (Prod'da kalıcılık olmayacak; örn: DATA_DIR=/data için izin yok.)"
  );
}
if (!writableUploads) {
  console.warn(
    "⚠️  UPLOAD_DIR yazılabilir değil:",
    UPLOAD_DIR,
    " (Görsel yükleme kalıcı olmayabilir.)"
  );
}

/* ---------------------------- Statik servisleme --------------------------- */
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    etag: true,
    lastModified: true,
    maxAge: "7d",
    immutable: true,
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=604800, immutable")
  })
);
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

/* ---------------------------- Yardımcı Fonksiyonlar ----------------------- */
const readJSON = (file, fallback = []) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8") || "[]");
  } catch {
    return fallback;
  }
};
const writeJSON = (file, data) => {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.warn("⚠️  JSON yazılamadı, değişiklikler kalıcı olmayabilir:", file, "-", e.message);
  }
};

const containsTR   = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const isValidEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nowTS        = () => Date.now();
const clientIP     = (req) => (req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "").trim();

function isValidPhone(s = "") { return /^[+0-9()\-\s]{6,}$/.test(String(s).trim()); }
function uploadAbsPathFromPublic(p) {
  if (!p || !p.startsWith("/uploads/")) return null;
  const base = path.basename(p);
  return path.join(UPLOAD_DIR, base);
}

// Fiyat & Tarih yardımcıları
function parsePrice(text) {
  const priceText = String(text ?? "").trim();
  const num = Number(priceText.replace(/[₺\s]/g, "").replace(",", "."));
  const isNum = Number.isFinite(num);
  return { price: isNum ? num : null, priceText, purchasable: !!isNum };
}
function toISODateOrNull(d) {
  if (!d) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
function todayISODateStart() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}

/* -------------------- JWT yardımcı (guest checkout için) ------------------ */
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_STRONG";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function tryGetJWTUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded; // { uid }
  } catch {
    return null;
  }
}

/* -------------------- Ürün normalize/tamir (deploy koruması) -------------- */
function normalizeProduct(p) {
  const out = { ...p };
  out.id   = String(out.id || `p${Date.now()}`);
  out.name = String(out.name || "").trim();
  out.desc = String(out.desc || "");
  out.image = out.image || "logo.png";

  const hasNumericPrice = Number.isFinite(Number(out.price));
  if (!out.priceText && hasNumericPrice) out.priceText = String(out.price);
  if (!hasNumericPrice && out.priceText) {
    const parsed = parsePrice(out.priceText);
    if (parsed.purchasable) {
      out.price = parsed.price;
      out.priceText = parsed.priceText;
      out.purchasable = true;
    }
  }
  const isNumPrice = Number.isFinite(Number(out.price));
  out.purchasable = !!isNumPrice;
  return out;
}

function readProductsRaw() { return readJSON(PRODUCTS_FILE, []); }
function readProductsNormalized() {
  const raw = readProductsRaw();
  return Array.isArray(raw) ? raw.map(normalizeProduct) : [];
}
function writeProducts(list) {
  const fixed = Array.isArray(list) ? list.map(normalizeProduct) : [];
  writeJSON(PRODUCTS_FILE, fixed);
}

// Mesaj/kupon/kullanıcı/yorum
const readMessages  = () => readJSON(MESSAGES_FILE, []);
const writeMessages = (list) => writeJSON(MESSAGES_FILE, Array.isArray(list) ? list : []);

const readCoupons   = () => readJSON(COUPONS_FILE, []);
const writeCoupons  = (list) => writeJSON(COUPONS_FILE, Array.isArray(list) ? list : []);

const readUsers     = () => readJSON(USERS_FILE, []);
const writeUsers    = (list) => writeJSON(USERS_FILE, Array.isArray(list) ? list : []);

const readReviews   = () => readJSON(REVIEWS_FILE, []);
const writeReviews  = (list) => writeJSON(REVIEWS_FILE, Array.isArray(list) ? list : []);

/* ---------------------------- Idempotency (20s) --------------------------- */
const INFLIGHT = new Map(); // key -> ts
const IDEMP_TTL_MS = 20000;

function hashBody(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}
function idempKey(req, bodyKeys) {
  const ip = clientIP(req);
  const pick = {};
  for (const k of bodyKeys) if (req.body?.[k] !== undefined) pick[k] = req.body[k];
  if (pick.items && Array.isArray(pick.items)) {
    pick.items = pick.items.map(it => ({
      id: it.id || null,
      name: it.name || "",
      qty: Number(it.qty || 1),
      price: Number(it.price || 0)
    })).sort((a,b)=> (a.id||a.name).localeCompare(b.id||b.name));
  }
  return ip + ":" + hashBody(pick);
}
function idempGuard(keys) {
  return (req, res, next) => {
    try {
      const key = idempKey(req, keys);
      const now = nowTS();
      const last = INFLIGHT.get(key) || 0;
      if (now - last < IDEMP_TTL_MS) {
        return res.status(429).json({ success:false, message:"İşleminiz alınıyor, lütfen tekrarlamayın." });
      }
      INFLIGHT.set(key, now);
      res.on("finish", () => { setTimeout(() => INFLIGHT.delete(key), IDEMP_TTL_MS); });
      next();
    } catch (_e) {
      next();
    }
  };
}

/* -------------------------------- Rate Limit ------------------------------ */
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api/", apiLimiter);

const tightLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: "draft-7", legacyHeaders: false });

/* ----------------------------- Admin (legacy panel) ----------------------- */
// Sadece bu admin, sadece admin.html üzerinden işlem yapabilir
const ADMIN_USER = process.env.ADMIN_USER || "EDE";
const ADMIN_PASS = process.env.ADMIN_PASS || "M@v3rn!2025@Kozm0tik";
let CURRENT_TOKEN = null;

function requireLegacyAdmin(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (token && token === CURRENT_TOKEN) return next();
  return res.status(401).json({ success: false, message: "Yetkisiz işlem" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    CURRENT_TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return res.json({ success: true, token: CURRENT_TOKEN, username });
  }
  return res.status(401).json({ success: false, message: "Kullanıcı adı veya şifre hatalı" });
});

/* ----------------------------- Auth (JWT tabanlı) ------------------------- */

function requireJWT(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: "Giriş gerekli" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET); // { uid }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Geçersiz oturum" });
  }
}

// Register — ek alanlar: fullName, phone, city, address, zip, notes
app.post("/api/auth/register", tightLimiter, async (req, res) => {
  const {
    email,
    password,
    displayName,
    fullName,
    phone,
    city,
    address,
    zip,
    notes
  } = req.body || {};

  const e = String(email || "").trim().toLowerCase();
  if (!e || containsTR(e) || !isValidEmail(e)) {
    return res.status(400).json({ success:false, message:"Geçerli e-posta gerekli" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ success:false, message:"Şifre en az 6 karakter" });
  }

  const users = readUsers();
  if (users.find(u => u.email === e)) {
    return res.status(400).json({ success:false, message:"Bu e-posta zaten kayıtlı" });
  }

  const safeFullName = String(fullName || "").trim();
  const safePhone    = String(phone || "").trim();
  const safeCity     = String(city || "").trim();
  const safeAddress  = String(address || "").trim();
  const safeZip      = String(zip || "").trim().slice(0, 16);
  const safeNotes    = String(notes || "").trim().slice(0, 500);

  if (safePhone && !isValidPhone(safePhone)) {
    return res.status(400).json({ success:false, message:"Telefon formatı geçersiz" });
  }

  const hash = await bcrypt.hash(String(password), 10);
  const user = {
    id: "u" + Date.now(),
    email: e,
    passHash: hash,
    displayName: String(displayName || "").trim() || e.split("@")[0],
    fullName: safeFullName || null,
    phone: safePhone || null,
    city: safeCity || null,
    address: safeAddress || null,
    zip: safeZip || null,
    notes: safeNotes || null,
    isApproved: false,  // admin onayı gerekir
    isAdmin: false,     // anlamı yok ama field kalsın
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    lastLoginIp: null
  };
  users.push(user);
  writeUsers(users);
  return res.json({ success:true, pendingApproval:true });
});

// Login — lastLoginAt / lastLoginIp set
app.post("/api/auth/login", tightLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const e = String(email || "").trim().toLowerCase();
  const users = readUsers();
  const idx = users.findIndex(x => x.email === e);
  if (idx === -1) return res.status(400).json({ success:false, message:"Kullanıcı bulunamadı" });

  const u = users[idx];
  const ok = await bcrypt.compare(String(password || ""), u.passHash || "");
  if (!ok) return res.status(400).json({ success:false, message:"Şifre hatalı" });
  if (!u.isApproved) return res.status(403).json({ success:false, message:"Hesabınız onay bekliyor" });

  users[idx].lastLoginAt = new Date().toISOString();
  users[idx].lastLoginIp = clientIP(req) || null;
  writeUsers(users);

  // Artık JWT içinde isAdmin yok, sadece uid
  const token = signToken({ uid: u.id });

  return res.json({
    success:true,
    token,
    user:{
      id:u.id,
      email:u.email,
      displayName:u.displayName,
      fullName:u.fullName || null,
      phone:u.phone || null,
      city:u.city || null,
      address:u.address || null,
      zip:u.zip || null,
      isAdmin:!!u.isAdmin,
      isApproved:!!u.isApproved,
      createdAt:u.createdAt,
      lastLoginAt:u.lastLoginAt,
      lastLoginIp:u.lastLoginIp
    }
  });
});

// Me
app.get("/api/auth/me", requireJWT, (req, res) => {
  const users = readUsers();
  const u = users.find(x => x.id === req.user.uid);
  if (!u) return res.status(404).json({ success:false, message:"Kullanıcı yok" });
  return res.json({
    success:true,
    user:{
      id:u.id,
      email:u.email,
      displayName:u.displayName,
      fullName:u.fullName || null,
      phone:u.phone || null,
      city:u.city || null,
      address:u.address || null,
      zip:u.zip || null,
      isAdmin:!!u.isAdmin,
      isApproved:!!u.isApproved,
      createdAt:u.createdAt,
      lastLoginAt:u.lastLoginAt,
      lastLoginIp:u.lastLoginIp
    }
  });
});

// Profil güncelle
app.patch("/api/auth/profile", requireJWT, async (req, res) => {
  const {
    displayName,
    fullName,
    phone,
    city,
    address,
    zip,
    notes,
    currentPassword,
    newPassword
  } = req.body || {};

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.user.uid);
  if (idx === -1) return res.status(404).json({ success:false, message:"Kullanıcı bulunamadı" });

  const user = users[idx];

  if (displayName !== undefined) {
    const dn = String(displayName || "").trim();
    if (dn) user.displayName = dn;
  }
  if (fullName !== undefined) {
    user.fullName = String(fullName || "").trim() || null;
  }
  if (phone !== undefined) {
    const p = String(phone || "").trim();
    if (p && !isValidPhone(p)) {
      return res.status(400).json({ success:false, message:"Telefon formatı geçersiz" });
    }
    user.phone = p || null;
  }
  if (city !== undefined) {
    user.city = String(city || "").trim() || null;
  }
  if (address !== undefined) {
    user.address = String(address || "").trim() || null;
  }
  if (zip !== undefined) {
    user.zip = String(zip || "").trim().slice(0, 16) || null;
  }
  if (notes !== undefined) {
    user.notes = String(notes || "").trim().slice(0, 500) || null;
  }

  if (newPassword) {
    const curr = String(currentPassword || "");
    const ok = await bcrypt.compare(curr, user.passHash || "");
    if (!ok) return res.status(400).json({ success:false, message:"Mevcut şifre hatalı" });
    if (String(newPassword).length < 6) return res.status(400).json({ success:false, message:"Yeni şifre en az 6 karakter" });
    const hash = await bcrypt.hash(String(newPassword), 10);
    user.passHash = hash;
  }

  users[idx] = user;
  writeUsers(users);
  res.json({
    success:true,
    user:{
      id:user.id,
      email:user.email,
      displayName:user.displayName,
      fullName:user.fullName || null,
      phone:user.phone || null,
      city:user.city || null,
      address:user.address || null,
      zip:user.zip || null,
      isAdmin:!!user.isAdmin,
      isApproved:!!user.isApproved,
      createdAt:user.createdAt,
      lastLoginAt:user.lastLoginAt,
      lastLoginIp:user.lastLoginIp
    }
  });
});

/* ----------------------------- Admin: Users -------------------------------- */
// Tüm kullanıcılar — sadece legacy admin
app.get("/api/admin/users", requireLegacyAdmin, (_req, res) => {
  const users = readUsers().map(u => ({
    id:u.id,
    email:u.email,
    displayName:u.displayName,
    fullName:u.fullName || null,
    phone:u.phone || null,
    city:u.city || null,
    address:u.address || null,
    zip:u.zip || null,
    notes:u.notes || null,
    isApproved:!!u.isApproved,
    isAdmin:!!u.isAdmin,
    createdAt:u.createdAt,
    lastLoginAt:u.lastLoginAt || null,
    lastLoginIp:u.lastLoginIp || null
  }));
  res.json({ success:true, items: users });
});

// Sadece onay durumu değişir (admin yapma yok)
app.patch("/api/admin/users/:id/approve", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { approved } = req.body || {};
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ success:false, message:"Kullanıcı bulunamadı" });

  if (typeof approved === "boolean") {
    users[idx].isApproved = approved;
  }
  // isAdmin burada değiştirilmez

  writeUsers(users);
  const u = users[idx];
  res.json({
    success:true,
    user:{
      id:u.id,
      email:u.email,
      isApproved:!!u.isApproved,
      isAdmin:!!u.isAdmin
    }
  });
});

// Kullanıcı silme
app.delete("/api/admin/users/:id", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let users = readUsers();
  const before = users.length;
  users = users.filter(u => u.id !== id);
  if (users.length === before) return res.status(404).json({ success:false, message:"Kullanıcı bulunamadı" });
  writeUsers(users);
  // kullanıcının yorumlarını da sil
  let revs = readReviews();
  const newRevs = revs.filter(r => r.userId !== id);
  if (newRevs.length !== revs.length) writeReviews(newRevs);
  res.json({ success:true });
});

/* --------------------------------- SMTP (Brevo) --------------------------- */
const secureFlag =
  String(process.env.BREVO_SECURE || "").toLowerCase() === "true" ||
  Number(process.env.BREVO_PORT) === 465;

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_HOST || "smtp-relay.brevo.com",
  port: Number(process.env.BREVO_PORT || 587),
  secure: secureFlag,
  auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_PASS },
  pool: true,
  maxConnections: 3,
  maxMessages: 50,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  tls: { rejectUnauthorized: false }
});

app.get("/api/mail/health", (_req, res) => res.json({ ok: true, app: "alive" }));
app.post("/api/admin/test-send", requireLegacyAdmin, async (_req, res) => {
  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || "Mavern"}" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
      to: process.env.MAIL_TO || process.env.BREVO_USER,
      subject: "Mavern SMTP Test",
      text: "Bu bir test e-postasıdır."
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get("/api/mail/verify", async (_req, res) => {
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- ÜRÜNLER (müşteri) --------------------------- */
app.get("/api/products", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readProductsNormalized());
});

/* ------------------------------- Upload (multer) -------------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    const safeBase = (file.originalname || "file")
      .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-\.]/g, "")
      .replace(/\.[^\.]+$/, "").slice(0, 40);
    cb(null, `${Date.now()}_${safeBase}.${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Sadece JPG/PNG/WEBP yükleyin"), ok);
  }
});

// Admin upload (legacy admin)
app.post("/api/admin/upload", requireLegacyAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Dosya yok" });
  res.json({ success: true, path: "/uploads/" + req.file.filename });
});

// Üye upload (yorum fotoğrafları)
app.post("/api/reviews/upload", requireJWT, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Dosya yok" });
  res.json({ success: true, path: "/uploads/" + req.file.filename });
});

/* ------------------------------- Ürünler (admin) -------------------------- */
app.post("/api/admin/products", requireLegacyAdmin, (req, res) => {
  const { name, price, image, desc } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: "İsim gerekli" });

  const list = readProductsNormalized();
  const parsed = parsePrice(price);

  const item = normalizeProduct({
    id: "p" + Date.now(),
    name: String(name).trim(),
    price: parsed.price,
    priceText: parsed.priceText,
    purchasable: parsed.purchasable,
    image: image || "logo.png",
    desc: String(desc || "")
  });
  list.push(item);
  writeProducts(list);
  res.json({ success: true, item });
});

app.put("/api/admin/products/:id", requireLegacyAdmin, (req, res) => {
  const id = req.params.id;
  const { name, price, image, desc } = req.body || {};
  const list = readProductsNormalized();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Ürün bulunamadı" });

  const oldImage = list[idx].image;

  if (name  !== undefined) list[idx].name  = String(name).trim();
  if (price !== undefined) {
    const parsed = parsePrice(price);
    list[idx].price = parsed.price;
    list[idx].priceText = parsed.priceText;
    list[idx].purchasable = parsed.purchasable;
  }
  if (image !== undefined) list[idx].image = String(image || "logo.png");
  if (desc  !== undefined) list[idx].desc  = String(desc);

  list[idx] = normalizeProduct(list[idx]);
  writeProducts(list);

  if (image !== undefined && oldImage && oldImage.startsWith("/uploads/") && oldImage !== list[idx].image) {
    const stillUsed = readProductsNormalized().some(p => p.image === oldImage);
    const abs = uploadAbsPathFromPublic(oldImage);
    if (!stillUsed && abs && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    }
  }
  res.json({ success: true, item: list[idx] });
});

app.delete("/api/admin/products/:id", requireLegacyAdmin, (req, res) => {
  const id = req.params.id;
  let list = readProductsNormalized();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Ürün bulunamadı" });

  const img = list[idx].image;
  list.splice(idx, 1);
  writeProducts(list);

  if (img && img.startsWith("/uploads/")) {
    const used = readProductsNormalized().some(p => p.image === img);
    const abs = uploadAbsPathFromPublic(img);
    if (!used && abs && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    }
  }
  res.json({ success: true });
});

/* --------------------------------- Kuponlar -------------------------------- */
app.post("/api/coupon/check", (req, res) => {
  const { code } = req.body || {};
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return res.json({ success: false, message: "Kod gerekli" });

  const coupons = readCoupons();
  const found = coupons.find(c => c.code === normalized);
  if (!found) return res.json({ success: false, message: "Geçersiz kod" });
  if (found.active === false) return res.json({ success: false, message: "Kod pasif" });

  const now = nowTS();
  if (found.startsAt) {
    const st = Date.parse(found.startsAt);
    if (!Number.isNaN(st) && now < st) {
      return res.json({ success: false, message: "Kod henüz başlamadı" });
    }
  }
  if (found.expiresAt) {
    const exp = Date.parse(found.expiresAt);
    if (!Number.isNaN(exp) && now > exp) {
      return res.json({ success: false, message: "Kod süresi dolmuş" });
    }
  }

  const percent = Number(found.percent || 0);
  if (!(percent > 0 && percent <= 90)) {
    return res.json({ success: false, message: "Kod yapılandırması geçersiz" });
  }
  return res.json({
    success: true,
    percent,
    startsAt: found.startsAt || null,
    expiresAt: found.expiresAt || null
  });
});

app.get("/api/admin/coupons", requireLegacyAdmin, (_req, res) => {
  res.json({ success: true, items: readCoupons() });
});

app.post("/api/admin/coupons", requireLegacyAdmin, (req, res) => {
  let { code, percent, active, startsAt, expiresAt } = req.body || {};
  code = String(code || "").trim().toUpperCase();
  const p = Number(percent);
  if (!code) return res.status(400).json({ success: false, message: "Kod gerekli" });
  if (!(p > 0 && p <= 90)) return res.status(400).json({ success: false, message: "Yüzde 1–90 arasında olmalı" });

  const list = readCoupons();
  if (list.find(c => c.code === code)) return res.status(400).json({ success: false, message: "Bu kod zaten var" });

  const startsISO = toISODateOrNull(startsAt) || todayISODateStart();
  const expISO = toISODateOrNull(expiresAt);

  const item = {
    id: "c" + Date.now(),
    code,
    percent: p,
    active: active === false ? false : true,
    startsAt: startsISO,
    expiresAt: expISO,
    createdAt: new Date().toISOString()
  };
  list.push(item);
  writeCoupons(list);
  res.json({ success: true, item });
});

app.delete("/api/admin/coupons/:code", requireLegacyAdmin, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  let list = readCoupons();
  const before = list.length;
  list = list.filter(c => c.code !== code);
  if (list.length === before) return res.status(404).json({ success: false, message: "Kod bulunamadı" });
  writeCoupons(list);
  res.json({ success: true });
});

/* ------------------------------ Mesaj Kutusu / Siparişler ----------------- */
app.get("/api/admin/messages", requireLegacyAdmin, (req, res) => {
  const type = String(req.query.type || "").trim();
  let list = readMessages().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  if (type === "contact" || type === "order") list = list.filter(m => m.type === type);
  res.json({ success: true, items: list });
});

app.patch("/api/admin/messages/:id/read", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const list = readMessages();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Mesaj bulunamadı" });
  list[idx].read = true;
  writeMessages(list);
  res.json({ success: true, item: list[idx] });
});

app.delete("/api/admin/messages/:id", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let list = readMessages();
  const before = list.length;
  list = list.filter(m => m.id !== id);
  if (list.length === before) return res.status(404).json({ success: false, message: "Mesaj bulunamadı" });
  writeMessages(list);
  res.json({ success: true });
});

// Admin: sipariş durum & takip kodu
app.patch("/api/admin/orders/:id", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { status, trackingCode, read } = req.body || {};
  const list = readMessages();
  const idx = list.findIndex(m => m.id === id && m.type === "order");
  if (idx === -1) return res.status(404).json({ success:false, message:"Sipariş bulunamadı" });

  if (status !== undefined) {
    const allowed = ["pending","preparing","shipped","completed","cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success:false, message:"Geçersiz durum" });
    }
    list[idx].status = status;
  }
  if (trackingCode !== undefined) {
    const tc = String(trackingCode || "").trim();
    list[idx].trackingCode = tc || null;
  }
  if (typeof read === "boolean") {
    list[idx].read = read;
  }

  writeMessages(list);
  res.json({ success:true, item:list[idx] });
});

app.post("/api/admin/messages/:id/resend", requireLegacyAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const list = readMessages();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Mesaj bulunamadı" });

  const msg = list[idx];
  try {
    if (msg.type === "contact") {
      await transporter.sendMail({
        from: `"${process.env.FROM_NAME || "Mavern Site"}" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
        replyTo: msg.email || undefined,
        to: process.env.MAIL_TO || process.env.BREVO_USER,
        subject: `Mavern İletişim - ${msg.name || "-"}`,
        text: `Gönderen: ${msg.name || "-"} - ${msg.email || "-"}\n\nMesaj:\n${msg.message || ""}`
      });
    } else if (msg.type === "order") {
      const lines = (msg.items || []).map(it => `• ${it.name} x${it.qty || 1} — ${it.price}₺`).join("\n");
      await transporter.sendMail({
        from: `"Mavern Sipariş" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
        to: process.env.MAIL_TO || process.env.BREVO_USER,
        subject: "Yeni Sipariş (Yeniden Gönderim)",
        text:
`Müşteri: ${msg.name || "-"} (${msg.email || "-"})
Telefon : ${msg.phone || "-"}
Adres   : ${msg.address || "-"}

Ürünler:
${lines}

Kupon: ${msg.coupon || "-"}
İndirim: ${msg.discount || 0}₺
Ödenecek: ${msg.payable || 0}₺`
      });
    } else {
      return res.status(400).json({ success: false, message: "Bu mesaj tipi için destek yok" });
    }
    list[idx].mailSent = true;
    list[idx].mailError = null;
    writeMessages(list);
    res.json({ success: true, message: "Mail yeniden gönderildi" });
  } catch (e) {
    list[idx].mailSent = false;
    list[idx].mailError = e.message || String(e);
    writeMessages(list);
    res.status(500).json({ success: false, message: "Yeniden gönderilemedi: " + e.message });
  }
});

/* --------------------------- İletişim & Checkout --------------------------- */
app.post("/api/contact", tightLimiter, idempGuard(["name","email","message"]), async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: "Lütfen tüm alanları doldurun." });
  }
  if (containsTR(email)) return res.status(400).json({ success: false, message: "E-posta adresinde Türkçe karakter kullanmayın." });
  if (!isValidEmail(email)) return res.status(400).json({ success: false, message: "Geçerli bir e-posta girin." });

  const list = readMessages();
  const id = "m" + Date.now();
  const rec = { id, type:"contact", name, email, message, createdAt: new Date().toISOString(), read:false, mailSent:false, mailError:null };
  list.push(rec);
  writeMessages(list);

  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || "Mavern Site"}" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
      replyTo: email,
      to: process.env.MAIL_TO || process.env.BREVO_USER,
      subject: `Mavern İletişim - ${name}`,
      text: `Gönderen: ${name} - ${email}\n\nMesaj:\n${message}`
    });
    const L = readMessages();
    const i = L.findIndex(m => m.id === id);
    if (i > -1) { L[i].mailSent = true; L[i].mailError = null; writeMessages(L); }
    res.json({ success: true, message: "Mesaj gönderildi." });
  } catch (e) {
    console.error("Mail hata (contact):", e.message);
    res.json({ success: true, message: "Mesaj kaydedildi, e-posta şu an gönderilemedi." });
  }
});

// CHECKOUT
app.post("/api/checkout", tightLimiter, idempGuard(["items","email","name","phone","address","coupon"]), async (req, res) => {
  const { items, email, name, phone, address, coupon } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Sepet boş." });
  }

  if (!name || !email || !phone || !address) {
    return res.status(400).json({ success: false, message: "Lütfen ad, e-posta, telefon ve adres bilgilerini girin." });
  }
  if (containsTR(email)) return res.status(400).json({ success: false, message: "E-posta adresinde Türkçe karakter kullanmayın." });
  if (!isValidEmail(email)) return res.status(400).json({ success: false, message: "Geçerli bir e-posta girin." });
  if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: "Geçerli bir telefon numarası girin." });

  const addr = String(address).trim();
  if (addr.length < 10) return res.status(400).json({ success: false, message: "Adres çok kısa (min 10 karakter)." });
  if (addr.length > 600) return res.status(400).json({ success: false, message: "Adres çok uzun (max 600 karakter)." });

  const all = readProductsNormalized();
  const notBuyable = [];
  const normalizedItems = [];

  for (const it of items) {
    const found = it.id ? all.find(p => p.id === it.id) : all.find(p => p.name === it.name);
    if (!found) { notBuyable.push({ name: it.name || "(?)", reason: "ürün bulunamadı" }); continue; }
    if (!found.purchasable || !Number.isFinite(found.price)) {
      notBuyable.push({ name: found.name, reason: "satılamıyor (fiyat sayısal değil)" }); continue;
    }
    const qty = Math.max(1, Number(it.qty || 1));
    normalizedItems.push({ id: found.id, name: found.name, price: Number(found.price), qty });
  }

  if (notBuyable.length > 0) {
    return res.status(400).json({ success:false, message: "Sepette satılamayan ürün(ler) var.", notBuyable });
  }

  const total = normalizedItems.reduce((s, it) => s + it.price * it.qty, 0);

  // Kupon
  let discount = 0;
  let appliedCoupon = null;
  if (coupon) {
    const normalized = String(coupon).trim().toUpperCase();
    const coupons = readCoupons();
    const now = nowTS();
    const found = coupons.find(c => c.code === normalized && c.active !== false);
    if (found) {
      let usable = true;
      if (found.startsAt) {
        const st = Date.parse(found.startsAt);
        if (!Number.isNaN(st) && now < st) usable = false;
      }
      if (usable && found.expiresAt) {
        const exp = Date.parse(found.expiresAt);
        if (!Number.isNaN(exp) && now > exp) usable = false;
      }
      if (usable && Number(found.percent) > 0 && Number(found.percent) <= 90) {
        appliedCoupon = found.code;
        discount = Math.round(total * (Number(found.percent) / 100));
      }
    }
  }

  const payable = total - discount;
  const lines = normalizedItems.map(it => `• ${it.name} x${it.qty} — ${it.price}₺`).join("\n");

  // Oturumdan kullanıcıyı bağla (login'li ise)
  const decoded = tryGetJWTUser(req);
  const userId = decoded?.uid || null;

  const list = readMessages();
  const id = "o" + Date.now();
  const orderRec = {
    id,
    type: "order",
    name: name || "-",
    email: email || "-",
    phone: phone || "-",
    address: addr,
    items: normalizedItems,
    coupon: appliedCoupon,
    total,
    discount,
    payable,
    userId: userId,
    status: "pending",
    trackingCode: null,
    createdAt: new Date().toISOString(),
    read: false,
    mailSent: false,
    mailError: null
  };
  list.push(orderRec);
  writeMessages(list);

  try {
    await transporter.sendMail({
      from: `"Mavern Sipariş" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
      to: process.env.MAIL_TO || process.env.BREVO_USER,
      subject: "Yeni Sipariş",
      text:
`Müşteri: ${name} (${email})
Telefon : ${phone}
Adres   : ${addr}

Ürünler:
${lines}

Kupon: ${appliedCoupon || "-"}
İndirim: ${discount}₺
Ödenecek: ${payable}₺`
    });

    const L = readMessages();
    const i = L.findIndex(m => m.id === id);
    if (i > -1) { L[i].mailSent = true; L[i].mailError = null; writeMessages(L); }

    res.json({ success: true, message: "Sipariş iletildi.", total, discount, payable, orderId: id });
  } catch (e) {
    console.error("Checkout mail hata:", e.message);
    res.json({
      success: true,
      message: "Sipariş kaydedildi, e-posta şu an gönderilemedi.",
      total,
      discount,
      payable,
      orderId: id
    });
  }
});

/* -------------------------- Kullanıcı tarafı siparişler ------------------- */

// Login'li kullanıcının tüm siparişleri
app.get("/api/orders/my", requireJWT, (req, res) => {
  const uid = req.user.uid;
  let list = readMessages()
    .filter(m => m.type === "order" && m.userId === uid)
    .sort((a,b) => (a.createdAt > b.createdAt ? -1 : 1));

  list = list.map(o => ({
    ...o,
    status: o.status || "pending",
    trackingCode: o.trackingCode || null
  }));

  res.json({ success:true, items:list });
});

// Login'li kullanıcının tek siparişi
app.get("/api/orders/:id", requireJWT, (req, res) => {
  const uid = req.user.uid;
  const id = String(req.params.id || "");
  const msg = readMessages().find(m => m.id === id && m.type === "order");
  if (!msg) return res.status(404).json({ success:false, message:"Sipariş bulunamadı" });
  if (msg.userId !== uid) return res.status(403).json({ success:false, message:"Bu siparişi görüntüleme yetkiniz yok" });

  const out = {
    ...msg,
    status: msg.status || "pending",
    trackingCode: msg.trackingCode || null
  };
  res.json({ success:true, item: out });
});

/* ------------------------------- Reviews ----------------------------------- */
// Public: bir ürünün onaylı yorumları
app.get("/api/products/:pid/reviews", (req, res) => {
  const pid = String(req.params.pid || "");
  const revs = readReviews().filter(r => r.productId === pid && r.approved === true)
    .sort((a,b) => (a.createdAt > b.createdAt ? -1 : 1));
  res.json({ success:true, items: revs });
});

// Üye: yorum ekle (JWT gerekli)
app.post("/api/products/:pid/reviews", requireJWT, async (req, res) => {
  const pid = String(req.params.pid || "");
  const { rating, comment, photos, anonymous } = req.body || {};

  const prod = readProductsNormalized().find(p => p.id === pid);
  if (!prod) return res.status(404).json({ success:false, message:"Ürün bulunamadı" });

  const users = readUsers();
  const me = users.find(u => u.id === req.user.uid);
  if (!me || !me.isApproved) return res.status(403).json({ success:false, message:"Hesabınız onaylı değil" });

  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) return res.status(400).json({ success:false, message:"Puan 1-5 arası olmalı" });

  let ph = [];
  if (Array.isArray(photos)) {
    ph = photos
      .map(p => String(p || ""))
      .filter(p => p.startsWith("/uploads/"))
      .slice(0, 5);
  }

  const revs = readReviews();
  const rec = {
    id: "r" + Date.now(),
    productId: pid,
    userId: me.id,
    displayName: anonymous ? "Gizli Kullanıcı" : (me.displayName || me.email),
    anonymous: !!anonymous,
    rating: r,
    comment: String(comment || "").trim(),
    photos: ph,
    approved: false,
    createdAt: new Date().toISOString()
  };
  revs.push(rec);
  writeReviews(revs);

  res.json({ success:true, pendingApproval:true, itemId: rec.id });
});

// Admin: yorumlar (legacy admin)
app.get("/api/admin/reviews", requireLegacyAdmin, (req, res) => {
  const pid = String(req.query.productId || "");
  let items = readReviews().sort((a,b)=> (a.createdAt > b.createdAt ? -1 : 1));
  if (pid) items = items.filter(r => r.productId === pid);
  res.json({ success:true, items });
});
app.patch("/api/admin/reviews/:id/approve", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { approved } = req.body || {};
  let revs = readReviews();
  const idx = revs.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ success:false, message:"Yorum bulunamadı" });
  if (typeof approved === "boolean") revs[idx].approved = approved;
  writeReviews(revs);
  res.json({ success:true, item: revs[idx] });
});
app.delete("/api/admin/reviews/:id", requireLegacyAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let revs = readReviews();
  const before = revs.length;
  revs = revs.filter(r => r.id !== id);
  if (revs.length === before) return res.status(404).json({ success:false, message:"Yorum bulunamadı" });
  writeReviews(revs);
  res.json({ success:true });
});

/* ------------------------------- Fallback/Server --------------------------- */
app.get("/api/version", (_req, res) => res.json({ name: "mavern", version: "1.2.0-admin-simplified" }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* ---------------------------- Boot-time Products Repair -------------------- */
(function bootRepairProducts() {
  try {
    const raw = readProductsRaw();
    const fixed = Array.isArray(raw) ? raw.map(normalizeProduct) : [];
    if (JSON.stringify(raw) !== JSON.stringify(fixed)) {
      writeJSON(PRODUCTS_FILE, fixed);
      console.log("🛠  products.json normalize edildi (boot-repair).");
    }
  } catch (e) {
    console.warn("products boot-repair atlandı:", e.message);
  }
})();

/* --------------------------------- Server --------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mavern sunucusu çalışıyor: http://localhost:${PORT}`);
  console.log(`📦 DATA_DIR:   ${DATA_DIR}  ${writableData ? "(yazılabilir)" : "(YAZILAMAZ!)"}`);
  console.log(`🖼  UPLOAD_DIR: ${UPLOAD_DIR}  ${writableUploads ? "(yazılabilir)" : "(YAZILAMAZ!)"}`);
  if (!ENV_DATA_DIR) {
    console.log("ℹ️  DATA_DIR ENV tanımlı değil. Varsayılan yerel ./data kullanılıyor. Prod ortamda kalıcılık için istersen DATA_DIR verebilirsin (yazılabilir olmalı).");
  }
});
