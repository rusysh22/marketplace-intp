-- ============================================================================
-- Compassion Market — logika bisnis (fungsi, trigger, view)
-- Semua proses yang menyentuh stok/uang berjalan di database (atomic & aman),
-- frontend cukup memanggil supabase.rpc('<nama_fungsi>', {...}).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.setting(p_key text, p_default text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.settings where key = p_key), p_default);
$$;

create or replace function public.log_audit(p_action text, p_entity text, p_entity_id bigint, p_detail jsonb default null, p_actor uuid default auth.uid())
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (user_id, action, entity, entity_id, detail) values (p_actor, p_action, p_entity, p_entity_id, p_detail);
$$;

-- Karyawan tidak punya sesi Supabase Auth (auth.uid() null); fungsi yang dipanggil
-- atas nama karyawan menaruh id-nya di sini supaya trigger/log tetap tercatat.
create or replace function public.current_actor() returns uuid
language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profil otomatis saat akun Supabase Auth dibuat.
-- HANYA dipakai untuk admin (dibuat lewat Supabase Dashboard -> Authentication ->
-- Add user, lalu dipromosikan jadi admin lewat SQL, lihat README). Karyawan tidak
-- pakai jalur ini sama sekali -- profilnya dibuat admin lewat admin_create_employee().
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, name, has_login)
  values (new.id, new.email, coalesce(nullif(v_meta ->> 'name', ''), nullif(v_meta ->> 'full_name', ''), split_part(new.email, '@', 1)), true)
  on conflict (id) do update set has_login = true;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Kartu stok otomatis: setiap perubahan kolom stock tercatat di stock_movements.
-- Fungsi lain mengisi alasan lewat set_config('app.stock_type'/'app.stock_ref').
-- ---------------------------------------------------------------------------
create or replace function public.track_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.stock_movements (product_id, qty_change, balance, type, ref, note, user_id)
    values (new.id, new.stock, new.stock, 'initial', new.code, nullif(current_setting('app.stock_note', true), ''), public.current_actor());
  elsif new.stock is distinct from old.stock then
    insert into public.stock_movements (product_id, qty_change, balance, type, ref, note, user_id)
    values (new.id, new.stock - old.stock, new.stock,
            coalesce(nullif(current_setting('app.stock_type', true), ''), 'adjust'),
            nullif(current_setting('app.stock_ref', true), ''),
            nullif(current_setting('app.stock_note', true), ''),
            public.current_actor());
  end if;
  return new;
end $$;
drop trigger if exists products_stock on public.products;
create trigger products_stock after insert or update of stock on public.products for each row execute function public.track_stock();

-- Kode barang CM-<no form>-<urutan>, melanjutkan penomoran katalog lama
create or replace function public.next_form_no() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := public.setting('product_code_prefix', 'CM');
  v_no int;
begin
  perform pg_advisory_xact_lock(hashtext('next_form_no'));
  v_no := coalesce(public.setting('next_submission_no')::int, 1);
  while exists (select 1 from public.products where code like v_prefix || '-' || lpad(v_no::text, 2, '0') || '-%') loop
    v_no := v_no + 1;
  end loop;
  insert into public.settings (key, value) values ('next_submission_no', (v_no + 1)::text)
  on conflict (key) do update set value = excluded.value;
  return v_no;
end $$;

-- ---------------------------------------------------------------------------
-- Katalog publik: harga efektif (flash sale) + foto, hanya barang tayang
-- ---------------------------------------------------------------------------
create or replace view public.catalog with (security_invoker = on) as
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
  coalesce((select json_agg(i.path order by i.sort, i.id) from public.product_images i where i.product_id = p.id), '[]'::json) as images,
  p.donation_amount
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

