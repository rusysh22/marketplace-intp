# Compassion Market — Marketplace Preloved Karyawan Interport

Marketplace barang bekas karyawan yang **self service**: karyawan mendaftarkan barangnya sendiri, admin cukup
memverifikasi, pembeli checkout dan membayar via **QRIS / transfer bank**, stok dan flash sale diatur admin.
Dilengkapi **toko 3D (Three.js)** yang terinspirasi desain toko Interport.

| Lapisan | Teknologi |
|---|---|
| Database | Supabase Postgres (+ Row Level Security) |
| Identitas karyawan | **Tanpa login** — pilih nama sendiri dari daftar, tanpa password/verifikasi (lihat catatan keamanan di bawah) |
| Login admin | Supabase Auth (email + password) — satu-satunya yang benar-benar login |
| Foto barang & bukti bayar | Supabase Storage (kompatibel S3) |
| Logika bisnis | Fungsi Postgres (RPC), dipanggil dari `supabase-js` |
| Frontend | HTML + CSS + JavaScript statis (tanpa build), Three.js untuk 3D, font Plus Jakarta Sans |

Tidak perlu server sendiri: folder `public/` cukup di-hosting sebagai situs statis (Netlify, Vercel,
Cloudflare Pages, GitHub Pages, atau di-embed seperti katalog lama).

> ⚠️ **Catatan keamanan (disengaja, keputusan produk):** karyawan tidak login — mereka cukup **mengetik
> email kantor `@interport.co.id` miliknya sendiri** di halaman "Pilih identitas" (dicocokkan ke database),
> tanpa password atau verifikasi apa pun (bukan OTP, bukan magic link).
> Artinya siapa pun yang tahu/menebak email karyawan lain bisa mengaku jadi orang itu (submit barang,
> checkout, isi rekening pencairan atas nama orang lain). Ini diterima karena barang **baru tayang
> setelah admin verifikasi**, dan bukti bayar **baru dianggap lunas setelah admin verifikasi** — jadi
> tidak ada aksi berdampak langsung yang lolos tanpa mata admin. Hanya **admin** yang tetap wajib login
> asli (email + password via Supabase Auth) untuk masuk ke panel Admin.

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
- Data dinamis dari database; desain, warna, kartu produk, flash sale, tampilan grid/list, latar pelangi, dan
  footer voucher dari katalog lama tetap ada — semua bisa dinyalakan/dimatikan admin.
- **Barang terjual disembunyikan secara default.** Pengunjung bisa mencentang "Tampilkan yang terjual (n)"
  untuk melihatnya (tampil dengan label *OUT OF STOCK*). Jumlah per jenis barang di filter ikut menyesuaikan.
- Filter jenis barang (dengan jumlah), pencarian (nama/kode/penjual), urutan (rekomendasi, harga, nama, terbaru).
- Detail barang (galeri foto, catatan kondisi, tanya via WhatsApp) terbuka dari foto atau tombol "Detail barang".
- **Bagikan link barang** (tombol 🔗 di kartu maupun di detail): di HP dengan dukungan Web Share, membuka menu
  bagikan bawaan (WhatsApp, dll.); kalau tidak, tautan disalin ke clipboard. Tautannya (`index.html?p=<kode>`)
  otomatis membuka detail barang itu saat dibuka siapa pun — cocok ditempel di grup WhatsApp/chat.
- Ringkasan metode pembayaran (logo QRIS/bank). Nomor rekening/QR & nominal pasti sengaja baru tampil setelah
  checkout, supaya setiap transfer terhubung ke satu pesanan (kode unik). Di halaman Pesanan Saya, gambar QRIS
  bisa diunduh (tombol "⬇ Unduh QRIS") untuk dipindai dari perangkat/aplikasi lain — admin juga bisa mengunduh
  ulang gambar QRIS yang sudah diunggah dari Admin → Metode pembayaran.
