-- ============================================================================
-- Compassion Market — Row Level Security & Supabase Storage
-- Prinsip: publik hanya bisa MEMBACA katalog; penulisan data sensitif (stok,
-- pesanan, verifikasi) hanya lewat fungsi RPC di 02_logic.sql.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.payment_methods enable row level security;
alter table public.submissions enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.flash_sales enable row level security;
alter table public.flash_sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_log enable row level security;

-- Hapus policy lama agar file ini bisa dijalankan ulang
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (id = auth.uid() or public.is_admin());

-- master data: semua boleh baca, hanya admin tulis
create policy settings_read on public.settings for select using (true);
create policy settings_admin on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy categories_read on public.categories for select using (true);
create policy categories_admin on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy pm_read on public.payment_methods for select using (active or public.is_admin());
create policy pm_admin on public.payment_methods for all using (public.is_admin()) with check (public.is_admin());
create policy flash_read on public.flash_sales for select using (true);
create policy flash_admin on public.flash_sales for all using (public.is_admin()) with check (public.is_admin());
create policy flash_items_read on public.flash_sale_items for select using (true);
create policy flash_items_admin on public.flash_sale_items for all using (public.is_admin()) with check (public.is_admin());

-- barang: publik lihat yang tayang, penjual lihat miliknya, admin semua
create policy products_read on public.products for select
  using (status = 'published' or seller_id = auth.uid() or public.is_admin());
create policy products_admin on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy images_read on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_id
          and (p.status = 'published' or p.seller_id = auth.uid() or public.is_admin())));
create policy images_admin on public.product_images for all using (public.is_admin()) with check (public.is_admin());
create policy submissions_read on public.submissions for select using (seller_id = auth.uid() or public.is_admin());

-- stok & audit: admin saja
create policy stock_admin on public.stock_movements for select using (public.is_admin());
create policy audit_admin on public.audit_log for select using (public.is_admin());

-- pesanan: pembeli lihat miliknya, admin semua (perubahan lewat RPC)
create policy orders_read on public.orders for select using (buyer_id = auth.uid() or public.is_admin());
create policy order_items_read on public.order_items for select using (
  public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()));

-- Fungsi internal tidak boleh dipanggil langsung dari API
revoke execute on function public.release_order_stock(bigint, text) from public, anon, authenticated;
revoke execute on function public.next_form_no() from public, anon, authenticated;
revoke execute on function public.log_audit(text, text, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke all on public.my_sales from anon;
grant select on public.my_sales to authenticated;

-- ---------------------------------------------------------------------------
-- STORAGE (S3-compatible)
--   product-photos  : publik, penjual upload ke folder <user_id>/
--   payment-proofs  : privat, pembeli upload ke <user_id>/, dibaca pemilik & admin
--   site-assets     : publik, admin upload QRIS / logo / banner
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('site-assets', 'site-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cm photos read" on storage.objects;
drop policy if exists "cm photos upload" on storage.objects;
drop policy if exists "cm photos delete" on storage.objects;
drop policy if exists "cm proofs read" on storage.objects;
drop policy if exists "cm proofs upload" on storage.objects;
drop policy if exists "cm assets read" on storage.objects;
drop policy if exists "cm assets write" on storage.objects;
drop policy if exists "cm assets update" on storage.objects;
drop policy if exists "cm assets delete" on storage.objects;

create policy "cm photos read" on storage.objects for select using (bucket_id = 'product-photos');
create policy "cm photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "cm photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "cm proofs read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "cm proofs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cm assets read" on storage.objects for select using (bucket_id = 'site-assets');
create policy "cm assets write" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());
create policy "cm assets update" on storage.objects for update to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());
create policy "cm assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());
