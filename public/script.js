// ===== Genel yardımcılar =====
const qs  = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);
const hasTr = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const fmtMoney = (n) => `${Number(n || 0).toFixed(0)} ₺`;

// ==== JWT anahtarı (auth.html ile uyumlu) ====
const TOKEN_KEY = "mavern_jwt";
let TOKEN = null;

// ==== Sepet kalıcılık anahtarı ====
const CART_KEY = "mavern_cart";

let PRODUCTS = [];
let CART = {};        // { id: {id,name,price,image,qty} }
let COUPON = null;    // { code, percent, expiresAt? }

// ===== Token / session helper =====
function loadTokenFromStorage() {
  try {
    TOKEN = localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    TOKEN = null;
  }
}

// ===== Panel aç/kapa =====
function openSidebar(){ qs("#sidebar")?.classList.add("open"); }
function closeSidebar(){ qs("#sidebar")?.classList.remove("open"); }
function openCart(){ renderCart(); qs("#cartPanel")?.classList.add("open"); }
function closeCart(){ qs("#cartPanel")?.classList.remove("open"); }

function openProductsPanel(){
  if (!PRODUCTS.length) {
    // ürünler daha yüklenmediyse bir daha çek
    loadProducts().then(() => renderProductsFull()).catch(()=>{});
  } else {
    renderProductsFull();
  }
  qs("#productsPanel")?.classList.add("open");
}
function closeProductsPanel(){ qs("#productsPanel")?.classList.remove("open"); }

// Checkout overlay
function openCheckout(){
  const items = Object.values(CART);
  const msg = qs("#checkoutMsg");
  if(!items.length){
    if (msg) msg.textContent = "Sepet boş.";
    return;
  }
  const payable = getPayable();
  const out = qs("#chPayable");
  if(out) out.textContent = fmtMoney(payable);
  const st = qs("#chStatus");
  if(st) st.textContent = "";
  qs("#checkoutOverlay")?.classList.add("show");
}
function closeCheckout(){
  qs("#checkoutOverlay")?.classList.remove("show");
}

