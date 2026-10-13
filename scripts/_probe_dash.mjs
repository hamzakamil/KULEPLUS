// Dashboard/backup ve diger 500 adaylarini dene (mevcut token ile)
const BASE = 'http://localhost:3000/api/v1';

async function login() {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'e2e@test.com', password: 'TestPassword123' }),
  });
  const j = await res.json();
  return j.accessToken;
}
const token = await login();
async function probe(label, path, opts) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts?.headers ?? {}), authorization: `Bearer ${token}` },
  });
  const t = (await res.text()).slice(0, 160);
  console.log(`${res.status} ${label} ${path} :: ${t}`);
}
await probe('GET', '/backups/status');
await probe('GET', '/dashboard/summary');
await probe('GET', '/company');
await probe('GET', '/contacts/with-balances?limit=2');
await probe('GET', '/contacts/export');
await probe('GET', '/users/me');
await probe('GET', '/tenants');
await probe('GET', '/dashboard');
