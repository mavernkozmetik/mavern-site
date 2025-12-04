"use strict";

// ===================================
// ========== GENEL YARDIMCILAR ======
// ===================================
const qs  = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);
const hasTr = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const fmtMoney = (n) => `${Number(n || 0).toFixed(0)} ₺`;

// ===================================
// ========== LOCALSTORAGE KEY'LER ===
// ===================================
const TOKEN_KEY             = "mavern_jwt";               // JWT (auth.html ile uyumlu)
const CART_KEY              = "mavern_cart";              // sepet
const THEME_KEY             = "mavern_theme";             // tema seçim
const AI_PROFILE_KEY        = "mavern_ai_profile_local";  // client event log
const AI_PROFILE_SERVER_KEY = "mavern_ai_profile";        // server’dan gelen profil cache
const SESSION_KEY           = "mavern_session_id";        // AI sinyalleri için basit session

let TOKEN    = null;
let PRODUCTS = [];
let CART     = {};   // { id: { id, name, price, image, qty } }
let COUPON   = null; // { code, percent, expiresAt? }

window.mavernProfile = null; // server’dan gelen detaylı profil

// ===================================
// ========== SESSION HELPER =========
// ===================================
function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (id && typeof id === "string" && id.length > 0) return id;
    // Basit, yeterli bir ID
    id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // localStorage kapalıysa fallback
    return `sess_${Date.now().toString(36)}`;
  }
}

const MAVERN_SESSION_ID = getOrCreateSessionId();

// ===================================
// ============== TEMA ===============
// ===================================
function applyTheme(theme) {
  const html = document.documentElement;
  const btn  = document.getElementById("themeToggle");

  // CSS tarafında varsayılan koyu; light için :root[data-theme="light"] override kullanılıyor
  if (theme === "light") {
    html.setAttribute("data-theme", "light");
  } else {
    html.removeAttribute("data-theme"); // koyu tema
    theme = "dark";
  }

  if (btn) {
    // Şu anda hangi moddaysak, buton “bir sonrakini” anlatacak şekilde yazılsın
    if (theme === "light") {
      // şu an açık => tıklayınca koyuya geçecek
      btn.textContent = "☾ Koyu tema";
    } else {
      // şu an koyu => tıklayınca açığa geçecek
      btn.textContent = "☀ Açık tema";
    }
  }
}

function initTheme() {
  let theme = "dark";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      theme = saved;
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      theme = "light";
    }
  } catch {
    theme = "dark";
  }
  applyTheme(theme);
}

// ===================================
// ===== TOKEN / OTURUM YARDIMCI =====
// ===================================
function loadTokenFromStorage() {
  try {
    TOKEN = localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    TOKEN = null;
  }
}

function updateAccountLink() {
  const links = qsa(".account-link");
  const hasToken = !!TOKEN;
  links.forEach((link) => {
    if (link.tagName === "A") {
      link.textContent = hasToken ? "Hesabım" : "Giriş / Kayıt";
    }
  });
}

// ===================================
// ========= PANEL & OVERLAY =========
// ===================================
function lockBodyScroll() {
  document.body && document.body.classList.add("no-scroll");
}
function unlockBodyScroll() {
  document.body && document.body.classList.remove("no-scroll");
}

function setAriaHidden(id, state) {
  const el = qs(id);
  if (!el) return;
  el.setAttribute("aria-hidden", state ? "true" : "false");
}

// Sol menü
function openSidebar(){
  const el = qs("#sidebar");
  if (!el) return;
  el.classList.add("open");
  setAriaHidden("#sidebar", false);
  lockBodyScroll();
}
function closeSidebar(){
  const el = qs("#sidebar");
  if (!el) return;
  el.classList.remove("open");
  setAriaHidden("#sidebar", true);
  unlockBodyScroll();
}

// Sepet
function openCart(){
  const el = qs("#cartPanel");
  if (!el) return;
  renderCart();
  el.classList.add("open");
  setAriaHidden("#cartPanel", false);
  lockBodyScroll();
}
function closeCart(){
  const el = qs("#cartPanel");
  if (!el) return;
  el.classList.remove("open");
  setAriaHidden("#cartPanel", true);
  unlockBodyScroll();
}

