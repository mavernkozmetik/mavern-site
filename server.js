// server.js — Mavern (Brevo SMTP + Kupon startsAt + Mesaj Kutusu + Güvenli Upload + Rate Limit + Helmet + HTTPS)

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

const app = express();

/* ---------------------------- Güvenlik / Temel ---------------------------- */
app.set("trust proxy", 1);

// CSP: inline <script>/<style> ve data: görsellere izin ver (site JS’leri çalışsın)
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

// CORS
app.use(cors({ origin: true, credentials: false }));

// Gövde boyutu limiti
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// HTTP -> HTTPS yönlendirme (Render vb.)
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
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const COUPONS_FILE = path.join(DATA_DIR, "coupons.json");

// Klasör/JSON başlangıcı
for (const [p, init] of [
  [DATA_DIR],
  [PUBLIC_DIR],
  [UPLOAD_DIR],
  [PRODUCTS_FILE, "[]"],
  [MESSAGES_FILE, "[]"],
  [COUPONS_FILE, "[]"]
]) {
  const isFile = typeof init === "string";
  if (isFile) {
    if (!fs.existsSync(p)) fs.writeFileSync(p, init, "utf8");
  } else {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
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
  try { return JSON.parse(fs.readFileSync(file, "utf8") || "[]"); }
  catch { return fallback; }
};
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");

const readProducts  = () => readJSON(PRODUCTS_FILE);
const writeProducts = (list) => writeJSON(PRODUCTS_FILE, list);

const readMessages  = () => readJSON(MESSAGES_FILE);
const writeMessages = (list) => writeJSON(MESSAGES_FILE, list);

const readCoupons   = () => readJSON(COUPONS_FILE);
const writeCoupons  = (list) => writeJSON(COUPONS_FILE, list);

const containsTR = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const isValidEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nowTS = () => Date.now();

function isValidPhone(s = "") {
  const x = String(s).trim();
  // Basit: rakam, boşluk, + (başta), parantez ve tire izinli; min 6 karakter
  return /^[+0-9()\-\s]{6,}$/.test(x);
}

function uploadAbsPathFromPublic(p) {
  if (!p || !p.startsWith("/uploads/")) return null;
  const base = path.basename(p);
  return path.join(UPLOAD_DIR, base);
}

// ---- Fiyat & Tarih yardımcıları ----
function parsePrice(text) {
  // Dönen: { price: number|null, priceText: string, purchasable: boolean }
  const priceText = String(text ?? "").trim();
  const num = Number(
    priceText
      .replace(/[₺\s]/g, "")
      .replace(",", ".")
  );
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

/* -------------------------------- Rate Limit ------------------------------ */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
app.use("/api/", apiLimiter);

const tightLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

/* --------------------------------- Admin Auth ----------------------------- */
const ADMIN_USER = "EDE";
const ADMIN_PASS = "M@v3rn!2025@Kozm0tik";
let CURRENT_TOKEN = null;

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token || token !== CURRENT_TOKEN) {
    return res.status(401).json({ success: false, message: "Yetkisiz işlem" });
  }
  next();
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    CURRENT_TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return res.json({ success: true, token: CURRENT_TOKEN });
  }
  return res.status(401).json({ success: false, message: "Kullanıcı adı veya şifre hatalı" });
});

/* --------------------------------- SMTP (Brevo) --------------------------- */
const secureFlag =
  String(process.env.BREVO_SECURE || "").toLowerCase() === "true" ||
  Number(process.env.BREVO_PORT) === 465;

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_HOST || "smtp-relay.brevo.com",
  port: Number(process.env.BREVO_PORT || 587),
  secure: secureFlag, // 587 => false, 465 => true
  auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_PASS },
  pool: true,
  maxConnections: 3,
  maxMessages: 50,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  tls: { rejectUnauthorized: false }
});

// Basit sağlık (SMTP'ye dokunmaz)
app.get("/api/mail/health", (_req, res) => res.json({ ok: true, app: "alive" }));

