-- Uji alur bisnis end-to-end (lokal). Jalankan: npm run test:sql
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'seller@interport.co.id', '{"name":"Sari Penjual","emp_id":"E001"}'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@interport.co.id', '{"name":"Budi Pembeli"}'),
  ('33333333-3333-3333-3333-333333333333', 'admin@interport.co.id', '{"name":"Admin CM"}');
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';

-- helper: bertindak sebagai user tertentu
create or replace function pg_temp.act(p_uid text) returns void language plpgsql as $$
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1) Penjual mengajukan 2 barang
select pg_temp.act('11111111-1111-1111-1111-111111111111');
select public.submit_items('[
  {"name":"Jaket Uniqlo","category_id":9,"size":"L","condition_pct":85,"price":150000,"original_price":250000,"stock":1,
   "summary":"Jaket parka","condition_note":"Ada noda kecil","images":["11111111-1111-1111-1111-111111111111/a.jpg"]},
  {"name":"Mouse Logitech","category_id":1,"condition_pct":95,"price":100000,"stock":2,
   "images":["11111111-1111-1111-1111-111111111111/b.jpg","11111111-1111-1111-1111-111111111111/c.jpg"]}
]'::jsonb, 'Form uji') as submit;
select code, status, seller_name from public.products where seller_id = auth.uid() order by code;

-- Foto milik orang lain ditolak
do $$ begin
  perform public.submit_items('[{"name":"X","category_id":1,"condition_pct":90,"price":1,"images":["22222222-2222-2222-2222-222222222222/x.jpg"]}]');
  raise exception 'SEHARUSNYA GAGAL';
exception when others then
  if sqlerrm = 'SEHARUSNYA GAGAL' then raise; end if;
  raise notice 'OK ditolak: %', sqlerrm;
end $$;

-- 2) Anon tidak melihat barang pending, dan tidak bisa update tabel
reset role;
select pg_temp.act(null);
select count(*) as anon_sees_pending from public.products where status = 'pending';
update public.products set price = 1;   -- RLS: 0 baris
reset role;
select count(*) as price_one_rows from public.products where price = 1;

-- Penjual tidak bisa approve sendiri
select pg_temp.act('11111111-1111-1111-1111-111111111111');
do $$ begin
  perform public.admin_review_product((select id from public.products where code = 'CM-26-1'), 'approve');
  raise exception 'SEHARUSNYA GAGAL';
exception when others then
  if sqlerrm = 'SEHARUSNYA GAGAL' then raise; end if;
  raise notice 'OK ditolak: %', sqlerrm;
end $$;

-- 3) Admin approve CM-26-1 (koreksi harga) dan CM-26-2; buat flash sale untuk CM-26-2
reset role;
select pg_temp.act('33333333-3333-3333-3333-333333333333');
select public.admin_review_product((select id from public.products where code = 'CM-26-1'), 'approve', null, '{"price":140000}');
select public.admin_review_product((select id from public.products where code = 'CM-26-2'), 'approve');
insert into public.flash_sales (name, start_at, end_at) values ('Flash Uji', now() - interval '1 hour', now() + interval '1 hour');
insert into public.flash_sale_items (flash_sale_id, product_id, flash_price, quota)
  values ((select max(id) from public.flash_sales), (select id from public.products where code = 'CM-26-2'), 75000, 1);
select public.admin_dashboard() ->> 'pending_products' as pending_after_review;

-- 4) Pembeli checkout: 1 jaket + 1 mouse (flash)
reset role;
select pg_temp.act('22222222-2222-2222-2222-222222222222');
select code, effective_price, flash_active from public.catalog where code like 'CM-26-%' order by code;
select public.create_order(jsonb_build_array(
  jsonb_build_object('product_id', (select id from public.products where code = 'CM-26-1'), 'qty', 1),
  jsonb_build_object('product_id', (select id from public.products where code = 'CM-26-2'), 'qty', 1)),
  (select id from public.payment_methods where name = 'Transfer BCA'), 'Ambil jam 12') as order_result;
select code, status, subtotal, unique_code between 1 and 299 as has_unique, total = subtotal + unique_code as total_ok from public.orders;
select code, price, normal_price, flash_item_id is not null as flash from public.order_items order by code;

-- stok habis -> order kedua gagal
do $$ begin
  perform public.create_order(jsonb_build_array(jsonb_build_object('product_id', (select id from public.catalog where code = 'CM-26-1'), 'qty', 1)), 2, null);
  raise exception 'SEHARUSNYA GAGAL';
exception when others then
  if sqlerrm = 'SEHARUSNYA GAGAL' then raise; end if;
  raise notice 'OK ditolak: %', sqlerrm;
end $$;

-- 5) Upload bukti, admin verifikasi, siap diambil, selesai, payout
select public.submit_payment_proof((select max(id) from public.orders), '22222222-2222-2222-2222-222222222222/proof.jpg');
reset role;
select pg_temp.act('33333333-3333-3333-3333-333333333333');
select public.admin_verify_payment((select max(id) from public.orders), true, 'Mutasi cocok');
select public.admin_set_order_status((select max(id) from public.orders), 'ready_pickup');
select public.admin_set_order_status((select max(id) from public.orders), 'completed');
select public.admin_mark_payout(array(select id from public.order_items), 'TRF-001') as payout_count;

-- penjual lihat penjualannya
reset role;
select pg_temp.act('11111111-1111-1111-1111-111111111111');
select code, order_status, payout_status, payout_amount from public.my_sales order by code;

-- 6) Order kedaluwarsa mengembalikan stok
reset role;
select pg_temp.act('22222222-2222-2222-2222-222222222222');
select public.create_order(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where code = 'CM-26-2'), 'qty', 1)),
  (select id from public.payment_methods where name = 'Transfer Mandiri')) ->> 'code' as order2;
reset role;
select code, stock from public.products where code = 'CM-26-2';
update public.orders set expires_at = now() - interval '1 minute' where status = 'waiting_payment';
select public.expire_orders() as expired;
select code, stock from public.products where code = 'CM-26-2';

-- kartu stok
select p.code, m.type, m.qty_change, m.balance, m.ref from public.stock_movements m join public.products p on p.id = m.product_id
where p.code like 'CM-26-%' order by m.id;
rollback;