- Cetak label harga A4 (8 label/halaman) — tombol hanya muncul untuk admin yang sedang login, mencetak barang
  yang sedang tampil (bisa disaring dulu lewat filter/pencarian).
- **Toko 3D**: ruangan isometrik (green wall + logo Interport, bar counter & stool, rak baju, meja tengah, rak
  mainan, pantry + kulkas, meja kasir, lampu gantung, tanaman). Setiap area = satu/lebih jenis barang; isi rak
  mengikuti stok tersedia. Klik area → katalog terfilter; klik filter kategori → kamera terbang ke area itu.
  - **Animasi penjual & pembeli dengan bubble percakapan**: pembeli masuk lewat pintu kaca, menuju rak yang
    punya barang tersedia, mengomentari barang **asli** dari database (nama & kondisi), lalu membayar di kasir
    (staf menyebut total harganya) dan pulang membawa tas belanja. Penjual datang membawa kardus, menitipkan
    barang di kasir, dan staf memverifikasinya. Maksimal 3 pengunjung sekaligus; mati otomatis jika pengguna
    memilih *reduce motion*, dan bisa dimatikan di Admin → Pengaturan → Tampilan.
  - **Logo** diambil dari `logo_url` di Pengaturan (default: logo resmi di interport.co.id), dipasang pada papan
    2,4 × 1,0 m dengan bantalan putih agar proporsional. Logo ditampilkan sebagai elemen `<img>` yang
    diproyeksikan 3D (CSS3DRenderer), jadi tidak memerlukan izin CORS dari server gambar. Jika gambar gagal
    dimuat, papan menampilkan teks `logo_text`.

**Pilih identitas (login.html)** — karyawan mengetik email kantor `@interport.co.id` miliknya lengkap lalu
Enter, sistem mencari kecocokan persis dan menampilkan konfirmasi nama sebelum lanjut (tanpa password,
tanpa daftar nama yang bisa dilihat publik). Admin punya jalur terpisah "Saya admin, masuk dengan password"
(email + password Supabase Auth asli).

**Jual barang (sell.html)** — form multi-barang (nama, jenis dari master data, ukuran dengan saran per jenis,
kondisi baru/preloved + slider %, harga jual, harga normal/coret, stok, deskripsi, catatan minus, hingga 5 foto
yang otomatis dikompres), daftar "Barang saya" (status, alasan ditolak, revisi, tarik), "Penjualan saya"
(status & pencairan), serta profil + rekening pencairan.

**Pesanan saya (orders.html)** — instruksi bayar (QR / rekening + tombol salin), total dengan kode unik,
hitung mundur batas bayar, unggah bukti (gambar/PDF), batalkan, status timeline.

**Admin (admin.html)** — Dashboard, Verifikasi barang, Pesanan (verifikasi bukti bayar, siap diambil, selesai,
batal), Produk & stok (edit, input barang titipan, penyesuaian stok dengan keterangan, kartu stok, tandai
pilihan ★), Flash sale (jadwal + pilih barang + diskon cepat % + kuota), Pencairan penjual, Jenis barang,
Metode pembayaran (unggah QRIS), Pengaturan, **Pengguna** (tambah karyawan baru, jadikan admin / nonaktifkan),
Audit log, Export CSV (pesanan, pencairan).

**Export / import Excel di Produk & stok** — untuk update data massal tanpa edit satu per satu:
1. **⬇ Export Excel** mengunduh barang sesuai filter aktif ke `.xlsx` berisi sheet *Produk* (header beku,
   autofilter, format rupiah, dropdown Jenis barang / Kondisi / Status / Pilihan dari master data, kolom kunci
   ID/Kode/Terakhir diubah berwarna abu-abu), *Master* (sumber dropdown), dan *Petunjuk*.
2. Edit di Excel: ubah harga, stok, status, deskripsi, dsb. Tambah barang baru di baris kosong dengan ID
   dikosongkan (wajib: nama, jenis, harga jual; kode dibuat otomatis).
