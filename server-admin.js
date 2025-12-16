// server-admin.js
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const mime = require("mime-types");

const {
  UPLOAD_DIR,
  readUsers,
  writeUsers,
  readProducts,
  writeProducts,
  parsePrice,
  readReviews,
  writeReviews,
  readMessages,
  writeMessages,
  readCoupons,
  writeCoupons,
  readFeedback,
  writeFeedback
} = require("./utils/storage");

const {
  sendMail,
  sendAdminTestMail,
  verifyTransport
} = require("./utils/email");

const router = express.Router();

/* ------------------ Admin Rate Limit ------------------ */

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

router.use("/api/admin", adminLimiter);

/* ------------------ Admin Auth (ENV) ------------------ */

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";
let ADMIN_TOKEN = null;

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer "))
    return res.status(401).json({ success: false, message: "Yetkisiz" });
  const token = auth.slice(7);
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, message: "Yetkisiz" });
  }
  next();
}

// Admin login – frontend zaten /api/login kullanıyor
router.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    ADMIN_TOKEN =
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    return res.json({ success: true, token: ADMIN_TOKEN, username });
  }
  return res
    .status(401)
    .json({ success: false, message: "Kullanıcı adı veya şifre hatalı" });
});

/* ------------------ Admin Upload ------------------ */

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

const uploadAdmin = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(
      file.mimetype
    );
    cb(ok ? null : new Error("Sadece JPG/PNG/WEBP yüklenebilir"), ok);
  }
});

router.post(
  "/api/admin/upload",
  requireAdmin,
  uploadAdmin.single("file"),
  (req, res) => {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "Dosya yok" });
    res.json({ success: true, path: "/uploads/" + req.file.filename });
  }
);

/* ======================================================================== */
/*  Admin Mail Test                                                          */
/* ======================================================================== */

router.get("/api/admin/mail/verify", requireAdmin, async (_req, res) => {
  try {
    await verifyTransport();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/api/admin/mail/test", requireAdmin, async (_req, res) => {
  try {
    await sendAdminTestMail();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ======================================================================== */
/*  Admin: Kullanıcılar                                                      */
/* ======================================================================== */

/**
 * Kullanıcı listesi:
 *  - isVerified: e-posta doğrulaması
 *  - isAdmin   : site içi admin flag
 *
 * Not: isApproved alanı artık kullanılmıyor (deprecated).
 */
router.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = readUsers().map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    fullName: u.fullName,
    phone: u.phone,
    city: u.city,
    district: u.district,
    address: u.address,
    zip: u.zip,
    notes: u.notes,
    isVerified: !!u.isVerified,
    isAdmin: !!u.isAdmin,
    aiProfile: u.aiProfile || null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    lastLoginIp: u.lastLoginIp,
    verifiedAt: u.verifiedAt
  }));
  res.json({ success: true, items: users });
});

/**
 * FULL detay:
 *  - user
 *  - orders (siparişler)
 *  - reviews (yorumlar)
 *  - feedback
 *  - contacts (iletişim kayıtları)
 *
 * Not: user.isApproved artık dönmüyoruz (deprecated).
 */
router.get("/api/admin/users/:id/full", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const users = readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: "Kullanıcı bulunamadı" });
  }

  const messages = readMessages();
  const reviews = readReviews();
  const feedback = readFeedback();

  const orders = messages.filter(
    (m) =>
      m.type === "order" &&
      (m.userId === user.id || (m.email && m.email === user.email))
  );

  const contacts = messages.filter(
    (m) =>
      m.type === "contact" &&
      (m.email && m.email === user.email)
  );

  const userReviews = reviews.filter(
    (r) =>
      r.userId === user.id || (r.userEmail && r.userEmail === user.email)
  );

  const userFeedback = feedback.filter(
    (f) =>
      f.userId === user.id || (f.userEmail && f.userEmail === user.email)
  );

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
      aiProfile: user.aiProfile || null,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      verifiedAt: user.verifiedAt
    },
    orders,
    contacts,
    reviews: userReviews,
    feedback: userFeedback
  });
});

/**
 * Kullanıcı güncelle:
 *  - isAdmin: panel dışındaki “site içi admin” yetkisi
 *
 * Not:
 *  - isVerified yalnızca e-posta doğrulaması ile değişsin, buradan değiştirmiyoruz.
 *  - isApproved alanı artık kullanılmıyor ve burada dikkate alınmıyor.
 */