// Ürün paneli
function openProductsPanel(){
  const panel = qs("#productsPanel");
  if (!panel) return;

  if (!PRODUCTS.length) {
    loadProducts().then(() => renderProductsFull()).catch((err)=>{
      console.warn("Ürünler yüklenemedi:", err);
    });
  } else {
    renderProductsFull();
  }
  panel.classList.add("open");
  setAriaHidden("#productsPanel", false);
  lockBodyScroll();
}
function closeProductsPanel(){
  const panel = qs("#productsPanel");
  if (!panel) return;
  panel.classList.remove("open");
  setAriaHidden("#productsPanel", true);
  unlockBodyScroll();
}

// Checkout overlay
function openCheckout(){
  const items = Object.values(CART);
  const msg = qs("#checkoutMsg");
  if (!items.length) {
    if (msg) msg.textContent = "Sepet boş.";
    return;
  }

  const payable = getPayable();
  const out = qs("#chPayable");
  if (out) out.textContent = fmtMoney(payable);

  const st = qs("#chStatus");
  if (st) st.textContent = "";

  const ov = qs("#checkoutOverlay");
  if (!ov) return;
  ov.classList.add("show");
  setAriaHidden("#checkoutOverlay", false);
  lockBodyScroll();

  // AI sinyali
  trackAiSignal("checkout_opened", {
    itemCount: items.length,
    payable
  });
}
function closeCheckout(){
  const ov = qs("#checkoutOverlay");
  if (!ov) return;
  ov.classList.remove("show");
  setAriaHidden("#checkoutOverlay", true);
  unlockBodyScroll();
}

