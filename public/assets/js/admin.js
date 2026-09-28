// ============================================================================
// Admin marketplace: verifikasi, pesanan, stok, flash sale, payout, master data
// Semua akses dijaga RLS + fungsi is_admin() di database.
// ============================================================================
import {
  sb, $, $$, esc, rupiah, num, fmtDate, toast, errText, modal, confirmDialog, promptDialog, renderNav, requireAdminSession,
  loadSettings, uploadFile, imgUrl, PLACEHOLDER, badge, ORDER_STATUS, PRODUCT_STATUS, copyText, waLink, downloadFromUrl
} from './core.js';

const ZONES = {
  bar_counter: 'Bar counter (dinding hijau)', table_center: 'Meja tengah', rack_left: 'Rak baju kiri', rack_back: 'Rak baju belakang',
  rack_front: 'Rak depan (tas)', rack_side: 'Rak samping (celana)', shelf_toys: 'Rak mainan', kitchen: 'Pantry / kitchen',
  sign_board: 'Papan tulis', floor_corner: 'Pojok lantai (skuter)'
};
const main = () => $('#admin-main');
let profile, categories = [];

(async () => {
  await renderNav('admin');
  profile = await requireAdminSession();
  if (!profile) return;
  if (profile.role !== 'admin') {
    main().innerHTML = '<div class="panel empty"><strong>Khusus admin marketplace</strong>Minta admin yang ada untuk menjadikan akun Anda admin (menu Pengguna).</div>';
    $('#admin-side').hidden = true;
    return;
  }
  await loadCategories();
  $$('#admin-side [data-sec]').forEach((b) => (b.onclick = () => go(b.dataset.sec)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));
  go(location.hash.slice(1) || 'dashboard', false);
  refreshCounts();
  setInterval(refreshCounts, 60000);
})();

const SECTIONS = { dashboard, review, orders, products, flash, payout, categories: categoriesSec, payments, settings: settingsSec, users, audit };
async function go(sec, push = true) {
  if (!SECTIONS[sec]) sec = 'dashboard';
  if (push) history.replaceState(null, '', '#' + sec);
  $$('#admin-side [data-sec]').forEach((b) => b.classList.toggle('active', b.dataset.sec === sec));
  main().innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
  try { await SECTIONS[sec](); } catch (e) { main().innerHTML = `<div class="panel notice danger">${esc(errText(e))}</div>`; }
}
async function loadCategories() {
  const { data } = await sb.from('categories').select('*').order('sort');
  categories = data || [];
}
async function refreshCounts() {
  const [p, o] = await Promise.all([
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'waiting_verification')
  ]);
  const set = (k, n) => { const el = $(`[data-count=${k}]`); el.hidden = !n; el.textContent = n || ''; };
  set('review', p.count); set('orders', o.count);
}
const catName = (id) => categories.find((c) => c.id === id)?.name || '-';
const head = (title, sub, right = '') => `<div class="order-head" style="margin-bottom:12px"><div><h2>${title}</h2><p class="sub">${sub}</p></div><div class="btn-row">${right}</div></div>`;
const firstImg = (p) => (p.product_images || []).slice().sort((a, b) => a.sort - b.sort)[0]?.path;
const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

