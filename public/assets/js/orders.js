// Pesanan pembeli: instruksi pembayaran, unggah bukti, batal, riwayat
import {
  sb, $, $$, esc, rupiah, fmtDate, duration, toast, errText, renderNav, requireIdentity, loadSettings,
  uploadFile, imgUrl, badge, ORDER_STATUS, copyText, confirmDialog, waLink
} from './core.js';

let profile, settings = {}, timer;
const STEPS = [['waiting_payment', 'Bayar'], ['waiting_verification', 'Verifikasi'], ['paid', 'Lunas'], ['ready_pickup', 'Siap diambil'], ['completed', 'Selesai']];

(async () => {
  await renderNav('orders');
  profile = await requireIdentity();
  if (!profile) return;
  try { settings = await loadSettings(); } catch {}
  await sb.rpc('expire_orders');
  await loadList();
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (id) showDetail(id);
})();

async function loadList() {
  const box = $('#list');
  const { data, error } = await sb.rpc('my_orders', { p_actor: profile.id });
  if (error) { box.innerHTML = `<div class="empty">${esc(errText(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = '<div class="empty"><strong>Belum ada pesanan</strong><a href="index.html">Lihat katalog</a></div>'; return; }
  box.innerHTML = `<h2>Riwayat pesanan</h2>` + data.map((o) => `<div class="list-item">
      <div class="grow"><h4>${esc(o.code)}</h4>
        <div class="meta">${fmtDate(o.created_at)} · ${o.order_items.map((i) => esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')}</div>
        <div style="margin-top:5px">${badge(ORDER_STATUS, o.status)}</div></div>
      <div style="text-align:right"><strong>${rupiah(o.total)}</strong><br><button class="btn btn-ghost btn-sm" data-id="${o.id}" style="margin-top:6px">Detail</button></div>
    </div>`).join('');
  $$('[data-id]', box).forEach((b) => (b.onclick = () => showDetail(Number(b.dataset.id))));
}

async function showDetail(id) {
  clearInterval(timer);
  const box = $('#detail');
  const { data: o, error } = await sb.rpc('my_order_detail', { p_actor: profile.id, p_order_id: id });
  if (error || !o) { box.innerHTML = ''; if (error) toast(errText(error), 'error'); return; }
  history.replaceState(null, '', '?id=' + id);
  const pm = o.payment_snapshot || {};
  const stepIdx = STEPS.findIndex(([k]) => k === o.status);
  const payable = ['waiting_payment', 'waiting_verification'].includes(o.status);
  let proofUrl = '';
  if (o.proof_path) { const { data: s } = await sb.storage.from('payment-proofs').createSignedUrl(o.proof_path, 600); proofUrl = s?.signedUrl || ''; }
  const wa = settings.admin_whatsapp;
  box.innerHTML = `<div class="panel order-card" style="margin-bottom:14px">
    <div class="order-head"><div><h2>${esc(o.code)}</h2><div class="small muted">Dibuat ${fmtDate(o.created_at)}</div></div>${badge(ORDER_STATUS, o.status)}</div>
    ${['cancelled', 'expired'].includes(o.status) ? '' : `<ol class="timeline">${STEPS.map(([k, l], i) => `<li class="${i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}">${l}</li>`).join('')}</ol>`}
    ${o.admin_note ? `<div class="notice ${o.status === 'waiting_payment' && o.proof_path ? 'warn' : ''}">Catatan admin: ${esc(o.admin_note)}</div>` : ''}
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead><tbody>
      ${o.order_items.map((i) => `<tr><td>${esc(i.code || '')} ${esc(i.name)}${i.flash_item_id ? ' <span class="badge warn">Flash</span>' : ''}<div class="small muted">Penjual: ${esc(i.seller_name || '-')}</div></td>
        <td class="num">${i.normal_price > i.price ? `<del class="muted small">${rupiah(i.normal_price)}</del> ` : ''}${rupiah(i.price)}</td><td class="num">${i.qty}</td><td class="num">${rupiah(i.price * i.qty)}</td></tr>`).join('')}
      <tr><td colspan="3">Subtotal</td><td class="num">${rupiah(o.subtotal)}</td></tr>
      ${o.admin_fee ? `<tr><td colspan="3">Biaya admin</td><td class="num">${rupiah(o.admin_fee)}</td></tr>` : ''}
      ${o.unique_code ? `<tr><td colspan="3">Kode unik transfer</td><td class="num">${rupiah(o.unique_code)}</td></tr>` : ''}
      <tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${rupiah(o.total)}</strong></td></tr>
    </tbody></table></div>
    ${payable ? `<div class="pay-box">
        <div class="small" style="color:#a5e9d4;font-weight:800;text-transform:uppercase;letter-spacing:.1em">${esc(pm.name || 'Pembayaran')}</div>
        <div class="amount">${rupiah(o.total)} <button class="copy-btn" type="button" data-copy="${o.total}">Salin nominal</button>
          <small>${o.unique_code ? 'Transfer TEPAT sampai 3 digit terakhir agar mudah diverifikasi' : 'Bayar sesuai total'}</small></div>
        ${o.status === 'waiting_payment' ? `<div style="margin-top:8px">Batas bayar: <span class="countdown-pill" id="deadline">…</span></div>` : ''}
        ${pm.type === 'qris' ? (pm.qris_image ? `<img class="qris" src="${esc(imgUrl(pm.qris_image, 'site-assets'))}" alt="QRIS">` : '<div class="acct">QR belum diunggah admin. Hubungi admin.</div>')
          : `<div class="acct"><div class="small muted">${esc(pm.bank_name || '')} a.n. ${esc(pm.account_holder || '')}</div><strong>${esc(pm.account_no || '')}</strong> <button class="copy-btn" type="button" data-copy="${esc(pm.account_no || '')}">Salin</button></div>`}
        ${pm.instructions ? `<p class="small" style="color:#d5e4ea;margin:10px 0 0">${esc(pm.instructions)}</p>` : ''}
      </div>
      <div class="panel" style="padding:14px">
        <h3>${o.proof_path ? 'Bukti bayar terkirim' : 'Unggah bukti bayar'}</h3>
        ${proofUrl ? `<a href="${esc(proofUrl)}" target="_blank" rel="noopener"><img src="${esc(proofUrl)}" alt="Bukti bayar" style="max-height:220px;border-radius:10px;border:1px solid var(--line)"></a>` : ''}
        ${o.status === 'waiting_payment' ? `<div class="btn-row" style="margin-top:10px"><input type="file" id="proof" accept="image/*,application/pdf" aria-label="File bukti bayar"><button class="btn btn-primary" type="button" id="send-proof">Kirim bukti</button></div>`
          : '<p class="small muted" style="margin:6px 0 0">Admin sedang memverifikasi pembayaran Anda.</p>'}
      </div>` : ''}
    ${['paid', 'ready_pickup'].includes(o.status) ? `<div class="notice">📦 ${esc(settings.pickup_info || 'Admin akan menghubungi Anda.')}</div>` : ''}
    <div class="btn-row">
      ${o.status === 'waiting_payment' ? '<button class="btn btn-ghost" type="button" id="cancel">Batalkan pesanan</button>' : ''}
      ${wa ? `<a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="${waLink(wa, `Halo admin, saya ${profile.name} ingin konfirmasi pesanan ${o.code} senilai ${rupiah(o.total)}.`)}">Hubungi admin (WhatsApp)</a>` : ''}
    </div></div>`;
  $$('[data-copy]', box).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, b)));
  if (o.status === 'waiting_payment') {
    const el = $('#deadline');
    const tick = () => {
      const ms = Date.parse(o.expires_at) - Date.now();
      el.textContent = ms > 0 ? duration(ms) : 'Waktu habis';
      if (ms <= 0) { clearInterval(timer); sb.rpc('expire_orders').then(() => { loadList(); showDetail(id); }); }
    };
    tick(); timer = setInterval(tick, 1000);
  }
  $('#send-proof')?.addEventListener('click', async (e) => {
    const f = $('#proof').files[0];
    if (!f) return toast('Pilih file bukti bayar dulu', 'error');
    e.target.disabled = true;
    try {
      const path = await uploadFile('payment-proofs', f, { folder: profile.id, compress: f.type !== 'application/pdf' });
      const { error: e2 } = await sb.rpc('submit_payment_proof', { p_actor: profile.id, p_order_id: o.id, p_path: path });
      if (e2) throw e2;
      toast('Bukti bayar terkirim. Admin akan memverifikasi.', 'ok');
      await loadList(); showDetail(o.id);
    } catch (err) { toast(errText(err), 'error'); e.target.disabled = false; }
  });
  $('#cancel')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Batalkan pesanan ini? Barang akan kembali tersedia untuk pembeli lain.', { danger: true, ok: 'Batalkan' }))) return;
    const { error: e2 } = await sb.rpc('cancel_my_order', { p_actor: profile.id, p_order_id: o.id });
    if (e2) return toast(errText(e2), 'error');
    toast('Pesanan dibatalkan', 'ok');
    await loadList(); showDetail(o.id);
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
