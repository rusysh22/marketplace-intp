// ============================================================================
// Self service penjual: daftarkan banyak barang, pantau status, penjualan, profil
// ============================================================================
import {
  sb, $, $$, esc, rupiah, num, fmtDate, toast, errText, modal, confirmDialog, renderNav, requireIdentity,
  loadSettings, uploadFile, imgUrl, PLACEHOLDER, badge, PRODUCT_STATUS, ORDER_STATUS
} from './core.js';

let profile, settings = {}, categories = [];
const MAX_ITEMS = () => Number(settings.max_items_per_submission || 10);
const MAX_PHOTOS = () => Number(settings.max_photos_per_item || 5);
const MIN_COND = () => Number(settings.min_condition_pct || 0);

(async () => {
  await renderNav('sell');
  profile = await requireIdentity();
  if (!profile) return;
  try {
    settings = await loadSettings();
    const { data, error } = await sb.from('categories').select('*').eq('active', true).order('sort');
    if (error) throw error;
    categories = data || [];
  } catch (e) { toast(errText(e), 'error'); }

  $$('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  const initial = location.hash.replace('#', '');
  showTab(['new', 'mine', 'sales', 'profile'].includes(initial) ? initial : 'new');
  window.addEventListener('hashchange', () => {
    const t = location.hash.replace('#', '');
    if (['new', 'mine', 'sales', 'profile'].includes(t)) showTab(t);
  });

  addItem();
  $('#add-item').onclick = () => addItem();
  $('#sell-form').onsubmit = submit;
  initProfile();
})();

function showTab(tab) {
  $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  if (tab === 'mine') loadMine();
  if (tab === 'sales') loadSales();
}

// ---------- form multi-barang ----------
function addItem() {
  const items = $$('#items .item-card');
  if (items.length >= MAX_ITEMS()) return toast(`Maksimal ${MAX_ITEMS()} barang per pengajuan`, 'error');
  const node = $('#item-tpl').content.firstElementChild.cloneNode(true);
  const catSel = $('[name=category_id]', node);
  catSel.innerHTML = '<option value="">— pilih jenis —</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.icon || '')} ${esc(c.name)}</option>`).join('');
  const sizeInput = $('[name=size]', node), dl = $('datalist', node);
  const dlId = 'sizes-' + Math.random().toString(36).slice(2, 8);
  dl.id = dlId; sizeInput.setAttribute('list', dlId);
  catSel.onchange = () => {
    const c = categories.find((x) => String(x.id) === catSel.value);
    const opts = String(c?.size_options || '').split(',').map((s) => s.trim()).filter(Boolean);
    dl.innerHTML = opts.map((o) => `<option value="${esc(o)}">`).join('');
    sizeInput.placeholder = opts.length ? 'Pilih / ketik: ' + opts.slice(0, 5).join(', ') + (opts.length > 5 ? '…' : '') : 'Opsional';
  };
  const range = $('[name=condition_pct]', node), out = $('output', node), hint = $('.cond-hint', node);
  const condLabel = (v) => v >= 95 ? 'Seperti baru' : v >= 80 ? 'Sangat baik, pemakaian ringan' : v >= 60 ? 'Baik, ada bekas pemakaian' : v >= 40 ? 'Cukup, ada minus terlihat' : 'Banyak minus / perlu perbaikan';
  const upd = () => { out.textContent = range.value + '%'; hint.textContent = condLabel(Number(range.value)); };
  range.oninput = upd; upd();
  $$('[name=price],[name=original_price],[name=donation_amount]', node).forEach((i) => i.addEventListener('input', () => {
    const v = num(i.value); i.value = v == null || Number.isNaN(v) ? '' : v.toLocaleString('id-ID');
  }));
  // foto
  node._files = [];
  const input = $('.photo-input', node), drop = $('.photo-drop', node);
  $('.photo-hint', node).textContent = `Maks. ${MAX_PHOTOS()} foto, otomatis dikompres. Foto pertama jadi foto utama.`;
  const addFiles = (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (node._files.length >= MAX_PHOTOS()) { toast(`Maksimal ${MAX_PHOTOS()} foto per barang`, 'error'); break; }
      node._files.push(f);
    }
    renderPreviews(node);
  };
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  $('.remove-item', node).onclick = () => { node.remove(); renumber(); };
  $('#items').appendChild(node);
  renumber();
  if (items.length) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPreviews(node) {
  const box = $('.photo-previews', node);
  (node._urls || []).forEach((u) => URL.revokeObjectURL(u));
  node._urls = node._files.map((f) => URL.createObjectURL(f));
  box.innerHTML = node._urls.map((u, i) => `<figure><img src="${u}" alt="Foto ${i + 1}"><button type="button" data-i="${i}" aria-label="Hapus foto">×</button></figure>`).join('');
  $$('button', box).forEach((b) => (b.onclick = () => { node._files.splice(Number(b.dataset.i), 1); renderPreviews(node); }));
}

function renumber() {
  const cards = $$('#items .item-card');
  cards.forEach((c, i) => { $('.n', c).textContent = i + 1; $('.remove-item', c).hidden = cards.length === 1; });
  $('#item-count').textContent = `${cards.length} barang dalam pengajuan ini (maks. ${MAX_ITEMS()})`;
  $('#add-item').disabled = cards.length >= MAX_ITEMS();
}

function collect() {
  const cards = $$('#items .item-card');
  return cards.map((c, i) => {
    const g = (n) => $(`[name=${n}]`, c).value.trim();
    const item = {
      name: g('name'), category_id: Number(g('category_id')) || null, size: g('size'), item_condition: g('item_condition'),
      condition_pct: Number(g('condition_pct')), price: num(g('price')), original_price: num(g('original_price')),
      donation_amount: num(g('donation_amount')) || 0,
      stock: Number(g('stock')) || 1, summary: g('summary'), condition_note: g('condition_note')
    };
    const err = !item.name ? 'nama wajib diisi' : !item.category_id ? 'pilih jenis barang' : item.price == null || item.price < 0 ? 'isi harga jual'
      : !item.summary ? 'isi deskripsi singkat' : !c._files.length ? 'tambahkan minimal 1 foto'
      : item.condition_pct < MIN_COND() ? `kondisi minimal ${MIN_COND()}%` : item.original_price != null && item.original_price < item.price ? 'harga normal harus ≥ harga jual'
      : item.donation_amount > item.price ? 'nominal donasi tidak boleh lebih dari harga jual' : null;
    return { item, files: c._files, err: err && `Barang #${i + 1}: ${err}`, card: c };
  });
}

async function submit(e) {
  e.preventDefault();
  const rows = collect();
  const bad = rows.find((r) => r.err);
  if (bad) { toast(bad.err, 'error'); bad.card.scrollIntoView({ behavior: 'smooth' }); return; }
  if (!$('#agree').checked) return toast('Centang pernyataan kepemilikan barang terlebih dahulu', 'error');
  const btn = $('#submit-btn'), status = $('#submit-status');
  btn.disabled = true;
  try {
    const total = rows.reduce((a, r) => a + r.files.length, 0);
    let done = 0;
    for (const r of rows) {
      r.item.images = [];
      for (const f of r.files) {
        status.textContent = `Mengunggah foto ${++done}/${total}…`;
        r.item.images.push(await uploadFile('product-photos', f, { folder: profile.id }));
      }
    }
    status.textContent = 'Menyimpan…';
    const { data, error } = await sb.rpc('submit_items', { p_actor: profile.id, p_items: rows.map((r) => r.item), p_note: $('[name=note]').value.trim() || null });
    if (error) throw error;
    modal({
      title: 'Pengajuan terkirim 🎉',
      body: `<p>Barang Anda sudah masuk antrean verifikasi admin dengan kode:</p>
        <p style="font-size:18px;font-weight:900;color:var(--navy)">${data.codes.map(esc).join(', ')}</p>
        <p class="small muted">Tempelkan kode ini pada barang saat diserahkan ke admin. Status bisa dipantau di tab "Barang saya".</p>`,
      actions: [{ label: 'Lihat barang saya', cls: 'btn-primary', onClick: () => showTab('mine') }]
    });
    $('#items').innerHTML = ''; $('#sell-form').reset(); addItem();
  } catch (err) {
    toast(errText(err), 'error');
  } finally {
    btn.disabled = false; status.textContent = '';
  }
}

// ---------- barang saya ----------
async function loadMine() {
  const box = $('#mine');
  const { data, error } = await sb.rpc('my_products', { p_actor: profile.id });
  if (error) { box.innerHTML = `<div class="empty">${esc(errText(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = '<div class="empty"><strong>Belum ada barang</strong>Daftarkan barang pertama Anda di tab "Daftarkan barang".</div>'; return; }
  box.innerHTML = `<h2>Barang saya</h2><p class="small muted" style="margin:0 0 8px">${data.length} barang</p>` + data.map((p) => {
    const img = (p.product_images || []).slice().sort((a, b) => a.sort - b.sort)[0]?.path;
    return `<div class="list-item" data-id="${p.id}">
      <img class="thumb" src="${esc(img ? imgUrl(img) : PLACEHOLDER)}" alt="">
      <div class="grow"><h4>${esc(p.name)}</h4>
        <div class="meta">${esc(p.code || '')} · ${esc(p.category_name || '')} · ${rupiah(p.price)} · stok ${p.stock} · ${fmtDate(p.created_at, false)}</div>
        <div style="margin-top:5px">${badge(PRODUCT_STATUS, p.status)} ${p.status === 'published' && p.stock === 0 ? '<span class="badge dark">Terjual</span>' : ''} ${p.donation_amount > 0 ? `<span class="badge ok">💝 Donasi ${rupiah(p.donation_amount)}</span>` : ''}</div>
        ${p.status === 'rejected' && p.reject_reason ? `<div class="notice danger small" style="margin-top:6px">Alasan ditolak: ${esc(p.reject_reason)}</div>` : ''}
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" data-edit>Ubah</button>
        ${p.status !== 'hidden' ? `<button class="btn btn-ghost btn-sm" data-withdraw>${['pending', 'rejected'].includes(p.status) ? 'Hapus' : 'Tarik'}</button>` : ''}
      </div></div>`;
  }).join('');
  $$('.list-item', box).forEach((row) => {
    const p = data.find((x) => x.id === Number(row.dataset.id));
    $('[data-edit]', row)?.addEventListener('click', () => editItem(p));
    $('[data-withdraw]', row)?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Tarik "${p.name}" dari marketplace?`, { danger: true }))) return;
      const { error: e2 } = await sb.rpc('withdraw_my_item', { p_actor: profile.id, p_id: p.id });
      if (e2) return toast(errText(e2), 'error');
      toast('Barang ditarik', 'ok'); loadMine();
    });
  });
}