function downloadCsv(name, rows) {
  if (!rows.length) return toast('Tidak ada data');
  const cols = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => q(r[c])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- form generator ----------
function formHtml(defs, v = {}) {
  return `<div class="grid-form">${defs.map((d) => {
    const val = v[d.k] ?? d.default ?? '';
    const cls = `field ${d.span || ''}`;
    const lab = `<span class="${d.req ? 'req' : ''}">${esc(d.label)}</span>`;
    const help = d.help ? `<small>${esc(d.help)}</small>` : '';
    if (d.type === 'check') return `<label class="check ${d.span || ''}" style="align-self:end;padding-bottom:9px"><input type="checkbox" name="${d.k}" ${val === true || val === '1' ? 'checked' : ''}> ${esc(d.label)}</label>`;
    if (d.type === 'select') return `<label class="${cls}">${lab}<select name="${d.k}">${d.options.map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${help}</label>`;
    if (d.type === 'textarea') return `<label class="${cls}">${lab}<textarea name="${d.k}">${esc(val)}</textarea>${help}</label>`;
    if (d.type === 'file') return `<label class="${cls}">${lab}<input type="file" name="${d.k}" accept="${d.accept || 'image/*'}">${help}</label>`;
    return `<label class="${cls}">${lab}<input type="${d.type || 'text'}" name="${d.k}" value="${esc(val)}" ${d.type === 'number' ? 'step="any"' : ''}>${help}</label>`;
  }).join('')}</div>`;
}
function readForm(body, defs) {
  const out = {};
  defs.forEach((d) => {
    const el = $(`[name="${d.k}"]`, body);
    if (!el || d.type === 'file') return;
    if (d.type === 'check') out[d.k] = el.checked;
    else if (d.type === 'number') out[d.k] = el.value === '' ? null : Number(el.value);
    else out[d.k] = el.value.trim() === '' ? null : el.value.trim();
    if (d.req && (out[d.k] == null || out[d.k] === '')) throw new Error(`${d.label} wajib diisi`);
  });
  return out;
}
const unwrap = ({ data, error }) => { if (error) throw error; return data; };

// ============================================================================
// DASHBOARD
// ============================================================================
async function dashboard() {
  const d = unwrap(await sb.rpc('admin_dashboard'));
  const stat = (v, l, alert, sec) => `<div class="stat ${alert ? 'alert' : ''}" ${sec ? `style="cursor:pointer" data-go="${sec}"` : ''}><div class="v">${v}</div><div class="l">${l}</div></div>`;
  main().innerHTML = head('Dashboard', 'Ringkasan operasional marketplace hari ini.') + `
    <div class="stats">
      ${stat(d.pending_products, 'Barang menunggu verifikasi', d.pending_products > 0, 'review')}
      ${stat(d.waiting_verification, 'Pembayaran perlu dicek', d.waiting_verification > 0, 'orders')}
      ${stat(d.to_handover, 'Pesanan lunas perlu diserahkan', d.to_handover > 0, 'orders')}
      ${stat(d.waiting_payment, 'Menunggu pembayaran', false, 'orders')}
      ${stat(d.available_products, 'Barang tersedia', false, 'products')}
      ${stat(d.sold_out_products, 'Barang terjual / stok 0', false, 'products')}
      ${stat(rupiah(d.revenue), 'Total uang masuk (lunas)')}
      ${stat(rupiah(d.payout_pending), 'Hak penjual belum dicairkan', d.payout_pending > 0, 'payout')}
      ${stat(d.employees, 'Akun karyawan terdaftar', false, 'users')}
    </div>
    <div class="panel"><h3>Stok per jenis barang</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Jenis</th><th class="num">Tayang</th><th class="num">Tersedia</th><th class="num">Terjual/habis</th></tr></thead>
      <tbody>${d.by_category.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.published}</td><td class="num">${c.available}</td><td class="num">${c.published - c.available}</td></tr>`).join('')}</tbody></table></div></div>`;
  $$('[data-go]').forEach((el) => (el.onclick = () => go(el.dataset.go)));
}

// ============================================================================
// VERIFIKASI BARANG
// ============================================================================
async function review() {
  const data = unwrap(await sb.from('products').select('*, product_images(path, sort), profiles:seller_id(name, phone, department, emp_id), submissions(note, form_no)')
    .eq('status', 'pending').order('created_at'));
  main().innerHTML = head('Verifikasi barang', `${data.length} barang menunggu. Cek foto & harga, koreksi bila perlu, lalu setujui atau tolak dengan alasan.`) +
    (data.length ? '' : '<div class="panel empty"><strong>Tidak ada antrean</strong>Semua pengajuan sudah diproses 🎉</div>') +
    data.map((p) => {
      const imgs = (p.product_images || []).sort((a, b) => a.sort - b.sort).map((i) => imgUrl(i.path));
      return `<div class="review-card" data-id="${p.id}">
        <div class="imgs">${(imgs.length ? imgs : [PLACEHOLDER]).map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>
        <div>
          <div class="order-head"><div><h3 style="margin:0">${esc(p.name)}</h3><div class="small muted">${esc(p.code)} · diajukan ${fmtDate(p.created_at)}</div></div>${badge(PRODUCT_STATUS, p.status)}</div>
          <dl class="kv">
            <dt>Penjual</dt><dd>${esc(p.profiles?.name || p.seller_name || '-')} ${p.profiles?.department ? '· ' + esc(p.profiles.department) : ''} ${p.profiles?.phone ? `· <a href="${waLink(p.profiles.phone.replace(/^0/, '62'), `Halo ${p.profiles.name}, terkait barang ${p.code} ${p.name}...`)}" target="_blank" rel="noopener">WA ${esc(p.profiles.phone)}</a>` : ''}</dd>
            <dt>Kondisi</dt><dd>${esc(p.item_condition || '-')} · ${p.condition_pct ?? '-'}% ${p.size ? '· Ukuran ' + esc(p.size) : ''}</dd>
            <dt>Deskripsi</dt><dd>${esc(p.summary || '-')}</dd>
            <dt>Catatan kondisi</dt><dd>${esc(p.condition_note || '-')}</dd>
            ${p.submissions?.note ? `<dt>Catatan penjual</dt><dd>${esc(p.submissions.note)}</dd>` : ''}
          </dl>
          <div class="grid-form" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            <label class="field"><span>Jenis</span><select name="category_id">${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Harga jual</span><input type="text" inputmode="numeric" name="price" value="${p.price.toLocaleString('id-ID')}"></label>
            <label class="field"><span>Harga coret</span><input type="text" inputmode="numeric" name="original_price" value="${p.original_price ? p.original_price.toLocaleString('id-ID') : ''}"></label>
            <label class="field"><span>Stok</span><input type="number" name="stock" value="${p.stock}" min="0"></label>
            <label class="field"><span>Nominal donasi</span><input type="text" inputmode="numeric" name="donation_amount" value="${(p.donation_amount || 0).toLocaleString('id-ID')}"></label>
          </div>
          <div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-approve>✓ Setujui & tayangkan</button><button class="btn btn-danger" data-reject>✕ Tolak</button></div>
        </div></div>`;
    }).join('');
  $$('.review-card').forEach((card) => {
    const id = Number(card.dataset.id);
    $$('.imgs img', card).forEach((img) => (img.onclick = () => modal({ title: 'Foto', wide: true, body: `<img src="${esc(img.src)}" style="width:100%;border-radius:10px" alt="">` })));
    $$('[name=price],[name=original_price],[name=donation_amount]', card).forEach((i) => i.addEventListener('input', () => {
      const v = num(i.value); i.value = v == null || Number.isNaN(v) ? '' : v.toLocaleString('id-ID');
    }));
    $('[data-approve]', card).onclick = async (e) => {
      const v = (n) => $(`[name=${n}]`, card).value;
      e.target.disabled = true;
      const { error } = await sb.rpc('admin_review_product', { p_id: id, p_action: 'approve', p_reason: null,
        p_patch: { category_id: Number(v('category_id')), price: num(v('price')) || 0, original_price: num(v('original_price')), stock: Number(v('stock')), donation_amount: num(v('donation_amount')) || 0 } });
      if (error) { e.target.disabled = false; return toast(errText(error), 'error'); }
      toast('Barang ditayangkan', 'ok'); card.remove(); refreshCounts();
    };
    $('[data-reject]', card).onclick = async () => {
      const reason = await promptDialog('Alasan penolakan (akan dilihat penjual):', { title: 'Tolak barang', placeholder: 'Mis. foto kurang jelas, mohon unggah foto tampak depan' });
      if (!reason) return;
      const { error } = await sb.rpc('admin_review_product', { p_id: id, p_action: 'reject', p_reason: reason, p_patch: {} });
      if (error) return toast(errText(error), 'error');
      toast('Barang ditolak', 'ok'); card.remove(); refreshCounts();
    };
  });
}

// ============================================================================
// PESANAN
// ============================================================================
let orderFilter = 'waiting_verification';
async function orders() {
  await sb.rpc('expire_orders');
  const all = unwrap(await sb.from('orders').select('*, order_items(*), profiles:buyer_id(name, phone, email, department)').order('created_at', { ascending: false }).limit(500));
  const counts = {};
  all.forEach((o) => (counts[o.status] = (counts[o.status] || 0) + 1));
  const list = orderFilter === 'all' ? all : all.filter((o) => o.status === orderFilter);
  main().innerHTML = head('Pesanan', 'Verifikasi bukti bayar, siapkan barang, dan tandai selesai saat diserahkan.',
    '<button class="btn btn-ghost btn-sm" data-export>⬇ Export CSV</button><button class="btn btn-primary btn-sm" data-offline>+ Catat penjualan offline</button>') + `
    <div class="tabs">${[['waiting_verification'], ['waiting_payment'], ['paid'], ['ready_pickup'], ['completed'], ['cancelled'], ['expired'], ['all']].map(([k]) =>
      `<button type="button" data-f="${k}" class="${orderFilter === k ? 'active' : ''}">${k === 'all' ? 'Semua' : ORDER_STATUS[k][0]}${counts[k] && k !== 'all' ? ` <span class="pill">${counts[k]}</span>` : ''}</button>`).join('')}</div>
    ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Kode</th><th>Tanggal</th><th>Pembeli</th><th>Barang</th><th>Metode</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((o) => `<tr><td><strong>${esc(o.code)}</strong></td><td class="nowrap">${fmtDate(o.created_at)}</td><td>${esc(o.profiles?.name || o.buyer_name || '')}<div class="small muted">${esc(o.profiles?.department || '')}</div></td>
        <td>${o.order_items.map((i) => esc(i.code || '') + ' ' + esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join('<br>')}</td>
        <td>${esc(o.payment_snapshot?.name || '')}</td><td class="num">${rupiah(o.total)}</td><td>${badge(ORDER_STATUS, o.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-open="${o.id}">Buka</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panel empty"><strong>Tidak ada pesanan</strong>pada status ini.</div>'}`;
  $$('[data-f]').forEach((b) => (b.onclick = () => { orderFilter = b.dataset.f; orders(); }));
  $$('[data-open]').forEach((b) => (b.onclick = () => openOrder(all.find((o) => o.id === Number(b.dataset.open)))));
  $('[data-offline]').onclick = () => recordOfflineOrder();
  $('[data-export]').onclick = () => downloadCsv(`pesanan-${new Date().toISOString().slice(0, 10)}.csv`, all.flatMap((o) => o.order_items.map((i) => ({
    order: o.code, tanggal: fmtDate(o.created_at), status: o.status, pembeli: o.profiles?.name || o.buyer_name, metode: o.payment_snapshot?.name,
    kode_barang: i.code, barang: i.name, qty: i.qty, harga: i.price, harga_normal: i.normal_price, penjual: i.seller_name,
    subtotal_order: o.subtotal, biaya_admin: o.admin_fee, kode_unik: o.unique_code, total_order: o.total, dibayar: o.paid_at ? fmtDate(o.paid_at) : '', payout: i.payout_status
  }))));
}

async function openOrder(o) {
  let proof = '';
  if (o.proof_path) { const { data } = await sb.storage.from('payment-proofs').createSignedUrl(o.proof_path, 900); proof = data?.signedUrl || ''; }
  const st = o.status;
  const actions = [{ label: 'Tutup' }];
  // await pada render ulang penting: tanpa itu, navigasi cepat setelah aksi bisa
  // membuat render lama menimpa halaman yang sudah berpindah (race condition).
  const call = (fn, args, msg) => async () => { unwrap(await sb.rpc(fn, args)); toast(msg, 'ok'); await refreshCounts(); await orders(); };
  if (['waiting_verification', 'waiting_payment'].includes(st)) {
    actions.push({ label: 'Tolak bukti', cls: 'btn-ghost', onClick: async () => {
      const note = await promptDialog('Alasan (dilihat pembeli):', { title: 'Tolak bukti bayar', value: 'Nominal / bukti tidak sesuai, silakan unggah ulang' });
      if (!note) return false;
      await call('admin_verify_payment', { p_order_id: o.id, p_approve: false, p_note: note }, 'Bukti ditolak')();
    } });
    actions.push({ label: '✓ Pembayaran valid', cls: 'btn-primary', onClick: call('admin_verify_payment', { p_order_id: o.id, p_approve: true, p_note: null }, 'Pembayaran diverifikasi') });
  }
  if (st === 'paid') actions.push({ label: 'Siap diambil', cls: 'btn-primary', onClick: call('admin_set_order_status', { p_order_id: o.id, p_status: 'ready_pickup', p_note: null }, 'Status: siap diambil') });
  if (['paid', 'ready_pickup'].includes(st)) actions.push({ label: '✓ Sudah diserahkan', cls: 'btn-primary', onClick: call('admin_set_order_status', { p_order_id: o.id, p_status: 'completed', p_note: null }, 'Pesanan selesai') });
  if (!['completed', 'cancelled', 'expired'].includes(st)) actions.splice(1, 0, { label: 'Batalkan', cls: 'btn-danger', onClick: async () => {
    const note = await promptDialog('Alasan pembatalan (stok akan dikembalikan):', { title: 'Batalkan pesanan' });
    if (!note) return false;
    await call('admin_set_order_status', { p_order_id: o.id, p_status: 'cancelled', p_note: note }, 'Pesanan dibatalkan')();
  } });
  const phone = o.profiles?.phone ? o.profiles.phone.replace(/^0/, '62') : '';
  modal({
    title: `Pesanan ${o.code}`, wide: true, actions,
    body: `<div class="grid-form" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:start">
      <div>
        <dl class="kv"><dt>Status</dt><dd>${badge(ORDER_STATUS, st)}</dd>
          <dt>Pembeli</dt><dd>${esc(o.profiles?.name || o.buyer_name || '')} · ${esc(o.profiles?.email || '')}${phone ? ` · <a target="_blank" rel="noopener" href="${waLink(phone, `Halo ${o.profiles.name}, terkait pesanan ${o.code} di Compassion Market...`)}">WA ${esc(o.profiles.phone)}</a>` : ''}</dd>
          <dt>Metode</dt><dd>${esc(o.payment_snapshot?.name || '')}</dd>
          <dt>Dibuat</dt><dd>${fmtDate(o.created_at)}${st === 'waiting_payment' ? ` · batas ${fmtDate(o.expires_at)}` : ''}</dd>
          ${o.paid_at ? `<dt>Lunas</dt><dd>${fmtDate(o.paid_at)}</dd>` : ''}
          ${o.buyer_note ? `<dt>Catatan pembeli</dt><dd>${esc(o.buyer_note)}</dd>` : ''}
          ${o.admin_note ? `<dt>Catatan admin</dt><dd>${esc(o.admin_note)}</dd>` : ''}</dl>
        <div class="table-wrap"><table class="tbl"><tbody>
          ${o.order_items.map((i) => `<tr><td>${esc(i.code || '')} ${esc(i.name)} ×${i.qty}<div class="small muted">Penjual: ${esc(i.seller_name || '-')}</div></td><td class="num">${rupiah(i.price * i.qty)}</td></tr>`).join('')}
          <tr><td>Subtotal</td><td class="num">${rupiah(o.subtotal)}</td></tr>
          ${o.admin_fee ? `<tr><td>Biaya admin</td><td class="num">${rupiah(o.admin_fee)}</td></tr>` : ''}
          ${o.unique_code ? `<tr><td>Kode unik</td><td class="num">${o.unique_code}</td></tr>` : ''}
          <tr><td><strong>Total harus diterima</strong></td><td class="num"><strong>${rupiah(o.total)}</strong></td></tr></tbody></table></div>
      </div>
      <div><h3>Bukti bayar</h3>${proof ? (/\.pdf$/i.test(o.proof_path) ? `<a class="btn btn-ghost" href="${esc(proof)}" target="_blank" rel="noopener">Buka PDF bukti</a>`
        : `<a href="${esc(proof)}" target="_blank" rel="noopener"><img src="${esc(proof)}" alt="Bukti bayar" style="width:100%;border-radius:10px;border:1px solid var(--line)"></a>`) : '<p class="muted small">Belum ada bukti.</p>'}</div>
    </div>`
  });
}

// Catat transaksi offline/tunai (langsung lunas), stok & pencairan tetap tercatat normal
async function recordOfflineOrder() {
  const prods = unwrap(await sb.from('products').select('id, code, name, price, stock, seller_name').eq('status', 'published').gt('stock', 0).order('name'));
  if (!prods.length) return toast('Tidak ada barang tayang dengan stok tersedia', 'error');
  const m = modal({
    title: 'Catat penjualan offline', wide: true,
    body: `<p class="small muted" style="margin:0 0 10px">Untuk transaksi yang terjadi langsung (tunai/di tempat), tanpa lewat alur checkout online. Pesanan akan langsung tercatat <strong>Lunas</strong>, stok berkurang, dan tetap masuk pencairan penjual.</p>
      <div class="grid-form">
        <label class="field span-2"><span>Nama pembeli (opsional)</span><input type="text" data-buyer placeholder="Mis. Budi (tamu) — kosongkan kalau tidak tahu"></label>
        <label class="field span-all"><span>Catatan (opsional)</span><input type="text" data-note placeholder="Mis. dibayar tunai di meja katalog"></label>
      </div>
      <div class="filter-bar" style="margin-top:10px"><input type="search" data-q placeholder="Cari barang"></div>
      <div class="table-wrap" style="max-height:45vh"><table class="tbl"><thead><tr><th></th><th>Barang</th><th class="num">Harga</th><th class="num" style="width:90px">Qty</th></tr></thead><tbody>
      ${prods.map((p) => `<tr data-id="${p.id}" data-name="${esc((p.code + ' ' + p.name).toLowerCase())}"><td><input type="checkbox" aria-label="Pilih"></td>
        <td>${esc(p.code || '')} ${esc(p.name)}<div class="small muted">Penjual: ${esc(p.seller_name || '-')} · stok ${p.stock}</div></td>
        <td class="num">${rupiah(p.price)}</td><td class="num"><input type="number" value="1" min="1" max="${p.stock}" style="width:70px;min-height:32px;padding:4px 6px"></td></tr>`).join('')}
      </tbody></table></div>
      <div class="small muted" style="margin-top:8px;text-align:right">Subtotal: <strong data-total>Rp0</strong></div>`,
    actions: [{ label: 'Batal' }, { label: 'Catat sebagai Lunas', cls: 'btn-primary', onClick: async ({ body }) => {
      const items = $$('tbody tr', body).filter((tr) => $('input[type=checkbox]', tr).checked).map((tr) => ({
        product_id: Number(tr.dataset.id), qty: Math.max(1, Number($('input[type=number]', tr).value) || 1)
      }));
      if (!items.length) throw new Error('Pilih minimal 1 barang');
      const { data, error } = await sb.rpc('admin_create_offline_order', {
        p_items: items, p_buyer_name: $('[data-buyer]', body).value.trim() || null, p_note: $('[data-note]', body).value.trim() || null
      });
      if (error) throw error;
      toast(`Pesanan ${data.code} dicatat lunas (${rupiah(data.total)})`, 'ok');
      await refreshCounts(); await orders();
    } }]
  });
  const recalc = () => {
    const total = $$('tbody tr', m.body).filter((tr) => $('input[type=checkbox]', tr).checked)
      .reduce((a, tr) => a + (prods.find((p) => p.id === Number(tr.dataset.id))?.price || 0) * (Number($('input[type=number]', tr).value) || 0), 0);
    $('[data-total]', m.body).textContent = rupiah(total);
  };
  $$('tbody tr', m.body).forEach((tr) => {
    $('input[type=checkbox]', tr).addEventListener('change', recalc);
    $('input[type=number]', tr).addEventListener('input', recalc);
  });
  $('[data-q]', m.body).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('tbody tr', m.body).forEach((tr) => (tr.hidden = !tr.dataset.name.includes(q))); };
}

// ============================================================================
// PRODUK & STOK
// ============================================================================
let prodFilter = { status: 'published', q: '' };
async function products() {
  let q = sb.from('products').select('*, product_images(path, sort)').order('created_at', { ascending: false }).limit(1000);
  if (prodFilter.status !== 'all') q = q.eq('status', prodFilter.status);
  const data = unwrap(await q);
  const s = prodFilter.q.toLowerCase();
  const list = s ? data.filter((p) => [p.code, p.name, p.seller_name].some((v) => String(v || '').toLowerCase().includes(s))) : data;
  main().innerHTML = head('Produk & stok', 'Edit data barang, atur stok (tercatat di kartu stok), tandai pilihan, sembunyikan / tayangkan.',
    `<button class="btn btn-ghost btn-sm" data-xlsx-export title="Export barang sesuai filter ke Excel">⬇ Export Excel</button>
     <label class="btn btn-ghost btn-sm" title="Update massal dari file hasil Export Excel">⬆ Import Excel<input type="file" data-xlsx-import accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
     <button class="btn btn-primary btn-sm" data-new>+ Barang baru</button>`) + `
    <div class="filter-bar"><select data-status>${[['all', 'Semua status'], ...Object.entries(PRODUCT_STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => `<option value="${k}" ${prodFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="search" data-q placeholder="Cari kode / nama / penjual" value="${esc(prodFilter.q)}"><span class="small muted">${list.length} barang</span></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>Kode</th><th>Barang</th><th>Jenis</th><th>Penjual</th><th class="num">Harga</th><th class="num">Stok</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr data-id="${p.id}"><td><img class="thumb" src="${esc(firstImg(p) ? imgUrl(firstImg(p)) : PLACEHOLDER)}" alt="" loading="lazy"></td>
      <td class="nowrap">${esc(p.code || '')}</td><td>${esc(p.name)} ${p.featured ? '<span class="badge warn">★</span>' : ''}</td><td>${esc(catName(p.category_id))}</td><td>${esc(p.seller_name || '-')}</td>
      <td class="num">${p.original_price ? `<del class="small muted">${rupiah(p.original_price)}</del><br>` : ''}${rupiah(p.price)}${p.donation_amount > 0 ? `<div class="small" style="color:var(--danger)">💝 ${rupiah(p.donation_amount)}</div>` : ''}</td>
      <td class="num"><strong>${p.stock}</strong></td><td>${badge(PRODUCT_STATUS, p.status)}</td>
      <td class="nowrap"><button class="btn btn-ghost btn-sm" data-edit>Edit</button> <button class="btn btn-ghost btn-sm" data-stock>Stok</button> <button class="btn btn-ghost btn-sm" data-card>Kartu stok</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('[data-status]').onchange = (e) => { prodFilter.status = e.target.value; products(); };
  $('[data-q]').onchange = (e) => { prodFilter.q = e.target.value; products(); };
  $('[data-new]').onclick = () => editProduct(null);
  $('[data-xlsx-export]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const { exportProducts } = await import('./admin-excel.js');
      const s = await loadSettings();
      const filterLabel = [prodFilter.status === 'all' ? 'Semua status' : PRODUCT_STATUS[prodFilter.status]?.[0], prodFilter.q && `"${prodFilter.q}"`].filter(Boolean).join(', ');
      await exportProducts(list, categories, { storeName: s.store_name, filterLabel });
      toast(`${list.length} barang diekspor ke Excel`, 'ok');
    } catch (err) { toast(errText(err), 'error'); }
    finally { e.target.disabled = false; }
  };
  $('[data-xlsx-import]').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importExcel(file);
  };
  $$('tr[data-id]').forEach((tr) => {
    const p = list.find((x) => x.id === Number(tr.dataset.id));
    $('[data-edit]', tr).onclick = () => editProduct(p);
    $('[data-stock]', tr).onclick = () => adjustStock(p);
    $('[data-card]', tr).onclick = () => stockCard(p);
  });
}

async function importExcel(file) {
  let mod, parsed, diff;
  try {
    mod = await import('./admin-excel.js');
    parsed = await mod.readImport(file, categories);
    const current = unwrap(await sb.from('products').select('*').limit(5000));
    diff = mod.diffImport(parsed, current, categories);
  } catch (err) { toast(errText(err), 'error'); return; }
  const { updates, creates, errors, warnings, unchanged } = diff;
  const total = updates.length + creates.length;
  const stat = (v, l, cls = '') => `<div class="stat ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  modal({
    title: `Pratinjau import — ${file.name}`, wide: true,
    body: `<div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
        ${stat(updates.length, 'Barang diubah')}${stat(creates.length, 'Barang baru')}${stat(unchanged, 'Tidak berubah')}${stat(errors.length, 'Baris error', errors.length ? 'alert' : '')}
      </div>
      ${errors.length ? `<div class="notice danger" style="margin-bottom:12px"><strong>Perbaiki dulu di Excel lalu import ulang — tidak ada yang disimpan selama masih ada error:</strong>
        <ul style="margin:6px 0 0;padding-left:18px">${errors.map((x) => `<li>Baris ${x.row}${x.label ? ` (${esc(x.label)})` : ''}: ${x.messages.map(esc).join('; ')}</li>`).join('')}</ul></div>` : ''}
      ${warnings.length ? `<div class="notice warn" style="margin-bottom:12px"><strong>Perhatian:</strong><ul style="margin:6px 0 0;padding-left:18px">${warnings.map((w) => `<li>Baris ${w.row} (${esc(w.label)}): ${esc(w.message)}</li>`).join('')}</ul></div>` : ''}
      ${total ? `<div class="table-wrap" style="max-height:50vh"><table class="tbl"><thead><tr><th>Baris</th><th>Barang</th><th>Perubahan</th></tr></thead><tbody>
        ${updates.map((u) => `<tr><td>${u.row}</td><td>${esc(u.label)}</td><td>${u.changes.map((c) => `<div><strong>${esc(c.label)}</strong>: <span class="muted">${esc(c.from)}</span> → ${esc(c.to)}</div>`).join('')}</td></tr>`).join('')}
        ${creates.map((c) => `<tr><td>${c.row}</td><td>${esc(c.label)} <span class="badge info">Baru</span></td><td class="small">${esc([c.payload.category, c.payload.price != null ? rupiah(c.payload.price) : null, c.payload.stock != null ? 'stok ' + c.payload.stock : 'stok 1'].filter(Boolean).join(' · '))}</td></tr>`).join('')}
      </tbody></table></div>` : (!errors.length ? '<div class="empty"><strong>Tidak ada perubahan</strong>Isi file sama dengan data di sistem.</div>' : '')}`,
    actions: [{ label: 'Batal' }, ...(total && !errors.length ? [{ label: `Terapkan ${total} perubahan`, cls: 'btn-primary', onClick: async () => {
      const res = unwrap(await sb.rpc('admin_import_products', { p_rows: [...updates.map((u) => u.payload), ...creates.map((c) => c.payload)], p_source: file.name }));
      toast(`Import selesai: ${res.updated} diubah, ${res.created} baru${res.stock_changes ? `, ${res.stock_changes} penyesuaian stok` : ''}`, 'ok');
      await products();
    } }] : [])]
  });
}

const PRODUCT_FIELDS = () => [
  { k: 'code', label: 'Kode barang' },
  { k: 'name', label: 'Nama barang', req: true, span: 'span-2' },
  { k: 'category_id', label: 'Jenis barang', type: 'select', options: categories.map((c) => [c.id, c.name]) },
  { k: 'seller_name', label: 'Nama penjual' },
  { k: 'size', label: 'Ukuran' },
  { k: 'item_condition', label: 'Kondisi', type: 'select', options: [['preloved', 'Preloved'], ['baru', 'Baru'], ['', 'Belum diinformasikan']] },
  { k: 'condition_pct', label: 'Kondisi (%)', type: 'number' },
  { k: 'price', label: 'Harga jual', type: 'number', req: true },
  { k: 'original_price', label: 'Harga coret (normal)', type: 'number' },
  { k: 'donation_amount', label: 'Nominal donasi', type: 'number', help: 'Bagian dari hasil penjualan yang didonasikan' },
  { k: 'status', label: 'Status', type: 'select', options: Object.entries(PRODUCT_STATUS).map(([k, [l]]) => [k, l]) },
  { k: 'sort_order', label: 'Urutan tampil', type: 'number', help: 'Angka kecil tampil lebih dulu' },
  { k: 'featured', label: 'Tandai sebagai pilihan (★)', type: 'check' },
  { k: 'summary', label: 'Deskripsi singkat', type: 'textarea', span: 'span-all' },
  { k: 'condition_note', label: 'Catatan kondisi', type: 'textarea', span: 'span-all' }
];

async function editProduct(p) {
  const isNew = !p;
  const defs = PRODUCT_FIELDS();
  const vals = p || { status: 'published', item_condition: 'preloved', condition_pct: 80, sort_order: 0, code: unwrap(await sb.rpc('admin_new_code')) };
  let images = (p?.product_images || []).slice().sort((a, b) => a.sort - b.sort).map((i) => i.path);
  const m = modal({
    title: isNew ? 'Barang baru (input admin)' : `Edit ${p.code || p.name}`, wide: true,
    body: formHtml(defs, vals) + `
      ${isNew ? `<label class="field" style="margin-top:12px"><span class="req">Stok awal</span><input type="number" name="init_stock" value="1" min="0"></label>` : `<p class="small muted">Stok saat ini <strong>${p.stock}</strong> — ubah lewat tombol "Stok" agar tercatat di kartu stok.</p>`}
      <div class="field" style="margin-top:12px"><span>Foto (urutan pertama = utama)</span><div class="photo-previews" data-imgs></div>
        <div class="btn-row" style="margin-top:8px"><input type="file" accept="image/*" multiple data-upload aria-label="Unggah foto"><input type="url" placeholder="atau tempel URL foto" data-url style="max-width:280px"><button class="btn btn-ghost btn-sm" type="button" data-addurl>Tambah URL</button></div></div>`,
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async ({ body }) => {
      const v = readForm(body, defs);
      v.item_condition = v.item_condition || null;
      v.featured = !!v.featured;
      v.sort_order = v.sort_order ?? 0;
      let id = p?.id;
      if (isNew) {
        v.stock = Number($('[name=init_stock]', body).value) || 0;
        v.published_at = v.status === 'published' ? new Date().toISOString() : null;
        v.reviewed_by = profile.id; v.reviewed_at = new Date().toISOString();
        id = unwrap(await sb.from('products').insert(v).select('id').single()).id;
      } else {
        if (v.status === 'published' && !p.published_at) v.published_at = new Date().toISOString();
        unwrap(await sb.from('products').update(v).eq('id', id));
      }
      unwrap(await sb.from('product_images').delete().eq('product_id', id));
      if (images.length) unwrap(await sb.from('product_images').insert(images.map((path, i) => ({ product_id: id, path, sort: i }))));
      toast('Barang disimpan', 'ok');
      await products();
    } }]
  });
  const draw = () => {
    const box = $('[data-imgs]', m.body);
    box.innerHTML = images.map((u, i) => `<figure><img src="${esc(imgUrl(u))}" alt=""><button type="button" data-i="${i}" aria-label="Hapus">×</button></figure>`).join('') || '<span class="small muted">Belum ada foto</span>';
    $$('button', box).forEach((b) => (b.onclick = () => { images.splice(Number(b.dataset.i), 1); draw(); }));
  };
  draw();
  $('[data-upload]', m.body).onchange = async (e) => {
    for (const f of e.target.files) { try { images.push(await uploadFile('product-photos', f, { folder: 'admin' })); } catch (err) { toast(errText(err), 'error'); } }
    e.target.value = ''; draw();
  };
  $('[data-addurl]', m.body).onclick = () => { const u = $('[data-url]', m.body).value.trim(); if (/^https?:\/\//.test(u)) { images.push(u); $('[data-url]', m.body).value = ''; draw(); } };
}

function adjustStock(p) {
  modal({
    title: `Stok ${p.code || ''} ${p.name}`,
    body: `<div class="grid-form"><label class="field"><span>Stok saat ini</span><input type="number" value="${p.stock}" disabled></label>
      <label class="field"><span class="req">Stok baru</span><input type="number" name="stock" min="0" value="${p.stock}"></label>
      <label class="field span-all"><span class="req">Keterangan</span><input type="text" name="note" placeholder="Mis. stock opname, terjual offline, barang rusak"></label></div>`,
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async ({ body }) => {
      const note = $('[name=note]', body).value.trim();
      if (!note) throw new Error('Isi keterangan penyesuaian');
      unwrap(await sb.rpc('admin_adjust_stock', { p_id: p.id, p_new_stock: Number($('[name=stock]', body).value), p_note: note }));
      toast('Stok diperbarui', 'ok'); await products();
    } }]
  });
}

async function stockCard(p) {
  const rows = unwrap(await sb.from('stock_movements').select('*').eq('product_id', p.id).order('created_at'));
  modal({
    title: `Kartu stok ${p.code || ''} ${p.name}`, wide: true,
    body: `<div class="table-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Tipe</th><th class="num">Masuk/Keluar</th><th class="num">Saldo</th><th>Ref</th><th>Keterangan</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td>${esc({ initial: 'Saldo awal', sale: 'Terjual/dipesan', release: 'Kembali (batal/expired)', adjust: 'Penyesuaian' }[r.type] || r.type)}</td>
        <td class="num" style="color:${r.qty_change < 0 ? 'var(--danger)' : 'var(--ok)'}">${r.qty_change > 0 ? '+' : ''}${r.qty_change}</td><td class="num">${r.balance}</td><td>${esc(r.ref || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Belum ada mutasi</td></tr>'}
    </tbody></table></div>`
  });
}

// ============================================================================
// FLASH SALE
// ============================================================================
async function flash() {
  const data = unwrap(await sb.from('flash_sales').select('*, flash_sale_items(*, products(code, name, price, stock))').order('start_at', { ascending: false }));
  const now = Date.now();
  const phase = (f) => !f.active ? ['Nonaktif', ''] : now < Date.parse(f.start_at) ? ['Akan datang', 'info'] : now < Date.parse(f.end_at) ? ['LIVE', 'danger'] : ['Selesai', 'dark'];
  main().innerHTML = head('Flash sale', 'Buat periode flash sale dan pilih barang beserta harga & kuotanya. Harga otomatis berlaku sesuai jadwal.', '<button class="btn btn-primary btn-sm" data-new>+ Flash sale baru</button>') +
    (data.length ? data.map((f) => `<div class="panel" data-id="${f.id}">
      <div class="order-head"><div><h3 style="margin:0">${esc(f.name)} <span class="badge ${phase(f)[1]}">${phase(f)[0]}</span></h3>
        <div class="small muted">${fmtDate(f.start_at)} — ${fmtDate(f.end_at)} · ${f.flash_sale_items.length} barang</div></div>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" data-edit>Ubah jadwal</button><button class="btn btn-ghost btn-sm" data-add>+ Barang</button><button class="btn btn-ghost btn-sm" data-del>Hapus</button></div></div>
      ${f.flash_sale_items.length ? `<div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Barang</th><th class="num">Harga normal</th><th class="num">Harga flash</th><th class="num">Diskon</th><th class="num">Kuota</th><th class="num">Terjual</th><th></th></tr></thead><tbody>
        ${f.flash_sale_items.map((i) => `<tr><td>${esc(i.products?.code || '')} ${esc(i.products?.name || '')} <span class="small muted">(stok ${i.products?.stock ?? '-'})</span></td><td class="num">${rupiah(i.products?.price)}</td><td class="num"><strong>${rupiah(i.flash_price)}</strong></td>
          <td class="num">${i.products?.price ? Math.round((1 - i.flash_price / i.products.price) * 100) + '%' : '-'}</td><td class="num">${i.quota ?? '∞'}</td><td class="num">${i.sold}</td>
          <td><button class="btn btn-ghost btn-sm" data-rm-item="${i.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`).join('') : '<div class="panel empty"><strong>Belum ada flash sale</strong>Buat yang pertama.</div>');
  $('[data-new]').onclick = () => editFlash(null);
  $$('.panel[data-id]').forEach((el) => {
    const f = data.find((x) => x.id === Number(el.dataset.id));
    $('[data-edit]', el).onclick = () => editFlash(f);
    $('[data-add]', el).onclick = () => addFlashItems(f);
    $('[data-del]', el).onclick = async () => { if (await confirmDialog(`Hapus flash sale "${f.name}"?`, { danger: true })) { unwrap(await sb.from('flash_sales').delete().eq('id', f.id)); await flash(); } };
    $$('[data-rm-item]', el).forEach((b) => (b.onclick = async () => { unwrap(await sb.from('flash_sale_items').delete().eq('id', Number(b.dataset.rmItem))); await flash(); }));
  });
}
function editFlash(f) {
  const start = f ? new Date(f.start_at) : new Date(Date.now() + 3600e3);
  const end = f ? new Date(f.end_at) : new Date(start.getTime() + 2 * 3600e3);
  const defs = [
    { k: 'name', label: 'Nama', req: true, span: 'span-all' },
    { k: 'start_at', label: 'Mulai', type: 'datetime-local', req: true },
    { k: 'end_at', label: 'Selesai', type: 'datetime-local', req: true },
    { k: 'active', label: 'Aktif', type: 'check' }
  ];
  modal({
    title: f ? 'Ubah flash sale' : 'Flash sale baru',
    body: formHtml(defs, { name: f?.name || 'Flash Sale', start_at: toLocalInput(start), end_at: toLocalInput(end), active: f ? f.active : true }),
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async ({ body }) => {
      const v = readForm(body, defs);
      v.start_at = new Date(v.start_at).toISOString(); v.end_at = new Date(v.end_at).toISOString();
      if (v.end_at <= v.start_at) throw new Error('Waktu selesai harus setelah mulai');
      if (f) unwrap(await sb.from('flash_sales').update(v).eq('id', f.id)); else unwrap(await sb.from('flash_sales').insert(v));
      toast('Flash sale disimpan', 'ok'); await flash();
    } }]
  });
}
async function addFlashItems(f) {
  const prods = unwrap(await sb.from('products').select('id, code, name, price, stock').eq('status', 'published').gt('stock', 0).order('name'));
  const existing = new Set(f.flash_sale_items.map((i) => i.product_id));
  const m = modal({
    title: `Tambah barang ke "${f.name}"`, wide: true,
    body: `<div class="filter-bar"><label class="field"><span>Diskon cepat (%)</span><input type="number" data-pct value="20" min="1" max="95"></label>
        <label class="field"><span>Kuota per barang (kosong = sesuai stok)</span><input type="number" data-quota min="1"></label>
        <input type="search" data-q placeholder="Cari barang" style="align-self:end"></div>
      <div class="table-wrap" style="max-height:50vh"><table class="tbl"><thead><tr><th><input type="checkbox" data-all aria-label="Pilih semua"></th><th>Barang</th><th class="num">Harga</th><th class="num">Harga flash</th></tr></thead><tbody>
      ${prods.filter((p) => !existing.has(p.id)).map((p) => `<tr data-id="${p.id}" data-name="${esc((p.code + ' ' + p.name).toLowerCase())}"><td><input type="checkbox" aria-label="Pilih"></td><td>${esc(p.code || '')} ${esc(p.name)} <span class="small muted">stok ${p.stock}</span></td>
        <td class="num">${rupiah(p.price)}</td><td class="num"><input type="number" data-price="${p.price}" style="width:120px;min-height:32px;padding:4px 8px"></td></tr>`).join('')}
      </tbody></table></div>`,
    actions: [{ label: 'Batal' }, { label: 'Tambahkan', cls: 'btn-primary', onClick: async ({ body }) => {
      const quota = $('[data-quota]', body).value;
      const rows = $$('tbody tr', body).filter((tr) => $('input[type=checkbox]', tr).checked).map((tr) => ({
        flash_sale_id: f.id, product_id: Number(tr.dataset.id), flash_price: Number($('[data-price]', tr).value), quota: quota ? Number(quota) : null
      }));
      if (!rows.length) throw new Error('Pilih minimal 1 barang');
      if (rows.some((r) => !(r.flash_price >= 0))) throw new Error('Isi harga flash');
      unwrap(await sb.from('flash_sale_items').insert(rows));
      toast(`${rows.length} barang ditambahkan`, 'ok'); await flash();
    } }]
  });
  const applyPct = () => { const pct = Number($('[data-pct]', m.body).value) || 0; $$('[data-price]', m.body).forEach((i) => { i.value = Math.round((Number(i.dataset.price) * (100 - pct)) / 100 / 500) * 500; }); };
  $('[data-pct]', m.body).oninput = applyPct; applyPct();
  $('[data-q]', m.body).oninput = (e) => $$('tbody tr', m.body).forEach((tr) => (tr.hidden = !tr.dataset.name.includes(e.target.value.toLowerCase())));
  $('[data-all]', m.body).onchange = (e) => $$('tbody tr:not([hidden]) input[type=checkbox]', m.body).forEach((c) => (c.checked = e.target.checked));
}

// ============================================================================
// PENCAIRAN PENJUAL
// ============================================================================
async function payout() {
  const s = await loadSettings(true);
  const comm = Number(s.commission_percent || 0);
  const rows = unwrap(await sb.from('order_items').select('*, orders!inner(code, status, paid_at), profiles:seller_id(name, phone, bank_name, bank_account, bank_holder)')
    .eq('payout_status', 'unpaid').in('orders.status', ['paid', 'ready_pickup', 'completed']));
  const groups = {};
  rows.forEach((r) => { const k = r.seller_id || 'name:' + (r.seller_name || '-'); (groups[k] ||= { seller: r.profiles, name: r.profiles?.name || r.seller_name || '-', items: [] }).items.push(r); });
  main().innerHTML = head('Pencairan penjual', `Hak penjual dari pesanan yang sudah lunas. Potongan komisi saat ini ${comm}% (ubah di Pengaturan).`, '<button class="btn btn-ghost btn-sm" data-export>⬇ Export CSV</button>') +
    (Object.keys(groups).length ? Object.entries(groups).map(([k, g]) => {
      const gross = g.items.reduce((a, i) => a + i.price * i.qty, 0);
      const net = Math.round(gross * (100 - comm) / 100);
      return `<div class="panel" data-k="${esc(k)}"><div class="order-head"><div><h3 style="margin:0">${esc(g.name)}</h3>
          <div class="small muted">${g.seller?.bank_account ? `${esc(g.seller.bank_name || '')} <strong>${esc(g.seller.bank_account)}</strong> a.n. ${esc(g.seller.bank_holder || '')} <button class="copy-btn" data-copy="${esc(g.seller.bank_account)}">Salin</button>` : '<span class="badge warn">Rekening belum diisi penjual</span>'}</div></div>
          <div style="text-align:right"><div class="small muted">Bruto ${rupiah(gross)}</div><strong style="font-size:18px">${rupiah(net)}</strong></div></div>
        <div class="table-wrap" style="margin-top:10px"><table class="tbl"><tbody>${g.items.map((i) => `<tr><td><input type="checkbox" checked data-item="${i.id}" aria-label="Pilih"></td><td>${esc(i.orders.code)}</td><td>${esc(i.code || '')} ${esc(i.name)} ×${i.qty}</td><td>${fmtDate(i.orders.paid_at)}</td><td class="num">${rupiah(i.price * i.qty)}</td></tr>`).join('')}</tbody></table></div>
        <div class="btn-row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-pay>Tandai sudah ditransfer</button></div></div>`;
    }).join('') : '<div class="panel empty"><strong>Tidak ada hak penjual yang tertunda</strong></div>');
  $$('[data-copy]').forEach((b) => (b.onclick = () => copyText(b.dataset.copy, b)));
  $('[data-export]').onclick = () => downloadCsv('pencairan.csv', rows.map((i) => ({ penjual: i.profiles?.name || i.seller_name, bank: i.profiles?.bank_name, rekening: i.profiles?.bank_account, atas_nama: i.profiles?.bank_holder, order: i.orders.code, barang: i.name, qty: i.qty, nilai: i.price * i.qty, neto: Math.round(i.price * i.qty * (100 - comm) / 100) })));
  $$('.panel[data-k]').forEach((el) => {
    $('[data-pay]', el).onclick = async () => {
      const ids = $$('[data-item]', el).filter((c) => c.checked).map((c) => Number(c.dataset.item));
      if (!ids.length) return toast('Pilih item', 'error');
      const ref = await promptDialog('No. referensi transfer / catatan:', { title: 'Konfirmasi pencairan', multiline: false });
      if (!ref) return;
      const n = unwrap(await sb.rpc('admin_mark_payout', { p_item_ids: ids, p_ref: ref }));
      toast(`${n} item ditandai dicairkan`, 'ok'); await payout();
    };
  });
}

// ============================================================================
// MASTER: JENIS BARANG
// ============================================================================
async function categoriesSec() {
  await loadCategories();
  const counts = unwrap(await sb.from('products').select('category_id'));
  const n = {}; counts.forEach((r) => (n[r.category_id] = (n[r.category_id] || 0) + 1));
  main().innerHTML = head('Jenis barang', 'Master data dropdown "jenis barang" di form jual + filter katalog + zona pajangan di toko 3D.', '<button class="btn btn-primary btn-sm" data-new>+ Jenis baru</button>') + `
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Urut</th><th>Ikon</th><th>Nama</th><th>Zona 3D</th><th>Pilihan ukuran</th><th class="num">Barang</th><th>Aktif</th><th></th></tr></thead><tbody>
    ${categories.map((c) => `<tr data-id="${c.id}"><td>${c.sort}</td><td>${esc(c.icon || '')}</td><td>${esc(c.name)}</td><td>${esc(ZONES[c.zone] || c.zone || '-')}</td><td class="small">${esc(c.size_options || '-')}</td><td class="num">${n[c.id] || 0}</td>
      <td>${c.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td><td class="nowrap"><button class="btn btn-ghost btn-sm" data-edit>Edit</button> <button class="btn btn-ghost btn-sm" data-del>Hapus</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('[data-new]').onclick = () => editCategory(null);
  $$('tr[data-id]').forEach((tr) => {
    const c = categories.find((x) => x.id === Number(tr.dataset.id));
    $('[data-edit]', tr).onclick = () => editCategory(c);
    $('[data-del]', tr).onclick = async () => {
      if (!(await confirmDialog(`Hapus jenis "${c.name}"? Jika sudah dipakai barang, nonaktifkan saja.`, { danger: true }))) return;
      const { error } = await sb.from('categories').delete().eq('id', c.id);
      if (error) return toast('Tidak bisa dihapus karena sudah dipakai barang. Nonaktifkan saja.', 'error');
      await categoriesSec();
    };
  });
}
function editCategory(c) {
  const defs = [
    { k: 'name', label: 'Nama', req: true },
    { k: 'icon', label: 'Ikon (emoji)' },
    { k: 'zone', label: 'Zona di toko 3D', type: 'select', options: [['', '— tidak tampil —'], ...Object.entries(ZONES)] },
    { k: 'sort', label: 'Urutan', type: 'number' },
    { k: 'size_options', label: 'Pilihan ukuran (pisah koma)', span: 'span-all', help: 'Mis. S,M,L,XL atau 38,39,40. Kosongkan jika bebas.' },
    { k: 'active', label: 'Aktif', type: 'check' }
  ];
  modal({
    title: c ? 'Edit jenis barang' : 'Jenis barang baru',
    body: formHtml(defs, c || { active: true, sort: categories.length + 1, icon: '🏷️' }),
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async ({ body }) => {
      const v = readForm(body, defs); v.sort = v.sort ?? 0; v.size_options = v.size_options || '';
      if (c) unwrap(await sb.from('categories').update(v).eq('id', c.id)); else unwrap(await sb.from('categories').insert(v));
      toast('Tersimpan', 'ok'); await categoriesSec();
    } }]
  });
}

// ============================================================================
// MASTER: METODE PEMBAYARAN
// ============================================================================
async function payments() {
  const data = unwrap(await sb.from('payment_methods').select('*').order('sort'));
  main().innerHTML = head('Metode pembayaran', 'QRIS & rekening bank yang tampil di katalog dan checkout.', '<button class="btn btn-primary btn-sm" data-new>+ Metode baru</button>') + `
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Urut</th><th>Tipe</th><th>Nama</th><th>Detail</th><th>Aktif</th><th></th></tr></thead><tbody>
    ${data.map((m) => `<tr data-id="${m.id}"><td>${m.sort}</td><td>${m.type === 'qris' ? '<span class="badge info">QRIS</span>' : '<span class="badge">Bank</span>'}</td><td>${esc(m.name)}</td>
      <td class="small">${m.type === 'qris' ? (m.qris_image ? `<img src="${esc(imgUrl(m.qris_image, 'site-assets'))}" style="height:60px;display:block;margin-bottom:4px" alt="QR"><button class="btn btn-ghost btn-sm" type="button" data-dl-qris>⬇ Unduh</button>` : '<span class="badge warn">Gambar QR belum diunggah</span>') : `${esc(m.bank_name || '')} ${esc(m.account_no || '')} a.n. ${esc(m.account_holder || '')}`}</td>
      <td>${m.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td><td class="nowrap"><button class="btn btn-ghost btn-sm" data-edit>Edit</button> <button class="btn btn-ghost btn-sm" data-del>Hapus</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('[data-new]').onclick = () => editPayment(null);
  $$('tr[data-id]').forEach((tr) => {
    const m = data.find((x) => x.id === Number(tr.dataset.id));
    $('[data-dl-qris]', tr)?.addEventListener('click', (e) => downloadFromUrl(imgUrl(m.qris_image, 'site-assets'), `QRIS-${(m.name || 'compassion-market').replace(/[^\w-]+/g, '-')}.jpg`, e.target));
    $('[data-edit]', tr).onclick = () => editPayment(m);
    $('[data-del]', tr).onclick = async () => {
      if (!(await confirmDialog(`Hapus "${m.name}"?`, { danger: true }))) return;
      const { error } = await sb.from('payment_methods').delete().eq('id', m.id);
      if (error) return toast('Sudah dipakai pesanan — nonaktifkan saja.', 'error');
      await payments();
    };
  });
}
function editPayment(m) {
  const defs = [
    { k: 'type', label: 'Tipe', type: 'select', options: [['bank', 'Transfer bank'], ['qris', 'QRIS']] },
    { k: 'name', label: 'Nama tampilan', req: true },
    { k: 'bank_name', label: 'Nama bank' },
    { k: 'account_no', label: 'No. rekening' },
    { k: 'account_holder', label: 'Atas nama' },
    { k: 'logo_url', label: 'URL logo bank (opsional)' },
    { k: 'qris_file', label: 'Gambar QRIS (untuk tipe QRIS)', type: 'file', span: 'span-all', help: m?.qris_image ? 'Kosongkan jika tidak ingin mengganti gambar' : '' },
    { k: 'instructions', label: 'Instruksi pembayaran', type: 'textarea', span: 'span-all' },
    { k: 'sort', label: 'Urutan', type: 'number' },
    { k: 'active', label: 'Aktif', type: 'check' }
  ];
  modal({
    title: m ? 'Edit metode pembayaran' : 'Metode pembayaran baru',
    body: formHtml(defs, m || { type: 'bank', active: true, sort: 9 }),
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async ({ body }) => {
      const v = readForm(body, defs); v.sort = v.sort ?? 0;
      const f = $('[name=qris_file]', body).files[0];
      if (f) v.qris_image = await uploadFile('site-assets', f, { folder: 'qris', compress: false });
      if (v.type === 'qris' && !v.qris_image && !m?.qris_image && v.active) throw new Error('Unggah gambar QRIS sebelum mengaktifkan');
      if (m) unwrap(await sb.from('payment_methods').update(v).eq('id', m.id)); else unwrap(await sb.from('payment_methods').insert(v));
      toast('Tersimpan', 'ok'); await payments();
    } }]
  });
}

