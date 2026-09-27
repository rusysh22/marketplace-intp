# Compassion Market — Marketplace Preloved Karyawan Interport

Marketplace barang bekas karyawan yang **self service**: karyawan mendaftarkan barangnya sendiri, admin cukup
memverifikasi, pembeli checkout dan membayar via **QRIS / transfer bank**, stok dan flash sale diatur admin.
Dilengkapi **toko 3D (Three.js)** yang terinspirasi desain toko Interport.

| Lapisan | Teknologi |
|---|---|
| Database | Supabase Postgres (+ Row Level Security) |
| Login karyawan | Supabase Auth (email + password) |
| Foto barang & bukti bayar | Supabase Storage (kompatibel S3) |
| Logika bisnis | Fungsi Postgres (RPC), dipanggil dari `supabase-js` |
| Frontend | HTML + CSS + JavaScript statis (tanpa build), Three.js untuk 3D |

Tidak perlu server sendiri: folder `public/` cukup di-hosting sebagai situs statis (Netlify, Vercel,
Cloudflare Pages, GitHub Pages, atau di-embed seperti katalog lama).

---

## Alur bisnis

```
 KARYAWAN (penjual)            ADMIN MARKETPLACE                   KARYAWAN (pembeli)
 ──────────────────            ─────────────────                   ──────────────────
 1. Isi form jual              2. Verifikasi barang
    (bisa >1 barang,              - koreksi jenis/harga/stok
    foto, kondisi %,              - Setujui → tayang di katalog
    ukuran, deskripsi)            - Tolak + alasan → penjual revisi
         │                                 │
         ▼                                 ▼
   status: pending ───────────────► status: published ───────► 3. Tambah ke keranjang
                                                                   & checkout (QRIS/Bank)
                                                                        │ stok dikunci
                                                                        ▼
                               5. Verifikasi bukti bayar ◄────── 4. Unggah bukti bayar
                                  - valid → Lunas                   (batas waktu X jam,
                                  - tolak → pembeli unggah ulang     lewat → otomatis batal
                                  6. Siap diambil → Selesai          & stok kembali)
                                  7. Pencairan ke penjual
                                     (dicatat no. referensi transfer)
```

Padanan istilah ERP (D365 / Odoo) supaya mudah dipetakan:

| Di aplikasi ini | Padanan ERP |
|---|---|
| Jenis barang, Metode pembayaran, Pengaturan | Master data / parameter |
| Pengajuan barang → Verifikasi | Approval workflow (mirip vendor/item approval) |
| Kartu stok (`stock_movements`) | Inventory transaction / stock ledger: saldo awal, keluar karena penjualan, kembali karena batal, penyesuaian (stock opname) |
| Pesanan + kode unik transfer | Sales order + payment matching (rekonsiliasi mutasi bank) |
| Pencairan penjual | Vendor payment / payout (dengan opsi komisi %) |
| Audit log | Database log / change tracking |

---

## Fitur

**Katalog (index.html)**
- Data dinamis dari database; desain, warna, kartu produk, label *OUT OF STOCK*, cetak label harga A4,
  tampilan grid/list, gulir otomatis (mode TV), latar pelangi, dan footer voucher dari katalog lama tetap ada
  — semua bisa dinyalakan/dimatikan admin.
- Filter jenis barang, pencarian (nama/kode/penjual), urutan (harga, nama, terbaru).
- Flash sale dengan hitung mundur (mulai dalam / berakhir dalam) dan harga otomatis mengikuti jadwal.
- Keranjang + checkout (QRIS / transfer), detail barang dengan galeri foto.
- **Toko 3D**: ruangan isometrik (green wall + logo, bar counter & stool, rak baju, meja tengah, rak mainan,
  pantry + kulkas, lampu gantung, tanaman). Setiap area = satu/lebih jenis barang; jumlah barang yang
  "dipajang" mengikuti stok tersedia. Klik area → katalog terfilter. Bisa diputar, di-zoom, dan disembunyikan.

