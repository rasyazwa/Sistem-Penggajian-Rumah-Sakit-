const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT || 3000);
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const frontendDirectory = path.resolve(__dirname, '../frontend');
const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };

async function databaseRequest(resource, options = {}) {
  if (!supabaseUrl || !supabaseKey) throw Object.assign(new Error('Konfigurasi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur.'), { status: 503 });
  const response = await fetch(`${supabaseUrl}/rest/v1/${resource}`, {
    method: options.method || 'GET',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', ...(options.method === 'POST' ? { Prefer: 'return=representation' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.details || 'Supabase menolak permintaan.'), { status: response.status === 409 ? 409 : 400 });
  return data;
}
async function readJson(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 32768) throw Object.assign(new Error('Ukuran data terlalu besar.'), { status: 413 }); }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Format JSON tidak valid.'), { status: 400 }); }
}
function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
function required(body, fields) {
  for (const field of fields) if (body[field] === undefined || body[field] === null || body[field] === '') throw Object.assign(new Error(`Kolom ${field} wajib diisi.`), { status: 400 });
}
async function routeApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/summary') {
    await databaseRequest('employees?select=id&is_active=eq.true');
    sendJson(response, 200, { message: 'Data diperbarui dari basis data.' }); return;
  }
  const getRoutes = {
    '/api/departments': 'departments?select=id,name&order=name.asc',
    '/api/employees': 'employees?select=id,employee_code,full_name,position,base_salary,departments(name)&is_active=eq.true&order=full_name.asc',
    '/api/attendance': 'attendance_records?select=id,attendance_date,status,employees(full_name,employee_code)&order=attendance_date.desc&limit=100',
    '/api/payrolls': 'payrolls?select=id,period_start,period_end,base_salary,allowance,deductions,net_salary,employees(full_name,employee_code)&order=created_at.desc&limit=100',
  };
  if (request.method === 'GET' && getRoutes[pathname]) { sendJson(response, 200, await databaseRequest(getRoutes[pathname])); return; }
  if (request.method !== 'POST' || !['/api/employees', '/api/attendance', '/api/payrolls'].includes(pathname)) { sendJson(response, 404, { error: 'Rute tidak ditemukan.' }); return; }
  const body = await readJson(request);
  let resource; let record;
  if (pathname === '/api/employees') {
    required(body, ['employee_code', 'full_name', 'department_id', 'position', 'base_salary']);
    if (!Number.isFinite(Number(body.base_salary)) || Number(body.base_salary) < 0) throw Object.assign(new Error('Gaji pokok harus berupa angka nol atau lebih.'), { status: 400 });
    resource = 'employees';
    record = { employee_code: body.employee_code.trim(), full_name: body.full_name.trim(), department_id: body.department_id, position: body.position.trim(), base_salary: Number(body.base_salary) };
  } else if (pathname === '/api/attendance') {
    required(body, ['employee_id', 'attendance_date', 'status']);
    if (!['present', 'sick', 'leave', 'absent'].includes(body.status)) throw Object.assign(new Error('Status kehadiran tidak valid.'), { status: 400 });
    resource = 'attendance_records'; record = { employee_id: body.employee_id, attendance_date: body.attendance_date, status: body.status };
  } else {
    required(body, ['employee_id', 'period_start', 'period_end', 'allowance', 'deductions']);
    if (body.period_end < body.period_start) throw Object.assign(new Error('Akhir periode harus setelah awal periode.'), { status: 400 });
    const employees = await databaseRequest(`employees?select=id,base_salary&id=eq.${encodeURIComponent(body.employee_id)}&is_active=eq.true`);
    if (!employees.length) throw Object.assign(new Error('Pegawai tidak ditemukan atau sudah nonaktif.'), { status: 404 });
    const allowance = Number(body.allowance); const deductions = Number(body.deductions);
    if (![allowance, deductions].every((amount) => Number.isFinite(amount) && amount >= 0)) throw Object.assign(new Error('Tunjangan dan potongan harus berupa angka nol atau lebih.'), { status: 400 });
    resource = 'payrolls'; record = { employee_id: body.employee_id, period_start: body.period_start, period_end: body.period_end, base_salary: employees[0].base_salary, allowance, deductions };
  }
  sendJson(response, 201, await databaseRequest(resource, { method: 'POST', body: record }));
}
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname.startsWith('/api/')) { await routeApi(request, response, pathname); return; }
    const file = staticFiles[pathname];
    if (request.method !== 'GET' || !file) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Tidak ditemukan.'); return; }
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); fs.createReadStream(path.join(frontendDirectory, file[0])).pipe(response);
  } catch (error) {
    if (error.name === 'AbortError') return;
    sendJson(response, error.status || 500, { error: error.message || 'Terjadi kesalahan pada server.' });
  }
});
server.listen(port, () => console.log(`Ruang Gaji tersedia di http://localhost:${port}`));