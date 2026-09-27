-- ============================================================================
-- Compassion Market -- bersihkan fungsi versi lama yang jadi "overload" liar.
--
-- CREATE OR REPLACE FUNCTION hanya menimpa kalau daftar parameternya PERSIS
-- sama. Sepanjang pengembangan, beberapa fungsi ganti tanda tangan (mis.
-- log_audit nambah parameter p_actor, submit_items/create_order/dst. nambah
-- parameter p_actor di depan) -- migrasi sebelumnya hanya menambah fungsi versi
-- BARU, versi LAMA tetap nyangkut di database dan bikin pemanggilan jadi
-- ambigu ("is not unique"). File ini menghapus semua versi lama yang sudah
-- tidak dipakai kode. Aman dijalankan ulang.
-- ============================================================================

drop function if exists public.log_audit(text, text, bigint, jsonb);
drop function if exists public.submit_items(jsonb, text);
drop function if exists public.update_my_item(bigint, jsonb);
drop function if exists public.withdraw_my_item(bigint);
drop function if exists public.create_order(jsonb, bigint, text);
drop function if exists public.submit_payment_proof(bigint, text);
drop function if exists public.cancel_my_order(bigint);

-- Trigger lama "protect_profile" (kunci role/active/email saat karyawan edit
-- profil sendiri lewat RLS langsung) sudah tidak relevan -- profil karyawan
-- sekarang diubah lewat fungsi update_my_profile() yang sudah membatasi kolom
-- yang boleh diubah, bukan lewat RLS lagi.
drop trigger if exists profiles_protect on public.profiles;
drop function if exists public.protect_profile();

-- View lama my_sales (sebelum jadi fungsi my_sales(p_actor)) sudah tidak dipakai.
drop view if exists public.my_sales;
