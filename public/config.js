// ============================================================================
// Konfigurasi koneksi Supabase.
// Ambil dari Supabase Dashboard → Project Settings → API:
//   - Project URL         -> SUPABASE_URL
//   - anon / public key   -> SUPABASE_ANON_KEY  (aman dipasang di frontend; data dijaga RLS)
// JANGAN pernah menaruh service_role key di sini.
// ============================================================================
window.CM_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'ISI_ANON_KEY_ANDA'
};
