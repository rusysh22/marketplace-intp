// ============================================================================
// Admin → Produk & stok: export ke Excel (.xlsx) dan import untuk update massal.
// Alur (mirip Excel add-in di ERP): Export → edit di Excel → Import → pratinjau
// perubahan → Terapkan (satu transaksi via RPC admin_import_products).
// ExcelJS dimuat hanya saat tombol dipakai supaya halaman admin tetap ringan.
// ============================================================================
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

export const STATUS_LABEL = { published: 'Tayang', pending: 'Menunggu verifikasi', rejected: 'Ditolak', hidden: 'Disembunyikan' };
const CONDITION_LABEL = { baru: 'Baru', preloved: 'Preloved' };

// Kolom sheet "Produk". ro = hanya info (tidak diimpor untuk barang yang sudah ada).
export const COLUMNS = [
  { k: 'id', h: 'ID', w: 8, ro: true, note: 'Kunci baris — jangan diubah. Kosongkan untuk barang baru.' },
  { k: 'code', h: 'Kode', w: 11, ro: true, note: 'Dibuat otomatis oleh sistem.' },
  { k: 'name', h: 'Nama barang', w: 36 },
  { k: 'category', h: 'Jenis barang', w: 22, list: 'category' },
  { k: 'seller_name', h: 'Penjual', w: 22 },
  { k: 'size', h: 'Ukuran', w: 10 },
  { k: 'item_condition', h: 'Kondisi', w: 12, list: 'condition' },
  { k: 'condition_pct', h: 'Kondisi (%)', w: 11, type: 'int', min: 0, max: 100 },
  { k: 'original_price', h: 'Harga coret', w: 14, type: 'money' },
  { k: 'price', h: 'Harga jual', w: 14, type: 'money' },
  { k: 'donation_amount', h: 'Donasi', w: 12, type: 'money' },
  { k: 'stock', h: 'Stok', w: 8, type: 'int', min: 0 },
  { k: 'status', h: 'Status', w: 20, list: 'status' },
  { k: 'featured', h: 'Pilihan (★)', w: 11, list: 'yesno' },
  { k: 'sort_order', h: 'Urutan tampil', w: 12, type: 'int' },
  { k: 'summary', h: 'Deskripsi', w: 50, wrap: true },
  { k: 'condition_note', h: 'Catatan kondisi', w: 40, wrap: true },
  { k: 'photo_url', h: 'Foto utama (URL)', w: 40, note: 'Hanya dipakai untuk barang BARU. Foto barang lama diubah lewat tombol Edit.' },
  { k: 'updated_at', h: 'Terakhir diubah', w: 18, ro: true, note: 'Dipakai untuk mendeteksi data yang diubah orang lain setelah export.' }
];
const EDITABLE = COLUMNS.filter((c) => !c.ro && c.k !== 'photo_url').map((c) => c.k);
const LABEL = Object.fromEntries(COLUMNS.map((c) => [c.k, c.h]));

let loading;
async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { loading = null; reject(new Error('Gagal memuat library Excel. Periksa koneksi internet.')); };
    document.head.appendChild(s);
  });
  return loading;
}

