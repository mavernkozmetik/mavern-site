// server.js — Mavern (Brevo SMTP + Kupon + Mesaj Kutusu + Güvenli Görsel Yükleme/Silme)

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");
const multer = require("multer");
const mime = require("mime-types");

const app = express();

// ---------- TEMEL ----------
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR     = path.join(__dirname, "data");
const UPLOAD_DIR   = path.join(__dirname, "public", "uploads");
const PRODUCTS_FILE= path.join(DATA_DIR, "products.json");
const MESSAGES_FILE= path.join(DATA_DIR, "messages.json");
const COUPONS_FILE = path.join(DATA_DIR, "coupons.json");

// klasörleri hazırla
for (const [p, init] of [
  [DATA_DIR], [UPLOAD_DIR],
  [PRODUCTS_FILE, "[]"], [MESSAGES_FILE, "[]"], [COUPONS_FILE, "[]"]
]) {
  const isFile = p.endsWith(".json");
  if (isFile) { if (!fs.existsSync(p)) fs.writeFileSync(p, init, "utf8"); }
  else { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
}

// uploads statik servis
app.use("/uploads", express.static(UPLOAD_DIR));

// ---------- ADMIN GİRİŞ ----------
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

// ---------- DOSYA YARDIMCI ----------
const readJSON  = (file, fallback = []) => { try { return JSON.parse(fs.readFileSync(file, "utf8") || "[]"); } catch { return fallback; } };
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");

const readProducts  = () => readJSON(PRODUCTS_FILE);
const writeProducts = (list) => writeJSON(PRODUCTS_FILE, list);

const readMessages  = () => readJSON(MESSAGES_FILE);
const writeMessages = (list) => writeJSON(MESSAGES_FILE, list);

const readCoupons   = () => readJSON(COUPONS_FILE);
const writeCoupons  = (list) => writeJSON(COUPONS_FILE, list);

// ---------- GENEL YARDIMCI ----------
const containsTR = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const isValidEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nowTS = () => Date.now();

// uploads içinden güvenli tam yol elde et
function uploadAbsPathFromPublic(p) {
  // beklenen format: "/uploads/filename.ext"
  if (!p || !p.startsWith("/uploads/")) return null;
  const base = path.basename(p); // traversal engeli
  return path.join(UPLOAD_DIR, base);
}

// ---------- SMTP (Brevo) ----------
const secureFlag =
  String(process.env.BREVO_SECURE || "").toLowerCase() === "true" ||
  Number(process.env.BREVO_PORT) === 465;

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_HOST || "smtp-relay.brevo.com",
  port: Number(process.env.BREVO_PORT || 587),
  secure: secureFlag,
  auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_PASS }
});