-- ---------------------------------------------------------------------------
-- PENJUAL: daftarkan barang (bisa lebih dari satu sekaligus)
-- p_items: [{name, category_id, size, item_condition, condition_pct, original_price,
--            price, stock, summary, condition_note, images: ["<uid>/file.jpg", ...]}]
-- ---------------------------------------------------------------------------
create or replace function public.submit_items(p_actor uuid, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := p_actor;
  v_profile public.profiles;
  v_max int := coalesce(public.setting('max_items_per_submission')::int, 10);
  v_max_photos int := coalesce(public.setting('max_photos_per_item')::int, 5);
  v_min_cond int := coalesce(public.setting('min_condition_pct')::int, 0);
  v_prefix text := public.setting('product_code_prefix', 'CM');
  v_form int;
  v_sub bigint;
  v_item jsonb;
  v_idx int := 0;
  v_pid bigint;
  v_code text;
  v_codes text[] := '{}';
  v_img text;
  v_n int;
begin
  if v_uid is null then raise exception 'Pilih identitas Anda terlebih dahulu'; end if;
  select * into v_profile from public.profiles where id = v_uid and active;
  if not found then raise exception 'Akun tidak aktif'; end if;
  perform set_config('app.actor_id', v_uid::text, true);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Minimal satu barang'; end if;
  if jsonb_array_length(p_items) > v_max then raise exception 'Maksimal % barang per pengajuan', v_max; end if;

  v_form := public.next_form_no();
  insert into public.submissions (form_no, seller_id, note) values (v_form, v_uid, p_note) returning id into v_sub;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_item ->> 'name'), '') = '' then raise exception 'Barang #%: nama wajib diisi', v_idx; end if;
    if not exists (select 1 from public.categories where id = (v_item ->> 'category_id')::bigint and active) then
      raise exception 'Barang #%: jenis barang tidak valid', v_idx;
    end if;
    if coalesce((v_item ->> 'price')::bigint, -1) < 0 then raise exception 'Barang #%: harga tidak valid', v_idx; end if;
    if coalesce((v_item ->> 'donation_amount')::bigint, 0) < 0 then raise exception 'Barang #%: nominal donasi tidak valid', v_idx; end if;
    if coalesce((v_item ->> 'condition_pct')::int, -1) not between 0 and 100 then raise exception 'Barang #%: kondisi harus 0-100 persen', v_idx; end if;
    if (v_item ->> 'condition_pct')::int < v_min_cond then raise exception 'Barang #%: kondisi minimal % persen', v_idx, v_min_cond; end if;
    v_n := coalesce(jsonb_array_length(v_item -> 'images'), 0);
    if v_n = 0 then raise exception 'Barang #%: minimal 1 foto', v_idx; end if;
    if v_n > v_max_photos then raise exception 'Barang #%: maksimal % foto', v_idx, v_max_photos; end if;

    v_code := v_prefix || '-' || lpad(v_form::text, 2, '0') || '-' || v_idx;
    insert into public.products (code, submission_id, seller_id, seller_name, category_id, name, size, item_condition,
      condition_pct, original_price, price, donation_amount, stock, summary, condition_note, status)
    values (v_code, v_sub, v_uid, v_profile.name, (v_item ->> 'category_id')::bigint, trim(v_item ->> 'name'),
      nullif(trim(v_item ->> 'size'), ''), coalesce(nullif(v_item ->> 'item_condition', ''), 'preloved'),
      (v_item ->> 'condition_pct')::int, nullif(v_item ->> 'original_price', '')::bigint, (v_item ->> 'price')::bigint,
      coalesce((v_item ->> 'donation_amount')::bigint, 0),
      greatest(1, coalesce((v_item ->> 'stock')::int, 1)), v_item ->> 'summary', v_item ->> 'condition_note', 'pending')
    returning id into v_pid;

    v_n := 0;
    for v_img in select jsonb_array_elements_text(v_item -> 'images') loop
      if split_part(v_img, '/', 1) <> v_uid::text then raise exception 'Foto tidak valid'; end if;
      insert into public.product_images (product_id, path, sort) values (v_pid, v_img, v_n);
      v_n := v_n + 1;
    end loop;
    v_codes := v_codes || v_code;
  end loop;

  perform public.log_audit('submit_items', 'submission', v_sub, jsonb_build_object('codes', v_codes), v_uid);
  return jsonb_build_object('submission_id', v_sub, 'form_no', v_form, 'codes', to_jsonb(v_codes));
end $$;

