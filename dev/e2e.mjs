// ============================================================================
// Uji end-to-end di browser (lokal). Prasyarat: `npm run dev` sedang berjalan
// dan database lokal baru di-reset (dev/reset-db.sh).
// Jalankan: node dev/e2e.mjs   (screenshot disimpan di dev/.screens/)
// ============================================================================
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:54321';
const OUT = new URL('./.screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/market' });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const openPages = [];
async function newPage(name, { with3d = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  openPages.push([name, page]);
  // Toko 3D dirender CPU di sandbox (tanpa GPU): hanya tab tamu yang menampilkannya,
  // supaya tab lain tidak berebut CPU dan pemeriksaan "elemen stabil" tidak timeout.
  await page.addInitScript((show) => { if (localStorage.getItem('cm_3d_hidden') === null) localStorage.setItem('cm_3d_hidden', show ? '0' : '1'); }, with3d);
  // CDN -> node_modules lokal; gambar eksternal -> placeholder (lingkungan uji tanpa internet)
  await page.route('https://cdn.jsdelivr.net/**', async (r) => {
    const res = await fetch(r.request().url().replace('https://cdn.jsdelivr.net', BASE + '/cdn'));
    r.fulfill({ status: res.status, contentType: 'text/javascript', body: Buffer.from(await res.arrayBuffer()) });
  });
  await page.route(/(supabase\.co|interport\.co\.id|wikimedia\.org|canva\.com)/, (r) => {
    const n = decodeURIComponent(r.request().url().split('/').pop()).replace(/\.\w+$/, '').slice(0, 22).replace(/[&<]/g, '');
    const hue = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    r.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue},45%,72%)"/><text x="200" y="160" font-size="22" text-anchor="middle" font-family="Arial" fill="#123">${n}</text></svg>` });
  });
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
  return page;
}
const shot = async (page, n) => {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page.screenshot({ path: OUT + n + '.png', fullPage: false });
};
const step = (m) => console.log('•', m);
const expectToast = async (page, re) => { await page.locator('.toast', { hasText: re }).first().waitFor({ timeout: 15000 }); };

