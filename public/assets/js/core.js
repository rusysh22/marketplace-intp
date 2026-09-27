// ============================================================================
// Compassion Market — modul inti: klien Supabase, helper UI, keranjang, header
// ============================================================================
const cfg = window.CM_CONFIG || {};
export const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/xxxx/.test(cfg.SUPABASE_URL));

export const sb = window.supabase.createClient(
  cfg.SUPABASE_URL || 'http://localhost:54321',
  cfg.SUPABASE_ANON_KEY || 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } }
);

// ---------- helper DOM & format ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
export const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[^\d-]/g, '')));
export const fmtDate = (d, withTime = true) => d ? new Date(d).toLocaleString('id-ID', withTime
  ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  : { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const pad = (n) => String(n).padStart(2, '0');
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? d + ' hari ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s % 60);
}
export const waLink = (number, text) => `https://wa.me/${String(number || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

export function imgUrl(path, bucket = 'product-photos') {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#eaf4f1"/><circle cx="320" cy="213" r="102" fill="#f8fffc"/><path d="M258 224l37-45 39 38 30-22 37 37" fill="none" stroke="#54a79c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="273" cy="187" r="10" fill="#54a79c"/><text x="320" y="382" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="bold" letter-spacing="3" fill="#397184">FOTO PRODUK</text></svg>');

export function errText(e) {
  const m = e?.message || e?.error_description || e?.error || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Email atau password salah';
  if (/Email not confirmed/i.test(m)) return 'Email belum dikonfirmasi — cek inbox Anda';
  if (/User already registered/i.test(m)) return 'Email sudah terdaftar, silakan login';
  if (/Failed to fetch/i.test(m)) return 'Tidak bisa terhubung ke server. Cek koneksi / konfigurasi Supabase.';
  return m;
}

// ---------- toast ----------
export function toast(msg, type = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="x-btn" type="button" aria-label="Tutup">×</button></div>
    <div class="modal-body"></div>
    ${actions.length ? '<div class="modal-foot"></div>' : ''}</div>`;
  const bodyEl = $('.modal-body', bd);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = () => { bd.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('.x-btn', bd).onclick = close;
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  const foot = $('.modal-foot', bd);
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (a.cls || 'btn-ghost');
    b.textContent = a.label;
    b.onclick = async () => {
      if (!a.onClick) return close();
      b.disabled = true;
      try { const r = await a.onClick({ close, el: bd, body: bodyEl }); if (r !== false) close(); }
      catch (e) { toast(errText(e), 'error'); }
      finally { b.disabled = false; }
    };
    foot.appendChild(b);
  });
  document.body.appendChild(bd);
  setTimeout(() => $('input,select,textarea', bodyEl)?.focus(), 30);
  return { el: bd, body: bodyEl, close };
}

export function confirmDialog(message, { title = 'Konfirmasi', ok = 'Ya, lanjutkan', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: `<p style="margin:0">${esc(message)}</p>`,
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Batal' },
        { label: ok, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; resolve(true); } }
      ]
    });
    return m;
  });
}

