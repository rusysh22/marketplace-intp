// ============================================================================
// Kartu bagikan (share card): halaman HTML statis dengan meta Open Graph, dibuat
// terpisah dari index.ts agar bisa dipakai ulang di harness lokal (dev/local-supabase.mjs)
// tanpa bergantung pada runtime Deno.
// ============================================================================
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function rupiah(n) {
  return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

export function imgUrl(supabaseUrl, path, bucket = 'product-photos') {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${String(supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${path}`;
}

function page({ title, description, image, url, siteName, redirectUrl, price }) {
  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
${price != null ? `<meta property="product:price:amount" content="${Math.round(Number(price) || 0)}">
<meta property="product:price:currency" content="IDR">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
<meta http-equiv="refresh" content="0;url=${esc(redirectUrl)}">
<link rel="canonical" href="${esc(redirectUrl)}">
</head><body>
<p>Mengalihkan ke ${esc(siteName)}&hellip; Jika tidak otomatis, <a href="${esc(redirectUrl)}">klik di sini</a>.</p>
</body></html>`;
}

// product: baris dari view public.catalog (name, code, id, summary, images[], effective_price/price)
// settings: object hasil {key: value} dari tabel public.settings
export function buildSharePage({ supabaseUrl, siteUrl, code, product, settings }) {
  const storeName = settings.store_name || 'Compassion Market';
  const base = String(siteUrl || '').replace(/\/$/, '');
  const catalogUrl = `${base}/index.html?p=${encodeURIComponent(code || '')}`;
  if (!product) {
    return {
      status: 404,
      html: page({
        title: `Barang tidak ditemukan · ${storeName}`,
        description: 'Barang yang Anda cari tidak ditemukan atau sudah tidak tayang.',
        image: '', url: catalogUrl, siteName: storeName, redirectUrl: catalogUrl
      })
    };
  }
  const price = product.effective_price ?? product.price;
  const img = Array.isArray(product.images) && product.images[0] ? imgUrl(supabaseUrl, product.images[0]) : '';
  const desc = `${rupiah(price)}${product.summary ? ' — ' + String(product.summary).slice(0, 140) : ''}`;
  return {
    status: 200,
    html: page({
      title: `${product.name} · ${storeName}`,
      description: desc, image: img, url: catalogUrl, siteName: storeName, redirectUrl: catalogUrl, price
    })
  };
}
