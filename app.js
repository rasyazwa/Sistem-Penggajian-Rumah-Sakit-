const pageTitles = { dashboard: 'Ringkasan', employees: 'Pegawai', attendance: 'Kehadiran', payroll: 'Penggajian' };
const state = { employees: [], departments: [], payrolls: [], attendance: [] };
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const localMode = location.protocol === 'file:';
const localDataKey = 'ruang-gaji-local-v1';
let localData;
function browserData() {
  if (!localData) {
    try { localData = JSON.parse(localStorage.getItem(localDataKey) || 'null'); } catch { localData = null; }
    if (!localData || !Array.isArray(localData.departments)) {
      localData = { departments: ['Keperawatan', 'Medis', 'Farmasi', 'Administrasi', 'Laboratorium'].map((name) => ({ id: crypto.randomUUID(), name })), employees: [], attendance: [], payrolls: [] };
      saveBrowserData();
    }
  }
  return localData;
}
function saveBrowserData() {
  try {
    localStorage.setItem(localDataKey, JSON.stringify(localData));
    const label = document.querySelector('#storage-mode');
    if (label) label.textContent = 'Mode lokal · tersimpan di browser';
  } catch {
    const label = document.querySelector('#storage-mode');
    if (label) label.textContent = 'Mode lokal · penyimpanan sementara';
  }
}
function localApi(path, options = {}) {
  const data = browserData();
  const body = options.body || {};
  const employeeById = (id) => data.employees.find((employee) => employee.id === id);
  const withEmployee = (record) => {
    const employee = employeeById(record.employee_id);
    return { ...record, employees: employee ? { full_name: employee.full_name, employee_code: employee.employee_code } : null };
  };
  if (!options.method || options.method === 'GET') {
    if (path === 'summary') return { message: 'Mode lokal aktif. Data disimpan di browser ini.' };
    if (path === 'departments') return [...data.departments].sort((a, b) => a.name.localeCompare(b.name));
    if (path === 'employees') return data.employees.filter((employee) => employee.is_active).map((employee) => ({ ...employee, departments: { name: data.departments.find((department) => department.id === employee.department_id)?.name || '' } })).sort((a, b) => a.full_name.localeCompare(b.full_name));
    if (path === 'attendance') return data.attendance.map(withEmployee).sort((a, b) => b.attendance_date.localeCompare(a.attendance_date)).slice(0, 100);
    if (path === 'payrolls') return data.payrolls.map(withEmployee).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
    throw new Error('Rute tidak ditemukan.');
  }
  if (options.method !== 'POST') throw new Error('Metode tidak didukung.');
  const id = crypto.randomUUID();
  if (path === 'employees') {
    if (data.employees.some((employee) => employee.employee_code === body.employee_code)) throw new Error('NIP sudah terdaftar.');
    if (!data.departments.some((department) => department.id === body.department_id)) throw new Error('Unit kerja tidak ditemukan.');
    if (!Number.isFinite(Number(body.base_salary)) || Number(body.base_salary) < 0) throw new Error('Gaji pokok harus berupa angka nol atau lebih.');
    data.employees.push({ id, ...body, base_salary: Number(body.base_salary), is_active: true, created_at: new Date().toISOString() });
  } else if (path === 'attendance') {
    if (!employeeById(body.employee_id)) throw new Error('Pegawai tidak ditemukan.');
    if (!['present', 'sick', 'leave', 'absent'].includes(body.status)) throw new Error('Status kehadiran tidak valid.');
    if (data.attendance.some((item) => item.employee_id === body.employee_id && item.attendance_date === body.attendance_date)) throw new Error('Kehadiran pegawai pada tanggal tersebut sudah dicatat.');
    data.attendance.push({ id, ...body, created_at: new Date().toISOString() });
  } else if (path === 'payrolls') {
    const employee = employeeById(body.employee_id);
    if (!employee) throw new Error('Pegawai tidak ditemukan.');
    const allowance = Number(body.allowance); const deductions = Number(body.deductions);
    if (body.period_end < body.period_start) throw new Error('Akhir periode harus setelah awal periode.');
    if (![allowance, deductions].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new Error('Tunjangan dan potongan harus berupa angka nol atau lebih.');
    if (deductions > employee.base_salary + allowance) throw new Error('Potongan tidak boleh melebihi gaji pokok ditambah tunjangan.');
    if (data.payrolls.some((item) => item.employee_id === body.employee_id && item.period_start === body.period_start && item.period_end === body.period_end)) throw new Error('Penggajian untuk periode tersebut sudah dibuat.');
    data.payrolls.push({ id, ...body, base_salary: employee.base_salary, allowance, deductions, net_salary: employee.base_salary + allowance - deductions, created_at: new Date().toISOString() });
  } else {
    throw new Error('Rute tidak ditemukan.');
  }
  saveBrowserData();
  return { id };
}
const api = async (path, options = {}) => {
  if (localMode) return localApi(path, options);
  const response = await fetch(`/api/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Permintaan tidak dapat diproses.');
  return result;
};
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatDate = (value) => value ? dateFormat.format(new Date(`${value}T00:00:00`)) : '—';
const getInitials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
const statusNames = { present: 'Hadir', sick: 'Sakit', leave: 'Izin', absent: 'Tidak hadir' };

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}
function setTableMessage(id, message, columns) {
  document.querySelector(`#${id}`).innerHTML = `<tr><td class="empty-cell" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}
function renderEmployees(filter = '') {
  const rows = state.employees.filter((employee) => `${employee.employee_code} ${employee.full_name} ${employee.position} ${employee.departments?.name || ''}`.toLowerCase().includes(filter.toLowerCase()));
  document.querySelector('#employee-count').textContent = `${state.employees.length} pegawai terdaftar`;
  document.querySelector('#employees-body').innerHTML = rows.length ? rows.map((employee) => `<tr><td>${escapeHtml(employee.employee_code)}</td><td><span class="person-cell"><span class="person-initial">${escapeHtml(getInitials(employee.full_name))}</span><span class="person-name">${escapeHtml(employee.full_name)}</span></span></td><td>${escapeHtml(employee.departments?.name || '—')}</td><td>${escapeHtml(employee.position)}</td><td>${rupiah.format(employee.base_salary)}</td></tr>`).join('') : `<tr><td class="empty-cell" colspan="5">${filter ? 'Pegawai tidak ditemukan.' : 'Belum ada data pegawai.'}</td></tr>`;
}
function renderAttendance() {
  document.querySelector('#attendance-body').innerHTML = state.attendance.length ? state.attendance.map((item) => `<tr><td>${formatDate(item.attendance_date)}</td><td class="person-name">${escapeHtml(item.employees?.full_name || 'Pegawai')}</td><td>${escapeHtml(item.employees?.employee_code || '—')}</td><td><span class="status-pill status-${escapeHtml(item.status)}">${statusNames[item.status] || '—'}</span></td></tr>`).join('') : '<tr><td class="empty-cell" colspan="4">Belum ada catatan kehadiran.</td></tr>';
}
function renderPayrolls() {
  const rows = state.payrolls;
  document.querySelector('#payroll-body').innerHTML = rows.length ? rows.map((item) => `<tr><td><span class="person-cell"><span class="person-initial">${escapeHtml(getInitials(item.employees?.full_name))}</span><span><span class="person-name">${escapeHtml(item.employees?.full_name || 'Pegawai')}</span><small class="sub-cell">${escapeHtml(item.employees?.employee_code || '')}</small></span></span></td><td>${formatDate(item.period_start)} – ${formatDate(item.period_end)}</td><td>${rupiah.format(item.base_salary)}</td><td>${rupiah.format(item.allowance)}</td><td>${rupiah.format(item.deductions)}</td><td class="person-name">${rupiah.format(item.net_salary)}</td></tr>`).join('') : '<tr><td class="empty-cell" colspan="6">Belum ada data penggajian.</td></tr>';
  document.querySelector('#recent-payroll-body').innerHTML = rows.length ? rows.slice(0, 5).map((item) => `<tr><td><span class="person-cell"><span class="person-initial">${escapeHtml(getInitials(item.employees?.full_name))}</span><span><span class="person-name">${escapeHtml(item.employees?.full_name || 'Pegawai')}</span><small class="sub-cell">${escapeHtml(item.employees?.employee_code || '')}</small></span></span></td><td>${formatDate(item.period_start)} – ${formatDate(item.period_end)}</td><td class="person-name">${rupiah.format(item.net_salary)}</td><td><span class="status-pill">Tersimpan</span></td></tr>`).join('') : '<tr><td class="empty-cell" colspan="4">Belum ada data penggajian.</td></tr>';
}
function renderDashboard() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const periodPayrolls = state.payrolls.filter((item) => item.period_start <= monthEnd && item.period_end >= monthStart);
  const attendanceCount = state.attendance.filter((item) => item.attendance_date >= monthStart && item.attendance_date <= monthEnd).length;
  document.querySelector('#metric-employees').textContent = state.employees.length;
  document.querySelector('#metric-payroll').textContent = rupiah.format(periodPayrolls.reduce((total, item) => total + Number(item.net_salary), 0));
  document.querySelector('#metric-period').textContent = periodPayrolls.length ? `${periodPayrolls.length} slip gaji periode ini` : 'belum ada penggajian bulan ini';
  document.querySelector('#metric-attendance').textContent = attendanceCount;
}
function populateDepartmentSelect(emptyMessage = 'Belum ada unit kerja. Jalankan backend/schema.sql.') {
  const select = document.querySelector('#department-select');
  const options = state.departments.map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`).join('');
  select.innerHTML = options ? `<option value="">Pilih unit kerja</option>${options}` : `<option value="">${escapeHtml(emptyMessage)}</option>`;
  select.disabled = state.departments.length === 0;
}
function populateEmployeeSelects() {
  const options = state.employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.employee_code)} · ${escapeHtml(employee.full_name)}</option>`).join('');
  document.querySelectorAll('.employee-select').forEach((select) => { select.innerHTML = `<option value="">Pilih pegawai</option>${options}`; });
  populateDepartmentSelect();
}
async function refreshData() {
  try {
    state.departments = await api('departments');
    populateDepartmentSelect();
  } catch {
    state.departments = [];
    populateDepartmentSelect('Gagal memuat unit kerja. Periksa koneksi database.');
  }
  try {
    const [summary, employees, attendance, payrolls] = await Promise.all([api('summary'), api('employees'), api('attendance'), api('payrolls')]);
    state.employees = employees; state.attendance = attendance; state.payrolls = payrolls;
    renderEmployees(document.querySelector('#employee-search').value); renderAttendance(); renderPayrolls(); renderDashboard(); populateEmployeeSelects();
    document.querySelector('#dashboard-note').textContent = summary.message || 'Data diperbarui dari basis data.';
  } catch (error) {
    document.querySelector('#dashboard-note').textContent = `Koneksi data belum tersedia: ${error.message}`;
    [['employees-body', 5], ['attendance-body', 4], ['payroll-body', 6], ['recent-payroll-body', 4]].forEach(([id, count]) => setTableMessage(id, 'Gagal memuat data. Periksa koneksi backend dan konfigurasi Supabase.', count));
    ['metric-employees', 'metric-payroll', 'metric-attendance'].forEach((id) => { document.querySelector(`#${id}`).textContent = '—'; });
  }
}
function showPage(pageName) {
  document.querySelectorAll('.page').forEach((page) => { const visible = page.id === `page-${pageName}`; page.hidden = !visible; page.classList.toggle('is-visible', visible); });
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.page === pageName));
  document.querySelector('#breadcrumb-current').textContent = pageTitles[pageName];
  history.replaceState(null, '', `#${pageName}`);
}
function setupForm(formId, dialogId, errorId, endpoint) {
  const form = document.querySelector(`#${formId}`);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.querySelector(`#${errorId}`); error.textContent = '';
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      ['base_salary', 'allowance', 'deductions'].forEach((key) => { if (body[key] !== undefined) body[key] = Number(body[key]); });
      await api(endpoint, { method: 'POST', body });
      document.querySelector(`#${dialogId}`).close(); form.reset(); showToast('Data berhasil disimpan.'); await refreshData();
    } catch (submitError) { error.textContent = submitError.message; }
    finally { submit.disabled = false; }
  });
}
document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => showPage(link.dataset.page)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelector('#employee-search').addEventListener('input', (event) => renderEmployees(event.target.value));
document.querySelector('#add-employee-button').addEventListener('click', () => document.querySelector('#employee-dialog').showModal());
document.querySelector('#add-attendance-button').addEventListener('click', () => { document.querySelector('#attendance-form').elements.attendance_date.value = new Date().toISOString().slice(0, 10); document.querySelector('#attendance-dialog').showModal(); });
document.querySelector('#add-payroll-button').addEventListener('click', () => document.querySelector('#payroll-dialog').showModal());
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
setupForm('employee-form', 'employee-dialog', 'employee-error', 'employees');
setupForm('attendance-form', 'attendance-dialog', 'attendance-error', 'attendance');
setupForm('payroll-form', 'payroll-dialog', 'payroll-error', 'payrolls');
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
const initialPage = location.hash.slice(1);
showPage(pageTitles[initialPage] ? initialPage : 'dashboard');
refreshData();