// Nilai DB -> nilai tampilan di Excel
function toCell(p, k, catName) {
  switch (k) {
    case 'category': return catName(p.category_id) === '-' ? '' : catName(p.category_id);
    case 'item_condition': return CONDITION_LABEL[p.item_condition] || '';
    case 'status': return STATUS_LABEL[p.status] || p.status;
    case 'featured': return p.featured ? 'Ya' : 'Tidak';
    case 'photo_url': { const i = (p.product_images || []).slice().sort((a, b) => a.sort - b.sort)[0]?.path; return i || ''; }
    case 'updated_at': return p.updated_at ? new Date(p.updated_at) : '';
    default: return p[k] ?? '';
  }
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
export async function exportProducts(list, categories, { storeName = 'Compassion Market', filterLabel = '' } = {}) {
  const ExcelJS = await loadExcelJS();
  const catName = (id) => categories.find((c) => c.id === id)?.name || '-';
  const wb = new ExcelJS.Workbook();
  wb.creator = storeName;
  wb.created = new Date();

  // --- Master (sumber dropdown) ---
  const master = wb.addWorksheet('Master');
  const cats = categories.filter((c) => c.active !== false).map((c) => c.name);
  const lists = {
    category: ['Jenis barang', cats.length ? cats : ['-']],
    status: ['Status', Object.values(STATUS_LABEL)],
    condition: ['Kondisi', Object.values(CONDITION_LABEL)],
    yesno: ['Pilihan (★)', ['Ya', 'Tidak']]
  };
  const ranges = {};
  Object.entries(lists).forEach(([key, [title, values]], i) => {
    const col = master.getColumn(i + 1);
    col.width = 26;
    master.getCell(1, i + 1).value = title;
    master.getCell(1, i + 1).font = { bold: true };
    values.forEach((v, j) => { master.getCell(j + 2, i + 1).value = v; });
    const letter = col.letter;
    ranges[key] = `Master!$${letter}$2:$${letter}$${values.length + 1}`;
  });

  // --- Produk ---
  const ws = wb.addWorksheet('Produk', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.h, key: c.k, width: c.w }));
  list.forEach((p) => ws.addRow(Object.fromEntries(COLUMNS.map((c) => [c.k, toCell(p, c.k, catName)]))));
  const lastRow = Math.max(list.length + 1, 2);
  const header = ws.getRow(1);
  header.height = 22;
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.ro ? 'FF5B6B73' : 'FF123C56' } };
    cell.alignment = { vertical: 'middle' };
    if (c.note) cell.note = c.note;
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0';
    if (c.k === 'updated_at') col.numFmt = 'dd/mm/yyyy hh:mm';
    if (c.wrap) col.alignment = { wrapText: true, vertical: 'top' };
  });
  // validasi & warna kolom read-only sampai 500 baris di bawah data (untuk barang baru)
  const maxRow = lastRow + 500;
  for (let r = 2; r <= maxRow; r++) {
    COLUMNS.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      if (c.ro && r <= lastRow) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F3' } };
      if (c.list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [ranges[c.list]], showErrorMessage: true, errorTitle: c.h, error: `Pilih ${c.h} dari daftar.` };
      else if (c.type === 'money' || (c.type === 'int' && c.min != null)) {
        cell.dataValidation = { type: 'whole', operator: c.max != null ? 'between' : 'greaterThanOrEqual', allowBlank: true,
          formulae: c.max != null ? [c.min, c.max] : [c.min ?? 0], showErrorMessage: true, errorTitle: c.h,
          error: c.max != null ? `Isi angka ${c.min}-${c.max}.` : 'Isi angka bulat ≥ 0.' };
      }
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  // --- Petunjuk ---
  const help = wb.addWorksheet('Petunjuk');
  help.getColumn(1).width = 110;
  [
    [`${storeName} — Export data barang`, true],
    [`Diekspor: ${new Date().toLocaleString('id-ID')}${filterLabel ? ' · Filter: ' + filterLabel : ''} · ${list.length} barang`],
    [''],
    ['CARA UPDATE DATA', true],
    ['1. Ubah nilai di sheet "Produk" (nama, jenis, harga, stok, status, dsb.). Kolom berwarna abu-abu (ID, Kode, Terakhir diubah) jangan diubah.'],
    ['2. Jenis barang, Kondisi, Status, dan Pilihan memakai dropdown sesuai master data. Harga & stok harus angka bulat ≥ 0.'],
    ['3. Tambah barang baru: isi baris kosong di bawah data dengan kolom ID dikosongkan. Wajib: Nama barang, Jenis barang, Harga jual. Kode dibuat otomatis.'],
    ['4. Hapus baris dari file TIDAK menghapus barang di sistem (baris yang tidak ada di file dianggap tidak berubah). Untuk menurunkan barang, ubah Status menjadi "Disembunyikan".'],
    ['5. Simpan file (.xlsx), lalu di halaman Admin → Produk & stok klik "Import Excel". Sistem menampilkan pratinjau perubahan sebelum diterapkan.'],
    ['6. Perubahan stok tercatat otomatis di kartu stok dengan keterangan "Import Excel". Semua baris diterapkan sekaligus; jika ada satu error, tidak ada yang tersimpan.'],
    ['7. Jika barang diubah orang lain setelah file ini diekspor, pratinjau akan memberi peringatan agar tidak saling menimpa.']
  ].forEach(([t, bold], i) => { const c = help.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true }; if (bold) c.font = { bold: true, size: i ? 11 : 14 }; });

  // urutan tab: Produk, Master, Petunjuk (sheet Master dibuat duluan untuk sumber dropdown)
  ws.orderNo = 0; master.orderNo = 1; help.orderNo = 2;
  wb.views = [{ activeTab: 0 }];

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `produk-compassion-market-${stamp}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------------------
// IMPORT: baca file → normalisasi → bandingkan dengan data saat ini
// ---------------------------------------------------------------------------
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return cellValue(v.result);            // sel rumus
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;                          // hyperlink
    return null;
  }
  return v;
}
function toInt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
const text = (v) => (v == null ? null : (String(v).trim() || null));

export async function readImport(file, categories) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error('File tidak bisa dibaca. Pastikan formatnya .xlsx (Excel 2007 ke atas).'); }
  const ws = wb.getWorksheet('Produk') || wb.worksheets[0];
  if (!ws) throw new Error('Sheet "Produk" tidak ditemukan');

  // peta header -> kolom (berdasarkan nama header, jadi urutan kolom boleh diubah)
  const colOf = {};
  ws.getRow(1).eachCell((cell, n) => {
    const h = norm(cellValue(cell.value));
    const c = COLUMNS.find((x) => norm(x.h) === h);
    if (c) colOf[c.k] = n;
  });
  if (!colOf.id) throw new Error('Kolom "ID" tidak ditemukan di baris pertama. Gunakan file hasil "Export Excel".');
  const present = COLUMNS.filter((c) => colOf[c.k]).map((c) => c.k);

  const catByName = Object.fromEntries(categories.map((c) => [norm(c.name), c]));
  const statusByLabel = Object.fromEntries(Object.entries(STATUS_LABEL).flatMap(([k, l]) => [[norm(l), k], [k, k]]));
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const raw = Object.fromEntries(present.map((k) => [k, cellValue(row.getCell(colOf[k]).value)]));
    if (Object.values(raw).every((v) => v == null || String(v).trim() === '')) return;
    const errors = [];
    const out = { row: n };
    const idRaw = raw.id;
    out.id = idRaw == null || String(idRaw).trim() === '' ? null : toInt(idRaw);
    if (Number.isNaN(out.id)) errors.push('ID tidak valid');
    for (const k of present) {
      const v = raw[k];
      switch (k) {
        case 'id': case 'code': case 'updated_at': break;
        case 'name': case 'seller_name': case 'size': case 'summary': case 'condition_note': case 'photo_url':
          out[k] = text(v); break;
        case 'category': {
          const t = text(v);
          if (t == null) { out[k] = null; break; }
          const c = catByName[norm(t)];
          if (!c) errors.push(`Jenis barang "${t}" tidak ada di master data`); else out[k] = c.name;
          break;
        }
        case 'item_condition': {
          const t = norm(v);
          out[k] = !t ? null : t.startsWith('baru') ? 'baru' : t.startsWith('prelov') || t.startsWith('bekas') ? 'preloved' : (errors.push('Kondisi harus Baru/Preloved'), undefined);
          break;
        }
        case 'status': {
          const t = norm(v);
          if (!t) { errors.push('Status wajib diisi'); break; }
          out[k] = statusByLabel[t] ?? (errors.push(`Status "${v}" tidak dikenal`), undefined);
          break;
        }
        case 'featured': { const t = norm(v); out[k] = ['ya', 'yes', 'true', '1', 'y', '★'].includes(t); break; }
        default: {                                   // angka
          const n2 = toInt(v);
          if (Number.isNaN(n2)) { errors.push(`${LABEL[k]} harus angka`); break; }
          const col = COLUMNS.find((c) => c.k === k);
          if (n2 != null && ((col.min != null && n2 < col.min) || (col.type === 'money' && n2 < 0))) errors.push(`${LABEL[k]} tidak boleh negatif`);
          if (n2 != null && col.max != null && n2 > col.max) errors.push(`${LABEL[k]} maksimal ${col.max}`);
          out[k] = n2;
        }
      }
    }
    if (out.id == null) {
      if (!out.name) errors.push('Barang baru wajib punya Nama barang');
      if (!out.category) errors.push('Barang baru wajib punya Jenis barang');
      if (out.price == null) errors.push('Barang baru wajib punya Harga jual');
    } else {
      if ('name' in out && !out.name) errors.push('Nama barang tidak boleh kosong');
      if ('price' in out && out.price == null) errors.push('Harga jual tidak boleh kosong');
      if ('stock' in out && out.stock == null) errors.push('Stok tidak boleh kosong');
      if ('category' in out && !out.category && !errors.some((e) => e.startsWith('Jenis'))) errors.push('Jenis barang tidak boleh kosong');
    }
    const exportedAt = raw.updated_at instanceof Date ? raw.updated_at : null;
    rows.push({ data: out, errors, exportedAt, code: text(raw.code) });
  });
  return { rows, sheet: ws.name, fileName: file.name };
}

// Bandingkan dengan data saat ini -> daftar perubahan per baris
export function diffImport(parsed, current, categories) {
  const byId = new Map(current.map((p) => [p.id, p]));
  const catName = (id) => categories.find((c) => c.id === id)?.name ?? null;
  const seen = new Set();
  const result = { updates: [], creates: [], errors: [], warnings: [], unchanged: 0 };
  for (const r of parsed.rows) {
    const d = r.data;
    if (r.errors.length) { result.errors.push({ row: d.row, label: d.name || r.code || '', messages: r.errors }); continue; }
    if (d.id == null) { result.creates.push({ row: d.row, payload: stripUndefined(d), label: d.name }); continue; }
    if (seen.has(d.id)) { result.errors.push({ row: d.row, label: r.code || d.name, messages: [`ID ${d.id} muncul lebih dari sekali di file`] }); continue; }
    seen.add(d.id);
    const p = byId.get(d.id);
    if (!p) { result.errors.push({ row: d.row, label: r.code || d.name, messages: [`Barang ID ${d.id} tidak ditemukan (mungkin sudah dihapus)`] }); continue; }
    const before = { ...p, category: catName(p.category_id), featured: !!p.featured };
    const changes = [];
    const payload = { id: d.id, row: d.row };
    for (const k of EDITABLE) {
      if (!(k in d) || d[k] === undefined) continue;
      const a = before[k] ?? null, b = d[k] ?? null;
      const same = typeof a === 'number' || typeof b === 'number' ? Number(a ?? NaN) === Number(b ?? NaN) || (a == null && b == null)
        : String(a ?? '').trim() === String(b ?? '').trim();
      if (!same) { changes.push({ k, label: LABEL[k], from: fmt(k, a), to: fmt(k, b) }); payload[k] = b; }
    }
    if (!changes.length) { result.unchanged++; continue; }
    if (r.exportedAt && p.updated_at && new Date(p.updated_at) - r.exportedAt > 1500) {
      result.warnings.push({ row: d.row, label: p.code || p.name, message: 'Diubah di sistem setelah file diekspor — perubahan dari file akan menimpanya.' });
    }
    result.updates.push({ row: d.row, id: d.id, label: `${p.code || ''} ${p.name}`.trim(), changes, payload });
  }
  return result;
}
const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
function fmt(k, v) {
  if (v == null || v === '') return '—';
  if (k === 'status') return STATUS_LABEL[v] || v;
  if (k === 'item_condition') return CONDITION_LABEL[v] || v;
  if (k === 'featured') return v ? 'Ya' : 'Tidak';
  if (['price', 'original_price', 'donation_amount'].includes(k)) return 'Rp' + Number(v).toLocaleString('id-ID');
  return String(v);
}