// ============================================================================
// PENGATURAN
// ============================================================================
const SETTING_GROUPS = [
  ['Umum', [
    { k: 'store_name', label: 'Nama marketplace' }, { k: 'page_title', label: 'Judul halaman katalog' },
    { k: 'logo_url', label: 'URL logo', span: 'span-2' }, { k: 'logo_file', label: 'atau unggah logo', type: 'file' },
    { k: 'catalog_intro', label: 'Teks pengantar katalog', type: 'textarea', span: 'span-all' },
    { k: 'admin_whatsapp', label: 'WhatsApp admin (format 62…)' }, { k: 'pickup_info', label: 'Info pengambilan barang', type: 'textarea', span: 'span-all' }]],
  ['Tampilan', [
    { k: 'enable_3d', label: 'Tampilkan toko 3D', type: 'check' }, { k: 'theme_effects', label: 'Latar pelangi & kembang api', type: 'check' },
    { k: 'auto_scroll', label: 'Gulir otomatis (mode layar TV)', type: 'check' }, { k: 'enable_3d_people', label: 'Animasi penjual & pembeli di toko 3D', type: 'check' }, { k: 'logo_text', label: 'Teks logo di dinding 3D' },
    { k: 'sign_text', label: 'Tulisan papan tulis 3D', type: 'textarea' }]],
  ['Penjualan', [
    { k: 'product_code_prefix', label: 'Prefix kode barang' }, { k: 'next_submission_no', label: 'No. form berikutnya', type: 'number' },
    { k: 'max_items_per_submission', label: 'Maks. barang per pengajuan', type: 'number' }, { k: 'max_photos_per_item', label: 'Maks. foto per barang', type: 'number' },
    { k: 'min_condition_pct', label: 'Kondisi minimal (%)', type: 'number' }]],
  ['Pembayaran & pesanan', [
    { k: 'payment_intro', label: 'Teks info pembayaran', type: 'textarea', span: 'span-all' },
    { k: 'order_expiry_hours', label: 'Batas bayar (jam)', type: 'number' },
    { k: 'admin_fee_type', label: 'Tipe biaya admin', type: 'select', options: [['flat', 'Nominal (Rp)'], ['percent', 'Persen (%)']] },
    { k: 'admin_fee_value', label: 'Biaya admin', type: 'number' }, { k: 'use_unique_code', label: 'Kode unik 3 digit untuk transfer bank', type: 'check' },
    { k: 'commission_percent', label: 'Komisi dari penjual (%)', type: 'number', help: '0 = 100% hasil penjualan untuk penjual' }]],
  ['Footer voucher', [
    { k: 'footer_enabled', label: 'Tampilkan footer', type: 'check' }, { k: 'footer_kicker', label: 'Kicker' }, { k: 'footer_title', label: 'Judul', span: 'span-2' },
    { k: 'footer_text', label: 'Teks', type: 'textarea', span: 'span-all' }, { k: 'footer_embed_url', label: 'URL embed (Canva, dsb.)', span: 'span-all' },
    { k: 'footer_links', label: 'Tautan (satu per baris: Label|URL)', type: 'textarea', span: 'span-all' }]]
];
async function settingsSec() {
  const s = await loadSettings(true);
  const vals = { ...s };
  main().innerHTML = head('Pengaturan', 'Konfigurasi dinamis marketplace — berlaku langsung tanpa ubah kode.') +
    `<form id="settings-form">${SETTING_GROUPS.map(([g, defs]) => `<div class="panel"><h3>${g}</h3>${formHtml(defs, vals)}</div>`).join('')}
     <div class="btn-row" style="margin-top:14px;position:sticky;bottom:10px"><button class="btn btn-primary" type="submit">Simpan pengaturan</button></div></form>`;
  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const defs = SETTING_GROUPS.flatMap(([, d]) => d);
      const v = readForm(e.target, defs);
      const f = $('[name=logo_file]', e.target).files[0];
      if (f) v.logo_url = imgUrl(await uploadFile('site-assets', f, { folder: 'logo', compress: false }), 'site-assets');
      const rows = Object.entries(v).map(([key, val]) => ({ key, value: typeof val === 'boolean' ? (val ? '1' : '0') : val == null ? '' : String(val) }));
      unwrap(await sb.from('settings').upsert(rows));
      toast('Pengaturan disimpan', 'ok');
    } catch (err) { toast(errText(err), 'error'); }
  };
}

