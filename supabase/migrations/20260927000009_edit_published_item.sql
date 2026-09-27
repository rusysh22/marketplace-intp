-- ============================================================================
-- Compassion Market -- penjual boleh ubah barang yang sudah tayang (kembali
-- ke antrean verifikasi admin), tidak hanya barang pending/ditolak.
-- ============================================================================

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