router.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { isAdmin } = req.body || {};

  const users = readUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Kullanıcı bulunamadı" });
  }

  if (typeof isAdmin === "boolean") {
    users[idx].isAdmin = isAdmin;
  }

  writeUsers(users);

  const u = users[idx];
  res.json({
    success: true,
    user: {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      fullName: u.fullName,
      phone: u.phone,
      city: u.city,
      district: u.district,
      address: u.address,
      zip: u.zip,
      notes: u.notes,
      isVerified: !!u.isVerified,
      isAdmin: !!u.isAdmin,
      aiProfile: u.aiProfile || null,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      lastLoginIp: u.lastLoginIp,
      verifiedAt: u.verifiedAt
    }
  });
});

// Kullanıcı sil
router.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let users = readUsers();
  const before = users.length;
  const user = users.find((u) => u.id === id) || null;
  users = users.filter((u) => u.id !== id);
  if (users.length === before) {
    return res
      .status(404)
      .json({ success: false, message: "Kullanıcı bulunamadı" });
  }
  writeUsers(users);

  // Yorumlar
  let revs = readReviews();
  revs = revs.filter((r) => r.userId !== id);
  writeReviews(revs);

  // Feedback
  let fbs = readFeedback();
  fbs = fbs.filter((f) => f.userId !== id);
  writeFeedback(fbs);

  // İsteğe bağlı: kullanıcının e-postasına bağlı contact/order kayıtlarını silmiyoruz,
  // raporlama / muhasebe için log olarak kalsın.

  res.json({ success: true });
});

/* ======================================================================== */
/*  Admin: ÜRÜNLER                                                          */
/* ======================================================================== */

// Ürün ekle
router.post("/api/admin/products", requireAdmin, (req, res) => {
  const { name, price, image, desc } = req.body || {};
  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "Ürün adı gerekli" });
  }

  const list = readProducts();
  const parsed = parsePrice(price);
  const item = {
    id: "p" + Date.now(),
    name: String(name).trim(),
    price: parsed.price,
    priceText: parsed.priceText,
    purchasable: parsed.purchasable,
    image: image || "logo.png",
    desc: String(desc || "")
  };

  list.push(item);
  writeProducts(list);
  res.json({ success: true, item });
});

// Ürün güncelle
router.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { name, price, image, desc } = req.body || {};
  const list = readProducts();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Ürün bulunamadı" });
  }

  if (name !== undefined) list[idx].name = String(name).trim();
  if (price !== undefined) {
    const parsed = parsePrice(price);
    list[idx].price = parsed.price;
    list[idx].priceText = parsed.priceText;
    list[idx].purchasable = parsed.purchasable;
  }
  if (image !== undefined) list[idx].image = String(image || "logo.png");
  if (desc !== undefined) list[idx].desc = String(desc);

  writeProducts(list);
  res.json({ success: true, item: list[idx] });
});

// Ürün sil
router.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  let list = readProducts();
  const before = list.length;
  list = list.filter((p) => p.id !== id);
  if (list.length === before) {
    return res
      .status(404)
      .json({ success: false, message: "Ürün bulunamadı" });
  }
  writeProducts(list);
  res.json({ success: true });
});

/* ======================================================================== */
/*  Admin: Yorumlar                                                          */
/* ======================================================================== */

router.get("/api/admin/reviews", requireAdmin, (_req, res) => {
  const list = readReviews().sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1
  );
  res.json({ success: true, items: list });
});

// approved flag
router.patch("/api/admin/reviews/:id/approve", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { approved } = req.body || {};
  const list = readReviews();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Yorum bulunamadı" });
  }

  if (typeof approved === "boolean") {
    list[idx].approved = approved;
    list[idx].isApproved = approved;
    list[idx].updatedAt = new Date().toISOString();
  }
  writeReviews(list);

  res.json({ success: true, item: list[idx] });
});

router.delete("/api/admin/reviews/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let list = readReviews();
  const before = list.length;
  list = list.filter((r) => r.id !== id);
  if (list.length === before) {
    return res
      .status(404)
      .json({ success: false, message: "Yorum bulunamadı" });
  }
  writeReviews(list);
  res.json({ success: true });
});

/* ======================================================================== */
/*  Admin: Mesajlar + Siparişler                                            */
/* ======================================================================== */

router.get("/api/admin/messages", requireAdmin, (req, res) => {
  const type = String(req.query.type || "").trim();
  let list = readMessages().sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1
  );
  if (type === "contact" || type === "order") {
    list = list.filter((m) => m.type === type);
  }
  res.json({ success: true, items: list });
});

router.patch("/api/admin/messages/:id/read", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const list = readMessages();
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Mesaj bulunamadı" });
  }
  list[idx].read = true;
  writeMessages(list);
  res.json({ success: true, item: list[idx] });
});

