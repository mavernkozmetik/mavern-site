// server-core.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const mime = require("mime-types");

const {
  UPLOAD_DIR,
  readProducts,
  readUsers,
  writeUsers,
  readMessages,
  writeMessages,
  readCoupons,
  readReviews,
  writeReviews,
  readFeedback,
  writeFeedback
} = require("./utils/storage");

const { sendVerificationEmail, sendMail } = require("./utils/email");

const router = express.Router();

/* ------------------ Genel Helper'lar ------------------ */

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

const containsTR = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const isValidEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clientIP = (req) =>
  (req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "").trim();

function isValidPhone(s = "") {
  return /^[+0-9()\-\s]{6,}$/.test(String(s).trim());
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function requireJWT(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer "))
    return res.status(401).json({ success: false, message: "Giriş gerekli" });
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Geçersiz oturum" });
  }
}

function tryGetJWTUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    return jwt.verify(token, JWT_SECRET); // { uid }
  } catch {
    return null;
  }
}

// Nested AI profil sanitize (3 seviye)
function sanitizeAIProfile(input, depth = 0) {
  if (!input || typeof input !== "object" || depth > 3) return null;
  if (Array.isArray(input)) {
    return input
      .slice(0, 20)
      .map((v) => sanitizeAIProfile(v, depth + 1))
      .filter((v) => v !== null);
  }
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") {
      out[k] = v.trim().slice(0, 500);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (v && typeof v === "object") {
      const sub = sanitizeAIProfile(v, depth + 1);
      if (sub !== null) out[k] = sub;
    }
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------ Rate Limit & Idempotency ------------------ */

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const tightLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

router.use("/api/", apiLimiter);

const IDEMP_MAP = new Map();
const IDEMP_TTL = 20000;

function hashBody(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

function idempKey(req, keys) {
  const ip = clientIP(req);
  const pick = {};
  for (const k of keys) {
    if (req.body?.[k] !== undefined) pick[k] = req.body[k];
  }
  if (pick.items && Array.isArray(pick.items)) {
    pick.items = pick.items
      .map((it) => ({
        id: it.id || null,
        name: it.name || "",
        qty: Number(it.qty || 1)
      }))
      .sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name));
  }
  return ip + ":" + hashBody(pick);
}

function idempGuard(keys) {
  return (req, res, next) => {
    try {
      const key = idempKey(req, keys);
      const now = Date.now();
      const last = IDEMP_MAP.get(key) || 0;
      if (now - last < IDEMP_TTL) {
        return res.status(429).json({
          success: false,
          message: "İşleminiz alındı. Lütfen tekrarlamayın."
        });
      }
      IDEMP_MAP.set(key, now);
      res.on("finish", () => {
        setTimeout(() => IDEMP_MAP.delete(key), IDEMP_TTL);
      });
      next();
    } catch {
      next();
    }
  };
}