3. **⬆ Import Excel** menampilkan **pratinjau** sebelum menyimpan: jumlah barang diubah / baru / tidak
   berubah, daftar perubahan per baris (nilai lama → baru), error per baris (jenis tidak ada di master data,
   angka negatif, status tidak dikenal, dll.), serta peringatan jika barang diubah orang lain setelah export.
4. **Terapkan** menjalankan `admin_import_products` dalam satu transaksi: satu baris error = tidak ada yang
   tersimpan. Perubahan stok tercatat di kartu stok dengan keterangan "Import Excel: <nama file>", dan ringkasan
   import masuk audit log. Menghapus baris dari file **tidak** menghapus barang (ubah status jadi Disembunyikan).

Tambahan yang saya sesuaikan dari kebutuhan awal:
- **Stok dikunci saat checkout** dan otomatis kembali jika pesanan kedaluwarsa/dibatalkan (mencegah barang
  1 pcs terjual ke 2 orang).
- **Kode unik 3 digit** untuk transfer bank agar pembayaran mudah dicocokkan dengan mutasi rekening.
- **Pencairan ke penjual** + komisi opsional, karena uang pembeli masuk ke rekening marketplace dulu.
- **Kartu stok & audit log** otomatis untuk jejak audit.
- **Karyawan tanpa login** — dikelola admin lewat menu Pengguna (tambah nama, tidak perlu password); admin
  tetap wajib akun Supabase Auth asli.
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
   5. `supabase/migrations/20260927000005_donation.sql` — kolom nominal donasi per barang
   6. `supabase/migrations/20260927000007_admin_link_by_email.sql` — tautkan akun admin baru ke
      profil karyawan yang sudah ada (kalau emailnya sama), lihat langkah 2 di bawah
   7. `supabase/migrations/20260927000008_fix_overloaded_functions.sql` — bersihkan fungsi versi lama (overload)
   8. `supabase/migrations/20260927000009_edit_published_item.sql` — penjual boleh mengubah barang yang sudah tayang
   9. `supabase/migrations/20260927000010_hide_donation_public.sql` — nominal donasi hanya untuk admin
   10. `supabase/migrations/20260927000011_offline_order.sql` — pencatatan penjualan offline
   11. `supabase/migrations/20260928000007_ui_update.sql` — pengaturan animasi 3D & teks pembayaran
   12. `supabase/migrations/20260928000008_admin_product_import.sql` — import/update massal barang dari Excel

   Atau dengan Supabase CLI: `supabase link --project-ref <ref>` lalu `supabase db push`.

### 2. Buat akun admin pertama
**Mengubah `role` jadi `'admin'` di tabel `profiles` saja TIDAK CUKUP** — itu cuma menentukan hak akses,
bukan bikin login-nya ada. Login admin wajib akun Supabase Auth asli (email + password), dan itu pun dibuat
manual lewat dashboard (bukan lewat halaman aplikasi):
1. **Authentication → Users → Add user** → isi email & password admin pertama Anda.
   - Kalau email itu **sudah ada** sebagai profil karyawan (mis. dari import `Data User.xlsx`), migrasi #7
     di atas otomatis **menautkan** akun baru ini ke profil karyawan tersebut — nama/departemen/role yang
     sudah Anda isi (termasuk kalau sudah pernah di-`update role='admin'`) tidak hilang.
   - Boleh matikan **Authentication → Providers → Email → Confirm email** juga supaya reset password lewat
     email tidak perlu klik konfirmasi.
2. **Authentication → URL Configuration → Site URL**: isi alamat situs Anda.
3. Setelah user dibuat, lanjut ke langkah 5 di bawah untuk memastikan/menjadikannya admin.

### 3. Hubungkan frontend
Isi `public/config.js` dengan **Project URL** dan **anon public key** dari
**Project Settings → API**. Anon key memang aman di frontend karena semua data dijaga RLS.
**Jangan pernah** memasang `service_role` key di frontend.

