-- ============================================================================
-- Compassion Market — pembaruan tampilan (aman dijalankan ulang)
-- Untuk project Supabase yang sudah menjalankan seed sebelumnya.
-- ============================================================================

-- Toggle animasi penjual & pembeli di toko 3D (Admin -> Pengaturan -> Tampilan)
insert into public.settings (key, value) values ('enable_3d_people', '1')
on conflict (key) do nothing;

-- Nomor rekening kini hanya tampil setelah checkout; perbarui teks bawaan
-- (hanya jika admin belum mengubahnya).
update public.settings
set value = 'Pilih QRIS atau transfer bank saat checkout. Nomor rekening/QR dan nominal pasti (dengan kode unik) muncul di halaman Pesanan Saya.'
where key = 'payment_intro'
  and value = 'Bayar lewat QRIS atau transfer ke salah satu rekening berikut, lalu unggah bukti bayar di halaman Pesanan Saya.';
