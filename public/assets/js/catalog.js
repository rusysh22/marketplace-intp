// ============================================================================
// Katalog: data dinamis dari Supabase (view public.catalog)
// ============================================================================
import {
  sb, $, $$, esc, rupiah, duration, waLink, imgUrl, PLACEHOLDER, toast, modal, errText,
  loadSettings, flag, getIdentity, getProfile, cart, renderNav, configured
} from './core.js';

const state = {
  settings: {}, categories: [], products: [], methods: [],
  filter: 'all', search: '', sort: 'default', view: 'grid', phaseKey: '', showSold: false, isAdmin: false
};
const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

init();

async function init() {
  await renderNav('catalog');
  try { restoreView(); } catch {}
  if (!configured) { $('#grid').innerHTML = '<div class="empty"><strong>Belum terhubung ke database</strong>Isi konfigurasi Supabase di config.js.</div>'; return; }
  try {
    await loadAll();
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty"><strong>Gagal memuat katalog</strong>${esc(errText(e))}</div>`;
    return;
  }
  state.isAdmin = (await getProfile().catch(() => null))?.role === 'admin';
  $('#print-all').hidden = !state.isAdmin;
  bindToolbar();
  applySettings();
  renderPayment();
  renderFilters();
  renderGrid();
  renderFooter();
  setInterval(tick, 1000);
  tick();
  init3D();
  initAutoScroll();
  document.addEventListener('cart:open', openCart);
  document.addEventListener('cart:change', syncCartButtons);
  if (location.hash === '#cart') openCart();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshProducts(); });
}

async function loadAll() {
  const [s, cats, pms] = await Promise.all([
    loadSettings(),
    sb.from('categories').select('*').eq('active', true).order('sort'),
    sb.from('payment_methods').select('*').eq('active', true).order('sort')
  ]);
  if (cats.error) throw cats.error;
  state.settings = s;
  state.categories = cats.data || [];
  state.methods = pms.data || [];
  await refreshProducts(false);
}

async function refreshProducts(render = true) {
  const { data, error } = await sb.from('catalog').select('*').order('sort_order').order('published_at', { ascending: false });
  if (error) { if (render) toast(errText(error), 'error'); else throw error; return; }
  state.products = (data || []).map((p) => ({ ...p, images: Array.isArray(p.images) ? p.images : [] }));
  state.phaseKey = phaseKey();
  if (render) { renderFilters(); renderGrid(); window.__store3d?.update(state.categories, state.products); }
}

// ---------- pengaturan tampilan ----------
function applySettings() {
  const s = state.settings;
  $('#title').textContent = s.page_title || 'Katalog barang';
  $('#brand-kicker').textContent = s.store_name || 'Compassion Market';
  document.title = `${s.store_name || 'Compassion Market'} — ${s.page_title || 'Katalog barang'}`;
  const logo = $('#brand-logo');
  logo.onerror = () => { logo.closest('.brand-logo').hidden = true; };
  if (s.logo_url) logo.src = imgUrl(s.logo_url, 'site-assets'); else logo.closest('.brand-logo').hidden = true;
  document.body.classList.toggle('fx', flag(s, 'theme_effects'));
}

// Ringkasan metode pembayaran. Nomor rekening + nominal (dengan kode unik) sengaja
// hanya ditampilkan setelah checkout agar setiap transfer terhubung ke satu pesanan.
function renderPayment() {
  const s = state.settings;
  const box = $('#payment');
  if (!state.methods.length) return;
  box.hidden = false;
  const wa = s.admin_whatsapp;
  box.innerHTML = `<span class="payment-kicker">Pembayaran</span>
    <div class="pay-chips">${state.methods.map((m) => `<span class="pay-chip">${m.logo_url
      ? `<img src="${esc(imgUrl(m.logo_url, 'site-assets'))}" alt="${esc(m.bank_name || m.name)}" loading="lazy">` : `<strong>${esc(m.type === 'qris' ? 'QRIS' : m.bank_name || m.name)}</strong>`}</span>`).join('')}</div>
    <p>${esc(s.payment_intro || 'Pilih metode saat checkout; rekening/QR & nominal pasti muncul di halaman pesanan.')}</p>
    ${wa ? `<a class="confirm-payment" href="${waLink(wa, 'Halo, saya ingin bertanya tentang Compassion Market.')}" target="_blank" rel="noopener noreferrer">
      <svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.8 7.2L3 20.3l1.4-4.6A8.5 8.5 0 1 1 20.5 11.7Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.1 7.6c.3-.3.7-.3.9.1l1 1.7c.2.3.1.6-.1.8l-.6.6c.6 1.2 1.6 2.1 2.9 2.8l.6-.7c.2-.2.5-.3.8-.1l1.8.9c.4.2.5.6.2.9-.5.8-1.2 1.2-2.2 1-1.3-.4-3-1.9-4.6-3.4-1.7-1.5-2.7-3.3-2.5-4.8.1-.5.4-1 .8-1.3Z" fill="currentColor"/></svg>
      <span>Tanya admin <small>WhatsApp ${esc(formatPhone(wa))}</small></span></a>` : ''}`;
}
const formatPhone = (n) => String(n).replace(/^62/, '0').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');

