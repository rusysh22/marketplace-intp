// ============================================================================
// Server "Supabase mini" untuk pengembangan & pengujian LOKAL saja.
//   /rest/v1/*     -> PostgREST (Postgres asli + RLS asli dari migrasi)
//   /auth/v1/*     -> tiruan sederhana GoTrue (signup, login, refresh, user)
//   /storage/v1/*  -> tiruan Storage (policy storage.objects tetap dicek di DB)
//   /*             -> file statis dari folder public/ (config.js diisi otomatis)
// Produksi TIDAK memakai file ini — produksi memakai project Supabase asli.
//
// Prasyarat: Postgres lokal + binary PostgREST (env POSTGREST_BIN).
// Jalankan: DATABASE_URL=postgres://postgres:postgres@localhost:5432/market npm run dev
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildSharePage } from '../supabase/functions/share/template.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 54321);
const PGRST_PORT = Number(process.env.PGRST_PORT || 54322);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/market';
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-jwt-secret-please-change-0123456789';
const STORAGE_DIR = path.join(ROOT, 'dev', '.storage');
const PUBLIC_DIR = path.join(ROOT, 'public');

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------- JWT HS256 ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
function signJwt(payload, expSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + expSec, ...payload };
  const data = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(body));
  return data + '.' + crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
}
function verifyJwt(token) {
  try {
    const [h, p, s] = String(token).split('.');
    const expect = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
    if (s !== expect) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url'));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}
const ANON_KEY = signJwt({ role: 'anon', iss: 'local' }, 10 * 365 * 86400);

// ---------- PostgREST ----------
function startPostgrest() {
  const bin = process.env.POSTGREST_BIN || 'postgrest';
  const u = new URL(DATABASE_URL);
  u.username = 'authenticator'; u.password = 'authenticator';
  const conf = path.join(ROOT, 'dev', '.postgrest.conf');
  fs.writeFileSync(conf, [
    `db-uri = "${u.toString()}"`, 'db-schemas = "public"', 'db-anon-role = "anon"',
    `jwt-secret = "${JWT_SECRET}"`, `server-port = ${PGRST_PORT}`, 'server-host = "127.0.0.1"', 'log-level = "warn"'
  ].join('\n'));
  const child = spawn(bin, [conf], { stdio: 'inherit' });
  child.on('exit', (c) => { console.error('PostgREST berhenti', c); process.exit(1); });
  process.on('exit', () => child.kill());
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { child.kill(); process.exit(0); }));
}

// ---------- util HTTP ----------
const readBody = (req) => new Promise((res, rej) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', ...CORS, ...headers });
  res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range, content-location'
};
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const userFromReq = (req) => { const p = verifyJwt(bearer(req)); return p?.role === 'authenticated' ? p : null; };

// ---------- AUTH ----------
const refreshTokens = new Map();
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) { return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
function checkPw(pw, stored) { const [salt] = String(stored).split(':'); return stored && hashPw(pw, salt) === stored; }
function userJson(u) { return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email' }, created_at: u.created_at, email_confirmed_at: u.created_at }; }
function session(u) {
  const access = signJwt({ sub: u.id, role: 'authenticated', email: u.email, aud: 'authenticated' }, 3600);
  const refresh = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJson(u) };
}
async function handleAuth(req, res, url) {
  const route = url.pathname.replace('/auth/v1', '');
  const body = ['POST', 'PUT'].includes(req.method) ? JSON.parse((await readBody(req)).toString() || '{}') : {};
  if (route === '/signup' && req.method === 'POST') {
    if (!body.email || !body.password || body.password.length < 6) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password minimal 6 karakter' });
    try {
      const { rows } = await pool.query('insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1,$2,$3) returning *',
        [body.email.toLowerCase(), hashPw(body.password), body.data || {}]);
      return send(res, 200, session(rows[0]));
    } catch (e) {
      if (e.code === '23505') return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      return send(res, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user: ' + e.message });
    }
  }
  if (route === '/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await pool.query('select * from auth.users where email = $1', [String(body.email || '').toLowerCase()]);
      if (!rows[0] || !checkPw(body.password, rows[0].encrypted_password)) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(rows[0]));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
      return send(res, 200, session(rows[0]));
    }
  }
  if (route === '/user') {
    const u = userFromReq(req);
    if (!u) return send(res, 401, { code: 401, msg: 'invalid JWT' });
    if (req.method === 'PUT' && body.password) await pool.query('update auth.users set encrypted_password = $2 where id = $1', [u.sub, hashPw(body.password)]);
    const { rows } = await pool.query('select * from auth.users where id = $1', [u.sub]);
    return send(res, 200, userJson(rows[0]));
  }
  if (route === '/logout') return send(res, 204);
  if (route === '/settings') return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
  return send(res, 404, { msg: 'not found' });
}