// SMTP canlı test (korumalı)
app.post("/api/admin/test-send", requireAuth, async (_req, res) => {
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

// SMTP verify (isteğe bağlı)
app.get("/api/mail/verify", async (_req, res) => {
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- ÜRÜNLER (müşteri) --------------------------- */
app.get("/api/products", (_req, res) => res.json(readProducts()));

/* ------------------------------- Upload (multer) -------------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    const safeBase = (file.originalname || "file")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_\-\.]/g, "")
      .replace(/\.[^\.]+$/, "")
      .slice(0, 40);
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

app.post("/api/admin/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Dosya yok" });
  res.json({ success: true, path: "/uploads/" + req.file.filename });
});

/* ------------------------------- Ürünler (admin) -------------------------- */
// Fiyat artık metin de olabilir: priceText saklanır, sayısal ise purchasable=true
app.post("/api/admin/products", requireAuth, (req, res) => {
  const { name, price, image, desc } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: "İsim gerekli" });

  const list = readProducts();
  const parsed = parsePrice(price);

  const item = {
    id: "p" + Date.now(),
    name: String(name).trim(),
    price: parsed.price,             // number | null
    priceText: parsed.priceText,     // "150₺", "yakında", vb.
    purchasable: parsed.purchasable, // sayıysa true
    image: image || "logo.png",
    desc: String(desc || "")
  };
  list.push(item);
  writeProducts(list);
  res.json({ success: true, item });
});

app.put("/api/admin/products/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const { name, price, image, desc } = req.body || {};
  const list = readProducts();
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
  if (image !== undefined) list[idx].image = String(image);
  if (desc  !== undefined) list[idx].desc  = String(desc);

  writeProducts(list);

  // Eski görseli başka ürün kullanmıyorsa sil
  if (image !== undefined && oldImage && oldImage.startsWith("/uploads/") && oldImage !== list[idx].image) {
    const stillUsed = readProducts().some(p => p.image === oldImage);
    const abs = uploadAbsPathFromPublic(oldImage);
    if (!stillUsed && abs && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    }
  }

  res.json({ success: true, item: list[idx] });
});

app.delete("/api/admin/products/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  let list = readProducts();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Ürün bulunamadı" });

  const img = list[idx].image;
  list.splice(idx, 1);
  writeProducts(list);

  if (img && img.startsWith("/uploads/")) {
    const used = readProducts().some(p => p.image === img);
    const abs = uploadAbsPathFromPublic(img);
    if (!used && abs && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    }
  }

  res.json({ success: true });
});

/* --------------------------------- Kuponlar -------------------------------- */
// Kupon check: startsAt + expiresAt
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

app.get("/api/admin/coupons", requireAuth, (_req, res) => {
  res.json({ success: true, items: readCoupons() });
});