-- PENJUAL: revisi barang yang masih pending / ditolak -> kembali ke antrean verifikasi
create or replace function public.update_my_item(p_actor uuid, p_id bigint, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p public.products;
  v_img text;
  v_n int := 0;
begin
  if not exists (select 1 from public.profiles where id = p_actor and active) then raise exception 'Identitas tidak valid'; end if;
  perform set_config('app.actor_id', p_actor::text, true);
  select * into v_p from public.products where id = p_id and seller_id = p_actor for update;
  if not found then raise exception 'Barang tidak ditemukan'; end if;
  if v_p.status not in ('pending', 'rejected') then raise exception 'Barang yang sudah tayang hanya bisa diubah admin'; end if;
  update public.products set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    category_id = coalesce((p_data ->> 'category_id')::bigint, category_id),
    size = case when p_data ? 'size' then nullif(trim(p_data ->> 'size'), '') else size end,
    item_condition = coalesce(nullif(p_data ->> 'item_condition', ''), item_condition),
    condition_pct = coalesce((p_data ->> 'condition_pct')::int, condition_pct),
    original_price = case when p_data ? 'original_price' then nullif(p_data ->> 'original_price', '')::bigint else original_price end,
    price = coalesce((p_data ->> 'price')::bigint, price),
    donation_amount = case when p_data ? 'donation_amount' then coalesce((p_data ->> 'donation_amount')::bigint, 0) else donation_amount end,
    summary = coalesce(p_data ->> 'summary', summary),
    condition_note = coalesce(p_data ->> 'condition_note', condition_note),
    status = 'pending', reject_reason = null
  where id = p_id;
  if p_data ? 'stock' then
    update public.products set stock = greatest(1, (p_data ->> 'stock')::int) where id = p_id;
  end if;
  if jsonb_typeof(p_data -> 'images') = 'array' and jsonb_array_length(p_data -> 'images') > 0 then
    delete from public.product_images where product_id = p_id;
    for v_img in select jsonb_array_elements_text(p_data -> 'images') loop
      if split_part(v_img, '/', 1) <> p_actor::text and v_img !~ '^https?://' then raise exception 'Foto tidak valid'; end if;
      insert into public.product_images (product_id, path, sort) values (p_id, v_img, v_n);
      v_n := v_n + 1;
    end loop;
  end if;
  perform public.log_audit('update_my_item', 'product', p_id, p_data - 'images', p_actor);
end $$;

-- PENJUAL: tarik barang (pending/ditolak dihapus, yang tayang disembunyikan)
create or replace function public.withdraw_my_item(p_actor uuid, p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.products;
begin
  select * into v_p from public.products where id = p_id and seller_id = p_actor for update;
  if not found then raise exception 'Barang tidak ditemukan'; end if;
  if v_p.status in ('pending', 'rejected') and not exists (select 1 from public.order_items where product_id = p_id) then
    delete from public.products where id = p_id;
    perform public.log_audit('withdraw_item', 'product', p_id, jsonb_build_object('code', v_p.code, 'result', 'deleted'), p_actor);
    return 'deleted';
  end if;
  update public.products set status = 'hidden' where id = p_id;
  perform public.log_audit('withdraw_item', 'product', p_id, jsonb_build_object('code', v_p.code, 'result', 'hidden'), p_actor);
  return 'hidden';
end $$;

-- ---------------------------------------------------------------------------
-- PESANAN
-- ---------------------------------------------------------------------------
-- Kembalikan stok (dan kuota flash sale) dari pesanan yang batal / kedaluwarsa
create or replace function public.release_order_stock(p_order_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders;
  v_it record;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.stock_released then return; end if;
  perform set_config('app.stock_type', 'release', true);
  perform set_config('app.stock_ref', v_o.code, true);
  perform set_config('app.stock_note', p_reason, true);
  for v_it in select * from public.order_items where order_id = p_order_id loop
    update public.products set stock = stock + v_it.qty where id = v_it.product_id;
    if v_it.flash_item_id is not null then
      update public.flash_sale_items set sold = greatest(0, sold - v_it.qty) where id = v_it.flash_item_id;
    end if;
  end loop;
  update public.orders set stock_released = true where id = p_order_id;
  perform set_config('app.stock_type', '', true);
  perform set_config('app.stock_ref', '', true);
  perform set_config('app.stock_note', '', true);
end $$;

-- Pesanan yang lewat batas bayar -> expired + stok kembali. Aman dipanggil siapa saja,
-- dan bisa dijadwalkan dengan pg_cron (lihat README).
create or replace function public.expire_orders() returns int
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_n int := 0;
begin
  for v_id in select id from public.orders where status = 'waiting_payment' and expires_at < now() for update skip locked loop
    update public.orders set status = 'expired', admin_note = coalesce(admin_note, 'Melewati batas waktu pembayaran') where id = v_id;
    perform public.release_order_stock(v_id, 'Pesanan kedaluwarsa');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- PEMBELI: checkout. p_items: [{product_id, qty}]
create or replace function public.create_order(p_actor uuid, p_items jsonb, p_payment_method_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := p_actor;
  v_buyer public.profiles;
  v_pm public.payment_methods;
  v_item jsonb;
  v_p public.products;
  v_qty int;
  v_fi record;
  v_price bigint;
  v_flash_id bigint;
  v_subtotal bigint := 0;
  v_fee bigint := 0;
  v_unique int := 0;
  v_order_id bigint;
  v_code text;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
begin
  if v_uid is null then raise exception 'Pilih identitas Anda untuk membeli'; end if;
  select * into v_buyer from public.profiles where id = v_uid and active;
  if not found then raise exception 'Akun tidak aktif'; end if;
  perform set_config('app.actor_id', v_uid::text, true);
  select * into v_pm from public.payment_methods where id = p_payment_method_id and active;
  if not found then raise exception 'Metode pembayaran tidak tersedia'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;

  perform public.expire_orders();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item ->> 'qty')::int, 1));
    select * into v_p from public.products where id = (v_item ->> 'product_id')::bigint for update;
    if not found or v_p.status <> 'published' then raise exception 'Barang tidak tersedia lagi'; end if;
    if v_p.seller_id = v_uid then raise exception '"%" adalah barang Anda sendiri', v_p.name; end if;
    if v_p.stock < v_qty then raise exception 'Stok "%" tidak cukup (sisa %)', v_p.name, v_p.stock; end if;

    v_price := v_p.price; v_flash_id := null;
    select fi.* into v_fi from public.flash_sale_items fi join public.flash_sales fs on fs.id = fi.flash_sale_id
      where fi.product_id = v_p.id and fs.active and now() >= fs.start_at and now() < fs.end_at
      order by fs.start_at limit 1 for update of fi;
    if found and (v_fi.quota is null or v_fi.quota - v_fi.sold >= v_qty) then
      v_price := v_fi.flash_price; v_flash_id := v_fi.id;
      update public.flash_sale_items set sold = sold + v_qty where id = v_fi.id;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object('product_id', v_p.id, 'seller_id', v_p.seller_id, 'seller_name', v_p.seller_name,
      'code', v_p.code, 'name', v_p.name, 'price', v_price, 'normal_price', v_p.price, 'qty', v_qty, 'flash_item_id', v_flash_id);
  end loop;

  if public.setting('admin_fee_type', 'flat') = 'percent' then
    v_fee := round(v_subtotal * coalesce(public.setting('admin_fee_value')::numeric, 0) / 100);
  else
    v_fee := coalesce(public.setting('admin_fee_value')::bigint, 0);
  end if;
  if v_pm.type = 'bank' and public.setting('use_unique_code', '1') = '1' then
    v_unique := 1 + floor(random() * 299)::int;
  end if;

  v_code := 'ORD-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 5));
  insert into public.orders (code, buyer_id, buyer_name, status, payment_method_id, payment_snapshot, subtotal, admin_fee,
    unique_code, total, buyer_note, expires_at)
  values (v_code, v_uid, v_buyer.name, 'waiting_payment', v_pm.id,
    jsonb_build_object('type', v_pm.type, 'name', v_pm.name, 'bank_name', v_pm.bank_name, 'account_no', v_pm.account_no,
      'account_holder', v_pm.account_holder, 'qris_image', v_pm.qris_image, 'instructions', v_pm.instructions),
    v_subtotal, v_fee, v_unique, v_subtotal + v_fee + v_unique, p_note,
    now() + make_interval(hours => coalesce(public.setting('order_expiry_hours')::int, 24)))
  returning id into v_order_id;

  perform set_config('app.stock_type', 'sale', true);
  perform set_config('app.stock_ref', v_code, true);
  perform set_config('app.stock_note', 'Dipesan ' || coalesce(v_buyer.name, ''), true);
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, product_id, seller_id, seller_name, code, name, price, normal_price, qty, flash_item_id)
    values (v_order_id, (v_line ->> 'product_id')::bigint, nullif(v_line ->> 'seller_id', '')::uuid, v_line ->> 'seller_name',
      v_line ->> 'code', v_line ->> 'name', (v_line ->> 'price')::bigint, (v_line ->> 'normal_price')::bigint,
      (v_line ->> 'qty')::int, nullif(v_line ->> 'flash_item_id', '')::bigint);
    update public.products set stock = stock - (v_line ->> 'qty')::int where id = (v_line ->> 'product_id')::bigint;
  end loop;
  perform set_config('app.stock_type', '', true);
  perform set_config('app.stock_ref', '', true);
  perform set_config('app.stock_note', '', true);

  perform public.log_audit('create_order', 'order', v_order_id, jsonb_build_object('code', v_code, 'total', v_subtotal + v_fee + v_unique), v_uid);
  return jsonb_build_object('order_id', v_order_id, 'code', v_code, 'total', v_subtotal + v_fee + v_unique);