// Admin: akun Supabase Auth (di produksi dibuat lewat Dashboard -> Authentication)
async function createAdmin(email, name) {
  const r = await fetch(BASE + '/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'rahasia123', data: { name } }) });
  if (!r.ok) throw new Error('Gagal membuat akun admin: ' + (await r.text()));
  await db.query("update profiles set role = 'admin' where email = $1", [email]);
}
async function adminLogin(page, email) {
  await page.goto(BASE + '/login.html?next=admin.html');
  await page.fill('#form-admin [name=email]', email);
  await page.fill('#form-admin [name=password]', 'rahasia123');
  await page.click('#form-admin button[type=submit]');
  await page.waitForURL((u) => u.pathname.endsWith('/admin.html'));
}
// Karyawan: dibuat admin lewat menu Pengguna, lalu "pilih identitas" tanpa password
async function addEmployee(admin, name, dept, email) {
  await admin.goto(BASE + '/admin.html#users');
  await admin.click('[data-add-employee]');
  const m = admin.locator('.modal');
  await m.locator('[name=name]').fill(name);
  await m.locator('[name=department]').fill(dept);
  await m.locator('[name=email]').fill(email);
  await m.locator('[name=phone]').fill('081234567890');
  await m.locator('button', { hasText: 'Tambah' }).click();
  await expectToast(admin, /Karyawan ditambahkan/);
}
async function pickIdentity(page, email) {
  await page.goto(BASE + '/login.html');
  await page.fill('#q', email);
  await page.locator('#form-identity button[type=submit]').click();
  await page.click('#confirm-identity');
  await page.waitForURL((u) => u.pathname.endsWith('/index.html'));
}

try {
  // ---------- admin ----------
  const admin = await newPage('admin');
  await createAdmin('admin@interport.co.id', 'Admin Market');
  await adminLogin(admin, 'admin@interport.co.id');
  await addEmployee(admin, 'Sari Penjual', 'Finance', 'sari.penjual.e2e@interport.co.id');
  await addEmployee(admin, 'Budi Pembeli', 'Ops', 'budi.pembeli.e2e@interport.co.id');
  step('admin login & mendaftarkan 2 karyawan');

  // ---------- regresi: sesi admin tanpa identitas karyawan tidak boleh looping ----------
  // (login.html sempat menganggap sesi admin cukup untuk lolos ke halaman yang
  // sebenarnya butuh identitas karyawan, sehingga login.html <-> orders.html
  // saling redirect tanpa henti)
  {
    const navs = [];
    const onNav = (f) => { if (f === admin.mainFrame()) navs.push(f.url()); };
    admin.on('framenavigated', onNav);
    await admin.goto(BASE + '/orders.html');
    await admin.waitForTimeout(4000);
    admin.off('framenavigated', onNav);
    if (navs.length > 6) throw new Error(`Redirect looping login.html <-> orders.html terdeteksi (${navs.length} navigasi): ${navs.slice(0, 10).join(' -> ')}`);
    if (!admin.url().includes('login.html')) throw new Error('Sesi admin tanpa identitas karyawan seharusnya berhenti di halaman "Pilih identitas", dapat: ' + admin.url());
    await admin.waitForSelector('#form-identity');
  }
  step('sesi admin tanpa identitas karyawan berhenti di halaman pilih identitas (tidak looping)');

  // ---------- katalog awal ----------
  const guest = await newPage('guest', { with3d: true });
  await guest.goto(BASE + '/');
  await guest.waitForSelector('.card');
  const cards = await guest.locator('.card').count();
  if (cards !== 15 || await guest.locator('.card.sold').count()) throw new Error('Default hanya 15 barang tersedia (terjual disembunyikan), dapat ' + cards);
  await guest.check('#show-sold');
  if (await guest.locator('.card').count() !== 31) throw new Error('Toggle "Tampilkan yang terjual" harus menampilkan 31 barang');
  await guest.uncheck('#show-sold');
  if (await guest.locator('#print-all').isVisible()) throw new Error('Tombol cetak label hanya untuk admin');
  // animasi 3D: percepat waktu sampai muncul bubble percakapan
  await guest.evaluate(() => { window.__s3dTimeScale = 30; });
  await guest.locator('.s3d-bubble').first().waitFor({ timeout: 90000 });
  await guest.evaluate(() => { window.__s3dTimeScale = 1; });
  await guest.click('#toggle-3d');                      // sembunyikan 3D setelah diuji
  if (!(await guest.locator('.s3d-logo').count())) throw new Error('Logo 3D tidak dipasang');
  await guest.waitForTimeout(3000);
  await shot(guest, '01-katalog');
  step(`katalog: ${cards} barang tersedia (terjual disembunyikan, bisa ditampilkan), animasi 3D & bubble berjalan`);
  // gulir otomatis (mode layar TV) dimatikan agar klik uji stabil
  await db.query("update settings set value = '0' where key in ('auto_scroll', 'theme_effects')");

  // ---------- penjual ----------
  const seller = await newPage('seller');
  await pickIdentity(seller, 'sari.penjual.e2e@interport.co.id');
  await seller.goto(BASE + '/sell.html');
  const png = await guest.screenshot({ clip: { x: 300, y: 300, width: 400, height: 300 } });
  const fillItem = async (i, it) => {
    const card = seller.locator('#items .item-card').nth(i);
    await card.locator('[name=name]').fill(it.name);
    await card.locator('[name=category_id]').selectOption({ label: it.cat });
    await card.locator('[name=size]').fill(it.size);
    await card.locator('[name=condition_pct]').fill(String(it.cond));
    await card.locator('[name=price]').fill(String(it.price));
    await card.locator('[name=original_price]').fill(String(it.orig));
    await card.locator('[name=summary]').fill(it.summary);
    await card.locator('.photo-input').setInputFiles([{ name: 'foto1.png', mimeType: 'image/png', buffer: png }, { name: 'foto2.png', mimeType: 'image/png', buffer: png }]);
  };
  await fillItem(0, { name: 'Jaket Parka Uniqlo', cat: '👕 Pakaian', size: 'L', cond: 85, price: 175000, orig: 450000, summary: 'Jaket parka hijau army, hangat.' });
  await seller.click('#add-item');
  await fillItem(1, { name: 'Headset Sony WH-1000XM3', cat: '🎧 Elektronik', size: '', cond: 90, price: 1200000, orig: 2500000, summary: 'Noise cancelling, lengkap dengan case.' });
  await seller.check('#agree');
  await shot(seller, '02-form-jual');
  await seller.click('#submit-btn');
  await seller.locator('.modal', { hasText: 'Pengajuan terkirim' }).waitFor({ timeout: 20000 });
  await shot(seller, '03-pengajuan-terkirim');
  step('penjual mengajukan 2 barang (upload 4 foto ke storage)');

  // ---------- admin verifikasi ----------
  await admin.goto(BASE + '/admin.html#review');
  await admin.waitForSelector('.review-card');
  await admin.waitForFunction(() => [...document.querySelectorAll('.review-card img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 })
    .catch(() => { throw new Error('Foto di halaman verifikasi gagal dimuat'); });
  await shot(admin, '04-admin-verifikasi');
  const first = admin.locator('.review-card').first();
  await first.locator('[name=price]').fill('160000');
  await first.locator('[data-approve]').click();
  await expectToast(admin, /ditayangkan/);
  await admin.locator('.review-card').first().locator('[data-approve]').click();
  await admin.waitForFunction(() => !document.querySelector('.review-card'));
  step('admin menyetujui 2 barang (harga jaket dikoreksi)');

  // flash sale lewat UI
  await admin.goto(BASE + '/admin.html#flash');
  await admin.click('[data-new]');
  const fm = admin.locator('.modal');
  await fm.locator('[name=name]').fill('Flash Jumat');
  const now = new Date(Date.now() - 60e3), later = new Date(Date.now() + 3 * 3600e3);
  const loc = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  await fm.locator('[name=start_at]').fill(loc(now));
  await fm.locator('[name=end_at]').fill(loc(later));
  await fm.locator('button', { hasText: 'Simpan' }).click();
  await expectToast(admin, /Flash sale disimpan/);
  await admin.locator('[data-add]').first().click();
  const am = admin.locator('.modal');
  await am.locator('[data-q]').fill('sony');
  await am.locator('tbody tr:not([hidden])', { hasText: 'Sony' }).locator('input[type=checkbox]').check();
  await am.locator('button', { hasText: 'Tambahkan' }).click();
  await expectToast(admin, /ditambahkan/);
  await shot(admin, '05-admin-flash-sale');
  step('flash sale dibuat dan headset dimasukkan (diskon 20%)');

  // ---------- pembeli ----------
  const buyer = await newPage('buyer');
  await pickIdentity(buyer, 'budi.pembeli.e2e@interport.co.id');
  await buyer.waitForSelector('.card');
  await buyer.fill('#search', 'sony');
  const sony = buyer.locator('.card', { hasText: 'Sony' });
  await sony.locator('.flash.sale-active').waitFor();
  await sony.locator('.buy-btn').click();
  // keranjang harus langsung muncul setelah klik "+ Keranjang"
  await buyer.locator('.drawer .cart-line.just-added', { hasText: 'Sony' }).waitFor({ timeout: 5000 });
  await buyer.click('.drawer [data-continue]');
  if (await buyer.locator('.drawer').count()) throw new Error('"Lanjut belanja" harus menutup keranjang');
  await buyer.fill('#search', 'parka');
  await buyer.locator('.card', { hasText: 'Parka' }).locator('.buy-btn').click();
  await buyer.locator('.drawer .cart-line.just-added', { hasText: 'Parka' }).waitFor({ timeout: 5000 });
  if (await buyer.locator('.drawer .cart-line').count() !== 2) throw new Error('Keranjang harus berisi 2 barang');
  await shot(buyer, '07-keranjang');
  step('klik "+ Keranjang" langsung membuka keranjang (barang baru ditandai, "Lanjut belanja" menutup)');
  await buyer.click('.drawer [data-checkout]');
  await buyer.locator('.modal', { hasText: 'Checkout' }).waitFor();
  await buyer.locator('.pay-option', { hasText: 'BCA' }).click();
  await shot(buyer, '08-checkout');
  await buyer.locator('.modal button', { hasText: 'Buat pesanan' }).click();
  await buyer.waitForURL(/orders\.html\?id=/);
  await buyer.waitForSelector('.pay-box');
  await shot(buyer, '09-instruksi-bayar');
  const total = await buyer.locator('.pay-box .amount').innerText();
  if (!/1\.120\.\d{3}/.test(total.replace(/\s/g, ''))) console.warn('  (cek total: ' + total + ')');
  await buyer.setInputFiles('#proof', { name: 'bukti.png', mimeType: 'image/png', buffer: png });
  await buyer.click('#send-proof');
  await expectToast(buyer, /Bukti bayar terkirim/);
  step('pembeli checkout (flash price + kode unik) & upload bukti bayar');

  // stok berkurang di katalog
  await guest.reload();
  await guest.waitForSelector('.card');
  await guest.fill('#search', 'sony');
  if (await guest.locator('.card', { hasText: 'Sony' }).count()) throw new Error('Barang yang stoknya habis seharusnya tersembunyi');
  await guest.check('#show-sold');
  await guest.locator('.card.sold', { hasText: 'Sony' }).waitFor();
  step('stok barang terkunci (tampil OUT OF STOCK untuk pengunjung)');

  // ---------- admin verifikasi bayar ----------
  await admin.goto(BASE + '/admin.html#orders');
  await admin.waitForSelector('[data-open]');
  await admin.locator('[data-open]').first().click();
  await admin.locator('.modal img[alt="Bukti bayar"]').waitFor();
  await shot(admin, '10-admin-verifikasi-bayar');
  await admin.locator('.modal button', { hasText: 'Pembayaran valid' }).click();
  await expectToast(admin, /diverifikasi/);
  await admin.click('[data-f=paid]');
  await admin.locator('[data-open]').first().click();
  await admin.locator('.modal button', { hasText: 'Sudah diserahkan' }).click();
  await expectToast(admin, /selesai/);
  step('admin verifikasi pembayaran & tandai diserahkan');

  await admin.goto(BASE + '/admin.html#payout');
  await admin.waitForSelector('[data-pay]');
  await shot(admin, '11-admin-pencairan');
  admin.once('dialog', () => {});
  await admin.locator('[data-pay]').first().click();
  await admin.locator('#pd-input').fill('TRF-BCA-0001');
  await admin.locator('.modal button', { hasText: 'Simpan' }).click();
  await expectToast(admin, /dicairkan/);
  step('admin mencatat pencairan ke penjual');

  await admin.goto(BASE + '/admin.html#dashboard');
  await admin.waitForSelector('.stat');
  await shot(admin, '12-admin-dashboard');
  await admin.goto(BASE + '/admin.html#products');
  await admin.waitForSelector('[data-card]');
  await admin.fill('[data-q]', 'sony'); await admin.press('[data-q]', 'Enter');
  await admin.waitForTimeout(800);
  await admin.locator('[data-card]').first().click();
  await admin.locator('.modal', { hasText: 'Kartu stok' }).waitFor();
  await shot(admin, '13-kartu-stok');
  await admin.goto(BASE + '/admin.html#settings');
  await admin.waitForSelector('#settings-form');
  await shot(admin, '14-admin-pengaturan');

  // ---------- export / import Excel (update massal produk) ----------
  {
    const ExcelJS = (await import('exceljs')).default;
    await admin.goto(BASE + '/admin.html#products');
    await admin.reload();                                   // bersihkan modal & filter dari langkah sebelumnya
    await admin.waitForSelector('[data-xlsx-export]');
    const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('[data-xlsx-export]')]);
    const xlsxPath = OUT + 'export-produk.xlsx';
    await dl.saveAs(xlsxPath);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const ws = wb.getWorksheet('Produk');
    if (!ws || !wb.getWorksheet('Master') || !wb.getWorksheet('Petunjuk')) throw new Error('Sheet Produk/Master/Petunjuk tidak lengkap');
    const head = {}; ws.getRow(1).eachCell((c, n) => { head[c.value] = n; });
    const rowOf = (name) => { let r = null; ws.eachRow((row, n) => { if (row.getCell(head['Nama barang']).value === name) r = row; }); return r; };
    const jaket = rowOf('Jaket Parka Uniqlo');
    if (!jaket) throw new Error('Barang tidak ada di file export');
    if (!ws.getCell(2, head['Jenis barang']).dataValidation?.formulae?.[0]?.startsWith('Master!')) throw new Error('Dropdown jenis barang tidak terpasang');
    jaket.getCell(head['Harga jual']).value = 155000;
    jaket.getCell(head['Status']).value = 'Disembunyikan';
    const hirono = rowOf('Figur Pop Mart Hirono');
    hirono.getCell(head['Stok']).value = 3;
    const newRow = ws.getRow(ws.actualRowCount + 1);
    newRow.getCell(head['Nama barang']).value = 'Topi Baseball Uniqlo';
    newRow.getCell(head['Jenis barang']).value = 'Tas & Aksesori';
    newRow.getCell(head['Harga jual']).value = 50000;
    newRow.getCell(head['Stok']).value = 2;
    newRow.getCell(head['Status']).value = 'Tayang';
    newRow.commit();
    // 1) file dengan error -> pratinjau menolak, tidak ada tombol terapkan
    const bad = new ExcelJS.Workbook(); await bad.xlsx.readFile(xlsxPath);
    const bws = bad.getWorksheet('Produk'); bws.getCell(2, head['Jenis barang']).value = 'Kategori Ngawur'; bws.getCell(3, head['Stok']).value = -4;
    await bad.xlsx.writeFile(OUT + 'import-error.xlsx');
    await admin.setInputFiles('[data-xlsx-import]', OUT + 'import-error.xlsx');
    await admin.locator('.modal', { hasText: 'Pratinjau import' }).locator('.notice.danger').waitFor();
    if (await admin.locator('.modal button', { hasText: 'Terapkan' }).count()) throw new Error('Import berisi error tidak boleh bisa diterapkan');
    await shot(admin, '14a-import-error');
    await admin.locator('.modal button', { hasText: 'Batal' }).click();
    // 2) file valid -> pratinjau -> terapkan
    await wb.xlsx.writeFile(OUT + 'import-ok.xlsx');
    await admin.setInputFiles('[data-xlsx-import]', OUT + 'import-ok.xlsx');
    const pm = admin.locator('.modal', { hasText: 'Pratinjau import' });
    await pm.locator('td', { hasText: 'Rp160.000' }).first().waitFor();
    await shot(admin, '14b-import-pratinjau');
    await pm.locator('button', { hasText: 'Terapkan 3 perubahan' }).click();
    await expectToast(admin, /Import selesai: 2 diubah, 1 baru, 1 penyesuaian stok/);
    const chk = (await db.query(`select name, price, status, stock from products where name in ('Jaket Parka Uniqlo','Figur Pop Mart Hirono','Topi Baseball Uniqlo') order by name`)).rows;
    const by = Object.fromEntries(chk.map((r) => [r.name, r]));
    if (Number(by['Jaket Parka Uniqlo'].price) !== 155000 || by['Jaket Parka Uniqlo'].status !== 'hidden') throw new Error('Update harga/status via import gagal');
    if (by['Figur Pop Mart Hirono'].stock !== 3) throw new Error('Update stok via import gagal');
    if (!by['Topi Baseball Uniqlo'] || by['Topi Baseball Uniqlo'].stock !== 2) throw new Error('Barang baru via import gagal');
    const mv = (await db.query(`select m.note from stock_movements m join products p on p.id = m.product_id where p.name = 'Figur Pop Mart Hirono' order by m.id desc limit 1`)).rows[0];
    if (!/Import Excel/.test(mv?.note || '')) throw new Error('Mutasi stok import tidak tercatat di kartu stok');
    step('export Excel (3 sheet + dropdown) → import: file error ditolak, file valid diterapkan (harga, status, stok, barang baru)');
  }

  // ---------- penjual melihat penjualan ----------
  await seller.goto(BASE + '/sell.html#sales');
  await seller.locator('#sales .badge.ok', { hasText: 'Ditransfer Rp960.000' }).waitFor();
  await shot(seller, '15-penjualan-saya');
  step('penjual melihat penjualan & status pencairan');

  // mobile
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.route('https://cdn.jsdelivr.net/**', async (r) => { const res = await fetch(r.request().url().replace('https://cdn.jsdelivr.net', BASE + '/cdn')); r.fulfill({ status: res.status, contentType: 'text/javascript', body: Buffer.from(await res.arrayBuffer()) }); });
  await mobile.route(/(supabase\.co|interport\.co\.id|wikimedia\.org|canva\.com|fonts\.)/, (r) => r.abort());
  await mobile.goto(BASE + '/');
  await mobile.waitForSelector('.card');
  await mobile.waitForTimeout(3000);
  await mobile.screenshot({ path: OUT + '16-mobile.png' });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push('Halaman mobile overflow horizontal ' + overflow + 'px');

  const { rows } = await db.query("select status from orders");
  console.log('status pesanan akhir:', rows.map((r) => r.status).join(', '));
  if (errors.length) { console.log('\nERROR BROWSER:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('\n✅ E2E lulus. Screenshot di ' + OUT);
} catch (e) {
  console.error('❌ GAGAL:', e.message);
  for (const [name, pg] of openPages) await pg.screenshot({ path: OUT + `GAGAL-${name}.png` }).catch(() => {});
  if (errors.length) console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
