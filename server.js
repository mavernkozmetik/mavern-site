// server.js
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const { PUBLIC_DIR, UPLOAD_DIR } = require("./utils/storage");
const coreRoutes = require("./server-core");
const adminRoutes = require("./server-admin");

const app = express();
const NODE_ENV = process.env.NODE_ENV || "development";

/* ------------------ Güvenlik & Ortak Middleware ------------------ */

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

// Production'da HTTP → HTTPS (Render / proxy için)
if (NODE_ENV === "production") {
  app.use((req, res, next) => {
    const proto = req.get("x-forwarded-proto");
    if (proto && proto !== "https") {
      const host = req.get("host");
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

/* ------------------ Statik Servisleme ------------------ */

app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    etag: true,
    lastModified: true,
    maxAge: "7d",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    }
  })
);

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

/* ------------------ Router Montajı ------------------ */

app.use(coreRoutes);   // Public + kullanıcı API
app.use(adminRoutes); // Admin panel API

/* ------------------ Health & Version ------------------ */

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

app.get("/api/version", (_req, res) => {
  res.json({ name: "mavern", version: "2.0.0" });
});

/* ------------------ SPA Fallback (frontend .html) ------------------ */

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  return res.sendFile(indexPath, (err) => {
    if (err) return res.status(404).send("Not found");
  });
});

/* ------------------ Server Başlat ------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mavern sunucusu çalışıyor: http://localhost:${PORT}`);
  console.log(`📁 PUBLIC_DIR : ${PUBLIC_DIR}`);
  console.log(`🖼  UPLOAD_DIR : ${UPLOAD_DIR}`);
});