### 4. Hosting folder `public/`
Unggah isi folder `public/` ke hosting statis mana pun, contoh:
- **Netlify / Cloudflare Pages / Vercel**: drag & drop folder `public`, atau set *publish directory* = `public`.
- **GitHub Pages**: publish folder `public`.
- Tetap ingin di-embed di halaman lain: `<iframe src="https://situs-anda/index.html" style="width:100%;height:100vh;border:0"></iframe>`

### 5. Jadikan akun itu admin
Jalankan sekali di SQL Editor (pakai email yang Anda isi di langkah 2):
```sql
update public.profiles set role = 'admin' where email = 'email-admin-anda@interport.co.id';
```
Masuk ke `admin.html` → tab **"Saya admin, masuk dengan password"** di halaman Pilih identitas. Admin
berikutnya: buat user lewat dashboard seperti langkah 2, lalu jadikan admin dari menu **Admin → Pengguna**
(tombol "Jadikan admin" hanya muncul untuk akun yang sudah punya login Supabase Auth).

### 6. Daftarkan karyawan
233 karyawan Interport dari `Data User.xlsx` sudah otomatis masuk lewat migrasi #6 di atas. Untuk karyawan
baru/susulan, tambah lewat **Admin → Pengguna → + Tambah karyawan** (nama wajib + email/departemen/WA
opsional), atau `insert` langsung ke `public.profiles` lewat SQL Editor untuk impor massal lagi.

Karyawan masuk dengan mengetik **email kantor `@interport.co.id` miliknya lengkap** lalu Enter di halaman
"Pilih identitas" — dicocokkan persis (case-insensitive) ke kolom `email`, bukan memilih dari daftar
(sengaja begitu supaya seluruh daftar 233 nama tidak bisa ditarik borongan lewat API).

### 7. Lengkapi master data di menu Admin
- **Metode pembayaran** → edit *QRIS* → unggah gambar QR → centang Aktif. Cek rekening BCA/Mandiri.
- **Pengaturan** → nomor WhatsApp admin, info pengambilan barang, batas bayar, biaya admin, komisi,
  tampilan (3D, efek latar, gulir otomatis), footer voucher.
  Gulir otomatis (mode layar TV) **mati secara default**; nyalakan hanya jika katalog ditayangkan di layar TV.
  Jika seed lama (dengan gulir otomatis menyala) sudah terlanjur dijalankan, matikan dengan:
  `update public.settings set value = '0' where key = 'auto_scroll';`
- **Jenis barang** → tambah/ubah jenis, pilihan ukuran, dan area pajangannya di toko 3D.

### 8. (Opsional) Kedaluwarsa pesanan terjadwal
Pesanan lewat batas bayar sudah otomatis ditutup setiap ada checkout / admin membuka dashboard. Agar tetap
berjalan walau sepi, aktifkan ekstensi **pg_cron** (Database → Extensions) lalu:
```sql
select cron.schedule('cm-expire-orders', '*/10 * * * *', 'select public.expire_orders()');
```

### 9. (Opsional) Kartu bagikan — foto/harga muncul saat tautan barang dibagikan ke chat
Karena situs ini statis (tidak ada server-side rendering), WhatsApp/Telegram/dll tidak bisa membaca meta
Open Graph dari halaman katalog secara langsung. Fungsinya dibantu Edge Function `share` yang menyajikan
halaman HTML berisi meta `og:*` (foto, judul, harga, nama toko), lalu meneruskan pengguna sungguhan ke
halaman katalog aslinya. Tautan yang dibagikan tetap memakai **domain situs Anda sendiri** (bukan
`*.supabase.co`) lewat rewrite/proxy di hosting — supaya rapi dan konsisten dengan brand.

