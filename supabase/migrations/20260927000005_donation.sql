-- ============================================================================
-- Compassion Market — nominal donasi per barang (acara donasi)
-- Aman dijalankan ulang di project yang sudah dipasang sebelumnya.
-- ============================================================================

alter table public.products add column if not exists donation_amount bigint not null default 0 check (donation_amount >= 0);

-- Tampilkan nominal donasi di katalog publik juga
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

-- PENJUAL: submit_items -- terima donation_amount per barang
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

-- PENJUAL: update_my_item -- boleh ubah donation_amount juga
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

-- ADMIN: admin_review_product -- boleh koreksi donation_amount saat approve
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
