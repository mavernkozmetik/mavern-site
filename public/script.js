// ===== Genel yardımcılar =====
const qs  = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);
const hasTr = (s = "") => /[çğıöşüÇĞİÖŞÜ]/.test(s);
const fmt = (n) => `${Number(n || 0).toFixed(0)} ₺`;

// Token: sadece eski mini admin için; gerçek admin sayfası kendi JS'ini kullanıyor
let TOKEN = localStorage.getItem("mavern_token") || null;

let PRODUCTS = [];
let CART = {};        // { id: {id,name,price,image,qty} }
let COUPON = null;    // { code, percent, expiresAt? }

// ===== Panel aç/kapa =====
function openSidebar(){ qs("#sidebar")?.classList.add("open"); }
function closeSidebar(){ qs("#sidebar")?.classList.remove("open"); }
function openCart(){ qs("#cartPanel")?.classList.add("open"); renderCart(); }
function closeCart(){ qs("#cartPanel")?.classList.remove("open"); }
function openProductsPanel(){ qs("#productsPanel")?.classList.add("open"); renderProductsFull(); }
function closeProductsPanel(){ qs("#productsPanel")?.classList.remove("open"); }
function scrollToSection(id){
  const el = qs("#" + id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===== API (güçlü sarmalayıcı) =====
async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch { /* boş/HTML olabilir */ }
  if (!res.ok) {
    const msg = data && (data.message || data.error);
    throw new Error(msg || `İstek başarısız: ${res.status}`);
  }
  return data;
}

// ===== Ürünler =====
async function loadProducts() {
  try {
    const data = await api("/api/products");
    PRODUCTS = Array.isArray(data) ? data : [];
  } catch {
    PRODUCTS = [];
  }
  renderProductsPreview();
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
  el.innerHTML = `
    <img class="prod" src="${sanitize(p.image || "logo.png")}" alt="${esc(p.name)}"
         style="width:100%;height:180px;object-fit:cover;border-radius:12px;border:1px solid #26324a;background:#0a0f1b"
         onerror="this.src='logo.png'">
    <h4 style="margin:.5rem 0 0">${esc(p.name)}</h4>
    <div class="price" style="margin:.25rem 0 .5rem">${fmt(p.price)}</div>
    ${p.desc ? `<p style="margin:0 0 .5rem" class="muted">${esc(p.desc)}</p>` : ""}
    <button class="btn" onclick="addToCart('${p.id}')">Sepete Ekle</button>
  `;
  return el;
}

// ===== Sepet =====
function addToCart(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return alert("Ürün bulunamadı");
  if (!CART[id]) CART[id] = { ...p, qty: 0 };
  CART[id].qty += 1;
  renderCart();
  openCart();
}

function changeQty(id, delta) {
  if (!CART[id]) return;
  CART[id].qty += delta;
  if (CART[id].qty <= 0) delete CART[id];
  renderCart();
}

function removeFromCart(id) {
  if (CART[id]) delete CART[id];
  renderCart();
}

function clearCart() {
  CART = {};
  COUPON = null;
  qs("#couponInput") && (qs("#couponInput").value = "");
  qs("#couponMsg") && (qs("#couponMsg").textContent = "");
  renderCart();
}

function renderCart() {
  const list = qs("#cartItems");
  if (!list) return;

  list.innerHTML = "";
  const items = Object.values(CART);
  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + (Number(i.price) * i.qty), 0);
  let discount = 0;
  if (COUPON?.percent) discount = Math.round(subtotal * (COUPON.percent / 100));
  const payable = Math.max(0, subtotal - discount);

  const badge = qs("#cartCount");
  if (badge) badge.textContent = count > 0 ? count : "";

  qs("#subtotal") && (qs("#subtotal").textContent = fmt(subtotal));
  qs("#discount") && (qs("#discount").textContent = fmt(discount));
  qs("#payable") && (qs("#payable").textContent = fmt(payable));

  if (!items.length) {
    list.innerHTML = `<div class="muted">Sepetiniz boş.</div>`;
    return;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <img src="${sanitize(it.image || "logo.png")}" alt=""
           style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #26324a;background:#0a0f1b"
           onerror="this.src='logo.png'">
      <div class="meta" style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</div>
        <div class="muted small">${fmt(it.price)}</div>
      </div>
      <div>
        <div class="qty">
          <button aria-label="Azalt" onclick="changeQty('${it.id}',-1)">−</button>
          <div class="num">${it.qty}</div>
          <button aria-label="Arttır" onclick="changeQty('${it.id}',1)">+</button>
        </div>
        <button class="btn" style="margin-top:6px" onclick="removeFromCart('${it.id}')">Kaldır</button>
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
  } catch (e) {
    msgEl.textContent = "Sunucu hatası.";
  }
}

// ===== Checkout (mail) =====
async function checkout() {
  const nameEl = qs("#coName");
  const emailEl = qs("#coEmail");
  const msg = qs("#checkoutMsg");
  if (!msg) return;

  const name = (nameEl?.value || "").trim();
  const email = (emailEl?.value || "").trim();
  const items = Object.values(CART).map((i) => ({
    id: i.id,
    name: i.name,
    price: Number(i.price),
    qty: i.qty,
  }));

  if (!items.length) {
    msg.textContent = "Sepet boş.";
    return;
  }
  if (email) {
    if (hasTr(email)) {
      msg.textContent = "E-posta adresinde Türkçe karakter kullanmayın.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = "Geçerli bir e-posta girin.";
      return;
    }
  }

  msg.textContent = "Gönderiliyor...";
  try {
    const res = await api("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ items, name, email, coupon: COUPON?.code || null }),
    });

    if (res.success) {
      msg.textContent = "Sipariş iletildi. Teşekkürler!";
      clearCart();
    } else {
      msg.textContent = res.message || "Gönderilemedi.";
    }
  } catch (e) {
    msg.textContent = e.message || "Sunucu hatası.";
  }
}