function renderFooter() {
  const s = state.settings;
  if (!flag(s, 'footer_enabled')) return;
  const links = String(s.footer_links || '').split('\n').map((l) => l.split('|')).filter((x) => x[1]);
  const f = $('#market-footer');
  f.hidden = false;
  f.innerHTML = `<div class="footer-inner wrap">
    ${s.footer_embed_url ? `<div class="voucher-preview"><iframe src="${esc(s.footer_embed_url)}" title="${esc(s.footer_title)}" loading="lazy" allowfullscreen></iframe></div>` : '<div></div>'}
    <div class="voucher-copy"><span class="footer-kicker">${esc(s.footer_kicker)}</span><h2>${esc(s.footer_title)}</h2><p>${esc(s.footer_text)}</p>
      <div class="footer-links">${links.map(([l, u]) => `<a href="${esc(u.trim())}" target="_blank" rel="noopener noreferrer">${esc(l.trim())} ↗</a>`).join('')}</div></div></div>`;
}

// ---------- toolbar ----------
function bindToolbar() {
  $('#search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); renderGrid(); });
  $('#sort-products').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });
  $$('.views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#print-all').addEventListener('click', () => printTags());
  $('#show-sold').addEventListener('change', (e) => { state.showSold = e.target.checked; renderFilters(); renderGrid(); });
}
function setView(v) {
  state.view = v;
  $('#market').classList.toggle('view-list', v === 'list');
  $$('.views button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  try { localStorage.setItem('cm_view', v); } catch {}
}
function restoreView() { const v = localStorage.getItem('cm_view'); if (v) setView(v); }

const isShown = (p) => state.showSold || p.stock > 0;

function renderFilters() {
  const counts = {};
  const shown = state.products.filter(isShown);
  shown.forEach((p) => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
  const cats = state.categories.filter((c) => counts[c.id]);
  if (state.filter !== 'all' && !String(state.filter).split(',').some((id) => counts[id])) state.filter = 'all';
  $('#filters').innerHTML = `<button type="button" data-cat="all" class="${state.filter === 'all' ? 'active' : ''}">Semua <span class="n">${shown.length}</span></button>` +
    cats.map((c) => `<button type="button" data-cat="${c.id}" class="${String(state.filter) === String(c.id) ? 'active' : ''}">${esc(c.name)} <span class="n">${counts[c.id]}</span></button>`).join('');
  $$('#filters button').forEach((b) => (b.onclick = () => {
    setFilter(b.dataset.cat);
    if (b.dataset.cat === 'all') window.__store3d?.reset(); else window.__store3d?.focusCategory(Number(b.dataset.cat));
  }));
  const sold = state.products.length - state.products.filter((p) => p.stock > 0).length;
  $('#show-sold-label').hidden = !sold;
  $('#show-sold-count').textContent = sold;
}
export function setFilter(cat) {
  state.filter = cat;
  $$('#filters button').forEach((b) => b.classList.toggle('active', b.dataset.cat === String(cat)));
  renderGrid();
}

// ---------- flash sale ----------
function flashPhase(p, now = Date.now()) {
  if (!p.flash_item_id) return null;
  const st = Date.parse(p.flash_start), en = Date.parse(p.flash_end);
  if (now < st) return 'upcoming';
  if (now < en) return 'active';
  return 'ended';
}
function phaseKey() { return state.products.map((p) => flashPhase(p) || '').join(','); }

function tick() {
  const now = Date.now();
  $$('.flash[data-start]').forEach((box) => {
    const st = Number(box.dataset.start), en = Number(box.dataset.end);
    const t = $('.countdown', box), lbl = $('.count-label', box);
    if (now < st) { box.classList.remove('sale-active'); lbl.textContent = 'Mulai dalam'; t.textContent = duration(st - now); }
    else if (now < en) { box.classList.add('sale-active'); lbl.textContent = 'Berakhir dalam'; t.textContent = duration(en - now); }
    else { box.classList.remove('sale-active'); lbl.textContent = ''; t.textContent = 'Selesai'; }
  });
  // pergantian fase flash sale -> ambil harga terbaru dari server
  if (state.products.length && phaseKey() !== state.phaseKey) refreshProducts();
}

// ---------- kartu produk ----------
function visibleProducts() {
  let list = state.products.filter(isShown);
  if (state.filter !== 'all') { const ids = String(state.filter).split(','); list = list.filter((p) => ids.includes(String(p.category_id))); }
  if (state.search) list = list.filter((p) => [p.name, p.code, p.seller_name, p.summary, p.category_name, p.size]
    .some((v) => String(v || '').toLowerCase().includes(state.search)));
  const byIdx = (a, b) => (a.sort_order - b.sort_order) || (Date.parse(b.published_at) - Date.parse(a.published_at));
  const cmp = {
    default: (a, b) => ((b.stock > 0) - (a.stock > 0)) || (b.featured - a.featured) || (b.flash_active - a.flash_active) || byIdx(a, b),
    newest: (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at),
    'price-up': (a, b) => a.effective_price - b.effective_price,
    'price-down': (a, b) => b.effective_price - a.effective_price,
    'name-up': (a, b) => collator.compare(a.name, b.name),
    'name-down': (a, b) => collator.compare(b.name, a.name),
    listed: byIdx
  }[state.sort] || byIdx;
  return list.sort((a, b) => cmp(a, b) || byIdx(a, b));
}

function renderGrid() {
  const all = state.products;
  const avail = all.filter((p) => p.stock > 0).length;
  const intro = state.settings.catalog_intro ? state.settings.catalog_intro + ' ' : '';
  $('#catalog-intro').textContent = `${avail} barang tersedia${all.length - avail ? ` • ${all.length - avail} sudah terjual` : ''}. ${intro}`.trim();
  const list = visibleProducts();
  const grid = $('#grid');
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Belum ada barang di sini</strong>Coba kategori lain${!state.showSold ? ', centang "Tampilkan yang terjual",' : ''} atau <a href="sell.html">jual barang Anda</a>.</div>`;
    return;
  }
  grid.innerHTML = list.map(cardHtml).join('');
  $$('.card', grid).forEach((el) => {
    const p = state.products.find((x) => x.id === Number(el.dataset.id));
    $('.photo', el).onclick = () => openDetail(p);
    $('.buy-btn', el)?.addEventListener('click', () => addToCart(p));
    $('.detail-btn', el).onclick = () => openDetail(p);
  });
  tick();
}

function priceBlock(p) {
  const phase = flashPhase(p);
  const eff = Number(p.effective_price);
  const strike = Math.max(Number(p.original_price || 0), phase === 'active' ? Number(p.price) : 0);
  if (strike > eff) {
    const pct = Math.round((1 - eff / strike) * 100);
    return `<div class="pricing"><div class="promo-top"><span class="promo-percent">(-${pct}%)</span></div>
      <div class="price-pair"><del class="original-price">${rupiah(strike)}</del><strong class="price sale-price">${rupiah(eff)}</strong></div></div>`;
  }
  return `<div class="pricing"><strong class="price">${rupiah(eff)}</strong></div>`;
}

function cardHtml(p) {
  const sold = p.stock <= 0;
  const img = p.images[0] ? imgUrl(p.images[0]) : PLACEHOLDER;
  const cond = p.item_condition === 'baru' ? 'Baru' : p.item_condition === 'preloved' ? 'Preloved' : 'Kondisi belum diinformasikan';
  const rating = p.condition_pct == null
    ? `<div class="rating rating-unknown">Kondisi: <strong>konfirmasi penjual</strong></div>`
    : `<div class="rating" aria-label="Kondisi ${Math.round(p.condition_pct / 10)} dari 10"><span aria-hidden="true">★</span> Kondisi <strong>${Math.round(p.condition_pct / 10)}/10</strong><small>(${p.condition_pct}%)</small></div>`;
  const phase = flashPhase(p);
  const flash = phase && phase !== 'ended'
    ? `<div class="flash" data-start="${Date.parse(p.flash_start)}" data-end="${Date.parse(p.flash_end)}" aria-label="Flash sale ${esc(p.flash_sale_name)}">
         <strong class="flash-title">🔥 Flash ${rupiah(p.flash_price)} <span class="live-indicator">LIVE</span></strong>
         <span style="text-align:right"><span class="count-label"></span><time class="countdown">…</time></span></div>` : '';
  const inCart = cart.has(p.id);
  return `<article class="card ${sold ? 'sold' : ''}" data-id="${p.id}" aria-labelledby="t-${p.id}">
    <button class="photo" type="button" style="background-image:url(&quot;${esc(img)}&quot;),url(&quot;${PLACEHOLDER}&quot;)" aria-label="Lihat foto ${esc(p.name)}">
      ${p.images.length > 1 ? `<span class="photo-badge">${p.images.length} foto</span>` : ''}
      ${p.featured ? '<span class="featured-badge">★ Pilihan</span>' : ''}
      <span class="stock-badge">Stok ${p.stock}</span>${p.code ? `<span class="photo-code">${esc(p.code)}</span>` : ''}
      <span class="sold-overlay">OUT OF STOCK</span>
    </button>
    <div class="card-body">
      <div class="eyebrow">${esc(p.category_name || 'Lainnya')} <span>•</span> ${cond}</div>
      <h3 id="t-${p.id}">${esc(p.name)}</h3>
      <div class="seller"><span aria-hidden="true">◉</span> Penjual: <strong>${esc(p.seller_name || 'Belum diinformasikan')}</strong></div>
      <div>${rating}${p.size ? `<span class="size-chip">Ukuran ${esc(p.size)}</span>` : ''}</div>
      <p class="summary">${esc(p.summary || '')}</p>
      ${priceBlock(p)}
      ${flash}
      <div class="actions">
        <button class="detail-btn" type="button">Detail barang</button>
        <button class="buy-btn ${inCart ? 'in-cart' : ''}" type="button">${inCart ? '✓ Di keranjang' : '+ Keranjang'}</button>
        <span class="sold-contact">Stok habis</span>
      </div>
    </div></article>`;
}

function syncCartButtons() {
  $$('.card').forEach((el) => {
    const b = $('.buy-btn', el); if (!b) return;
    const inCart = cart.has(Number(el.dataset.id));
    b.classList.toggle('in-cart', inCart);
    b.textContent = inCart ? '✓ Di keranjang' : '+ Keranjang';
  });
}

function addToCart(p) {
  if (p.stock <= 0) return;
  if (cart.has(p.id)) { openCart(); return; }
  cart.add(p);
  toast(`"${p.name}" masuk keranjang`, 'ok');
}

// ---------- detail + galeri ----------
function openDetail(p) {
  const imgs = p.images.length ? p.images.map((i) => imgUrl(i)) : [PLACEHOLDER];
  const m = modal({
    title: `${p.code || ''} · ${p.name}`, wide: true,
    body: `<div class="grid-form" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:start">
      <div><img class="gallery-main" src="${esc(imgs[0])}" alt="${esc(p.name)}">
        ${imgs.length > 1 ? `<div class="gallery-thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" data-i="${i}" class="${i ? '' : 'active'}" alt="Foto ${i + 1}">`).join('')}</div>` : ''}</div>
      <div><div class="eyebrow">${esc(p.category_name || '')}</div><h3 style="margin:6px 0">${esc(p.name)}</h3>
        ${priceBlock(p)}
        <p class="small muted" style="margin:10px 0">${esc(p.summary || '')}</p>
        <table class="tbl"><tbody>
          <tr><td class="muted">Kondisi</td><td>${p.condition_pct == null ? 'Konfirmasi penjual' : p.condition_pct + '%'} · ${esc(p.item_condition || '-')}</td></tr>
          <tr><td class="muted">Ukuran</td><td>${esc(p.size || '-')}</td></tr>
          <tr><td class="muted">Stok</td><td>${p.stock}</td></tr>
          <tr><td class="muted">Penjual</td><td>${esc(p.seller_name || '-')}</td></tr>
          <tr><td class="muted">Catatan</td><td>${esc(p.condition_note || '-')}</td></tr>
        </tbody></table>
        ${state.settings.admin_whatsapp ? `<a class="btn btn-ghost btn-sm" style="margin-top:10px" href="${waLink(state.settings.admin_whatsapp, `Halo, saya tertarik dengan ${p.name} (${p.code}) dari ${p.seller_name || '-'}. Apakah masih tersedia?`)}" target="_blank" rel="noopener noreferrer">Tanya via WhatsApp ↗</a>` : ''}
        </div></div>`,
    actions: p.stock > 0 ? [{ label: 'Tutup' }, { label: cart.has(p.id) ? 'Lihat keranjang' : '+ Tambah ke keranjang', cls: 'btn-primary', onClick: () => { if (cart.has(p.id)) openCart(); else addToCart(p); } }] : [{ label: 'Tutup' }]
  });
  $$('.gallery-thumbs img', m.body).forEach((t) => (t.onclick = () => {
    $('.gallery-main', m.body).src = t.src;
    $$('.gallery-thumbs img', m.body).forEach((x) => x.classList.toggle('active', x === t));
  }));
}