**Jual barang (sell.html)** — form multi-barang (nama, jenis dari master data, ukuran dengan saran per jenis,
kondisi baru/preloved + slider %, harga jual, harga normal/coret, stok, deskripsi, catatan minus, hingga 5 foto
yang otomatis dikompres), daftar "Barang saya" (status, alasan ditolak, revisi, tarik), "Penjualan saya"
(status & pencairan), serta profil + rekening pencairan.

**Pesanan saya (orders.html)** — instruksi bayar (QR / rekening + tombol salin), total dengan kode unik,
hitung mundur batas bayar, unggah bukti (gambar/PDF), batalkan, status timeline.

**Admin (admin.html)** — Dashboard, Verifikasi barang, Pesanan (verifikasi bukti bayar, siap diambil, selesai,
batal), Produk & stok (edit, input barang titipan, penyesuaian stok dengan keterangan, kartu stok, tandai
pilihan ★), Flash sale (jadwal + pilih barang + diskon cepat % + kuota), Pencairan penjual, Jenis barang,
Metode pembayaran (unggah QRIS), Pengaturan, Pengguna (jadikan admin / nonaktifkan), Audit log,
Export CSV (pesanan, produk, pencairan).

Tambahan yang saya sesuaikan dari kebutuhan awal:
- **Stok dikunci saat checkout** dan otomatis kembali jika pesanan kedaluwarsa/dibatalkan (mencegah barang
  1 pcs terjual ke 2 orang).
- **Kode unik 3 digit** untuk transfer bank agar pembayaran mudah dicocokkan dengan mutasi rekening.
- **Pencairan ke penjual** + komisi opsional, karena uang pembeli masuk ke rekening marketplace dulu.
- **Kartu stok & audit log** otomatis untuk jejak audit.
- **Batasan domain email** (mis. hanya `@interport.co.id`) dan buka/tutup pendaftaran.
- 31 barang dari katalog statis lama sudah diimpor sebagai data awal (kode CM-xx-x, foto tetap memakai URL
  Supabase lama). Penomoran form baru melanjutkan dari **CM-26**.

---

## Cara pasang (± 15 menit)

### 1. Buat project Supabase
1. Masuk ke <https://supabase.com> → **New project** (region Singapore disarankan).
2. Buka **SQL Editor**, lalu jalankan isi file berikut **berurutan** (copy–paste → Run):
   1. `supabase/migrations/20260927000001_schema.sql` — tabel
   2. `supabase/migrations/20260927000002_logic.sql` — fungsi bisnis, trigger kartu stok, view katalog
   3. `supabase/migrations/20260927000003_security.sql` — RLS + bucket Storage (`product-photos`, `payment-proofs`, `site-assets`)
   4. `supabase/migrations/20260927000004_seed.sql` — pengaturan awal, jenis barang, rekening, 31 barang lama

   Atau dengan Supabase CLI: `supabase link --project-ref <ref>` lalu `supabase db push`.

### 2. Atur Auth
**Authentication → Providers → Email**: aktif. Jika ingin tanpa verifikasi email, matikan
*Confirm email*. **Authentication → URL Configuration → Site URL**: isi alamat situs Anda.

### 3. Hubungkan frontend
Isi `public/config.js` dengan **Project URL** dan **anon public key** dari
**Project Settings → API**. Anon key memang aman di frontend karena semua data dijaga RLS.
**Jangan pernah** memasang `service_role` key di frontend.

### 4. Hosting folder `public/`
Unggah isi folder `public/` ke hosting statis mana pun, contoh:
- **Netlify / Cloudflare Pages / Vercel**: drag & drop folder `public`, atau set *publish directory* = `public`.
- **GitHub Pages**: publish folder `public`.
- Tetap ingin di-embed di halaman lain: `<iframe src="https://situs-anda/index.html" style="width:100%;height:100vh;border:0"></iframe>`