// ===== İletişim formu =====
async function sendMessage() {
  const name = (qs("#contactName")?.value || "").trim();
  const email = (qs("#contactEmail")?.value || "").trim();
  const message = (qs("#contactMsg")?.value || "").trim();
  const status = qs("#contactStatus");
  if (!status) return;

  if (!name || !email || !message) {
    status.textContent = "Lütfen tüm alanları doldurun.";
    return;
  }
  if (hasTr(email)) {
    status.textContent = "E-posta adresinde Türkçe karakter kullanmayın.";
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Geçerli bir e-posta girin.";
    return;
  }

  status.textContent = "Gönderiliyor...";
  try {
    const res = await api("/api/contact", {
      method: "POST",
      body: JSON.stringify({ name, email, message }),
    });
    status.textContent = res.success
      ? "Mesaj alındı. Teşekkürler!"
      : res.message || "Gönderilemedi.";
    if (res.success) {
      qs("#contactName").value = "";
      qs("#contactEmail").value = "";
      qs("#contactMsg").value = "";
    }
  } catch (e) {
    status.textContent = e.message || "Sunucu hatası.";
  }
}

// ===== (Eski) Mini Admin — yalnızca ilgili elemanlar varsa çalışır =====
async function adminLogin() {
  const u = qs("#adminUser")?.value.trim();
  const p = qs("#adminPass")?.value.trim();
  const info = qs("#adminLoginStatus");
  if (!u || !p) {
    if (info) info.textContent = "Bilgileri doldurun.";
    return;
  }
  try {
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ username: u, password: p }) });
    TOKEN = res.token;
    localStorage.setItem("mavern_token", TOKEN);
    if (qs("#loginPanel")) qs("#loginPanel").style.display = "none";
    if (qs("#adminPanel")) qs("#adminPanel").style.display = "block";
    await loadProducts();
    renderAdminProducts();
    if (info) info.textContent = "Giriş başarılı ✅";
  } catch (e) {
    if (info) info.textContent = "Yanlış giriş";
  }
}

function adminLogout() {
  TOKEN = null;
  localStorage.removeItem("mavern_token");
  if (qs("#adminPanel")) qs("#adminPanel").style.display = "none";
  if (qs("#loginPanel")) qs("#loginPanel").style.display = "block";
}

async function addProduct() {
  // yalnızca mini admin kullanıyorsa
  if (!qs("#adminProducts")) return;
  const name = qs("#prodName")?.value.trim();
  const price = parseFloat(qs("#prodPrice")?.value);
  const image = qs("#prodImg")?.value.trim();
  const desc = qs("#prodDesc")?.value.trim();
  if (!name || isNaN(price)) {
    alert("İsim ve geçerli fiyat girin.");
    return;
  }
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify({ name, price, image, desc }) });
    await loadProducts();
    renderAdminProducts();
    if (qs("#prodName")) qs("#prodName").value = "";
    if (qs("#prodPrice")) qs("#prodPrice").value = "";
    if (qs("#prodImg")) qs("#prodImg").value = "";
    if (qs("#prodDesc")) qs("#prodDesc").value = "";
    alert("Ürün eklendi.");
  } catch (e) {
    alert(e.message);
  }
}

async function delProduct(id) {
  if (!qs("#adminProducts")) return;
  if (!confirm("Silinsin mi?")) return;
  try {
    await api("/api/admin/products/" + encodeURIComponent(id), { method: "DELETE" });
    await loadProducts();
    renderAdminProducts();
  } catch (e) {
    alert(e.message);
  }
}

function renderAdminProducts() {
  const box = qs("#adminProducts");
  if (!box) return;
  box.innerHTML = "";
  if (!PRODUCTS.length) {
    box.innerHTML = `<p class="muted">Ürün yok</p>`;
    return;
  }
  PRODUCTS.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <img src="${sanitize(p.image || "logo.png")}" alt=""
           style="width:100%;height:120px;object-fit:cover;border-radius:8px;border:1px solid #26324a;background:#0a0f1b"
           onerror="this.src='logo.png'">
      <h4 style="margin:.5rem 0 0">${esc(p.name)}</h4>
      <div class="price" style="margin:.25rem 0 .5rem">${fmt(p.price)}</div>
      <button class="btn" onclick="delProduct('${p.id}')">Sil</button>
    `;
    box.appendChild(card);
  });
}

// ===== utils =====
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
function sanitize(s) {
  return String(s || "").replace(/"/g, "&quot;");
}

// ===== init =====
window.addEventListener("DOMContentLoaded", async () => {
  // Ürünleri yükle
  await loadProducts();
  renderCart(); // boş başlat

  // ESC ile açık panelleri kapat
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCart();
      closeProductsPanel();
      closeSidebar();
    }
  });

  // Mini admin’de otomatik panel göster
  if (location.pathname.endsWith("/admin.html") && TOKEN) {
    if (qs("#loginPanel")) qs("#loginPanel").style.display = "none";
    if (qs("#adminPanel")) qs("#adminPanel").style.display = "block";
    renderAdminProducts();
  }
});