end $$;

-- PEMBELI: unggah bukti bayar (file sudah di-upload ke bucket payment-proofs/<uid>/...)
create or replace function public.submit_payment_proof(p_actor uuid, p_order_id bigint, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id and buyer_id = p_actor for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_o.status not in ('waiting_payment', 'waiting_verification') then raise exception 'Pesanan tidak menunggu pembayaran'; end if;
  if v_o.status = 'waiting_payment' and v_o.expires_at < now() then raise exception 'Batas waktu pembayaran sudah lewat'; end if;
  update public.orders set proof_path = p_path, status = 'waiting_verification' where id = p_order_id;
  perform public.log_audit('submit_payment_proof', 'order', p_order_id, null, p_actor);
end $$;

-- PEMBELI: batalkan pesanan yang belum dibayar
create or replace function public.cancel_my_order(p_actor uuid, p_order_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id and buyer_id = p_actor for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_o.status <> 'waiting_payment' then raise exception 'Pesanan tidak bisa dibatalkan (status %)', v_o.status; end if;
  perform set_config('app.actor_id', p_actor::text, true);
  update public.orders set status = 'cancelled', admin_note = 'Dibatalkan pembeli' where id = p_order_id;
  perform public.release_order_stock(p_order_id, 'Dibatalkan pembeli');
  perform public.log_audit('cancel_order', 'order', p_order_id, null, p_actor);
end $$;

-- ---------------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Khusus admin marketplace'; end if;
end $$;

-- Verifikasi barang: approve (bisa sambil koreksi data) atau reject dengan alasan
create or replace function public.admin_review_product(p_id bigint, p_action text, p_reason text default null, p_patch jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.products;
begin
  perform public.assert_admin();
  select * into v_p from public.products where id = p_id for update;
  if not found then raise exception 'Barang tidak ditemukan'; end if;
  if p_action = 'approve' then
    update public.products set
      name = coalesce(nullif(trim(p_patch ->> 'name'), ''), name),
      category_id = coalesce((p_patch ->> 'category_id')::bigint, category_id),
      price = coalesce((p_patch ->> 'price')::bigint, price),
      original_price = case when p_patch ? 'original_price' then nullif(p_patch ->> 'original_price', '')::bigint else original_price end,
      donation_amount = case when p_patch ? 'donation_amount' then coalesce((p_patch ->> 'donation_amount')::bigint, 0) else donation_amount end,
      status = 'published', reject_reason = null, reviewed_by = auth.uid(), reviewed_at = now(),
      published_at = coalesce(published_at, now())
    where id = p_id;
    if p_patch ? 'stock' then
      perform set_config('app.stock_note', 'Koreksi saat verifikasi', true);
      update public.products set stock = (p_patch ->> 'stock')::int where id = p_id;
      perform set_config('app.stock_note', '', true);
    end if;
  elsif p_action = 'reject' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Isi alasan penolakan'; end if;
    update public.products set status = 'rejected', reject_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  else
    raise exception 'Aksi tidak dikenal';
  end if;
  perform public.log_audit('review_' || p_action, 'product', p_id, jsonb_build_object('code', v_p.code, 'reason', p_reason, 'patch', p_patch));
end $$;

-- Kode untuk barang yang diinput langsung oleh admin (barang titipan / offline)
create or replace function public.admin_new_code() returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return public.setting('product_code_prefix', 'CM') || '-' || lpad(public.next_form_no()::text, 2, '0') || '-1';
end $$;

-- Penyesuaian stok manual dengan catatan (stock opname)
create or replace function public.admin_adjust_stock(p_id bigint, p_new_stock int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_new_stock < 0 then raise exception 'Stok tidak boleh negatif'; end if;
  perform set_config('app.stock_type', 'adjust', true);
  perform set_config('app.stock_note', coalesce(p_note, 'Penyesuaian admin'), true);
  update public.products set stock = p_new_stock where id = p_id;
  perform set_config('app.stock_type', '', true);
  perform set_config('app.stock_note', '', true);
  perform public.log_audit('adjust_stock', 'product', p_id, jsonb_build_object('new_stock', p_new_stock, 'note', p_note));
end $$;

-- Verifikasi pembayaran
create or replace function public.admin_verify_payment(p_order_id bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  perform public.assert_admin();
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_o.status not in ('waiting_verification', 'waiting_payment') then raise exception 'Status pesanan %', v_o.status; end if;
  if p_approve then
    if v_o.stock_released then raise exception 'Stok pesanan ini sudah dilepas (expired/batal). Buat pesanan baru.'; end if;
    update public.orders set status = 'paid', paid_at = now(), admin_note = coalesce(p_note, admin_note) where id = p_order_id;
  else
    update public.orders set status = 'waiting_payment', admin_note = coalesce(p_note, 'Bukti bayar ditolak, silakan unggah ulang'),
      expires_at = greatest(expires_at, now() + interval '12 hours') where id = p_order_id;
  end if;
  perform public.log_audit(case when p_approve then 'payment_approved' else 'payment_rejected' end, 'order', p_order_id, jsonb_build_object('note', p_note));
end $$;

-- Ubah status pesanan: paid -> ready_pickup -> completed, atau cancelled
create or replace function public.admin_set_order_status(p_order_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  perform public.assert_admin();
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_o.status in ('completed', 'cancelled', 'expired') then raise exception 'Pesanan sudah final (%)', v_o.status; end if;
  if p_status not in ('paid', 'ready_pickup', 'completed', 'cancelled') then raise exception 'Status tidak valid'; end if;
  if p_status in ('ready_pickup', 'completed') and v_o.status not in ('paid', 'ready_pickup') then
    raise exception 'Pesanan harus lunas terlebih dahulu';
  end if;
  update public.orders set status = p_status, admin_note = coalesce(p_note, admin_note),
    completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_order_id;
  if p_status = 'cancelled' then
    perform public.release_order_stock(p_order_id, coalesce(p_note, 'Dibatalkan admin'));
  end if;
  perform public.log_audit('order_' || p_status, 'order', p_order_id, jsonb_build_object('note', p_note));
end $$;

-- Tandai hak penjual sudah dibayarkan (setelah pesanan lunas)
create or replace function public.admin_mark_payout(p_item_ids bigint[], p_ref text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_comm numeric := coalesce(public.setting('commission_percent')::numeric, 0);
  v_n int;
begin
  perform public.assert_admin();
  update public.order_items oi set payout_status = 'paid', payout_at = now(), payout_ref = p_ref,
    payout_amount = round(oi.price * oi.qty * (100 - v_comm) / 100)
  from public.orders o
  where o.id = oi.order_id and oi.id = any(p_item_ids) and oi.payout_status = 'unpaid'
    and o.status in ('paid', 'ready_pickup', 'completed');
  get diagnostics v_n = row_count;
  perform public.log_audit('payout', 'order_item', null, jsonb_build_object('ids', p_item_ids, 'ref', p_ref, 'count', v_n));
  return v_n;
end $$;

-- Ringkasan dashboard admin
create or replace function public.admin_dashboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_admin();
  perform public.expire_orders();
  select jsonb_build_object(
    'pending_products', (select count(*) from public.products where status = 'pending'),
    'published_products', (select count(*) from public.products where status = 'published'),
    'available_products', (select count(*) from public.products where status = 'published' and stock > 0),
    'sold_out_products', (select count(*) from public.products where status = 'published' and stock = 0),
    'waiting_payment', (select count(*) from public.orders where status = 'waiting_payment'),
    'waiting_verification', (select count(*) from public.orders where status = 'waiting_verification'),
    'to_handover', (select count(*) from public.orders where status in ('paid', 'ready_pickup')),
    'revenue', (select coalesce(sum(total), 0) from public.orders where status in ('paid', 'ready_pickup', 'completed')),
    'gmv_items', (select coalesce(sum(oi.price * oi.qty), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                  where o.status in ('paid', 'ready_pickup', 'completed')),
    'payout_pending', (select coalesce(sum(oi.price * oi.qty), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                  where o.status in ('paid', 'ready_pickup', 'completed') and oi.payout_status = 'unpaid'),
    'employees', (select count(*) from public.profiles),
    'by_category', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select c.name, count(p.id) filter (where p.status = 'published') as published,
               count(p.id) filter (where p.status = 'published' and p.stock > 0) as available
        from public.categories c left join public.products p on p.category_id = c.id
        group by c.id, c.name, c.sort order by c.sort) x)
  ) into v;
  return v;
end $$;

-- Admin menambah karyawan baru (tanpa password/akun auth -- dipilih sendiri lewat
-- halaman "Masuk sebagai"). Email hanya label, tidak dipakai untuk autentikasi.
create or replace function public.admin_create_employee(p_name text, p_email text default null, p_emp_id text default null,
  p_department text default null, p_phone text default null) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles;
begin
  perform public.assert_admin();
  if coalesce(trim(p_name), '') = '' then raise exception 'Nama wajib diisi'; end if;
  insert into public.profiles (name, email, emp_id, department, phone, role, has_login)
  values (trim(p_name), nullif(trim(p_email), ''), nullif(trim(p_emp_id), ''), nullif(trim(p_department), ''), nullif(trim(p_phone), ''), 'employee', false)
  returning * into v_p;
  perform public.log_audit('create_employee', 'profile', null, jsonb_build_object('id', v_p.id, 'name', v_p.name));
  return v_p;
end $$;

-- ---------------------------------------------------------------------------
-- Identitas karyawan (tanpa login): pilih dari daftar, tanpa password/OTP.
-- Verifikasi tetap ada di sisi admin sebelum barang tayang / bukti bayar disetujui.
-- ---------------------------------------------------------------------------
create or replace function public.employee_directory() returns table(id uuid, name text, email text, department text)
language sql stable security definer set search_path = public as $$
  select id, name, email, department from public.profiles where active order by name;
$$;

create or replace function public.my_profile(p_actor uuid) returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = p_actor and active;
$$;

create or replace function public.update_my_profile(p_actor uuid, p_data jsonb) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles;
begin
  if not exists (select 1 from public.profiles where id = p_actor and active) then raise exception 'Identitas tidak valid'; end if;
  update public.profiles set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    emp_id = case when p_data ? 'emp_id' then nullif(trim(p_data ->> 'emp_id'), '') else emp_id end,
    department = case when p_data ? 'department' then nullif(trim(p_data ->> 'department'), '') else department end,
    phone = case when p_data ? 'phone' then nullif(trim(p_data ->> 'phone'), '') else phone end,
    bank_name = case when p_data ? 'bank_name' then nullif(trim(p_data ->> 'bank_name'), '') else bank_name end,
    bank_account = case when p_data ? 'bank_account' then nullif(trim(p_data ->> 'bank_account'), '') else bank_account end,
    bank_holder = case when p_data ? 'bank_holder' then nullif(trim(p_data ->> 'bank_holder'), '') else bank_holder end
  where id = p_actor
  returning * into v_p;
  return v_p;
end $$;

-- Barang milik karyawan yang sedang "masuk sebagai" p_actor
create or replace function public.my_products(p_actor uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select p.*, c.name as category_name,
      coalesce((select jsonb_agg(jsonb_build_object('path', i.path, 'sort', i.sort) order by i.sort) from public.product_images i where i.product_id = p.id), '[]'::jsonb) as product_images
    from public.products p left join public.categories c on c.id = p.category_id
    where p.seller_id = p_actor
  ) x;
$$;

-- Penjualan milik karyawan (tanpa membuka data pembeli selain nama)
create or replace function public.my_sales(p_actor uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select oi.id, oi.code, oi.name, oi.qty, oi.price, oi.payout_status, oi.payout_amount, oi.payout_at, oi.payout_ref,
           o.code as order_code, o.status as order_status, o.buyer_name, o.created_at, o.paid_at
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.seller_id = p_actor
  ) x;
$$;

-- Pesanan milik karyawan (sebagai pembeli)
create or replace function public.my_orders(p_actor uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select o.*,
      coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'price', i.price)) from public.order_items i where i.order_id = o.id), '[]'::jsonb) as order_items
    from public.orders o where o.buyer_id = p_actor
  ) x;
$$;

create or replace function public.my_order_detail(p_actor uuid, p_order_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object('order_items',
      coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_order_id and o.buyer_id = p_actor;
$$;