function scrollToSection(id){
  const el = qs("#" + id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===================================
// ============== API =================
// ===================================
async function api(path, opts = {}) {
  loadTokenFromStorage(); // her istekte güncel token
  const headers = {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(opts.headers || {}),
  };

  const res = await fetch(path, { ...opts, headers });
  let data = null;

  try {
    data = await res.json();
  } catch {
    // JSON olmayan cevaplarda da en azından status döneriz
  }

  if (!res.ok) {
    const msg = data && (data.message || data.error);
    console.warn("API hata:", path, res.status, msg);
    throw new Error(msg || `İstek başarısız: ${res.status}`);
  }

  return data;
}

// ===================================
// ===== ÜRÜN NORMALİZE / LISTE ======
// ===================================
function parsePriceTextToNumber(text){
  const t = String(text ?? "").trim();
  if (!t) return null;
  const num = Number(t.replace(/[₺\s]/g,"").replace(",","."));
  return Number.isFinite(num) ? num : null;
}

function normalizeProductClient(p){
  const out = { ...p };
  out.id    = String(out.id || "");
  out.name  = String(out.name || "").trim();
  out.desc  = String(out.desc || "");
  out.image = out.image || "logo.png";

  const priceIsNum      = typeof out.price === "number" && isFinite(out.price);
  const parsedFromText  = !priceIsNum ? parsePriceTextToNumber(out.priceText) : null;

  if (priceIsNum) {
    out.price = Number(out.price);
    if (!out.priceText) out.priceText = String(out.price);
    out.purchasable = true;
  } else if (parsedFromText !== null) {
    out.price = parsedFromText;
    out.priceText = out.priceText ?? String(parsedFromText);
    out.purchasable = true;
  } else {
    out.price = null;
    out.priceText = out.priceText || "—";
    out.purchasable = false;
  }
  return out;
}

async function loadProducts() {
  try {
    const data = await api("/api/products");
    const list = Array.isArray(data) ? data : [];
    PRODUCTS = list.map(normalizeProductClient);
    trackAiSignal("products_loaded", { count: PRODUCTS.length });
  } catch (err) {
    console.warn("Ürünler alınırken hata:", err);
    PRODUCTS = [];
  }
  renderProductsPreview();
}

function displayPriceTag(p) {
  const isNum = typeof p.price === "number" && isFinite(p.price);
  return isNum ? fmtMoney(p.price) : (p.priceText || "—");
}

function renderProductsPreview() {
  const box = qs("#products");
  if (!box) return;
  box.innerHTML = "";
  const subset = PRODUCTS.slice(0, 8);
  if (!subset.length) {
    box.innerHTML = `<div class="muted">Ürün bulunamadı.</div>`;
    return;
  }
  subset.forEach((p) => box.appendChild(productCard(p)));
}

function renderProductsFull() {
  const box = qs("#productsFull");
  if (!box) return;
  box.innerHTML = "";
  if (!PRODUCTS.length) {
    box.innerHTML = `<div class="muted">Ürün bulunamadı.</div>`;
    return;
  }
  PRODUCTS.forEach((p) => box.appendChild(productCard(p)));
}

function productCard(p) {
  const el = document.createElement("div");
  el.className = "product-card";

  const priceTag = displayPriceTag(p);
  const canBuy   = !!(p && p.purchasable && typeof p.price === "number" && isFinite(p.price));
  const link     = `product.html?id=${encodeURIComponent(p.id)}`;
  const imgSrc   = sanitize(p.image || "logo.png");
  const safeId   = String(p.id || "").replace(/'/g, "\\'");

  el.innerHTML = `
    <a href="${link}"
       style="display:block"
       onclick="window.mavernTrack && window.mavernTrack('view_product',{ id: '${safeId}' })">
      <img class="prod"
           src="${imgSrc}"
           alt="${esc(p.name)}"
           onerror="this.src='logo.png'">
    </a>
    <h4 style="margin:.5rem 0 0">
      <a href="${link}" style="color:inherit;text-decoration:none">${esc(p.name)}</a>
    </h4>
    <div class="price muted" style="margin:.25rem 0 .5rem">${esc(priceTag)}</div>
    ${p.desc ? `<p style="margin:0 0 .5rem" class="muted">${esc(p.desc)}</p>` : ""}
    <button class="btn"
      ${canBuy ? `onclick="addToCart('${safeId}')"` : 'disabled title="Satın alınamaz"'}
    >
      ${canBuy ? "Sepete Ekle" : "Satın Alınamaz"}
    </button>
  `;
  return el;
}

// ===================================
// ============= SEPET ===============
// ===================================
function loadCartFromStorage(){
  try {
    const raw = localStorage.getItem(CART_KEY);
    CART = raw ? JSON.parse(raw) : {};
    if (typeof CART !== "object" || Array.isArray(CART) || CART === null) CART = {};
  } catch {
    CART = {};
  }
}
function saveCartToStorage(){
  try { localStorage.setItem(CART_KEY, JSON.stringify(CART)); } catch {}
}

function addToCart(id) {
  const p = PRODUCTS.find((x) => String(x.id) === String(id));
  if (!p) {
    alert("Ürün bulunamadı");
    return;
  }
  const canBuy = !!(p.purchasable && typeof p.price === "number" && isFinite(p.price));
  if (!canBuy) {
    alert("Bu ürün şu anda satılabilir değil.");
    return;
  }

  if (!CART[id]) CART[id] = { id: p.id, name: p.name, price: p.price, image: p.image, qty: 0 };
  CART[id].qty += 1;

  saveCartToStorage();
  renderCart();
  openCart();

  trackAiSignal("add_to_cart", { productId: id, price: p.price });
}

function changeQty(id, delta) {
  if (!CART[id]) return;
  CART[id].qty += delta;
  if (CART[id].qty <= 0) delete CART[id];
  saveCartToStorage();
  renderCart();

  const el = qs("#checkoutOverlay");
  if (el?.classList.contains("show")) {
    const out = qs("#chPayable");
    if (out) out.textContent = fmtMoney(getPayable());
  }
}

function removeFromCart(id) {
  if (CART[id]) delete CART[id];
  saveCartToStorage();
  renderCart();

  const el = qs("#checkoutOverlay");
  if (el?.classList.contains("show")) {
    const out = qs("#chPayable");
    if (out) out.textContent = fmtMoney(getPayable());
  }

  trackAiSignal("remove_from_cart", { productId: id });
}

function clearCart() {
  CART = {};
  saveCartToStorage();
  COUPON = null;
  const ci = qs("#couponInput"); if (ci) ci.value = "";
  const cm = qs("#couponMsg");  if (cm) cm.textContent = "";
  renderCart();
  const out = qs("#chPayable"); if (out) out.textContent = fmtMoney(0);

  trackAiSignal("clear_cart");
}

function getTotals(){
  const items = Object.values(CART);
  const subtotal = items.reduce((s, i) => s + (Number(i.price) * i.qty), 0);
  let discount = 0;
  if (COUPON?.percent) discount = Math.round(subtotal * (COUPON.percent / 100));
  const payable = Math.max(0, subtotal - discount);
  return { items, subtotal, discount, payable };
}
function getPayable(){ return getTotals().payable; }

// Sticky cart bar (mobil)
function updateStickyCartBar(count, payable){
  const bar  = qs("#stickyCartBar");
  if (!bar) return;

  const totalEl = bar.querySelector("[data-sticky-total]");
  const labelEl = bar.querySelector("[data-sticky-label]");

  if (count > 0) {
    bar.classList.add("show");
    bar.setAttribute("aria-hidden", "false");
    if (totalEl) totalEl.textContent = fmtMoney(payable);
    if (labelEl) labelEl.textContent = `${count} ürün`;
    document.body?.classList.add("has-sticky-pad");
  } else {
    bar.classList.remove("show");
    bar.setAttribute("aria-hidden", "true");
    document.body?.classList.remove("has-sticky-pad");
  }
}

function renderCart() {
  const list = qs("#cartItems");
  if (!list) return;

  list.innerHTML = "";
  const { items, subtotal, discount, payable } = getTotals();
  const count = items.reduce((s, i) => s + i.qty, 0);

  const badge = qs("#cartCount");
  if (badge) badge.textContent = count > 0 ? count : "";

  const st = qs("#subtotal");
  const dc = qs("#discount");
  const py = qs("#payable");
  if (st) st.textContent = fmtMoney(subtotal);
  if (dc) dc.textContent = fmtMoney(discount);
  if (py) py.textContent = fmtMoney(payable);

  updateStickyCartBar(count, payable);

  if (!items.length) {
    list.innerHTML = `<div class="muted">Sepetiniz boş.</div>`;
    return;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const imgSrc = sanitize(it.image || "logo.png");
    row.innerHTML = `
      <img src="${imgSrc}" alt=""
           style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--edge);background:#111"
           onerror="this.src='logo.png'">
      <div class="meta" style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</div>
        <div class="muted small">${fmtMoney(it.price)}</div>
      </div>
      <div>
        <div class="qty">
          <button type="button" aria-label="Azalt" onclick="changeQty('${it.id}',-1)">−</button>
          <div class="num">${it.qty}</div>
          <button type="button" aria-label="Arttır" onclick="changeQty('${it.id}',1)">+</button>
        </div>
        <button class="btn" type="button" style="margin-top:6px" onclick="removeFromCart('${it.id}')">Kaldır</button>
      </div>
    `;
    list.appendChild(row);
  });
}

// ===================================
// ============= KUPON ===============
// ===================================
async function applyCoupon() {
  const input = qs("#couponInput");
  const msgEl = qs("#couponMsg");
  if (!input || !msgEl) return;

  const code = (input.value || "").trim();
  if (!code) {
    msgEl.textContent = "Kod girin.";
    COUPON = null;
    renderCart();
    return;
  }

  try {
    const res = await api("/api/coupon/check", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (res.success) {
      COUPON = { code, percent: res.percent, expiresAt: res.expiresAt || null };
      const extra = res.expiresAt
        ? ` • Bitiş: ${new Date(res.expiresAt).toLocaleString("tr-TR")}`
        : "";
      msgEl.textContent = `${code} uygulandı: %${res.percent} indirim${extra}.`;

      trackAiSignal("apply_coupon", { code, percent: res.percent });
    } else {
      COUPON = null;
      msgEl.textContent = res.message || "Geçersiz kod.";
    }
    renderCart();
    const el = qs("#checkoutOverlay");
    if (el?.classList.contains("show")) {
      const out = qs("#chPayable"); if (out) out.textContent = fmtMoney(getPayable());
    }
  } catch (err) {
    console.warn("Kupon kontrol hatası:", err);
    msgEl.textContent = "Sunucu hatası.";
  }
}

// ===================================
// ============= CHECKOUT ============
// ===================================
function isValidEmail(e=""){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(t=""){ return /^[+0-9()\-\s]{6,}$/.test(String(t).trim()); }

let CHECKOUT_LOCK = false;
let CHECKOUT_LOCK_TIMER = null;

async function submitCheckout(){
  const st = qs("#chStatus");
  const name   = (qs("#chName")?.value || "").trim();
  const email  = (qs("#chEmail")?.value || "").trim();
  const phone  = (qs("#chPhone")?.value || "").trim();
  const addr   = (qs("#chAddress")?.value || "").trim();
  const kvkkOk = qs("#chKvkk")?.checked;

  if (!st) return;

  if (CHECKOUT_LOCK) {
    st.textContent = "İşleminiz alınıyor, lütfen bekleyin.";
    return;
  }

  const { items } = getTotals();
  if (!items.length){ st.textContent="Sepet boş."; return; }

  // Zorunlu alanlar
  if (!name || !email || !phone || !addr){ st.textContent="Lütfen tüm alanları doldurun."; return; }
  if (hasTr(email)){ st.textContent="E-posta adresinde Türkçe karakter kullanmayın."; return; }
  if (!isValidEmail(email)){ st.textContent="Geçerli bir e-posta girin."; return; }
  if (!isValidPhone(phone)){ st.textContent="Geçerli bir telefon girin."; return; }
  if (addr.length < 10){ st.textContent="Adres çok kısa (min 10 karakter)."; return; }
  if (addr.length > 600){ st.textContent="Adres çok uzun (max 600 karakter)."; return; }
  if (!kvkkOk){ st.textContent="KVKK onayı zorunludur."; return; }

  // AI / kişiselleştirme snapshot
  let profileSnapshot = null;
  try {
    if (typeof window.mavernGetProfileSnapshot === "function") {
      profileSnapshot = window.mavernGetProfileSnapshot();
    }
  } catch {
    profileSnapshot = null;
  }

  const payload = {
    items: items.map(i => ({ id:i.id, name:i.name, price:Number(i.price), qty:i.qty })),
    name, email, phone, address: addr,
    coupon: COUPON?.code || null,
    profileSnapshot: profileSnapshot || null
  };

  CHECKOUT_LOCK = true;
  if (CHECKOUT_LOCK_TIMER) clearTimeout(CHECKOUT_LOCK_TIMER);
  CHECKOUT_LOCK_TIMER = setTimeout(()=>{ CHECKOUT_LOCK = false; }, 20000);

  st.textContent = "Gönderiliyor...";

  // AI sinyali (deneme aşaması)
  trackAiSignal("checkout_attempt", {
    itemCount: items.length,
    hasCoupon: !!COUPON?.code
  });

  try{
    const res = await api("/api/checkout", { method:"POST", body: JSON.stringify(payload) });
    if (res.success){
      st.textContent = "Sipariş iletildi. Teşekkürler!";
      trackAiSignal("checkout_submitted", { itemCount: items.length, hasCoupon: !!COUPON?.code });
      clearCart();
      setTimeout(()=>{ closeCheckout(); }, 600);
      const msg = qs("#checkoutMsg"); if (msg) msg.textContent = "Sipariş iletildi. Teşekkürler!";
    } else {
      st.textContent = res.message || "Gönderilemedi.";
    }
  } catch(e){
    console.warn("Checkout hatası:", e);
    st.textContent = e.message || "Sunucu hatası.";
  } finally {
    // sunucuda idempotency var; kilit 20sn sonra otomatik kalkıyor (timer yukarıda)
  }
}

// ===================================
// ============ İLETİŞİM =============
// ===================================
async function sendMessage() {
  const name = (qs("#contactName")?.value || "").trim();
  const email = (qs("#contactEmail")?.value || "").trim();
  const message = (qs("#contactMsg")?.value || "").trim();
  const status = qs("#contactStatus");
  if (!status) return;

  if (!name || !email || !message) { status.textContent = "Lütfen tüm alanları doldurun."; return; }
  if (hasTr(email)) { status.textContent = "E-posta adresinde Türkçe karakter kullanmayın."; return; }
  if (!isValidEmail(email)) { status.textContent = "Geçerli bir e-posta girin."; return; }

  status.textContent = "Gönderiliyor...";

  trackAiSignal("contact_attempt");

  try {
    const res = await api("/api/contact", { method: "POST", body: JSON.stringify({ name, email, message }) });
    status.textContent = res.success ? "Mesaj alındı. Teşekkürler!" : res.message || "Gönderilemedi.";
    if (res.success) {
      const n = qs("#contactName");  if (n) n.value = "";
      const e = qs("#contactEmail"); if (e) e.value = "";
      const m = qs("#contactMsg");   if (m) m.value = "";
      trackAiSignal("contact_sent");
    }
  } catch (err) {
    console.warn("İletişim formu hatası:", err);
    status.textContent = err.message || "Sunucu hatası.";
  }
}

// ===================================
// ========= SİPARİŞLERİM ============
// ===================================
async function loadMyOrders() {
  const root = qs("[data-orders-root]");
  if (!root) return;

  root.innerHTML = `<div class="muted small">Yükleniyor...</div>`;

  try {
    const res = await api("/api/orders/my", { method: "GET" });
    if (!res.success || !Array.isArray(res.items) || res.items.length === 0) {
      root.innerHTML = `<div class="muted small">Henüz siparişiniz yok.</div>`;
      return;
    }

    const list = res.items;

    const statusLabel = (s) => {
      switch (s) {
        case "pending":   return "Beklemede";
        case "preparing": return "Hazırlanıyor";
        case "shipped":   return "Kargoya verildi";
        case "completed": return "Tamamlandı";
        case "cancelled": return "İptal edildi";
        default:          return s || "-";
      }
    };

    root.innerHTML = "";
    list.forEach(o => {
      const box = document.createElement("article");
      box.className = "order-card";

      const created = o.createdAt ? new Date(o.createdAt).toLocaleString("tr-TR") : "-";
      const items = Array.isArray(o.items) ? o.items : [];
      const lines = items.map(it => `• ${esc(it.name)} x${it.qty || 1}`).join("<br>");

      const total    = Number(o.total    ?? 0);
      const discount = Number(o.discount ?? 0);
      const payable  = Number(o.payable  ?? (total - discount));

      const statusTxt = statusLabel(o.status || "pending");
      const tracking  = o.trackingCode || null;

      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div>
            <div style="font-size:13px;color:var(--muted);">Sipariş ID</div>
            <div style="font-weight:600;font-size:13px;">${esc(o.id)}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:var(--muted);">
            ${esc(created)}
          </div>
        </div>

        <div style="margin:6px 0;font-size:13px;">
          <strong>Durum:</strong> ${esc(statusTxt)}
          ${tracking ? `<br><strong>Takip Kodu:</strong> ${esc(tracking)}` : ""}
        </div>

        <div style="font-size:13px;margin-bottom:6px;">
          <strong>Ürünler:</strong><br>
          ${lines}
        </div>

        <div style="font-size:13px;border-top:1px solid var(--edge);padding-top:6px;margin-top:4px;display:flex;justify-content:space-between;">
          <span>Ara Toplam / İndirim / Ödenecek</span>
          <span>
            ${fmtMoney(total)} / ${fmtMoney(discount)} / <strong>${fmtMoney(payable)}</strong>
          </span>
        </div>
      `;
      root.appendChild(box);
    });
  } catch (e) {
    const msg = e?.message || "Siparişler alınamadı.";
    console.warn("Siparişlerim hatası:", e);
    if (String(msg).includes("401") || msg === "Giriş gerekli" || msg === "Geçersiz oturum") {
      root.innerHTML = `<div class="muted small">Siparişleri görmek için giriş yapın.</div>`;
    } else {
      root.innerHTML = `<div class="muted small">${esc(msg)}</div>`;
    }
  }
}

// Basit logout
function mavernLogout() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  TOKEN = null;
  location.href = "index.html";
}

// ===================================
// ===== AI / KİŞİSELLEŞTİRME ========
// ===================================
function trackAiSignal(type, payload = {}) {
  try {
    const raw  = localStorage.getItem(AI_PROFILE_KEY);
    const base = raw ? JSON.parse(raw) : {};
    const now  = new Date().toISOString();

    const events = Array.isArray(base.events) ? base.events : [];
    events.push({
      type,
      payload,
      at: now,
      sessionId: MAVERN_SESSION_ID
    });
    base.events = events.slice(-50);

    if (!base.metrics) base.metrics = {};
    if (type === "add_to_cart") {
      base.metrics.addToCartCount = (base.metrics.addToCartCount || 0) + 1;
    }
    if (type === "checkout_submitted") {
      base.metrics.checkoutCount = (base.metrics.checkoutCount || 0) + 1;
    }

    base.lastUpdatedAt = now;

    localStorage.setItem(AI_PROFILE_KEY, JSON.stringify(base));
  } catch (err) {
    console.warn("AI sinyal yazılamadı:", err);
  }
}

window.mavernTrack = trackAiSignal;

function buildClientSignals() {
  const { items, subtotal, discount, payable } = getTotals();
  const theme = (document.documentElement.getAttribute("data-theme") === "light") ? "light" : "dark";

  return {
    sessionId: MAVERN_SESSION_ID,
    cart: {
      itemCount: items.length,
      subtotal,
      discount,
      payable
    },
    ui: {
      theme
    }
  };
}

window.mavernGetProfileSnapshot = function(){
  const snapshot = {};

  // 1) Sunucudaki aiProfile
  if (window.mavernProfile && typeof window.mavernProfile === "object") {
    snapshot.serverProfile = window.mavernProfile;
  } else {
    // Cache’ten al
    try {
      const cached = localStorage.getItem(AI_PROFILE_SERVER_KEY);
      if (cached) {
        const obj = JSON.parse(cached);
        if (obj && typeof obj === "object") {
          snapshot.serverProfile = obj;
        }
      }
    } catch {}
  }

  // 2) Client event log
  try {
    const raw = localStorage.getItem(AI_PROFILE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        snapshot.localSignals = obj;
      }
    }
  } catch {}

  // 3) Anlık client sinyalleri
  snapshot.client = buildClientSignals();

  return Object.keys(snapshot).length ? snapshot : null;
};

// Kullanıcı + AI profilini server’dan al
async function initUserAndAiProfile() {
  if (!TOKEN) return;

  // 1) /api/auth/me
  try {
    const me = await api("/api/auth/me", { method: "GET" });
    if (me && me.success && me.user) {
      const u = me.user;

      const links = qsa(".account-link");
      links.forEach((link) => {
        if (link.tagName === "A") {
          link.textContent = u.displayName
            ? `${u.displayName} • Hesabım`
            : "Hesabım";
        }
      });

      const heroLine = qs("#heroPersonalLine");
      if (heroLine) {
        const name = u.fullName || u.displayName || (u.email || "").split("@")[0];
        heroLine.textContent = `Hoş geldin ${name}, alışveriş deneyimini adım adım kişiselleştirmeye hazırlanıyoruz.`;
        heroLine.style.display = "block";
      }

      trackAiSignal("user_session_detected", {
        id: u.id || u._id || null
      });
    }
  } catch (err) {
    console.warn("Kullanıcı bilgisi alınamadı:", err);
  }

  // 2) /api/profile/full
  try {
    const res = await api("/api/profile/full", { method: "GET" });
    if (res && res.success && res.profile) {
      window.mavernProfile = res.profile;
      try {
        localStorage.setItem(AI_PROFILE_SERVER_KEY, JSON.stringify(res.profile));
      } catch {}
    }
  } catch (err) {
    console.warn("AI profil alınamadı:", err);
  }
}

// ===================================
// ============= UTILS ===============
// ===================================
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
function sanitize(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

// ===================================
// ============== INIT ===============
// ===================================
window.addEventListener("DOMContentLoaded", async () => {
  // Tema
  initTheme();
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      const next = current === "light" ? "dark" : "light";
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      applyTheme(next);
    });
  }

  // Oturum & sepet & ürünler
  loadTokenFromStorage();
  updateAccountLink();
  loadCartFromStorage();

  await loadProducts();
  renderCart();

  // Kullanıcı + AI profil
  initUserAndAiProfile();

  // Sticky cart bar tıklanınca (boş değilse) sepeti aç
  const sticky = qs("#stickyCartBar");
  if (sticky) {
    sticky.addEventListener("click", () => {
      if (getTotals().items.length > 0) openCart();
    });
  }

  // Siparişlerim sayfasında isek
  if (qs("[data-orders-root]")) {
    loadMyOrders();
  }

  // ESC ile panelleri kapat
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCart();
      closeProductsPanel();
      closeSidebar();
      closeCheckout();
    }
  });
});
