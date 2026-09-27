// ============================================================================
// Konfigurasi koneksi Supabase.
// Ambil dari Supabase Dashboard → Project Settings → API:
//   - Project URL         -> SUPABASE_URL
//   - anon / public key   -> SUPABASE_ANON_KEY  (aman dipasang di frontend; data dijaga RLS)
// JANGAN pernah menaruh service_role key di sini.
// ============================================================================
window.CM_CONFIG = {
  SUPABASE_URL: 'https://eauxnrhagjodwslbuxsr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhdXhucmhhZ2pvZHdzbGJ1eHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1MTQ1MTMsImV4cCI6MjEwNjA5MDUxM30.neHr_3oFdxhI8iLmHj1jxqO29IlMbM7NHCsmWYCbMno'
};