1. Deploy fungsinya (butuh [Supabase CLI](https://supabase.com/docs/guides/cli), login dengan akun yang
   punya akses ke project — minimal role **Developer** di organisasi Supabase-nya):
   ```sh
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase functions deploy share --no-verify-jwt
   ```
   `--no-verify-jwt` wajib — crawler chat app memanggil URL ini tanpa login. `<PROJECT_REF>` dilihat dari
   URL dashboard project Anda.
2. Proxy path `/share` di hosting situs Anda ke Edge Function itu, supaya tautan yang dibagikan berupa
   `https://domain-anda.com/share?p=<kode>` (bukan URL mentah Supabase):
   - **Vercel** — sudah disiapkan file [`vercel.json`](./vercel.json) di root repo; isi `<PROJECT_REF>` di
     dalamnya dengan project ref Anda sebelum deploy. Kalau *Root Directory* project Vercel Anda diset ke
     `public/` (bukan root repo), pindahkan `vercel.json` ke dalam folder `public/`.
   - **Netlify** — tambahkan di `public/_redirects`:
     `/share  https://<PROJECT_REF>.supabase.co/functions/v1/share  200`
   - **Nginx** — tambahkan di server block:
     ```nginx
     location = /share {
       proxy_pass https://<PROJECT_REF>.supabase.co/functions/v1/share$is_args$args;
     }
     ```
3. Di menu **Admin → Pengaturan → Kartu bagikan (share card)**: isi **URL situs katalog** (domain situs
   Anda sendiri, mis. `https://market.contoh.com`, tanpa `/` di akhir) dan centang untuk mengaktifkan.
4. Setelah aktif, tombol "Bagikan" akan membagikan tautan `https://market.contoh.com/share?p=<kode-barang>`
   alih-alih tautan katalog langsung. Kalau belum diisi/diaktifkan, fitur bagikan tetap bekerja seperti
   biasa (tautan katalog biasa, tanpa kartu pratinjau).

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
supabase/functions/share/   ← Edge Function kartu bagikan (Open Graph), opsional
dev/                        ← HANYA untuk pengembangan & pengujian lokal
```

## Fungsi database (RPC) utama

Karyawan tidak punya sesi Supabase Auth, jadi hampir semua fungsi menerima `p_actor` (id profil yang dipilih
di halaman "Pilih identitas") sebagai pengganti `auth.uid()` — fungsi sendiri yang memvalidasi profil itu
aktif, bukan sistem autentikasi.

| Fungsi | Dipakai oleh | Kegunaan |
|---|---|---|
| `find_employee_by_email(email)` | Halaman Pilih identitas | Cari SATU identitas berdasarkan email penuh (tidak ada endpoint list-semua) |
| `my_profile(p_actor)`, `update_my_profile(p_actor, data)` | Karyawan | Lihat/ubah profil & rekening sendiri |
| `submit_items(p_actor, items, note)` | Penjual | Daftarkan banyak barang sekaligus, kode otomatis CM-xx-n |
| `my_products(p_actor)` | Penjual | Daftar "Barang saya" |
| `update_my_item`, `withdraw_my_item` | Penjual | Revisi (kembali ke antrean) / tarik barang |
| `my_sales(p_actor)` | Penjual | Daftar "Penjualan saya" |
| `create_order(p_actor, items, payment_method_id, note)` | Pembeli | Checkout atomik: kunci stok, harga flash sale, biaya admin, kode unik |
| `my_orders(p_actor)`, `my_order_detail(p_actor, order_id)` | Pembeli | Riwayat & detail pesanan |
| `submit_payment_proof`, `cancel_my_order` | Pembeli | Unggah bukti / batalkan |
| `admin_create_employee(name, email, emp_id, department, phone)` | Admin | Tambah karyawan baru (tanpa password) |
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

> ⚠️ `dev/test-flow.sql` dan `dev/e2e.mjs` masih ditulis untuk alur login lama (daftar akun dengan
> password) dan belum diperbarui mengikuti model "pilih identitas tanpa login" di atas — perlu disesuaikan
> sebelum dipakai lagi.
