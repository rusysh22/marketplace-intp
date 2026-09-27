// Halaman "Pilih identitas" (karyawan, tanpa password) + login admin (Supabase Auth)
import { sb, $, $$, esc, toast, errText, renderNav, getIdentity, setIdentity, getProfile, promptDialog } from './core.js';

const next = new URLSearchParams(location.search).get('next') || 'index.html';
const safeNext = /^[\w.-]+\.html(\?[^#]*)?(#\w+)?$/.test(next) ? next : 'index.html';

(async () => {
  await renderNav('login');
  if (safeNext.startsWith('admin.html')) showAdmin();
  if (await getProfile()) { location.replace(safeNext); return; }
  if (!safeNext.startsWith('admin.html') && getIdentity()) { location.replace(safeNext); return; }

  let employees = [];
  try {
    const { data, error } = await sb.rpc('employee_directory');
    if (error) throw error;
    employees = data || [];
  } catch (e) { toast(errText(e), 'error'); }

  const renderList = (q) => {
    const list = $('#emp-list'), qq = q.trim().toLowerCase();
    const filtered = qq ? employees.filter((e) => (e.name + ' ' + (e.email || '')).toLowerCase().includes(qq)) : employees;
    $('#emp-empty').hidden = filtered.length > 0;
    list.innerHTML = filtered.slice(0, 50).map((e) => `<button type="button" class="btn btn-ghost" style="justify-content:flex-start;text-align:left" data-id="${esc(e.id)}">
        <strong>${esc(e.name)}</strong>${e.department ? ` <span class="small muted">· ${esc(e.department)}</span>` : ''}
        ${e.email ? `<div class="small muted">${esc(e.email)}</div>` : ''}
      </button>`).join('');
    $$('[data-id]', list).forEach((b) => (b.onclick = () => {
      const emp = employees.find((e) => e.id === b.dataset.id);
      setIdentity(emp);
      location.replace(safeNext.startsWith('admin.html') ? 'index.html' : safeNext);
    }));
  };
  renderList('');
  $('#q').oninput = (e) => renderList(e.target.value);

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
