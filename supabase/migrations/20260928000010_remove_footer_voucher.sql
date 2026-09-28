-- Fitur footer voucher katalog lama dihapus total dari aplikasi; bersihkan juga datanya.
delete from public.settings where key in
  ('footer_enabled', 'footer_kicker', 'footer_title', 'footer_text', 'footer_embed_url', 'footer_links');