app.get("/api/mail/health", async (_req, res) => {
  try { await transporter.verify(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---------- ÜRÜNLER (müşteri) ----------
app.get("/api/products", (_req, res) => res.json(readProducts()));

// ---------- YÜKLEME (multer) ----------
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

// ---------- ÜRÜNLER (admin) ----------
app.post("/api/admin/products", requireAuth, (req, res) => {
  const { name, price, image, desc } = req.body || {};
  if (!name || isNaN(Number(price))) {
    return res.status(400).json({ success: false, message: "Geçerli isim ve fiyat gerekli" });
  }
  const list = readProducts();
  const item = {
    id: "p" + Date.now(),
    name: String(name),
    price: Number(price),
    image: image || "placeholder-soap.png", // "/uploads/xxx.jpg" beklenir
    desc: desc || ""
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

  if (name  !== undefined) list[idx].name  = String(name);
  if (price !== undefined) list[idx].price = Number(price);
  if (image !== undefined) list[idx].image = String(image);
  if (desc  !== undefined) list[idx].desc  = String(desc);

  writeProducts(list);

  // Eski görsel değiştiyse ve uploads içindeyse, başka ürün kullanmıyorsa sil
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

// ---------- KUPONLAR ----------
app.post("/api/coupon/check", (req, res) => {
  const { code } = req.body || {};
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return res.json({ success: false, message: "Kod gerekli" });

  const coupons = readCoupons();
  const found = coupons.find(c => c.code === normalized);
  if (!found) return res.json({ success: false, message: "Geçersiz kod" });
  if (found.active === false) return res.json({ success: false, message: "Kod pasif" });

  if (found.expiresAt) {
    const exp = Date.parse(found.expiresAt);
    if (!Number.isNaN(exp) && nowTS() > exp) {
      return res.json({ success: false, message: "Kod süresi dolmuş" });
    }
  }

  const percent = Number(found.percent || 0);
  if (!(percent > 0 && percent <= 90)) {
    return res.json({ success: false, message: "Kod yapılandırması geçersiz" });
  }
  return res.json({ success: true, percent, expiresAt: found.expiresAt || null });
});

app.get("/api/admin/coupons", requireAuth, (_req, res) => {
  res.json({ success: true, items: readCoupons() });
});

app.post("/api/admin/coupons", requireAuth, (req, res) => {
  let { code, percent, active, expiresAt } = req.body || {};
  code = String(code || "").trim().toUpperCase();
  const p = Number(percent);
  if (!code) return res.status(400).json({ success: false, message: "Kod gerekli" });
  if (!(p > 0 && p <= 90)) return res.status(400).json({ success: false, message: "Yüzde 1–90 arasında olmalı" });

  const list = readCoupons();
  if (list.find(c => c.code === code)) return res.status(400).json({ success: false, message: "Bu kod zaten var" });

  let expISO = null;
  if (expiresAt) {
    const parsed = Date.parse(expiresAt);
    if (!Number.isNaN(parsed)) expISO = new Date(parsed).toISOString();
  }

  const item = {
    id: "c" + Date.now(),
    code,
    percent: p,
    active: active === false ? false : true,
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

// ---------- MESAJ KUTUSU ----------
app.get("/api/admin/messages", requireAuth, (req, res) => {
  const type = String(req.query.type || "").trim();
  let list = readMessages().sort((a,b)=> (a.createdAt > b.createdAt ? -1 : 1));
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

// Mail tekrar deneme (admin)
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
        text: `Müşteri: ${msg.name || "-"} (${msg.email || "-"})\n\nÜrünler:\n${lines}\n\nKupon: ${msg.coupon || "-"}\nİndirim: ${msg.discount || 0}₺\nToplam: ${msg.payable || 0}₺`
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

// ---------- İLETİŞİM: önce kaydet, sonra mail dene ----------
app.post("/api/contact", async (req, res) => {
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

// ---------- CHECKOUT: önce kaydet, sonra mail dene ----------
app.post("/api/checkout", async (req, res) => {
  const { items, email, name, coupon } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Sepet boş." });
  }
  if (email && containsTR(email)) return res.status(400).json({ success: false, message: "E-posta adresinde Türkçe karakter kullanmayın." });
  if (email && !isValidEmail(email)) return res.status(400).json({ success: false, message: "Geçerli bir e-posta girin." });

  const total = items.reduce((s, it) => s + (Number(it.price) * Number(it.qty || 1)), 0);

  let discount = 0;
  let appliedCoupon = null;
  if (coupon) {
    const normalized = String(coupon).trim().toUpperCase();
    const coupons = readCoupons();
    const found = coupons.find(c => c.code === normalized);
    if (found && found.active !== false) {
      let usable = true;
      if (found.expiresAt) {
        const exp = Date.parse(found.expiresAt);
        if (!Number.isNaN(exp) && nowTS() > exp) usable = false;
      }
      if (usable && found.percent > 0 && found.percent <= 90) {
        appliedCoupon = found.code;
        discount = Math.round(total * (Number(found.percent) / 100));
      }
    }
  }

  const payable = total - discount;
  const lines = items.map(it => `• ${it.name} x${it.qty || 1} — ${it.price}₺`).join("\n");

  const list = readMessages();
  const id = "o" + Date.now();
  const orderRec = {
    id, type:"order", name: name || "-", email: email || "-",
    items, coupon: appliedCoupon, total, discount, payable,
    createdAt: new Date().toISOString(), read:false, mailSent:false, mailError:null
  };
  list.push(orderRec);
  writeMessages(list);

  try {
    await transporter.sendMail({
      from: `"Mavern Sipariş" <${process.env.FROM_EMAIL || process.env.BREVO_USER}>`,
      to: process.env.MAIL_TO || process.env.BREVO_USER,
      subject: "Yeni Sipariş",
      text: `Müşteri: ${name || "-"} (${email || "-"})\n\nÜrünler:\n${lines}\n\nKupon: ${appliedCoupon || "-"}\nİndirim: ${discount}₺\nToplam: ${payable}₺`
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

// ---------- SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mavern sunucusu çalışıyor: http://localhost:${PORT}`);
});