function editItem(p) {
  const m = modal({
    title: `Ubah ${p.code || 'barang'}`, wide: true,
    body: `<div class="grid-form">
      <label class="field span-2"><span>Nama barang</span><input type="text" name="name" value="${esc(p.name)}"></label>
      <label class="field"><span>Jenis</span><select name="category_id">${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Ukuran</span><input type="text" name="size" value="${esc(p.size || '')}"></label>
      <label class="field"><span>Kondisi (%)</span><input type="number" name="condition_pct" min="0" max="100" value="${p.condition_pct ?? 80}"></label>
      <label class="field"><span>Harga jual</span><input type="text" inputmode="numeric" name="price" value="${p.price.toLocaleString('id-ID')}"></label>
      <label class="field"><span>Harga normal</span><input type="text" inputmode="numeric" name="original_price" value="${p.original_price ? p.original_price.toLocaleString('id-ID') : ''}"></label>
      <label class="field"><span>Stok</span><input type="number" name="stock" min="1" value="${p.stock}"></label>
      <label class="field"><span>Nominal donasi</span><input type="text" inputmode="numeric" name="donation_amount" value="${(p.donation_amount || 0).toLocaleString('id-ID')}"></label>
      <label class="field span-all"><span>Deskripsi</span><textarea name="summary">${esc(p.summary || '')}</textarea></label>
      <label class="field span-all"><span>Catatan kondisi</span><textarea name="condition_note">${esc(p.condition_note || '')}</textarea></label>
      <label class="field span-all"><span>Ganti foto (opsional — mengganti semua foto lama)</span><input type="file" name="photos" accept="image/*" multiple></label>
    </div><p class="small muted">${p.status === 'published' ? '⚠️ Barang ini sedang tayang di katalog — begitu disimpan, barang akan turun dari katalog dan menunggu verifikasi ulang admin sebelum tayang lagi.' : 'Setelah disimpan, barang kembali ke antrean verifikasi admin.'}</p>`,
    actions: [{ label: 'Batal' }, { label: 'Simpan & ajukan ulang', cls: 'btn-primary', onClick: async ({ body }) => {
      const v = (n) => $(`[name=${n}]`, body).value;
      const patch = { name: v('name'), category_id: Number(v('category_id')), size: v('size'), condition_pct: Number(v('condition_pct')),
        price: num(v('price')) || 0, original_price: num(v('original_price')), donation_amount: num(v('donation_amount')) || 0,
        stock: Number(v('stock')), summary: v('summary'), condition_note: v('condition_note') };
      const files = $('[name=photos]', body).files;
      if (files.length) {
        if (files.length > MAX_PHOTOS()) throw new Error(`Maksimal ${MAX_PHOTOS()} foto`);
        patch.images = [];
        for (const f of files) patch.images.push(await uploadFile('product-photos', f, { folder: profile.id }));
      }
      const { error } = await sb.rpc('update_my_item', { p_actor: profile.id, p_id: p.id, p_data: patch });
      if (error) throw error;
      toast('Perubahan disimpan, menunggu verifikasi ulang', 'ok');
      loadMine();
    } }]
  });
  $$('[name=price],[name=original_price],[name=donation_amount]', m.body).forEach((i) => i.addEventListener('input', () => {
    const v = num(i.value); i.value = v == null || Number.isNaN(v) ? '' : v.toLocaleString('id-ID');
  }));
  return m;
}