// ============================================================================
// PENGGUNA
// ============================================================================
async function users() {
  const data = unwrap(await sb.from('profiles').select('*').order('created_at', { ascending: false }));
  main().innerHTML = head('Pengguna', `${data.length} akun. Tambah karyawan (tanpa password — mereka pilih namanya sendiri di halaman "Pilih identitas"), jadikan admin, atau nonaktifkan akun di sini.`,
    '<button class="btn btn-primary btn-sm" data-add-employee>+ Tambah karyawan</button>') + `
    <div class="filter-bar"><input type="search" data-q placeholder="Cari nama / email / departemen"></div>
    <div class="table-wrap"><table class="tbl" id="users-table"><thead><tr><th>Nama</th><th>Email</th><th class="col-department">Departemen</th><th class="col-wa">WA</th><th class="col-bank">Rekening</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.map((u) => `<tr data-id="${u.id}" data-s="${esc([u.name, u.email, u.department, u.emp_id].join(' ').toLowerCase())}"><td>${esc(u.name)}<div class="small muted">${esc(u.emp_id || '')}</div></td><td>${esc(u.email || '')}</td><td class="col-department">${esc(u.department || '')}</td><td class="col-wa">${esc(u.phone || '')}</td>
      <td class="small col-bank">${u.bank_account ? esc(`${u.bank_name || ''} ${u.bank_account}`) : '-'}</td><td>${u.role === 'admin' ? '<span class="badge dark">Admin</span>' : 'Karyawan'}${u.has_login ? '' : '<div class="small muted">Tanpa login</div>'}</td>
      <td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge danger">Nonaktif</span>'}</td>
      <td class="nowrap">${u.id === profile.id ? '<span class="small muted">(Anda)</span>' : `
        ${u.has_login ? `<button class="btn btn-ghost btn-sm" data-role>${u.role === 'admin' ? 'Jadikan karyawan' : 'Jadikan admin'}</button>` : '<span class="small muted" title="Buat akun lewat Supabase Dashboard → Authentication dulu supaya bisa jadi admin">Tanpa akun login</span>'}
        <button class="btn btn-ghost btn-sm" data-active>${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('[data-add-employee]').onclick = () => {
    modal({
      title: 'Tambah karyawan', body: `<div class="grid-form">
        <label class="field span-all"><span class="req">Nama lengkap</span><input type="text" name="name" required></label>
        <label class="field"><span>NIK / ID karyawan</span><input type="text" name="emp_id"></label>
        <label class="field"><span>Departemen</span><input type="text" name="department"></label>
        <label class="field"><span>Email (label saja, opsional)</span><input type="email" name="email"></label>
        <label class="field"><span>No. WhatsApp</span><input type="tel" name="phone"></label>
      </div>`,
      actions: [{ label: 'Batal' }, { label: 'Tambah', cls: 'btn-primary', onClick: async ({ body }) => {
        const v = (n) => $(`[name=${n}]`, body).value.trim();
        if (!v('name')) { toast('Nama wajib diisi', 'error'); return false; }
        const { error } = await sb.rpc('admin_create_employee', { p_name: v('name'), p_email: v('email') || null, p_emp_id: v('emp_id') || null, p_department: v('department') || null, p_phone: v('phone') || null });
        if (error) throw error;
        toast('Karyawan ditambahkan', 'ok'); await users();
      } }]
    });
  };
  $('[data-q]').oninput = (e) => $$('tr[data-s]').forEach((tr) => (tr.hidden = !tr.dataset.s.includes(e.target.value.toLowerCase())));
  $$('tr[data-id]').forEach((tr) => {
    const u = data.find((x) => x.id === tr.dataset.id);
    $('[data-role]', tr)?.addEventListener('click', async () => { unwrap(await sb.from('profiles').update({ role: u.role === 'admin' ? 'employee' : 'admin' }).eq('id', u.id)); await users(); });
    $('[data-active]', tr)?.addEventListener('click', async () => { unwrap(await sb.from('profiles').update({ active: !u.active }).eq('id', u.id)); await users(); });
  });
}

// ============================================================================
// AUDIT LOG
// ============================================================================
async function audit() {
  const [rows, people] = await Promise.all([
    sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300).then(unwrap),
    sb.from('profiles').select('id, name').then(unwrap)
  ]);
  const who = Object.fromEntries(people.map((p) => [p.id, p.name]));
  main().innerHTML = head('Audit log', '300 aktivitas terakhir (pengajuan, verifikasi, pesanan, stok, pencairan).') + `
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Objek</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td>${esc(who[r.user_id] || '-')}</td><td>${esc(r.action)}</td><td>${esc(r.entity || '')} ${r.entity_id ?? ''}</td><td class="small"><code>${esc(r.detail ? JSON.stringify(r.detail) : '')}</code></td></tr>`).join('')}
    </tbody></table></div>`;
}
