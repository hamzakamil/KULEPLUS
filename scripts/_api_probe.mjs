// Login + GET/POST /contacts — 500'u canli API uzerinden uretmeye calis
const BASE = 'http://localhost:3000/api/v1';

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let text = await res.text();
  try { text = JSON.stringify(JSON.parse(text)); } catch { /* ham metin */ }
  return { status: res.status, body: text };
}
async function get(path, token) {
  const res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 500) };
}

const creds = [
  ['e2e@test.com', 'TestPassword123'],
  ['demo@test.com', 'TestPassword123'],
  ['hamzakamil@gmail.com', 'TestPassword123'],
  ['test@test.com', 'TestPassword123'],
];
let token = null;
for (const [email, password] of creds) {
  const r = await post('/auth/login', { email, password });
  console.log('LOGIN', email, '->', r.status, r.body.slice(0, 200));
  if (r.status === 200) {
    try { token = JSON.parse(r.body).accessToken; } catch { /* yok */ }
    if (token) break;
  }
}
if (!token) { console.log('TOKEN YOK — login baarisiz'); process.exit(0); }

const g = await get('/contacts?limit=5', token);
console.log('GET /contacts ->', g.status, g.body.slice(0, 300));
const gs = await get('/contacts/stats', token);
console.log('GET /contacts/stats ->', gs.status, gs.body.slice(0, 200));

const payload = {
  code: 'DIAG-' + Date.now().toString().slice(-6),
  name: 'DIAG TEST CARİ',
  type: 'customer',
  tax_number: '1234567890',
  tax_office: 'İstanbul Merkez',
  settings: {},
  addresses: [{ is_primary: true, type: 'default', province: 'İstanbul', district: 'Kadıköy', street: 'Test Sk.', parsed: {} }],
  phones: [{ is_primary: true, type: 'mobile', number: '05550000000', parsed: {} }],
  emails: [{ is_primary: true, type: 'default', email: 'diag@test.com' }],
};
const p = await post('/contacts', payload, token);
console.log('POST /contacts ->', p.status, p.body.slice(0, 400));