// Kupon create: startsAt opsiyonel (boş ise bugün 00:00), expiresAt opsiyonel
app.post("/api/admin/coupons", requireAuth, (req, res) => {
  let { code, percent, active, startsAt, expiresAt } = req.body || {};
  code = String(code || "").trim().toUpperCase();
  const p = Number(percent);
  if (!code) return res.status(400).json({ success: false, message: "Kod gerekli" });
  if (!(p > 0 && p <= 90)) return res.status(400).json({ success: false, message: "Yüzde 1–90 arasında olmalı" });

  const list = readCoupons();
  if (list.find(c => c.code === code)) return res.status(400).json({ success: false, message: "Bu kod zaten var" });

  const startsISO = toISODateOrNull(startsAt) || todayISODateStart();
  const expISO = toISODateOrNull(expiresAt); // boş olabilir

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

app.delete("/api/admin/coupons/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  let list = readCoupons();
  const before = list.length;
  list = list.filter(c => c.code !== code);
  if (list.length === before) return res.status(404).json({ success: false, message: "Kod bulunamadı" });
  writeCoupons(list);
  res.json({ success: true });
});

/* ------------------------------ Mesaj Kutusu -------------------------------- */
app.get("/api/admin/messages", requireAuth, (req, res) => {
  const type = String(req.query.type || "").trim();
  let list = readMessages().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  if (type === "contact" || type === "order") list = list.filter(m => m.type === type);
  res.json({ success: true, items: list });
});

app.patch("/api/admin/messages/:id/read", requireAuth, (req, res) => {
  const id = String(req.params.id || "");
  const list = readMessages();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Mesaj bulunamadı" });
  list[idx].read = true;
  writeMessages(list);
  res.json({ success: true, item: list[idx] });
});

app.delete("/api/admin/messages/:id", requireAuth, (req, res) => {
  const id = String(req.params.id || "");
  let list = readMessages();
  const before = list.length;
  list = list.filter(m => m.id !== id);
  if (list.length === before) return res.status(404).json({ success: false, message: "Mesaj bulunamadı" });
  writeMessages(list);
  res.json({ success: true });
});

// Mesaj mailini yeniden gönder
app.post("/api/admin/messages/:id/resend", requireAuth, async (req, res) => {
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
app.post("/api/contact", tightLimiter, async (req, res) => {
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

// CHECKOUT: ad, email, telefon, adres ZORUNLU + satılamayan ürünü engelle + kupon
app.post("/api/checkout", tightLimiter, async (req, res) => {
  const { items, email, name, phone, address, coupon } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Sepet boş." });
  }

  // Kişi/iletişim zorunluluğu
  if (!name || !email || !phone || !address) {
    return res.status(400).json({ success: false, message: "Lütfen ad, e-posta, telefon ve adres bilgilerini girin." });
  }
  if (containsTR(email)) return res.status(400).json({ success: false, message: "E-posta adresinde Türkçe karakter kullanmayın." });
  if (!isValidEmail(email)) return res.status(400).json({ success: false, message: "Geçerli bir e-posta girin." });
  if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: "Geçerli bir telefon numarası girin." });

  const addr = String(address).trim();
  if (addr.length < 10) return res.status(400).json({ success: false, message: "Adres çok kısa (min 10 karakter)." });
  if (addr.length > 600) return res.status(400).json({ success: false, message: "Adres çok uzun (max 600 karakter)." });

  // Ürünleri güncel listeden doğrula (id varsa id ile, yoksa isimle)
  const all = readProducts();
  const notBuyable = [];
  const normalizedItems = [];

  for (const it of items) {
    const found = it.id ? all.find(p => p.id === it.id) : all.find(p => p.name === it.name);
    if (!found) {
      notBuyable.push({ name: it.name || "(?)", reason: "ürün bulunamadı" });
      continue;
    }
    if (!found.purchasable || !Number.isFinite(found.price)) {
      notBuyable.push({ name: found.name, reason: "satılamıyor (fiyat sayısal değil)" });
      continue;
    }
    const qty = Math.max(1, Number(it.qty || 1));
    normalizedItems.push({ id: found.id, name: found.name, price: found.price, qty });
  }

  if (notBuyable.length > 0) {
    return res.status(400).json({
      success:false,
      message: "Sepette satılamayan ürün(ler) var.",
      notBuyable
    });
  }

  const total = normalizedItems.reduce((s, it) => s + it.price * it.qty, 0);

  // Kupon uygula (startsAt/expiresAt dâhil)
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

  const list = readMessages();
  const id = "o" + Date.now();
  const orderRec = {
    id, type:"order",
    name: name || "-",
    email: email || "-",
    phone: phone || "-",
    address: addr,
    items: normalizedItems,
    coupon: appliedCoupon,
    total, discount, payable,
    createdAt: new Date().toISOString(),
    read:false, mailSent:false, mailError:null
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

    res.json({ success: true, message: "Sipariş iletildi.", total, discount, payable });
  } catch (e) {
    console.error("Checkout mail hata:", e.message);
    res.json({ success: true, message: "Sipariş kaydedildi, e-posta şu an gönderilemedi.", total, discount, payable });
  }
});

/* ------------------------------- Fallback/Server --------------------------- */
app.get("/api/version", (_req, res) => res.json({ name: "mavern", version: "1.0.0" }));

// Frontend routing (en sonda, API’leri gölgelemesin)
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mavern sunucusu çalışıyor: http://localhost:${PORT}`);
});
