-- ============================================================================
-- Compassion Market -- nominal donasi hanya untuk admin, bukan publik.
-- Aman dijalankan ulang.
-- ============================================================================

-- CREATE OR REPLACE VIEW tidak bisa menghapus kolom yang sudah ada, jadi
-- view-nya harus di-drop dulu lalu dibuat ulang tanpa kolom donation_amount.
drop view if exists public.catalog;
create view public.catalog with (security_invoker = on) as
select
  p.id, p.code, p.name, p.size, p.item_condition, p.condition_pct,
  p.original_price, p.price, p.stock, p.summary, p.condition_note,
  p.featured, p.sort_order, p.published_at, p.created_at,
  p.category_id, c.name as category_name, c.icon as category_icon, c.zone as category_zone,
  coalesce(p.seller_name, '') as seller_name,
  f.flash_item_id, f.flash_sale_name, f.flash_price, f.start_at as flash_start, f.end_at as flash_end,
  f.quota as flash_quota, f.sold as flash_sold,
  coalesce(f.active_now, false) as flash_active,
  case when f.active_now then f.flash_price else p.price end as effective_price,
  coalesce((select json_agg(i.path order by i.sort, i.id) from public.product_images i where i.product_id = p.id), '[]'::json) as images
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select fi.id as flash_item_id, fs.name as flash_sale_name, fi.flash_price, fs.start_at, fs.end_at, fi.quota, fi.sold,
         (now() >= fs.start_at and now() < fs.end_at and (fi.quota is null or fi.sold < fi.quota)) as active_now
  from public.flash_sale_items fi
  join public.flash_sales fs on fs.id = fi.flash_sale_id
  where fi.product_id = p.id and fs.active and fs.end_at > now()
  order by fs.start_at
  limit 1
) f on true
where p.status = 'published';

-- Karyawan & pembeli memakai anon key tanpa sesi (role "anon") -- blokir akses
-- kolom donation_amount langsung ke tabel products dari role itu, supaya tidak
-- bisa ditarik lewat REST API meski tidak ditampilkan di UI. Admin (role
-- "authenticated", satu-satunya yang benar-benar login) tetap bisa lihat.
revoke select (donation_amount) on public.products from anon;