function scrollToSection(id){
  const el = qs("#" + id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===== API =====
async function api(path, opts = {}) {
  loadTokenFromStorage(); // her istekte güncel token
  const headers = {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data && (data.message || data.error);
    throw new Error(msg || `İstek başarısız: ${res.status}`);
  }
  return data;
}

// ===== Ürün normalize (istemci fallback) =====
function parsePriceTextToNumber(text){
  const t = String(text ?? "").trim();
  if(!t) return null;
  const num = Number(t.replace(/[₺\s]/g,"").replace(",","."));
  return Number.isFinite(num) ? num : null;
}
function normalizeProductClient(p){
  const out = { ...p };
  out.id = String(out.id || "");
  out.name = String(out.name || "").trim();
  out.desc = String(out.desc || "");
  out.image = out.image || "logo.png";

  const priceIsNum = typeof out.price === "number" && isFinite(out.price);
  const parsedFromText = !priceIsNum ? parsePriceTextToNumber(out.priceText) : null;

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

// ===== Ürünler =====
async function loadProducts() {
  try {
    const data = await api("/api/products");
    const list = Array.isArray(data) ? data : [];
    PRODUCTS = list.map(normalizeProductClient);
  } catch {
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
  const canBuy = !!(p && p.purchasable && typeof p.price === "number" && isFinite(p.price));
  const link = `product.html?id=${encodeURIComponent(p.id)}`;
  const imgSrc = sanitize(p.image || "logo.png");

  el.innerHTML = `
    <a href="${link}" style="display:block">
      <img class="prod"
           src="${imgSrc}"
           alt="${esc(p.name)}"
           style="width:100%;height:180px;object-fit:cover;border-radius:12px;border:1px solid #26324a;background:#0a0f1b"
           onerror="this.src='logo.png'">
    </a>
    <h4 style="margin:.5rem 0 0">
      <a href="${link}" style="color:#e6edf3;text-decoration:none">${esc(p.name)}</a>
    </h4>
    <div class="price muted" style="margin:.25rem 0 .5rem">${esc(priceTag)}</div>
    ${p.desc ? `<p style="margin:0 0 .5rem" class="muted">${esc(p.desc)}</p>` : ""}
    <button class="btn"
      ${canBuy ? `onclick="addToCart('${p.id}')"` : 'disabled title="Satın alınamaz"'}>
      ${canBuy ? "Sepete Ekle" : "Satın Alınamaz"}
    </button>
  `;
  return el;
}

// ===== Sepet (localStorage kalıcılık) =====
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
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return alert("Ürün bulunamadı");
  const canBuy = !!(p.purchasable && typeof p.price === "number" && isFinite(p.price));
  if (!canBuy) { alert("Bu ürün şu anda satılabilir değil."); return; }
  if (!CART[id]) CART[id] = { id: p.id, name: p.name, price: p.price, image: p.image, qty: 0 };
  CART[id].qty += 1;
  saveCartToStorage();
  renderCart();
  openCart();
}

function changeQty(id, delta) {
  if (!CART[id]) return;
  CART[id].qty += delta;
  if (CART[id].qty <= 0) delete CART[id];
  saveCartToStorage();
  renderCart();
  const el = qs("#checkoutOverlay");
  if(el?.classList.contains("show")){
    const out = qs("#chPayable"); if(out) out.textContent = fmtMoney(getPayable());
  }
}

function removeFromCart(id) {
  if (CART[id]) delete CART[id];
  saveCartToStorage();
  renderCart();
  const el = qs("#checkoutOverlay");
  if(el?.classList.contains("show")){
    const out = qs("#chPayable"); if(out) out.textContent = fmtMoney(getPayable());
  }
}

function clearCart() {
  CART = {};
  saveCartToStorage();
  COUPON = null;
  const ci = qs("#couponInput"); if(ci) ci.value = "";
  const cm = qs("#couponMsg"); if(cm) cm.textContent = "";
  renderCart();
  const out = qs("#chPayable"); if(out) out.textContent = fmtMoney(0);
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
           style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #26324a;background:#0a0f1b"
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

// ===== Kupon =====
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
      const extra = res.expiresAt ? ` • Bitiş: ${new Date(res.expiresAt).toLocaleString("tr-TR")}` : "";
      msgEl.textContent = `${code} uygulandı: %${res.percent} indirim${extra}.`;
    } else {
      COUPON = null;
      msgEl.textContent = res.message || "Geçersiz kod.";
    }
    renderCart();
    const el = qs("#checkoutOverlay");
    if(el?.classList.contains("show")){
      const out = qs("#chPayable"); if(out) out.textContent = fmtMoney(getPayable());
    }
  } catch {
    msgEl.textContent = "Sunucu hatası.";
  }
}

// ===== Checkout (overlay -> server.js /api/checkout) =====
function isValidEmail(e=""){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(t=""){ return /^[+0-9()\-\s]{6,}$/.test(String(t).trim()); }

// 20s client-side kilit (sunucu idempotency’ye ek)
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
  if(!items.length){ st.textContent="Sepet boş."; return; }

  // Zorunlu alanlar
  if(!name || !email || !phone || !addr){ st.textContent="Lütfen tüm alanları doldurun."; return; }
  if(hasTr(email)){ st.textContent="E-posta adresinde Türkçe karakter kullanmayın."; return; }
  if(!isValidEmail(email)){ st.textContent="Geçerli bir e-posta girin."; return; }
  if(!isValidPhone(phone)){ st.textContent="Geçerli bir telefon girin."; return; }
  if(addr.length < 10){ st.textContent="Adres çok kısa (min 10 karakter)."; return; }
  if(addr.length > 600){ st.textContent="Adres çok uzun (max 600 karakter)."; return; }
  if(!kvkkOk){ st.textContent="KVKK onayı zorunludur."; return; }

  const payload = {
    items: items.map(i => ({ id:i.id, name:i.name, price:Number(i.price), qty:i.qty })),
    name, email, phone, address: addr,
    coupon: COUPON?.code || null
  };

  // Kilidi aç
  CHECKOUT_LOCK = true;
  if (CHECKOUT_LOCK_TIMER) clearTimeout(CHECKOUT_LOCK_TIMER);
  CHECKOUT_LOCK_TIMER = setTimeout(()=>{ CHECKOUT_LOCK = false; }, 20000);

  st.textContent = "Gönderiliyor...";
  try{
    const res = await api("/api/checkout", { method:"POST", body: JSON.stringify(payload) });
    if(res.success){
      st.textContent = "Sipariş iletildi. Teşekkürler!";
      clearCart();
      setTimeout(()=>{ closeCheckout(); }, 600);
      const msg = qs("#checkoutMsg"); if(msg) msg.textContent = "Sipariş iletildi. Teşekkürler!";
    }else{
      st.textContent = res.message || "Gönderilemedi.";
    }
  }catch(e){
    st.textContent = e.message || "Sunucu hatası.";
  }finally{
    // sunucuda idempotency var; kilit 20sn sonra otomatik kalkıyor (timer yukarıda)
  }
}

// ===== İletişim formu =====
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
  try {
    const res = await api("/api/contact", { method: "POST", body: JSON.stringify({ name, email, message }) });
    status.textContent = res.success ? "Mesaj alındı. Teşekkürler!" : res.message || "Gönderilemedi.";
    if (res.success) {
      const n = qs("#contactName"); if(n) n.value = "";
      const e = qs("#contactEmail"); if(e) e.value = "";
      const m = qs("#contactMsg"); if(m) m.value = "";
    }
  } catch (e) {
    status.textContent = e.message || "Sunucu hatası.";
  }
}

// ===== utils =====
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
function sanitize(s) {
  // src / href gibi attribute’lar için sadece çift tırnak temizliyoruz
  return String(s ?? "").replace(/"/g, "&quot;");
}

// ===== init =====
window.addEventListener("DOMContentLoaded", async () => {
  loadTokenFromStorage();
  loadCartFromStorage();

  await loadProducts();
  renderCart();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCart();
      closeProductsPanel();
      closeSidebar();
      closeCheckout();
    }
  });
});
