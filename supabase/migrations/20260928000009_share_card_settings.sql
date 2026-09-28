-- Pengaturan kartu bagikan (share card / Open Graph preview di chat app)
insert into public.settings (key, value) values
  ('site_url', ''),
  ('enable_share_card', '0')
on conflict (key) do nothing;
