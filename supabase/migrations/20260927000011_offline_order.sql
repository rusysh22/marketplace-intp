-- ============================================================================
-- Compassion Market -- admin bisa mencatat transaksi yang terjadi offline/tunai
-- langsung sebagai pesanan lunas, tanpa alur bayar online.
-- ============================================================================

create or replace function public.admin_create_offline_order(p_items jsonb, p_buyer_name text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_item jsonb;
  v_p public.products;
  v_qty int;
  v_subtotal bigint := 0;
  v_order_id bigint;
  v_code text;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
begin
  perform public.assert_admin();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Pilih minimal satu barang'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item ->> 'qty')::int, 1));
    select * into v_p from public.products where id = (v_item ->> 'product_id')::bigint for update;
    if not found or v_p.status <> 'published' then raise exception 'Barang tidak tersedia lagi'; end if;
    if v_p.stock < v_qty then raise exception 'Stok "%" tidak cukup (sisa %)', v_p.name, v_p.stock; end if;
    v_subtotal := v_subtotal + v_p.price * v_qty;
    v_lines := v_lines || jsonb_build_object('product_id', v_p.id, 'seller_id', v_p.seller_id, 'seller_name', v_p.seller_name,
      'code', v_p.code, 'name', v_p.name, 'price', v_p.price, 'qty', v_qty);
  end loop;

  v_code := 'OFF-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 5));
  insert into public.orders (code, buyer_id, buyer_name, status, payment_method_id, payment_snapshot, subtotal, admin_fee,
    unique_code, total, admin_note, paid_at)
  values (v_code, v_admin, coalesce(nullif(trim(p_buyer_name), ''), 'Pembeli langsung (offline)'), 'paid', null,
    jsonb_build_object('type', 'offline', 'name', 'Transaksi offline / tunai'),
    v_subtotal, 0, 0, v_subtotal, coalesce(nullif(trim(p_note), ''), 'Dicatat manual oleh admin (transaksi offline)'), now())
  returning id into v_order_id;

  perform set_config('app.stock_type', 'sale', true);
  perform set_config('app.stock_ref', v_code, true);
  perform set_config('app.stock_note', 'Penjualan offline dicatat admin', true);
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, product_id, seller_id, seller_name, code, name, price, normal_price, qty)
    values (v_order_id, (v_line ->> 'product_id')::bigint, nullif(v_line ->> 'seller_id', '')::uuid, v_line ->> 'seller_name',
      v_line ->> 'code', v_line ->> 'name', (v_line ->> 'price')::bigint, (v_line ->> 'price')::bigint, (v_line ->> 'qty')::int);
    update public.products set stock = stock - (v_line ->> 'qty')::int where id = (v_line ->> 'product_id')::bigint;
  end loop;
  perform set_config('app.stock_type', '', true);
  perform set_config('app.stock_ref', '', true);
  perform set_config('app.stock_note', '', true);

  perform public.log_audit('create_offline_order', 'order', v_order_id, jsonb_build_object('code', v_code, 'total', v_subtotal));
  return jsonb_build_object('order_id', v_order_id, 'code', v_code, 'total', v_subtotal);
end $$;