router.delete("/api/admin/messages/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  let list = readMessages();
  const before = list.length;
  list = list.filter((m) => m.id !== id);
  if (list.length === before) {
    return res
      .status(404)
      .json({ success: false, message: "Mesaj bulunamadı" });
  }
  writeMessages(list);
  res.json({ success: true });
});

// Sipariş durum / takip kodu
router.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const { status, trackingCode, read } = req.body || {};

  const list = readMessages();
  const idx = list.findIndex((m) => m.id === id && m.type === "order");
  if (idx === -1) {
    return res
      .status(404)
      .json({ success: false, message: "Sipariş bulunamadı" });
  }

  if (status !== undefined) {
    const allowed = [
      "pending",
      "preparing",
      "shipped",
      "completed",
      "cancelled",
      "returned"
    ];
    if (!allowed.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Geçersiz sipariş durumu" });
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
  res.json({ success: true, item: list[idx] });
});

// Mesaj / sipariş mailini yeniden gönder
router.post(
  "/api/admin/messages/:id/resend",
  requireAdmin,
  async (req, res) => {
    const id = String(req.params.id || "");
    const list = readMessages();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) {
      return res
        .status(404)
        .json({ success: false, message: "Mesaj bulunamadı" });
    }
    const msg = list[idx];

    try {
      if (msg.type === "contact") {
        await sendMail({
          subject: `Mavern İletişim (Yeniden) - ${msg.name || "-"}`,
          text: `Gönderen: ${msg.name || "-"} - ${
            msg.email || "-"
          }\n\nMesaj:\n${msg.message || ""}`,
          replyTo: msg.email || undefined
        });
      } else if (msg.type === "order") {
        const lines = (msg.items || [])
          .map(
            (it) =>
              `• ${it.name} x${it.qty || 1} — ${it.price}₺`
          )
          .join("\n");

        await sendMail({
          subject: "Yeni Sipariş (Yeniden Gönderim)",
          text: `Müşteri: ${msg.name || "-"} (${msg.email || "-"})
Telefon: ${msg.phone || "-"}
Adres  : ${msg.address || "-"}

Ürünler:
${lines}

Kupon   : ${msg.coupon || "-"}
İndirim: ${msg.discount || 0}₺
Ödenecek: ${msg.payable || 0}₺`
        });
      } else {
        return res.status(400).json({
          success: false,
          message: "Bu mesaj tipi yeniden gönderilemiyor"
        });
      }

      list[idx].mailSent = true;
      list[idx].mailError = null;
      writeMessages(list);
      res.json({ success: true, message: "Mail yeniden gönderildi" });
    } catch (e) {
      list[idx].mailSent = false;
      list[idx].mailError = e.message || String(e);
      writeMessages(list);
      res.status(500).json({
        success: false,
        message: "Mail gönderilemedi: " + e.message
      });
    }
  }
);

/* ======================================================================== */
/*  Admin: Kuponlar                                                          */
/* ======================================================================== */

function toISODateOrNull(d) {
  if (!d) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function todayISODateStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

router.get("/api/admin/coupons", requireAdmin, (_req, res) => {
  res.json({ success: true, items: readCoupons() });
});

router.post("/api/admin/coupons", requireAdmin, (req, res) => {
  let { code, percent, active, startsAt, expiresAt } = req.body || {};
  code = String(code || "").trim().toUpperCase();
  const p = Number(percent);

  if (!code) {
    return res
      .status(400)
      .json({ success: false, message: "Kod gerekli" });
  }
  if (!(p > 0 && p <= 90)) {
    return res.status(400).json({
      success: false,
      message: "Yüzde 1–90 arasında olmalı"
    });
  }

  const list = readCoupons();
  if (list.find((c) => c.code === code)) {
    return res
      .status(400)
      .json({ success: false, message: "Bu kod zaten var" });
  }

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

router.delete("/api/admin/coupons/:code", requireAdmin, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  let list = readCoupons();
  const before = list.length;
  list = list.filter((c) => c.code !== code);
  if (list.length === before) {
    return res
      .status(404)
      .json({ success: false, message: "Kod bulunamadı" });
  }
  writeCoupons(list);
  res.json({ success: true });
});

/* ======================================================================== */
/*  Admin: Feedback                                                          */
/* ======================================================================== */

router.get("/api/admin/feedback", requireAdmin, (_req, res) => {
  const list = readFeedback().sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1
  );
  res.json({ success: true, items: list });
});

module.exports = router;