### 5. Jadikan akun Anda admin
Daftar lewat halaman **Masuk / Daftar**, lalu jalankan sekali di SQL Editor:
```sql
update public.profiles set role = 'admin' where email = 'email-anda@interport.co.id';
```
Admin berikutnya cukup diangkat dari menu **Admin → Pengguna**.

### 6. Lengkapi master data di menu Admin
- **Metode pembayaran** → edit *QRIS* → unggah gambar QR → centang Aktif. Cek rekening BCA/Mandiri.
- **Pengaturan** → nomor WhatsApp admin, info pengambilan barang, batas bayar, biaya admin, komisi,
  domain email kantor, tampilan (3D, efek latar, gulir otomatis), footer voucher.
- **Jenis barang** → tambah/ubah jenis, pilihan ukuran, dan area pajangannya di toko 3D.

### 7. (Opsional) Kedaluwarsa pesanan terjadwal
Pesanan lewat batas bayar sudah otomatis ditutup setiap ada checkout / admin membuka dashboard. Agar tetap
berjalan walau sepi, aktifkan ekstensi **pg_cron** (Database → Extensions) lalu:
```sql
select cron.schedule('cm-expire-orders', '*/10 * * * *', 'select public.expire_orders()');
```

---

## Struktur folder

```
public/                     ← situs statis (ini yang di-hosting)
  index.html                  katalog + toko 3D + keranjang
  sell.html                   form jual & dashboard penjual
  orders.html                 pesanan & pembayaran pembeli
  admin.html                  panel admin
  login.html                  masuk / daftar
  config.js                   URL + anon key Supabase
  assets/css/                 app.css (komponen), market.css (katalog), pages.css
  assets/js/                  core.js, catalog.js, store3d.js, sell.js, orders.js, admin.js, login.js
supabase/migrations/        ← skema, fungsi, RLS/Storage, data awal
dev/                        ← HANYA untuk pengembangan & pengujian lokal
```

## Fungsi database (RPC) utama

| Fungsi | Dipakai oleh | Kegunaan |
|---|---|---|
| `submit_items(items, note)` | Penjual | Daftarkan banyak barang sekaligus, kode otomatis CM-xx-n |
| `update_my_item`, `withdraw_my_item` | Penjual | Revisi (kembali ke antrean) / tarik barang |
| `create_order(items, payment_method_id, note)` | Pembeli | Checkout atomik: kunci stok, harga flash sale, biaya admin, kode unik |
| `submit_payment_proof`, `cancel_my_order` | Pembeli | Unggah bukti / batalkan |
| `admin_review_product` | Admin | Setujui (dengan koreksi) / tolak |
| `admin_verify_payment`, `admin_set_order_status` | Admin | Verifikasi bayar, siap diambil, selesai, batal |
| `admin_adjust_stock` | Admin | Stock opname dengan keterangan |
| `admin_mark_payout` | Admin | Catat pencairan ke penjual |
| `expire_orders()` | Otomatis | Tutup pesanan lewat batas bayar & kembalikan stok |

---

## Pengembangan & pengujian lokal (opsional)

Folder `dev/` berisi "Supabase mini" untuk menguji tanpa project Supabase: Postgres lokal + PostgREST +
tiruan Auth & Storage (RLS dan kebijakan storage tetap dijalankan oleh Postgres).

Prasyarat: Node 22+, PostgreSQL 15+, binary [PostgREST](https://github.com/PostgREST/postgrest/releases),
dan Playwright + Chromium untuk uji browser.

```bash
npm install
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/market
./dev/reset-db.sh            # buat ulang DB lokal + semua migrasi
npm run dev                  # http://localhost:54321
npm test                     # reset DB → uji alur SQL → uji E2E browser (screenshot di dev/.screens/)
```

Uji E2E mencakup: daftar akun, jual 2 barang + upload foto, verifikasi admin (koreksi harga), buat flash sale,
checkout dengan harga flash + kode unik, stok terkunci, unggah bukti bayar, verifikasi pembayaran, pesanan
selesai, pencairan ke penjual, dan tampilan mobile.
