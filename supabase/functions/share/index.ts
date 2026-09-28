// ============================================================================
// Edge Function: /functions/v1/share?p=<kode-atau-id>
// Menyajikan halaman HTML dengan meta Open Graph (foto, judul, harga, nama toko)
// supaya WhatsApp/Telegram/dll menampilkan kartu pratinjau saat tautan dibagikan,
// lalu meneruskan pengguna sungguhan ke halaman katalog SPA yang sebenarnya.
//
// Deploy: supabase functions deploy share --no-verify-jwt
// (fungsi ini harus bisa diakses tanpa login karena dipanggil oleh crawler chat app)
// ============================================================================
import { buildSharePage } from './template.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

async function restGet(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
  });
  if (!r.ok) return [];
  return r.json();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('p') || '';
  const enc = encodeURIComponent(code);
  const isNum = /^\d+$/.test(code);
  const filter = !code ? '' : isNum ? `or=(code.eq.${enc},id.eq.${enc})` : `code=eq.${enc}`;

  const [settingsRows, products] = await Promise.all([
    restGet('settings?select=key,value'),
    filter ? restGet(`catalog?${filter}&select=*&limit=1`) : Promise.resolve([])
  ]);
  const settings: Record<string, string> = Object.fromEntries(
    (Array.isArray(settingsRows) ? settingsRows : []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const siteUrl = settings.site_url || SUPABASE_URL;

  const { html, status } = buildSharePage({
    supabaseUrl: SUPABASE_URL, siteUrl, code, product: Array.isArray(products) ? products[0] : null, settings
  });

  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
});