export function promptDialog(message, { title = 'Isi data', placeholder = '', value = '', required = true, multiline = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline ? `<textarea id="pd-input" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="pd-input" type="text" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
    modal({
      title, body: `<label class="field"><span>${esc(message)}</span>${input}</label>`,
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Batal' },
        { label: 'Simpan', cls: 'btn-primary', onClick: ({ body }) => {
          const v = $('#pd-input', body).value.trim();
          if (required && !v) { toast('Wajib diisi', 'error'); return false; }
          done = true; resolve(v);
        } }
      ]
    });
  });
}

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const f = document.createElement('textarea'); f.value = text; f.style.position = 'fixed'; f.style.opacity = '0';
    document.body.appendChild(f); f.select(); document.execCommand('copy'); f.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = 'Tersalin ✓'; setTimeout(() => (btn.textContent = o), 2000); }
}

// ---------- pengaturan (tabel settings) ----------
let settingsCache = null;
export async function loadSettings(force = false) {
  if (settingsCache && !force) return settingsCache;
  const { data, error } = await sb.from('settings').select('key,value');
  if (error) throw error;
  settingsCache = Object.fromEntries((data || []).map((r) => [r.key, r.value ?? '']));
  return settingsCache;
}
export const flag = (s, k) => String(s?.[k] ?? '') === '1';

// ---------- sesi & profil ----------
let profileCache;
export async function getProfile(force = false) {
  if (profileCache !== undefined && !force) return profileCache;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { profileCache = null; return null; }
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  profileCache = data ? { ...data, email: data.email || session.user.email } : { id: session.user.id, email: session.user.email, name: session.user.email, role: 'employee' };
  return profileCache;
}
export async function requireLogin() {
  const p = await getProfile();
  if (!p) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search); return null; }
  return p;
}
export async function logout() {
  await sb.auth.signOut();
  profileCache = null;
  location.href = 'index.html';
}

// ---------- keranjang (disimpan di browser) ----------
const CART_KEY = 'cm_cart_v1';
export const cart = {
  get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
  set(items) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {} document.dispatchEvent(new CustomEvent('cart:change')); },
  add(p, qty = 1) {
    const items = cart.get();
    const ex = items.find((i) => i.id === p.id);
    if (ex) ex.qty = Math.min(p.stock, ex.qty + qty);
    else items.push({ id: p.id, code: p.code, name: p.name, price: p.effective_price ?? p.price, image: p.images?.[0] || '', stock: p.stock, qty: Math.min(qty, p.stock) });
    cart.set(items);
  },
  update(id, qty) { cart.set(cart.get().map((i) => (i.id === id ? { ...i, qty: Math.max(1, Math.min(qty, i.stock || qty)) } : i))); },
  remove(id) { cart.set(cart.get().filter((i) => i.id !== id)); },
  has(id) { return cart.get().some((i) => i.id === id); },
  clear() { cart.set([]); },
  count() { return cart.get().reduce((a, i) => a + i.qty, 0); }
};

// ---------- kompres & upload foto ke Supabase Storage ----------
export async function compressImage(file, max = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export async function uploadFile(bucket, file, { folder, compress = true } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Silakan login terlebih dahulu');
  const f = compress ? await compressImage(file) : file;
  if (f.size > 5 * 1024 * 1024) throw new Error(`File "${file.name}" melebihi 5 MB`);
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder || session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, f, { contentType: f.type, upsert: false });
  if (error) throw error;
  return path;
}

// ---------- label status ----------
export const ORDER_STATUS = {
  waiting_payment: ['Menunggu pembayaran', 'warn'],
  waiting_verification: ['Menunggu verifikasi', 'info'],
  paid: ['Lunas — disiapkan', 'ok'],
  ready_pickup: ['Siap diambil', 'ok'],
  completed: ['Selesai', 'dark'],
  cancelled: ['Dibatalkan', 'danger'],
  expired: ['Kedaluwarsa', 'danger']
};
export const PRODUCT_STATUS = {
  pending: ['Menunggu verifikasi', 'warn'],
  published: ['Tayang', 'ok'],
  rejected: ['Ditolak', 'danger'],
  hidden: ['Disembunyikan', '']
};
export const badge = (map, key) => { const [l, c] = map[key] || [key, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };

// ---------- header navigasi ----------
export async function renderNav(active) {
  const host = $('#topnav');
  if (!host) return;
  let s = {};
  try { s = await loadSettings(); } catch {}
  const p = await getProfile().catch(() => null);
  const links = [
    ['index.html', 'Katalog', 'catalog'],
    ['sell.html', 'Jual Barang', 'sell'],
    ['orders.html', 'Pesanan Saya', 'orders']
  ];
  if (p?.role === 'admin') links.push(['admin.html', 'Admin', 'admin']);
  host.className = 'topnav';
  host.innerHTML = `<div class="wrap topnav-inner">
      <a class="brand" href="index.html">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : ''}<span>${esc(s.store_name || 'Compassion Market')}</span></a>
      <button class="nav-toggle" type="button" aria-expanded="false">☰ Menu</button>
      <nav>${links.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'active' : ''}">${l}</a>`).join('')}
        ${p ? `<button class="linkish" type="button" data-logout title="${esc(p.email)}">Keluar (${esc((p.name || p.email).split(' ')[0])})</button>`
            : `<a href="login.html" class="${active === 'login' ? 'active' : ''}">Masuk / Daftar</a>`}
        <button class="cart-btn" type="button" data-open-cart aria-label="Buka keranjang">🛒 <span class="count">${cart.count()}</span></button>
      </nav></div>`;
  $('.nav-toggle', host).onclick = (e) => { host.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', host.classList.contains('open')); };
  $('[data-logout]', host)?.addEventListener('click', logout);
  $('[data-open-cart]', host).onclick = () => {
    if (active === 'catalog') document.dispatchEvent(new CustomEvent('cart:open'));
    else location.href = 'index.html#cart';
  };
  document.addEventListener('cart:change', () => { const c = $('.cart-btn .count', host); if (c) c.textContent = cart.count(); });
  if (!configured) {
    const b = document.createElement('div');
    b.className = 'setup-banner';
    b.innerHTML = '<div class="wrap">⚙️ Supabase belum dikonfigurasi. Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di <code>config.js</code> (lihat README).</div>';
    host.after(b);
  }
}