// ---------- STORAGE ----------
async function asUser(u, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(u ? { sub: u.sub, role: 'authenticated' } : { role: 'anon' })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}
function parseMultipart(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype || '');
  if (!m) return { file: buf, type: ctype };
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  let file = null, type = 'application/octet-stream';
  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const next = buf.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(idx + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, sep).toString();
    if (/filename=/i.test(head) || /name=""/.test(head)) {
      file = part.subarray(sep + 4);
      type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || type;
    }
    idx = next;
  }
  return { file, type };
}
const safePath = (bucket, name) => {
  const p = path.join(STORAGE_DIR, bucket, name);
  if (!p.startsWith(path.join(STORAGE_DIR, bucket) + path.sep)) throw new Error('path');
  return p;
};
function serveFile(res, file, type) {
  if (!fs.existsSync(file)) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  const meta = fs.existsSync(file + '.type') ? fs.readFileSync(file + '.type', 'utf8') : type;
  res.writeHead(200, { 'Content-Type': meta || 'application/octet-stream', 'Cache-Control': 'no-cache', ...CORS });
  fs.createReadStream(file).pipe(res);
}
async function handleStorage(req, res, url) {
  const p = decodeURIComponent(url.pathname.replace('/storage/v1', ''));
  const u = userFromReq(req);
  let m;
  if ((m = /^\/object\/public\/([^/]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
    const { rows } = await pool.query('select public from storage.buckets where id = $1', [m[1]]);
    if (!rows[0]?.public) return send(res, 400, { message: 'Bucket not public' });
    return serveFile(res, safePath(m[1], m[2]));
  }
  if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p))) {
    if (req.method === 'GET') {
      const ok = crypto.createHmac('sha256', JWT_SECRET).update(m[1] + '/' + m[2]).digest('hex') === url.searchParams.get('token');
      return ok ? serveFile(res, safePath(m[1], m[2])) : send(res, 400, { message: 'invalid signature' });
    }
    const visible = await asUser(u, (c) => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [m[1], m[2]]));
    if (!visible.rowCount) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const token = crypto.createHmac('sha256', JWT_SECRET).update(m[1] + '/' + m[2]).digest('hex');
    return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2].split('/').map(encodeURIComponent).join('/')}?token=${token}` });
  }
  if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(p)) && (req.method === 'POST' || req.method === 'PUT')) {
    const buf = await readBody(req);
    const { file, type } = parseMultipart(buf, req.headers['content-type']);
    const { rows: [bucket] } = await pool.query('select * from storage.buckets where id = $1', [m[1]]);
    if (!bucket) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    if (bucket.file_size_limit && file.length > bucket.file_size_limit) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(type)) return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
    try {
      await asUser(u, (c) => c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1,$2,$3,$4)', [m[1], m[2], u?.sub || null, { mimetype: type, size: file.length }]));
    } catch (e) {
      return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: e.code === '23505' ? 'The resource already exists' : 'new row violates row-level security policy' });
    }
    const dest = safePath(m[1], m[2]);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file);
    fs.writeFileSync(dest + '.type', type);
    return send(res, 200, { Key: `${m[1]}/${m[2]}`, Id: crypto.randomUUID() });
  }
  if ((m = /^\/object\/([^/]+)$/.exec(p)) && req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    const { rows } = await asUser(u, (c) => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [m[1], prefixes]));
    rows.forEach((r) => fs.rmSync(safePath(m[1], r.name), { force: true }));
    return send(res, 200, rows.map((r) => ({ name: r.name })));
  }
  return send(res, 404, { message: 'not found' });
}

// ---------- REST proxy ----------
function proxyRest(req, res, url) {
  const headers = { ...req.headers };
  delete headers.host;
  if (!headers.authorization) headers.authorization = 'Bearer ' + ANON_KEY;
  const up = http.request({ host: '127.0.0.1', port: PGRST_PORT, method: req.method, path: url.pathname.replace('/rest/v1', '') + url.search, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...CORS });
    r.pipe(res);
  });
  up.on('error', (e) => send(res, 502, { message: 'PostgREST: ' + e.message }));
  req.pipe(up);
}

// ---------- Edge Function tiruan: kartu bagikan (share card) ----------
// Meniru supabase/functions/share/index.ts, tapi query langsung ke Postgres lokal
// (bukan lewat REST/PostgREST) supaya tidak perlu jaringan sama sekali saat diuji.
async function handleShareFunction(req, res, url) {
  const code = url.searchParams.get('p') || '';
  const settingsRows = await pool.query('select key, value from public.settings');
  const settings = Object.fromEntries(settingsRows.rows.map((r) => [r.key, r.value ?? '']));
  let product = null;
  if (code) {
    const isNum = /^\d+$/.test(code);
    const q = isNum
      ? await pool.query('select * from public.catalog where code = $1 or id = $2 limit 1', [code, Number(code)])
      : await pool.query('select * from public.catalog where code = $1 limit 1', [code]);
    product = q.rows[0] || null;
  }
  const siteUrl = settings.site_url || `http://${req.headers.host}`;
  const { html, status } = buildSharePage({ supabaseUrl: `http://${req.headers.host}`, siteUrl, code, product, settings });
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
  res.end(html);
}

// ---------- statis ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    return res.end(`window.CM_CONFIG = ${JSON.stringify({ SUPABASE_URL: `http://${req.headers.host}`, SUPABASE_ANON_KEY: ANON_KEY })};`);
  }
  // /cdn/npm/<pkg>@<ver>/<file> -> node_modules (untuk pengujian offline)
  let file;
  const cdn = /^\/cdn\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/.exec(url.pathname);
  if (cdn) file = path.join(ROOT, 'node_modules', cdn[1], cdn[2]);
  else file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------
startPostgrest();
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204);
  try {
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/storage/v1')) return await handleStorage(req, res, url);
    if (url.pathname === '/functions/v1/share') return await handleShareFunction(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
}).listen(PORT, () => console.log(`Compassion Market lokal: http://localhost:${PORT}`));