// ---------- penjualan ----------
async function loadSales() {
  const box = $('#sales');
  const { data, error } = await sb.rpc('my_sales', { p_actor: profile.id });
  if (error) { box.innerHTML = `<div class="empty">${esc(errText(error))}</div>`; return; }
  const paidStates = ['paid', 'ready_pickup', 'completed'];
  const earned = data.filter((r) => paidStates.includes(r.order_status)).reduce((a, r) => a + r.price * r.qty, 0);
  const paidOut = data.filter((r) => r.payout_status === 'paid').reduce((a, r) => a + Number(r.payout_amount || 0), 0);
  box.innerHTML = `<h2>Penjualan saya</h2>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="v">${data.filter((r) => paidStates.includes(r.order_status)).length}</div><div class="l">Barang terjual (lunas)</div></div>
      <div class="stat"><div class="v">${rupiah(earned)}</div><div class="l">Nilai penjualan</div></div>
      <div class="stat"><div class="v">${rupiah(paidOut)}</div><div class="l">Sudah ditransfer ke Anda</div></div>
    </div>
    ${!profile.bank_account ? '<div class="notice warn" style="margin-bottom:12px">Lengkapi rekening pencairan di tab "Profil & rekening" agar admin bisa mentransfer hasil penjualan.</div>' : ''}
    ${data.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Barang</th><th>Pesanan</th><th>Pembeli</th><th class="num">Nilai</th><th>Status pesanan</th><th>Pencairan</th></tr></thead><tbody>
      ${data.map((r) => `<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td>${esc(r.code || '')} ${esc(r.name)} ×${r.qty}</td><td>${esc(r.order_code)}</td><td>${esc(r.buyer_name || '')}</td>
        <td class="num">${rupiah(r.price * r.qty)}</td><td>${badge(ORDER_STATUS, r.order_status)}</td>
        <td>${r.payout_status === 'paid' ? `<span class="badge ok">Ditransfer ${rupiah(r.payout_amount)}</span><div class="small muted">${esc(r.payout_ref || '')}</div>` : '<span class="badge">Belum</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><strong>Belum ada penjualan</strong>Penjualan akan muncul setelah ada pembeli.</div>'}`;
}

// ---------- profil ----------
function initProfile() {
  const f = $('#profile-form');
  ['name', 'emp_id', 'department', 'phone', 'bank_name', 'bank_account', 'bank_holder'].forEach((k) => { f.elements[k].value = profile[k] || ''; });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const patch = Object.fromEntries(['name', 'emp_id', 'department', 'phone', 'bank_name', 'bank_account', 'bank_holder'].map((k) => [k, f.elements[k].value.trim() || null]));
    if (!patch.name) return toast('Nama wajib diisi', 'error');
    const { data, error } = await sb.rpc('update_my_profile', { p_actor: profile.id, p_data: patch });
    if (error) return toast(errText(error), 'error');
    profile = data;
    toast('Profil disimpan', 'ok');
  };
}
