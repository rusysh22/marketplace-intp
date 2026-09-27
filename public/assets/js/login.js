// Halaman masuk / daftar (Supabase Auth, email + password)
import { sb, $, $$, toast, errText, renderNav, loadSettings, getProfile, promptDialog } from './core.js';

const next = new URLSearchParams(location.search).get('next') || 'index.html';
const safeNext = /^[\w.-]+\.html(\?[^#]*)?(#\w+)?$/.test(next) ? next : 'index.html';

(async () => {
  await renderNav('login');
  if (await getProfile()) { location.replace(safeNext); return; }
  let s = {};
  try { s = await loadSettings(); } catch {}
  const domain = String(s.allowed_email_domain || '').replace(/^@/, '').trim();
  if (domain) $('#domain-hint').textContent = `Wajib memakai email @${domain}`;
  if (s.allow_registration === '0') $('[data-tab=register]').hidden = true;

  $$('[data-tab]').forEach((b) => (b.onclick = () => {
    $$('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#form-login').classList.toggle('hidden', b.dataset.tab !== 'login');
    $('#form-register').classList.toggle('hidden', b.dataset.tab !== 'register');
  }));

  $('#form-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
    btn.disabled = false;
    if (error) return toast(errText(error), 'error');
    location.replace(safeNext);
  };

  $('#form-register').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = $('button[type=submit]', e.target);
    const email = f.get('email').trim();
    if (domain && !email.toLowerCase().endsWith('@' + domain.toLowerCase())) return toast(`Gunakan email @${domain}`, 'error');
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email, password: f.get('password'),
      options: { data: { name: f.get('name').trim(), emp_id: f.get('emp_id').trim(), department: f.get('department').trim(), phone: f.get('phone').trim() },
                 emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html' }
    });
    btn.disabled = false;
    if (error) return toast(errText(error), 'error');
    if (!data.session) { toast('Pendaftaran berhasil. Cek email Anda untuk konfirmasi, lalu masuk.', 'ok'); $('[data-tab=login]').click(); return; }
    toast('Akun dibuat. Selamat datang!', 'ok');
    location.replace(safeNext);
  };

  $('#forgot').onclick = async () => {
    const email = await promptDialog('Masukkan email akun Anda. Link reset password akan dikirim.', { title: 'Lupa password', multiline: false });
    if (!email) return;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'sell.html#profile' });
    if (error) return toast(errText(error), 'error');
    toast('Jika email terdaftar, link reset sudah dikirim.', 'ok');
  };
})();
