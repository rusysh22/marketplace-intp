-- ============================================================================
-- Compassion Market — data awal
-- Diambil dari katalog HTML statis sebelumnya. Semua bisa diubah admin nanti.
-- Aman dijalankan ulang (hanya mengisi jika belum ada).
-- ============================================================================

-- Pengaturan (menu Admin > Pengaturan)
insert into public.settings (key, value) values
  ('store_name', 'Compassion Market'),
  ('page_title', 'Katalog barang'),
  ('logo_url', 'https://interport.co.id/wp-content/uploads/2024/11/logo-interport.png'),
  ('logo_text', 'interport'),
  ('sign_text', E'Good Items\nBrighter Stories'),
  ('catalog_intro', 'Barang preloved dari rekan kerja Interport. Semua barang diverifikasi admin sebelum tayang.'),
  ('product_code_prefix', 'CM'),
  ('next_submission_no', '26'),
  ('admin_whatsapp', '6281818180823'),
  ('payment_intro', 'Pilih QRIS atau transfer bank saat checkout. Nomor rekening/QR dan nominal pasti (dengan kode unik) muncul di halaman Pesanan Saya.'),
  ('order_expiry_hours', '24'),
  ('admin_fee_type', 'flat'),
  ('admin_fee_value', '0'),
  ('use_unique_code', '1'),
  ('commission_percent', '0'),
  ('pickup_info', 'Barang diambil di area Compassion Market. Admin akan menghubungi via WhatsApp saat barang siap.'),
  ('min_condition_pct', '0'),
  ('max_items_per_submission', '10'),
  ('max_photos_per_item', '5'),
  ('enable_3d', '1'),
  ('enable_3d_people', '1'),
  ('site_url', ''),
  ('enable_share_card', '0'),
  ('theme_effects', '1'),
  ('auto_scroll', '0')
on conflict (key) do nothing;

-- Jenis barang. zone = area pajangan di toko 3D.
insert into public.categories (name, icon, zone, size_options, sort)
select * from (values
  ('Elektronik', '🎧', 'bar_counter', '', 1),
  ('Sepatu', '👟', 'table_center', '36,37,37.5,38,39,40,41,42,43,44,45', 2),
  ('Tas & Aksesori', '👜', 'rack_front', 'Kecil,Sedang,Besar,All Size', 3),
  ('Mobilitas', '🛴', 'floor_corner', '', 4),
  ('Perawatan', '🧴', 'kitchen', '', 5),
  ('Hobi & Olahraga', '🏓', 'shelf_toys', '', 6),
  ('Perlengkapan', '🧰', 'kitchen', '', 7),
  ('Voucher', '🎟️', 'sign_board', '', 8),
  ('Pakaian', '👕', 'rack_left', 'XS,S,M,L,XL,XXL', 9)
) v(name, icon, zone, size_options, sort)
where not exists (select 1 from public.categories);

-- Metode pembayaran. QRIS dinonaktifkan sampai admin mengunggah gambar QR-nya.
insert into public.payment_methods (type, name, bank_name, account_no, account_holder, logo_url, instructions, active, sort)
select * from (values
  ('qris', 'QRIS', null, null, null, null,
   'Scan QR dengan m-banking / e-wallet apa pun. Pastikan nominal sesuai total, lalu unggah bukti bayar.', false, 0),
  ('bank', 'Transfer BCA', 'BCA', '5680490424', 'Mia Rosmiati',
   'https://upload.wikimedia.org/wikipedia/commons/5/5c/Bank_Central_Asia.svg',
   'Transfer tepat sesuai total (termasuk kode unik), lalu unggah bukti transfer.', true, 1),
  ('bank', 'Transfer Mandiri', 'Mandiri', '1330010971398', 'Adinda Sharfina',
   'https://upload.wikimedia.org/wikipedia/commons/a/ad/Bank_Mandiri_logo_2016.svg',
   'Transfer tepat sesuai total (termasuk kode unik), lalu unggah bukti transfer.', true, 2)
) v(type, name, bank_name, account_no, account_holder, logo_url, instructions, active, sort)
where not exists (select 1 from public.payment_methods);

-- 31 barang dari katalog statis (Compassion_Market_Item_Cleaned_With_Brands.xlsx)
do $$
declare
  base text := 'https://jfutygknyhqfqfyhqhvy.supabase.co/storage/v1/object/public/media/compassion-market/';
  r record;
  v_pid bigint;
  i int := 0;