/* ------------------ Upload (kullanıcı yorum foto) ------------------ */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    const base = (file.originalname || "file")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_\-\.]/g, "")
      .replace(/\.[^\.]+$/, "")
      .slice(0, 40);
    cb(null, `${Date.now()}_${base}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Sadece JPG/PNG/WEBP yüklenebilir"), ok);
  }
});

router.post(
  "/api/reviews/upload",
  requireJWT,
  upload.single("file"),
  (req, res) => {
    if (!req.file)
      return res.status(400).json({ success: false, message: "Dosya yok" });
    res.json({ success: true, path: "/uploads/" + req.file.filename });
  }
);

/* ======================================================================== */
/*  AUTH + E-POSTA DOĞRULAMA                                                */
/* ======================================================================== */

// Register
router.post("/api/auth/register", tightLimiter, async (req, res) => {
  const {
    email,
    password,
    displayName,
    fullName,
    phone,
    city,
    district,
    address,
    zip,
    notes
  } = req.body || {};

  const e = String(email || "").trim().toLowerCase();
  if (!e || containsTR(e) || !isValidEmail(e)) {
    return res.status(400).json({ success: false, message: "Geçerli e-posta gerekli" });
  }
  if (!password || String(password).length < 6) {
    return res
      .status(400)
      .json({ success: false, message: "Şifre en az 6 karakter olmalı" });
  }

  const users = readUsers();
  if (users.find((u) => u.email === e)) {
    return res.status(400).json({ success: false, message: "Bu e-posta zaten kayıtlı" });
  }

  const safePhone = String(phone || "").trim();
  if (safePhone && !isValidPhone(safePhone)) {
    return res
      .status(400)
      .json({ success: false, message: "Telefon formatı geçersiz" });
  }

  const hash = await bcrypt.hash(String(password), 10);
  const verificationToken = crypto.randomUUID();

  const user = {
    id: "u" + Date.now(),
    email: e,
    passHash: hash,
    displayName: String(displayName || "").trim() || e.split("@")[0],
    fullName: String(fullName || "").trim() || null,
    phone: safePhone || null,
    city: String(city || "").trim() || null,
    district: String(district || "").trim() || null,
    address: String(address || "").trim() || null,
    zip: String(zip || "").trim().slice(0, 16) || null,
    notes: String(notes || "").trim().slice(0, 500) || null,
    isVerified: false,
    verificationToken,
    verifiedAt: null,
    isAdmin: false,
    aiProfile: null,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    lastLoginIp: null
  };

  users.push(user);
  writeUsers(users);

  try {
    await sendVerificationEmail(user.email, verificationToken);
  } catch (e) {
    console.error("E-posta doğrulama mail hatası:", e.message);
  }

  return res.json({
    success: true,
    message: "Kayıt oluşturuldu. Lütfen e-posta adresinizi doğrulayın."
  });
});

// Email verify
router.post("/api/auth/verify-email", tightLimiter, (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ success: false, message: "Token gerekli" });
  }

  const users = readUsers();
  const idx = users.findIndex((u) => u.verificationToken === token);
  if (idx === -1) {
    return res.status(400).json({ success: false, message: "Geçersiz veya kullanılmış token" });
  }

  users[idx].isVerified = true;
  users[idx].verificationToken = null;
  users[idx].verifiedAt = new Date().toISOString();
  writeUsers(users);

  return res.json({ success: true, message: "E-posta adresiniz doğrulandı." });
});

// Login
router.post("/api/auth/login", tightLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const e = String(email || "").trim().toLowerCase();

  const users = readUsers();
  const idx = users.findIndex((u) => u.email === e);
  if (idx === -1) {
    return res.status(400).json({ success: false, message: "Kullanıcı bulunamadı" });
  }
  const user = users[idx];

  const ok = await bcrypt.compare(String(password || ""), user.passHash || "");
  if (!ok) {
    return res.status(400).json({ success: false, message: "Şifre hatalı" });
  }
  if (!user.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Lütfen e-posta adresinizi doğrulayın."
    });
  }

  users[idx].lastLoginAt = new Date().toISOString();
  users[idx].lastLoginIp = clientIP(req) || null;
  writeUsers(users);

  const token = signToken({ uid: user.id });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      fullName: user.fullName,
      phone: user.phone,
      city: user.city,
      district: user.district,
      address: user.address,
      zip: user.zip,
      notes: user.notes,
      isVerified: !!user.isVerified,
      isAdmin: !!user.isAdmin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp
    }
  });
});

// Me
router.get("/api/auth/me", requireJWT, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => u.id === req.user.uid);
  if (!user) return res.status(404).json({ success: false, message: "Kullanıcı yok" });

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      fullName: user.fullName,
      phone: user.phone,
      city: user.city,
      district: user.district,
      address: user.address,
      zip: user.zip,
      notes: user.notes,
      isVerified: !!user.isVerified,
      isAdmin: !!user.isAdmin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp
    }
  });
});

// Profil güncelle
router.patch("/api/auth/profile", requireJWT, async (req, res) => {
  const {
    displayName,
    fullName,
    phone,
    city,
    district,
    address,
    zip,
    notes,
    currentPassword,
    newPassword
  } = req.body || {};

  const users = readUsers();
  const idx = users.findIndex((u) => u.id === req.user.uid);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Kullanıcı bulunamadı" });
  }
  const user = users[idx];

  if (displayName !== undefined) user.displayName = String(displayName || "").trim() || user.displayName;
  if (fullName !== undefined)    user.fullName    = String(fullName || "").trim()    || null;

  if (phone !== undefined) {
    const p = String(phone || "").trim();
    if (p && !isValidPhone(p)) {
      return res.status(400).json({ success: false, message: "Telefon formatı geçersiz" });
    }
    user.phone = p || null;
  }

  if (city !== undefined)     user.city     = String(city || "").trim()     || null;
  if (district !== undefined) user.district = String(district || "").trim() || null;
  if (address !== undefined)  user.address  = String(address || "").trim()  || null;
  if (zip !== undefined)      user.zip      = String(zip || "").trim().slice(0, 16) || null;
  if (notes !== undefined)    user.notes    = String(notes || "").trim().slice(0, 500) || null;

  if (newPassword) {
    const curr = String(currentPassword || "");
    const ok = await bcrypt.compare(curr, user.passHash || "");
    if (!ok) {
      return res.status(400).json({ success: false, message: "Mevcut şifre hatalı" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: "Yeni şifre en az 6 karakter olmalı" });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    user.passHash = hash;
  }

  users[idx] = user;
  writeUsers(users);

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      fullName: user.fullName,
      phone: user.phone,
      city: user.city,
      district: user.district,
      address: user.address,
      zip: user.zip,
      notes: user.notes,
      isVerified: !!user.isVerified,
      isAdmin: !!user.isAdmin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp
    }
  });
});

/* ======================================================================== */
/*  AI PROFİL (Kullanıcı)                                                   */
/* ======================================================================== */

router.get("/api/profile/full", requireJWT, (req, res) => {
  const users = readUsers();
  const u = users.find((x) => x.id === req.user.uid);
  if (!u) return res.status(404).json({ success: false, message: "Kullanıcı yok" });

  res.json({ success: true, profile: u.aiProfile || null });
});

router.put("/api/profile/full", requireJWT, (req, res) => {
  const { aiProfile } = req.body || {};
  const cleanProfile = sanitizeAIProfile(aiProfile);
  if (!cleanProfile) {
    return res.status(400).json({ success: false, message: "Geçersiz profil yapısı" });
  }

  const users = readUsers();
  const idx = users.findIndex((u) => u.id === req.user.uid);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Kullanıcı bulunamadı" });
  }

  users[idx].aiProfile = cleanProfile;
  writeUsers(users);
  res.json({ success: true, profile: cleanProfile });
});

/* ======================================================================== */
/*  ÜRÜNLER + YORUMLAR (Public)                                             */
/* ======================================================================== */

router.get("/api/products", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readProducts());
});

router.get("/api/products/:id/reviews", (req, res) => {
  const productId = String(req.params.id || "");
  if (!productId) return res.json({ success: true, items: [] });

  const list = readReviews()
    .filter((r) => r.productId === productId && r.approved === true)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  res.json({ success: true, items: list });
});

router.post("/api/products/:id/reviews", requireJWT, (req, res) => {
  const productId = String(req.params.id || "");
  const { rating, comment, photos, anonymous } = req.body || {};

  if (!productId) {
    return res.status(400).json({ success: false, message: "Geçersiz ürün" });
  }

  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return res.status(400).json({ success: false, message: "Puan 1–5 arası olmalı" });
  }

  const text = String(comment || "").trim();
  if (text.length < 3) {
    return res.status(400).json({ success: false, message: "Yorum çok kısa" });
  }

  const products = readProducts();
  const exists = products.find((p) => p.id === productId);
  if (!exists) {
    return res.status(400).json({ success: false, message: "Ürün bulunamadı" });
  }

  const users = readUsers();
  const user = users.find((u) => u.id === req.user.uid);

  const list = readReviews();
  const cleanPhotos =
    Array.isArray(photos) && photos.length
      ? photos
          .filter((p) => typeof p === "string" && p.startsWith("/uploads/"))
          .slice(0, 5)
      : [];

  const review = {
    id: "r" + Date.now(),
    productId,
    userId: req.user.uid,
    userEmail: user?.email || null,
    displayName:
      anonymous || !user
        ? "Kullanıcı"
        : user.displayName || user.fullName || user.email || "Kullanıcı",
    rating: r,
    comment: text.slice(0, 2000),
    photos: cleanPhotos,
    anonymous: !!anonymous,
    approved: false,
    isApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  list.push(review);
  writeReviews(list);

  res.json({
    success: true,
    message: "Yorumunuz alındı. İnceleme sonrası yayınlanacaktır."
  });
});

/* ======================================================================== */
/*  KUPON KONTROL                                                            */
/* ======================================================================== */

router.post("/api/coupon/check", (req, res) => {
  const { code } = req.body || {};
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return res.json({ success: false, message: "Kod gerekli" });

  const coupons = readCoupons();
  const found = coupons.find((c) => c.code === normalized);
  if (!found) return res.json({ success: false, message: "Geçersiz kod" });
  if (found.active === false)
    return res.json({ success: false, message: "Kod pasif" });

  const now = Date.now();
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

  res.json({
    success: true,
    percent,
    startsAt: found.startsAt || null,
    expiresAt: found.expiresAt || null
  });
});

/* ======================================================================== */
/*  İLETİŞİM & CHECKOUT                                                      */
/* ======================================================================== */

// Contact
router.post(
  "/api/contact",
  tightLimiter,
  idempGuard(["name", "email", "message"]),
  async (req, res) => {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: "Tüm alanlar zorunlu" });
    }
    if (containsTR(email)) {
      return res.status(400).json({
        success: false,
        message: "E-posta adresinde Türkçe karakter kullanmayın."
      });
    }
    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Geçerli bir e-posta girin." });
    }

    const list = readMessages();
    const id = "m" + Date.now();
    const rec = {
      id,
      type: "contact",
      name,
      email,
      message,
      createdAt: new Date().toISOString(),
      read: false,
      mailSent: false,
      mailError: null
    };
    list.push(rec);
    writeMessages(list);

    try {
      await sendMail({
        subject: `Mavern İletişim - ${name}`,
        text: `Gönderen: ${name} - ${email}\n\nMesaj:\n${message}`,
        replyTo: email
      });

      const L = readMessages();
      const i = L.findIndex((m) => m.id === id);
      if (i > -1) {
        L[i].mailSent = true;
        L[i].mailError = null;
        writeMessages(L);
      }
      res.json({ success: true, message: "Mesaj gönderildi." });
    } catch (e) {
      const L = readMessages();
      const i = L.findIndex((m) => m.id === id);
      if (i > -1) {
        L[i].mailSent = false;
        L[i].mailError = e.message || String(e);
        writeMessages(L);
      }
      res.json({
        success: true,
        message: "Mesaj kaydedildi, e-posta şu an gönderilemedi."
      });
    }
  }
);

// Checkout
router.post(
  "/api/checkout",
  tightLimiter,
  idempGuard(["items", "email", "name", "phone", "address", "coupon", "profileSnapshot"]),
  async (req, res) => {
    const { items, email, name, phone, address, coupon, profileSnapshot } =
      req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Sepet boş" });
    }
    if (!name || !email || !phone || !address) {
      return res
        .status(400)
        .json({ success: false, message: "Ad, e-posta, telefon ve adres zorunlu" });
    }
    if (containsTR(email)) {
      return res.status(400).json({
        success: false,
        message: "E-posta adresinde Türkçe karakter kullanmayın."
      });
    }
    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Geçerli bir e-posta girin." });
    }
    if (!isValidPhone(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Geçerli bir telefon girin." });
    }

    const addr = String(address).trim();
    if (addr.length < 10) {
      return res
        .status(400)
        .json({ success: false, message: "Adres çok kısa (min 10 karakter)" });
    }
    if (addr.length > 600) {
      return res
        .status(400)
        .json({ success: false, message: "Adres çok uzun (max 600 karakter)" });
    }

    const allProducts = readProducts();
    const normalizedItems = [];
    const notBuyable = [];

    for (const it of items) {
      const found = it.id
        ? allProducts.find((p) => p.id === it.id)
        : allProducts.find((p) => p.name === it.name);
      if (!found) {
        notBuyable.push({ name: it.name || "(?)", reason: "Ürün bulunamadı" });
        continue;
      }
      if (!found.purchasable || !Number.isFinite(found.price)) {
        notBuyable.push({ name: found.name, reason: "Satılamıyor (fiyat yok)" });
        continue;
      }
      const qty = Math.max(1, Number(it.qty || 1));
      normalizedItems.push({
        id: found.id,
        name: found.name,
        price: Number(found.price),
        qty
      });
    }

    if (notBuyable.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Sepette satılamayan ürün(ler) var.",
        notBuyable
      });
    }

    const total = normalizedItems.reduce((sum, it) => sum + it.price * it.qty, 0);

    // Kupon
    let discount = 0;
    let appliedCoupon = null;
    if (coupon) {
      const normalized = String(coupon).trim().toUpperCase();
      const coupons = readCoupons();
      const now = Date.now();
      const found = coupons.find(
        (c) => c.code === normalized && c.active !== false
      );
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
          discount = Math.round(total * (Number(found.percent) / 100));
          appliedCoupon = found.code;
        }
      }
    }

    const payable = total - discount;
    const lines = normalizedItems
      .map((it) => `• ${it.name} x${it.qty} — ${it.price}₺`)
      .join("\n");

    const profileClean = sanitizeAIProfile(profileSnapshot);
    const decoded = tryGetJWTUser(req);
    const userId = decoded?.uid || null;

    const messages = readMessages();
    const id = "o" + Date.now();

    const order = {
      id,
      type: "order",
      name,
      email,
      phone,
      address: addr,
      items: normalizedItems,
      coupon: appliedCoupon,
      total,
      discount,
      payable,
      userId,
      status: "pending",
      trackingCode: null,
      profileSnapshot: profileClean || null,
      createdAt: new Date().toISOString(),
      read: false,
      mailSent: false,
      mailError: null
    };

    messages.push(order);
    writeMessages(messages);

    try {
      await sendMail({
        subject: "Yeni Sipariş",
        text: `Müşteri: ${name} (${email})
Telefon: ${phone}
Adres  : ${addr}

Ürünler:
${lines}

Kupon   : ${appliedCoupon || "-"}
İndirim: ${discount}₺
Ödenecek: ${payable}₺`
      });

      const L = readMessages();
      const i = L.findIndex((m) => m.id === id);
      if (i > -1) {
        L[i].mailSent = true;
        L[i].mailError = null;
        writeMessages(L);
      }

      res.json({
        success: true,
        message: "Sipariş iletildi.",
        total,
        discount,
        payable,
        orderId: id
      });
    } catch (e) {
      const L = readMessages();
      const i = L.findIndex((m) => m.id === id);
      if (i > -1) {
        L[i].mailSent = false;
        L[i].mailError = e.message || String(e);
        writeMessages(L);
      }

      res.json({
        success: true,
        message: "Sipariş kaydedildi, e-posta şu an gönderilemedi.",
        total,
        discount,
        payable,
        orderId: id
      });
    }
  }
);

/* ======================================================================== */
/*  Kullanıcı Tarafı Siparişler                                             */
/* ======================================================================== */

router.get("/api/orders/my", requireJWT, (req, res) => {
  const uid = req.user.uid;
  const list = readMessages()
    .filter((m) => m.type === "order" && m.userId === uid)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .map((o) => ({
      ...o,
      status: o.status || "pending",
      trackingCode: o.trackingCode || null
    }));

  res.json({ success: true, items: list });
});

router.get("/api/orders/:id", requireJWT, (req, res) => {
  const uid = req.user.uid;
  const id = String(req.params.id || "");
  const msg = readMessages().find((m) => m.id === id && m.type === "order");

  if (!msg) {
    return res.status(404).json({ success: false, message: "Sipariş bulunamadı" });
  }
  if (msg.userId && msg.userId !== uid) {
    return res
      .status(403)
      .json({ success: false, message: "Bu siparişi görüntüleme yetkiniz yok" });
  }

  const item = {
    ...msg,
    status: msg.status || "pending",
    trackingCode: msg.trackingCode || null
  };

  res.json({ success: true, item });
});

/* ======================================================================== */
/*  FEEDBACK                                                                 */
/* ======================================================================== */

router.post("/api/feedback", requireJWT, tightLimiter, (req, res) => {
  const { rating, comment, page, context } = req.body || {};
  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return res.status(400).json({ success: false, message: "Puan 1–5 arasında olmalı" });
  }

  const users = readUsers();
  const u = users.find((x) => x.id === req.user.uid);
  const list = readFeedback();

  const fb = {
    id: "fb" + Date.now(),
    userId: req.user.uid,
    userEmail: u?.email || null,
    rating: r,
    comment: String(comment || "").trim().slice(0, 500),
    page: String(page || "").trim().slice(0, 200) || null,
    context: context && typeof context === "object" ? context : null,
    createdAt: new Date().toISOString()
  };

  list.push(fb);
  writeFeedback(list);
  res.json({ success: true });
});

router.get("/api/feedback/my", requireJWT, (req, res) => {
  const uid = req.user.uid;
  const list = readFeedback()
    .filter((f) => f.userId === uid)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  res.json({ success: true, items: list });
});

/* ======================================================================== */
/*  AI CONSULT (stub)                                                        */
/* ======================================================================== */

router.post("/api/ai/consult", tightLimiter, (req, res) => {
  const { question, profileSnapshot } = req.body || {};
  const q = String(question || "").trim();
  if (!q) {
    return res.status(400).json({ success: false, message: "Soru metni gerekli" });
  }

  const suggestion =
    "Bu özellik şu anda test aşamasında. Profilinizi ve sorunuzu aldık; yakında çok daha derin kişiselleştirilmiş öneriler sunacağız. Şimdilik saç ve saç derinize uygun nazik bir şampuan kullanmayı, aşırı sıcak sudan kaçınmayı ve düzenli bakım rutini oluşturmayı ihmal etmeyin.";

  res.json({
    success: true,
    answer: suggestion,
    echo: {
      question: q,
      profileSnapshot: sanitizeAIProfile(profileSnapshot)
    }
  });
});

module.exports = router;