// ---------- keranjang & checkout ----------
function cartLines() {
  return cart.get().map((i) => {
    const p = state.products.find((x) => x.id === i.id);
    return { ...i, p, price: p ? Number(p.effective_price) : i.price, available: p ? p.stock : 0 };
  });
}

function openCart() {
  history.replaceState(null, '', location.pathname + location.search);
  $('.drawer')?.remove(); $('.drawer-backdrop')?.remove();
  const bd = document.createElement('div'); bd.className = 'drawer-backdrop';
  const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('aria-label', 'Keranjang');
  const close = () => { bd.remove(); dr.remove(); };
  bd.onclick = close;
  document.body.append(bd, dr);
  const draw = () => {
    const lines = cartLines();
    const subtotal = lines.filter((l) => l.available > 0).reduce((a, l) => a + l.price * Math.min(l.qty, l.available), 0);
    dr.innerHTML = `<div class="modal-head"><h3>Keranjang</h3><button class="x-btn" type="button" aria-label="Tutup">×</button></div>
      <div class="modal-body">${lines.length ? lines.map((l) => `
        <div class="cart-line" data-id="${l.id}">
          <img class="thumb" src="${esc(l.image ? imgUrl(l.image) : PLACEHOLDER)}" alt="">
          <div class="info"><strong>${esc(l.name)}</strong><small>${esc(l.code || '')} · ${rupiah(l.price)}</small>
            ${l.available <= 0 ? '<div><span class="badge danger">Stok habis</span></div>' : l.available > 1
              ? `<div style="margin-top:4px"><input type="number" min="1" max="${l.available}" value="${Math.min(l.qty, l.available)}" style="width:70px;min-height:30px;padding:4px 7px" aria-label="Jumlah"> <small>maks ${l.available}</small></div>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-rm aria-label="Hapus">✕</button>
        </div>`).join('') : '<div class="empty"><strong>Keranjang kosong</strong>Pilih barang dari katalog.</div>'}
      </div>
      ${lines.length ? `<div class="modal-foot" style="display:block">
        <div class="sum-row"><span>Subtotal</span><strong>${rupiah(subtotal)}</strong></div>
        <p class="small muted" style="margin:4px 0 10px">Stok dikunci untuk Anda setelah checkout selama ${esc(state.settings.order_expiry_hours || 24)} jam sampai pembayaran diverifikasi.</p>
        <button class="btn btn-primary btn-block" type="button" data-checkout ${subtotal ? '' : 'disabled'}>Checkout</button></div>` : ''}`;
    $('.x-btn', dr).onclick = close;
    $$('.cart-line', dr).forEach((row) => {
      const id = Number(row.dataset.id);
      $('[data-rm]', row).onclick = () => { cart.remove(id); draw(); };
      $('input', row)?.addEventListener('change', (e) => { cart.update(id, Number(e.target.value) || 1); draw(); });
    });
    $('[data-checkout]', dr)?.addEventListener('click', async () => { close(); await checkout(); });
  };
  draw();
}

async function checkout() {
  const profile = getIdentity();
  if (!profile) { toast('Pilih identitas Anda dulu untuk checkout'); location.href = 'login.html?next=' + encodeURIComponent('index.html#cart'); return; }
  await refreshProducts();
  const lines = cartLines().filter((l) => l.available > 0);
  if (!lines.length) { toast('Barang di keranjang sudah habis', 'error'); return; }
  if (!state.methods.length) { toast('Belum ada metode pembayaran aktif. Hubungi admin.', 'error'); return; }
  const s = state.settings;
  const subtotal = lines.reduce((a, l) => a + l.price * Math.min(l.qty, l.available), 0);
  const fee = s.admin_fee_type === 'percent' ? Math.round(subtotal * Number(s.admin_fee_value || 0) / 100) : Number(s.admin_fee_value || 0);
  modal({
    title: 'Checkout',
    body: `<div style="display:grid;gap:14px">
      <div>${lines.map((l) => `<div class="sum-row"><span>${esc(l.name)} × ${Math.min(l.qty, l.available)}</span><span>${rupiah(l.price * Math.min(l.qty, l.available))}</span></div>`).join('')}
        ${fee ? `<div class="sum-row"><span>Biaya admin</span><span>${rupiah(fee)}</span></div>` : ''}
        <div class="sum-row total"><span>Total</span><span>${rupiah(subtotal + fee)}</span></div>
        ${flag(s, 'use_unique_code') ? '<p class="small muted" style="margin:4px 0 0">Transfer bank akan ditambah kode unik 3 digit agar pembayaran mudah dicocokkan.</p>' : ''}</div>
      <div><div class="field"><span class="req">Metode pembayaran</span></div>
        <div class="pay-options">${state.methods.map((m, i) => `<label class="pay-option"><input type="radio" name="pm" value="${m.id}" ${i === 0 ? 'checked' : ''}>
          ${m.logo_url ? `<img src="${esc(imgUrl(m.logo_url, 'site-assets'))}" alt="">` : m.type === 'qris' ? '<strong>QRIS</strong>' : ''}
          <span><span class="t">${esc(m.name)}</span><small>${m.type === 'qris' ? 'Scan QR dari e-wallet / m-banking' : esc(`${m.bank_name || ''} ${m.account_no || ''} a.n. ${m.account_holder || ''}`)}</small></span></label>`).join('')}</div></div>
      <label class="field"><span>Catatan untuk admin (opsional)</span><textarea id="co-note" placeholder="Mis. ambil saat jam makan siang"></textarea></label>
      <p class="small muted" style="margin:0">📦 ${esc(s.pickup_info || '')}</p></div>`,
    actions: [
      { label: 'Batal' },
      { label: 'Buat pesanan', cls: 'btn-primary', onClick: async ({ body }) => {
        const pm = Number($('input[name=pm]:checked', body)?.value);
        const items = lines.map((l) => ({ product_id: l.id, qty: Math.min(l.qty, l.available) }));
        const { data, error } = await sb.rpc('create_order', { p_actor: profile.id, p_items: items, p_payment_method_id: pm, p_note: $('#co-note', body).value || null });
        if (error) throw error;
        lines.forEach((l) => cart.remove(l.id));
        toast('Pesanan dibuat! Silakan lakukan pembayaran.', 'ok');
        location.href = 'orders.html?id=' + data.order_id;
      } }
    ]
  });
}

// ---------- cetak label harga ----------
function printTags() {
  const list = visibleProducts().filter((p) => p.stock > 0);
  if (!list.length) { toast('Tidak ada barang tersedia untuk dicetak'); return; }
  const sheet = $('#print-sheet');
  const store = (state.settings.store_name || 'Compassion Market').toUpperCase();
  let html = '';
  list.forEach((p, i) => {
    if (i % 8 === 0) html += (i ? '</div>' : '') + '<div class="print-page">';
    const eff = Number(p.effective_price), orig = Number(p.original_price || 0);
    html += `<article class="price-tag"><div class="tag-head"><strong>${esc(store)}</strong><span>${esc(p.code || '')}</span></div>
      <div class="tag-product"><div class="tag-category">${esc(p.category_name || '')} • Kondisi ${p.condition_pct == null ? 'belum diinformasikan' : Math.round(p.condition_pct / 10) + '/10'}</div>
      <h2>${esc(p.name)}</h2><p>Penjual: ${esc(p.seller_name || '-')}${p.size ? ' · Ukuran ' + esc(p.size) : ''}</p></div>
      <div class="tag-bottom"><div class="tag-price">${orig > eff ? `<div class="tag-promo"><span>(-${Math.round((1 - eff / orig) * 100)}%)</span><del>${rupiah(orig)}</del></div>` : ''}<strong>${rupiah(eff)}</strong></div>
      <div class="tag-stock">STOK ${p.stock}</div></div></article>`;
  });
  sheet.innerHTML = html + '</div>';
  document.body.classList.add('print-tags');
  window.print();
}
window.addEventListener('afterprint', () => { document.body.classList.remove('print-tags'); $('#print-sheet').innerHTML = ''; });

// ---------- toko 3D ----------
async function init3D() {
  if (!flag(state.settings, 'enable_3d')) return;
  const canvasOk = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  if (!canvasOk) return;
  const section = $('#store3d-section');
  const toggle = $('#toggle-3d');
  let hidden = false;
  try { hidden = localStorage.getItem('cm_3d_hidden') === '1'; } catch {}
  toggle.hidden = false;
  const show = async (on) => {
    section.hidden = !on;
    toggle.textContent = on ? '🧊 Sembunyikan 3D' : '🧊 Toko 3D';
    try { localStorage.setItem('cm_3d_hidden', on ? '0' : '1'); } catch {}
    if (on && !window.__store3d) {
      try {
        await Promise.all(['800 44px', '700 32px', 'italic 700 70px'].map((w) => document.fonts?.load(`${w} "Plus Jakarta Sans"`))).catch(() => {});
        const mod = await import('./store3d.js');
        window.__store3d = mod.createStore3D($('#store3d'), {
          settings: state.settings, categories: state.categories, products: state.products,
          logoUrl: state.settings.logo_url ? imgUrl(state.settings.logo_url, 'site-assets') : '',
          onSelect: (catIds) => {
            setFilter(catIds?.length ? catIds.join(',') : 'all');
            $('.catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        $('#s3d-reset').onclick = () => window.__store3d.reset();
      } catch (e) {
        console.error(e);
        $('#store3d').innerHTML = '<div class="store3d-fallback">Tampilan 3D tidak dapat dimuat di perangkat ini.</div>';
      }
    }
  };
  toggle.onclick = () => show(section.hidden);
  show(!hidden);
}

// ---------- gulir otomatis (mode layar TV / kios) ----------
function initAutoScroll() {
  if (!flag(state.settings, 'auto_scroll')) return;
  const btn = $('#auto-scroll-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = reduced, running = false, dir = 1, raf = 0, idle = 0, prev = 0, hold = 0, pos = scrollY;
  const speed = matchMedia('(max-width: 730px)').matches ? 48 : 72;
  btn.hidden = false;
  const label = () => { btn.textContent = paused ? '▶ Lanjutkan gulir' : '⏸ Jeda gulir otomatis'; btn.setAttribute('aria-pressed', String(paused)); };
  const stop = () => { running = false; prev = 0; cancelAnimationFrame(raf); raf = 0; pos = scrollY; };
  const busy = () => paused || document.visibilityState !== 'visible' || document.body.classList.contains('print-tags') || $('.modal-backdrop,.drawer');
  const frame = (ts) => {
    if (!running || busy()) return stop();
    if (!prev) prev = ts;
    const dt = Math.min((ts - prev) / 1000, 0.06); prev = ts;
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (Math.abs(scrollY - pos) > 2) pos = scrollY;
    if (max > 1 && ts >= hold) {
      if (dir > 0 && scrollY >= max - 2) { dir = -1; hold = ts + 850; }
      else if (dir < 0 && scrollY <= 2) { dir = 1; hold = ts + 850; }
      else { pos = Math.max(0, Math.min(max, pos + dir * speed * dt)); scrollTo({ top: pos, behavior: 'instant' }); }
    }
    raf = requestAnimationFrame(frame);
  };
  const arm = () => { clearTimeout(idle); idle = 0; stop(); if (!busy()) idle = setTimeout(() => { idle = 0; if (busy()) return; running = true; raf = requestAnimationFrame(frame); }, 3000); };
  const onInput = (e) => { if (e?.target === btn) return; arm(); };
  btn.onclick = () => { paused = !paused; label(); arm(); };
  ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, onInput, { passive: true }));
  document.addEventListener('focusin', onInput);
  document.addEventListener('visibilitychange', arm);
  setInterval(() => { if (!running && !idle) arm(); }, 4000);
  label(); arm();
}
