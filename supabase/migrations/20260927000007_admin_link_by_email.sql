-- ============================================================================
-- Compassion Market -- tautkan akun Auth admin baru ke profil karyawan yang
-- sudah ada (by email), supaya role/nama/departemen tidak hilang/dobel saat
-- karyawan yang sama dipromosikan jadi admin. Aman dijalankan ulang.
-- ============================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_existing uuid;
begin
  select id into v_existing from public.profiles where lower(email) = lower(new.email) and id <> new.id;
  if v_existing is not null then
    update public.profiles set id = new.id, has_login = true where id = v_existing;
  else
    insert into public.profiles (id, email, name, has_login)
    values (new.id, new.email, coalesce(nullif(v_meta ->> 'name', ''), nullif(v_meta ->> 'full_name', ''), split_part(new.email, '@', 1)), true)
    on conflict (id) do update set has_login = true;
  end if;
  return new;
end $$;