begin
  if exists (select 1 from public.products) then return; end if;
  perform set_config('app.stock_note', 'Impor katalog statis', true);
  for r in select * from (values
    ('CM-02-1','Monitor Philips 29 inci','Elektronik','preloved',90,'Iqbal Fahmi Faisal',null,944000,850000,0,'Monitor bezel tipis, berfungsi menurut penjual. Termasuk kabel daya dan HDMI.','Dus tidak tersedia.','Monitor%2029%20inch%20Phillips.jpeg'),
    ('CM-02-2','Headphone SteelSeries Arctis Nova 7','Elektronik','preloved',70,'Iqbal Fahmi Faisal',null,1000000,700000,1,'Headphone nirkabel dengan pilihan Bluetooth, dongle, dan kabel; mikrofon cocok untuk panggilan.','Fungsi bekerja menurut penjual; fisik menunjukkan pemakaian.','Headphone.jpeg'),
    ('CM-03-1','Nike Air Force 1 — ukuran 42','Sepatu','baru',90,'Faisal Anggari Ang','42',400000,350000,1,'Belum pernah dipakai, tetapi muncul retakan setelah lama disimpan.','Periksa bagian yang retak sebelum membeli.','Sepatu_Nike_Faisal%20Ang.jpeg'),
    ('CM-03-2','Outdoor sneakers hitam — ukuran 41','Sepatu','baru',100,'Faisal Anggari Ang','41',null,425000,0,'Sneakers outdoor warna hitam dalam kondisi baru.','Coba atau pastikan ukuran sebelum membeli.','Sepatu_Black_Weidmann_Faisal_Ang.jpeg'),
    ('CM-04-1','Waist bag Cotopaxi Allpa 1,5 L','Tas & Aksesori','preloved',80,'Linda Astriyani',null,650000,550000,1,'Tas pinggang warna-warni berkapasitas 1,5 L.','Periksa detail warna dan kompartemen pada foto.','Waistbag_Linda%20Astriyani.jpeg'),
    ('CM-04-2','Skuter listrik Segway Ninebot ES2','Mobilitas','preloved',90,'Linda Astriyani',null,4000000,3750000,1,'Jarang digunakan; terdapat bekas pemakaian dan perlu dibersihkan.','Periksa baterai serta fungsi skuter sebelum transaksi.','Skuter_Listrik_Linda%20Astriyani.jpeg'),
    ('CM-05-1','Kamera Canon D1000 + lensa','Elektronik','preloved',80,'Yohanes K Gatot Mulyono',null,2273000,1700000,1,'Kamera dan lensa tanpa dus. Kondisi lensa perlu diperhatikan.','Lensa berjamur dan tutup slot memori hilang, sesuai formulir awal.','Kamera_Kanon_Gatot.jpg'),
    ('CM-06-1','Sepatu lari Kanky pink putih','Sepatu','preloved',100,'Shafira Karamina','39',200000,175000,1,'Baru dipakai dua kali; ukuran berlabel 39 terasa lebih kecil menurut penjual.','Penjual menyarankan mencoba langsung karena ukuran terasa mendekati 37–38.','Sepatu_Kanky_PM_Shafira%20Karamina.jpeg'),
    ('CM-07-1','Nike Air Jordan Mule — ukuran 44','Sepatu','baru',100,'Sarah Selli Ardelia','44',1728000,1400000,0,'Sepatu mule warna midnight blue dalam kondisi baru.','Pastikan kecocokan ukuran sebelum membeli.','Sepatu_Nike_Biru_Sarah%20Ardelia.jpg'),
    ('CM-07-2','Adidas Runblaze M — ukuran 42⅔','Sepatu','baru',100,'Sarah Selli Ardelia','42⅔',null,800000,0,'Sneakers baru dalam kombinasi warna Carbon, Matte Silver, dan Lucid Orange.','Pastikan kecocokan ukuran sebelum membeli.','Sepatu_Adidas_hitam_Sarah%20Ardelia.jpg'),
    ('CM-08-1','New Balance navy','Sepatu','preloved',70,'Banu Windyasmoro',null,100000,50000,0,'Sepatu New Balance warna biru navy.','Ukuran belum dicantumkan; tanyakan kepada penjual.','Sepatu_NB_Banu%20Windyasmoro.jpeg'),
    ('CM-08-2','Vans motif catur hitam putih','Sepatu','preloved',60,'Banu Windyasmoro',null,100000,50000,0,'Sneakers Vans dengan motif catur hitam putih.','Ukuran belum dicantumkan; tanyakan kepada penjual.','Sepatu_Vans_Banu.jpeg'),
    ('CM-09-1','Samsung Galaxy S23 Plus 8/256 GB','Elektronik','preloved',70,'Tito Alfani',null,3395000,2500000,1,'Ponsel Phantom Black dengan boks; layar pernah diganti dan baterai cenderung boros.','Kabel serta charger tidak tersedia. Periksa layar dan daya tahan baterai.','Samsung_Galaxy_S23_Tito%20Alfani.jpeg'),
    ('CM-11-1','BaByliss AS950E Rotating Brush','Perawatan','preloved',80,'Adinda',null,598000,550000,0,'Sikat pengering berputar 650 W dengan brush keramik 40 dan 50 mm, dua tingkat panas, serta udara dingin.','Kelengkapan dan fungsi dapat diperiksa sebelum transaksi.','Babyliss_Adinda_Rachma.jpg'),
    ('CM-13-1','Skechers Go Run — ukuran 43','Sepatu','preloved',100,'Cika Mada','43',null,225000,0,'Sepatu biru dengan sol putih, ukuran 43 / 27,5 cm; dipakai sekitar satu hingga dua kali.','Coba sepatu untuk memastikan kecocokan ukuran.','Sepatu_Skecher_Biru_Dongker_Maria%20Mada.jpeg'),
    ('CM-13-2','Converse Chuck Taylor High — ukuran 44','Sepatu','preloved',80,'Cika Mada','44',null,350000,0,'Sepatu putih krem, ukuran 44 / 28,5 cm.','Terdapat kotoran akibat pemakaian; sepatu belum dicuci.','Sepatu_Converse_Putih_Maria_Mada.jpeg'),
    ('CM-14-1','Scarf bermotif — pilihan 1','Tas & Aksesori','preloved',100,'Tegar Perkasa Darmawan',null,null,150000,0,'Scarf bermotif; motif pilihan pertama dapat dilihat pada foto.','Bahan dan ukuran belum dicantumkan.','Skarf_satu_Tegar%20Perkasa.jpeg'),
    ('CM-14-2','Scarf bermotif — pilihan 2','Tas & Aksesori','preloved',100,'Tegar Perkasa Darmawan',null,null,150000,0,'Scarf bermotif; pilihan kedua memiliki foto tersendiri.','Bahan dan ukuran belum dicantumkan.','Scarf_2_Tegar%20Perkasa.jpeg'),
    ('CM-15-1','Figur Pop Mart Skullpanda','Hobi & Olahraga','preloved',90,'Siti Asylla Mulia',null,null,99000,1,'Figur koleksi Pop Mart, dikenali sebagai Skullpanda dari nama berkas foto.','Seri dan kelengkapan kemasan belum dicantumkan; konfirmasi kepada penjual.','skull%20panda_Siti%20Mulia.jpg'),
    ('CM-16-1','Figur Pop Mart Hirono','Hobi & Olahraga','preloved',90,'Siti Asylla Mulia',null,null,99000,1,'Figur koleksi Pop Mart, dikenali sebagai Hirono dari nama berkas foto.','Seri dan kelengkapan kemasan belum dicantumkan; konfirmasi kepada penjual.','hirono_Siti%20Mulia.jpg'),
    ('CM-17-1','Tas Marhen.J Rico EQ Navy','Tas & Aksesori','preloved',100,'Mia R Mancani P',null,700000,600000,1,'Tas nilon warna navy yang menurut penjual muat laptop 14 inci dan memiliki slot tumbler.','Tanyakan ukuran persisnya bila ingin memastikan kecocokan laptop.','Tas_Marhen_J_Mia%20Putri.jpeg'),
    ('CM-18-1','Nike Air Force 1 White–Lilac — ukuran 37,5','Sepatu','preloved',90,'Mia R Mancani P','37,5',null,600000,1,'Sepatu kulit bernuansa putih dan lilac dengan sedikit sobekan pada bagian kanvas.','Periksa letak dan ukuran sobekan pada foto sebelum membeli.','Sepatu_Nike_Putih_Mia%20Putri.jpeg'),
    ('CM-19-1','Raket padel Decathlon Kuikma Comfort','Hobi & Olahraga','preloved',90,'Joko Santoso',null,null,500000,0,'Raket padel warna hitam; menurut penjual baru dipakai tiga kali.','Periksa permukaan raket dan grip sebelum transaksi.','Raket_Padel_Decathlon_Linda%20Astriyani.jpeg'),
    ('CM-20-1','Mini pouch Alpaka','Tas & Aksesori','preloved',100,'Iqbal Fahmi Faisal',null,250000,150000,1,'Pouch ringkas untuk kartu, AirPods, atau uang tunai.','Ukuran dan detail kompartemen dapat ditanyakan kepada penjual.','Mini%20Pouch_Mia%20Putri.jpeg'),
    ('CM-21-1','Dudukan laptop berbahan logam','Perlengkapan','preloved',100,'Iqbal Fahmi Faisal',null,null,200000,0,'Dudukan laptop berbahan logam dengan konstruksi kokoh menurut penjual.','Tanyakan dimensi dan kecocokan dengan laptop Anda.','Laptop_Stand_Mia_Putri.jpeg'),
    ('CM-22-1','Tas bahu Carlyn putih','Tas & Aksesori','preloved',60,'Adinda Rakhmania',null,null,250000,1,'Tas bahu Carlyn dengan warna putih.','Detail bekas pemakaian belum dijelaskan; periksa foto atau tanyakan penjual.','Carlyn_Adinda.jpg'),
    ('CM-23-1','Jam tangan Fossil uniseks','Tas & Aksesori','preloved',60,'Adinda Rakhmania',null,null,350000,0,'Jam tangan Fossil uniseks dengan strap kulit.','Kondisi fungsi dan kelengkapan belum dijelaskan; konfirmasi kepada penjual.','Jam_tangan_wanita_Fossil_Adinda%20Rakhmania.jpeg'),
    ('CM-24-1','Voucher MAP','Voucher','baru',100,'Wien Goerindro',null,null,75000,0,'Voucher MAP dalam kondisi baru.','Nilai voucher, masa berlaku, dan ketentuan penggunaan belum dicantumkan; tanyakan kepada penjual.','Voucher_MAP_Pak_Wien.jpg'),
    ('CM-25-1','Kamera DSLR Nikon D5200','Elektronik',null,null,null,null,3575000,1500000,1,'DSLR Nikon beresolusi 24,1 MP dengan sensor DX, layar putar, dan perekaman video Full HD.','Kondisi unit, shutter count, serta kelengkapan lensa, baterai, dan charger belum diinformasikan; konfirmasi sebelum membeli.','Nikon_DSLR_D5200_Wella_D.jpeg'),
    ('CM-25-2','Tas Kalibre dengan slot laptop','Tas & Aksesori',null,null,null,null,null,400000,1,'Tas Kalibre dengan ruang khusus untuk membawa laptop dan perlengkapan kerja sehari-hari.','Model, ukuran slot laptop, material, serta kondisi fisik belum diinformasikan; pastikan laptop Anda muat.','Kalibre_Mita_asita.jpeg'),
    ('CM-25-3','Tas Alpaka dengan slot laptop','Tas & Aksesori',null,null,null,null,null,500000,0,'Tas Alpaka dengan slot laptop untuk membawa perangkat dan barang pribadi saat beraktivitas.','Model, ukuran slot laptop, material, serta kondisi fisik belum diinformasikan; tanyakan detailnya sebelum membeli.','Tas_Alpaka_Mita_Asita.jpeg')
  ) as t(code, name, category, cond, pct, seller, size, orig, price, stock, summary, note, photo)
  loop
    i := i + 1;
    insert into public.products (code, name, category_id, item_condition, condition_pct, seller_name, size, original_price,
      price, stock, summary, condition_note, status, sort_order, published_at, reviewed_at)
    values (r.code, r.name, (select id from public.categories where name = r.category), r.cond, r.pct, r.seller, r.size,
      r.orig, r.price, r.stock, r.summary, r.note, 'published', i, now(), now())
    returning id into v_pid;
    insert into public.product_images (product_id, path, sort) values (v_pid, base || r.photo, 0);
  end loop;
  perform set_config('app.stock_note', '', true);
end $$;
