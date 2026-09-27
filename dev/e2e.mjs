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
async function newPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
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
async function addEmployee(admin, name, dept) {
  await admin.goto(BASE + '/admin.html#users');
  await admin.click('[data-add-employee]');
  const m = admin.locator('.modal');
  await m.locator('[name=name]').fill(name);
  await m.locator('[name=department]').fill(dept);
  await m.locator('[name=phone]').fill('081234567890');
  await m.locator('button', { hasText: 'Tambah' }).click();
  await expectToast(admin, /Karyawan ditambahkan/);
}
async function pickIdentity(page, name) {
  await page.goto(BASE + '/login.html');
  await page.fill('#q', name);
  await page.locator('#emp-list [data-id]', { hasText: name }).first().click();
  await page.waitForURL((u) => u.pathname.endsWith('/index.html'));
}

try {
  // ---------- admin ----------
  const admin = await newPage('admin');
  await createAdmin('admin@interport.co.id', 'Admin Market');
  await adminLogin(admin, 'admin@interport.co.id');
  await addEmployee(admin, 'Sari Penjual', 'Finance');
  await addEmployee(admin, 'Budi Pembeli', 'Ops');
  step('admin login & mendaftarkan 2 karyawan');

  // ---------- katalog awal ----------
  const guest = await newPage('guest');
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
  if (!(await guest.locator('.s3d-logo').count())) throw new Error('Logo 3D tidak dipasang');
  await guest.waitForTimeout(3000);
  await shot(guest, '01-katalog');
  step(`katalog: ${cards} barang tersedia (terjual disembunyikan, bisa ditampilkan), animasi 3D & bubble berjalan`);
  // gulir otomatis (mode layar TV) dimatikan agar klik uji stabil
  await db.query("update settings set value = '0' where key in ('auto_scroll', 'theme_effects')");

  // ---------- penjual ----------
  const seller = await newPage('seller');
  await pickIdentity(seller, 'Sari Penjual');
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
  await pickIdentity(buyer, 'Budi Pembeli');
  await buyer.waitForSelector('.card');
  await buyer.fill('#search', 'sony');
  const sony = buyer.locator('.card', { hasText: 'Sony' });
  await sony.locator('.flash.sale-active').waitFor();
  await sony.locator('.buy-btn').click();
  await buyer.fill('#search', 'parka');
  await buyer.locator('.card', { hasText: 'Parka' }).locator('.buy-btn').click();
  await buyer.fill('#search', '');
  await buyer.waitForTimeout(3500);
  await buyer.evaluate(() => window.scrollTo(0, 0));
  await shot(buyer, '06-katalog-flash-3d');
  await buyer.click('[data-open-cart]');
  await buyer.waitForSelector('.drawer [data-checkout]');
  await shot(buyer, '07-keranjang');
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
  if (errors.length) console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
