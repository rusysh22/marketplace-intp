-- ============================================================================
-- Compassion Market — import/update massal barang dari Excel (menu Admin → Produk)
-- Semua baris diproses dalam satu transaksi: jika satu baris gagal validasi,
-- tidak ada perubahan yang tersimpan. Perubahan stok tercatat di kartu stok.
-- Aman dijalankan ulang.
--
-- p_rows: [{ id?, code?, name?, category?, seller_name?, size?, item_condition?,
--            condition_pct?, original_price?, price?, donation_amount?, stock?,
--            status?, featured?, sort_order?, summary?, condition_note?, photo_url?,
--            row? }]
--   - id terisi  -> update barang tsb; hanya kolom yang ADA di objek yang diubah
--                   (nilai null = kosongkan kolom yang boleh kosong)
--   - id kosong  -> barang baru (wajib: name, category, price); kode dibuat otomatis
--   - row        -> nomor baris di Excel, hanya untuk pesan error
-- ============================================================================
create or replace function public.admin_import_products(p_rows jsonb, p_source text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_row text;
  v_p public.products;
  v_cat bigint;
  v_id bigint;
  v_code text;
  v_created int := 0;
  v_updated int := 0;
  v_stock int := 0;
  v_codes text[] := '{}';
  v_note text := 'Import Excel' || coalesce(': ' || nullif(trim(p_source), ''), '');
begin
  perform public.assert_admin();
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Format data import tidak valid'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Maksimal 2000 baris per import'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := 'Baris ' || coalesce(r ->> 'row', '?') || ': ';

    -- validasi nilai (berlaku untuk update & barang baru)
    if r ? 'name' and coalesce(trim(r ->> 'name'), '') = '' then raise exception '%Nama barang tidak boleh kosong', v_row; end if;
    if r ? 'price' and (r ->> 'price' is null or (r ->> 'price')::bigint < 0) then raise exception '%Harga jual wajib diisi dan tidak boleh negatif', v_row; end if;
    if coalesce((r ->> 'original_price')::bigint, 0) < 0 or coalesce((r ->> 'donation_amount')::bigint, 0) < 0 then
      raise exception '%Harga coret / donasi tidak boleh negatif', v_row;
    end if;
    if r ? 'stock' and (r ->> 'stock' is null or (r ->> 'stock')::int < 0) then raise exception '%Stok wajib diisi dan tidak boleh negatif', v_row; end if;
    if (r ->> 'condition_pct')::int not between 0 and 100 then raise exception '%Kondisi harus 0-100', v_row; end if;
    if r ? 'status' and coalesce(r ->> 'status', '') not in ('pending', 'published', 'rejected', 'hidden') then raise exception '%Status tidak dikenal', v_row; end if;
    if r ? 'item_condition' and r ->> 'item_condition' is not null and r ->> 'item_condition' not in ('baru', 'preloved') then
      raise exception '%Kondisi harus Baru atau Preloved', v_row;
    end if;
    v_cat := null;
    if r ? 'category' then
      select id into v_cat from public.categories where lower(name) = lower(trim(r ->> 'category'));
      if v_cat is null then raise exception '%Jenis barang "%" tidak ada di master data', v_row, r ->> 'category'; end if;
    end if;

    if nullif(r ->> 'id', '') is not null then
      -- ---------- update ----------
      select * into v_p from public.products where id = (r ->> 'id')::bigint for update;
      if not found then raise exception '%Barang dengan ID % tidak ditemukan', v_row, r ->> 'id'; end if;
      update public.products set
        name = case when r ? 'name' then trim(r ->> 'name') else name end,
        category_id = case when r ? 'category' then v_cat else category_id end,
        seller_name = case when r ? 'seller_name' then nullif(trim(r ->> 'seller_name'), '') else seller_name end,
        size = case when r ? 'size' then nullif(trim(r ->> 'size'), '') else size end,
        item_condition = case when r ? 'item_condition' then r ->> 'item_condition' else item_condition end,
        condition_pct = case when r ? 'condition_pct' then (r ->> 'condition_pct')::int else condition_pct end,
        original_price = case when r ? 'original_price' then (r ->> 'original_price')::bigint else original_price end,
        price = case when r ? 'price' then (r ->> 'price')::bigint else price end,
        donation_amount = case when r ? 'donation_amount' then coalesce((r ->> 'donation_amount')::bigint, 0) else donation_amount end,
        status = case when r ? 'status' then r ->> 'status' else status end,
        featured = case when r ? 'featured' then coalesce((r ->> 'featured')::boolean, false) else featured end,
        sort_order = case when r ? 'sort_order' then coalesce((r ->> 'sort_order')::int, 0) else sort_order end,
        summary = case when r ? 'summary' then nullif(r ->> 'summary', '') else summary end,
        condition_note = case when r ? 'condition_note' then nullif(r ->> 'condition_note', '') else condition_note end,
        published_at = case when r ->> 'status' = 'published' then coalesce(published_at, now()) else published_at end,
        reviewed_by = case when r ? 'status' and r ->> 'status' is distinct from v_p.status then auth.uid() else reviewed_by end,
        reviewed_at = case when r ? 'status' and r ->> 'status' is distinct from v_p.status then now() else reviewed_at end
      where id = v_p.id;
      if r ? 'stock' and (r ->> 'stock')::int <> v_p.stock then
        perform set_config('app.stock_type', 'adjust', true);
        perform set_config('app.stock_ref', coalesce(v_p.code, ''), true);
        perform set_config('app.stock_note', v_note, true);
        update public.products set stock = (r ->> 'stock')::int where id = v_p.id;
        v_stock := v_stock + 1;
      end if;
      v_updated := v_updated + 1;
    else
      -- ---------- barang baru ----------
      if coalesce(trim(r ->> 'name'), '') = '' then raise exception '%Barang baru wajib punya nama', v_row; end if;
      if v_cat is null then raise exception '%Barang baru wajib punya jenis barang', v_row; end if;
      if r ->> 'price' is null then raise exception '%Barang baru wajib punya harga jual', v_row; end if;
      v_code := public.setting('product_code_prefix', 'CM') || '-' || lpad(public.next_form_no()::text, 2, '0') || '-1';
      perform set_config('app.stock_note', v_note, true);
      insert into public.products (code, seller_name, category_id, name, size, item_condition, condition_pct, original_price,
        price, donation_amount, stock, summary, condition_note, status, featured, sort_order, reviewed_by, reviewed_at, published_at)
      values (v_code, nullif(trim(r ->> 'seller_name'), ''), v_cat, trim(r ->> 'name'), nullif(trim(r ->> 'size'), ''),
        coalesce(r ->> 'item_condition', 'preloved'), (r ->> 'condition_pct')::int, (r ->> 'original_price')::bigint,
        (r ->> 'price')::bigint, coalesce((r ->> 'donation_amount')::bigint, 0), coalesce((r ->> 'stock')::int, 1),
        nullif(r ->> 'summary', ''), nullif(r ->> 'condition_note', ''), coalesce(r ->> 'status', 'published'),
        coalesce((r ->> 'featured')::boolean, false), coalesce((r ->> 'sort_order')::int, 0), auth.uid(), now(),
        case when coalesce(r ->> 'status', 'published') = 'published' then now() end)
      returning id into v_id;
      if nullif(trim(r ->> 'photo_url'), '') ~ '^https?://' then
        insert into public.product_images (product_id, path, sort) values (v_id, trim(r ->> 'photo_url'), 0);
      end if;
      v_codes := v_codes || v_code;
      v_created := v_created + 1;
    end if;
    perform set_config('app.stock_type', '', true);
    perform set_config('app.stock_ref', '', true);
    perform set_config('app.stock_note', '', true);
  end loop;

  perform public.log_audit('import_products', 'product', null,
    jsonb_build_object('source', p_source, 'updated', v_updated, 'created', v_created, 'stock_changes', v_stock, 'new_codes', v_codes));
  return jsonb_build_object('updated', v_updated, 'created', v_created, 'stock_changes', v_stock, 'new_codes', to_jsonb(v_codes));
end $$;

revoke execute on function public.admin_import_products(jsonb, text) from public, anon;
grant execute on function public.admin_import_products(jsonb, text) to authenticated;
