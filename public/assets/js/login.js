// Halaman "Pilih identitas" (karyawan, tanpa password) + login admin (Supabase Auth)
import { sb, $, esc, toast, errText, renderNav, getIdentity, setIdentity, getProfile, promptDialog } from './core.js';

const next = new URLSearchParams(location.search).get('next') || 'index.html';
const safeNext = /^[\w.-]+\.html(\?[^#]*)?(#\w+)?$/.test(next) ? next : 'index.html';

(async () => {
  await renderNav('login');
  if (safeNext.startsWith('admin.html')) showAdmin();
  if (await getProfile()) { location.replace(safeNext); return; }
  if (!safeNext.startsWith('admin.html') && getIdentity()) { location.replace(safeNext); return; }

  const result = $('#emp-result');
  $('#form-identity').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#q').value.trim();
    if (!email) return;
    if (!/@interport\.co\.id$/i.test(email)) {
      result.innerHTML = `<p class="notice warn" style="margin:0">Gunakan email kantor <strong>@interport.co.id</strong>, mis. nama.anda@interport.co.id</p>`;
      return;
    }
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    const { data, error } = await sb.rpc('find_employee_by_email', { p_email: email });
    btn.disabled = false;
    if (error) { result.innerHTML = ''; return toast(errText(error), 'error'); }
    const emp = data?.[0];
    if (!emp) {
      result.innerHTML = `<p class="notice warn" style="margin:0">Email tidak ditemukan. Periksa lagi penulisannya, atau hubungi admin untuk didaftarkan.</p>`;
      return;
    }
    result.innerHTML = `<div class="notice" style="margin:0">
        <strong>${esc(emp.name)}</strong>${emp.department ? ` · ${esc(emp.department)}` : ''}<br>
        <span class="small muted">${esc(emp.email)}</span>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="confirm-identity" style="margin-top:10px">✓ Ya, ini saya — lanjutkan</button>`;
    $('#confirm-identity').onclick = () => {
      setIdentity(emp);
      location.replace(safeNext.startsWith('admin.html') ? 'index.html' : safeNext);
    };
  };

  $('#show-admin').onclick = showAdmin;
  $('#show-identity').onclick = () => { $('#pane-admin').classList.add('hidden'); $('#pane-identity').classList.remove('hidden'); };

  $('#form-admin').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
    btn.disabled = false;
    if (error) return toast(errText(error), 'error');
    location.replace(safeNext.startsWith('admin.html') ? safeNext : 'admin.html');
  };

  $('#forgot').onclick = async () => {
    const email = await promptDialog('Masukkan email akun admin Anda. Link reset password akan dikirim.', { title: 'Lupa password', multiline: false });
    if (!email) return;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html?next=admin.html' });
    if (error) return toast(errText(error), 'error');
    toast('Jika email terdaftar, link reset sudah dikirim.', 'ok');
  };
})();

function showAdmin() {
  $('#pane-identity').classList.add('hidden');
  $('#pane-admin').classList.remove('hidden');
}
