// Banka hesabi duzenleme (PATCH /cash-bank/:id) — 500'u uret
const BASE = 'http://localhost:3000/api/v1';
const login = await fetch(BASE + '/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'e2e@test.com', password: 'TestPassword123' }),
});
const { accessToken } = await login.json();
const H = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

const list = await fetch(BASE + '/cash-bank?limit=5', { headers: H });
const lj = await list.json();
console.log('LIST /cash-bank ->', list.status, JSON.stringify(lj).slice(0, 400));
const acc = (lj.data ?? [])[0];
if (!acc) { console.log('HESAP YOK — once hesap olusturacagim'); }

let target = acc;
if (!target) {
  const c = await fetch(BASE + '/cash-bank', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ accountType: 'bank', accountName: 'TEST BANK', accountNumber: 'TR00-TEST', currency: 'TRY', openingBalance: 1000, status: 'active' }),
  });
  console.log('CREATE ->', c.status);
  target = await c.json();
}

const payload = {
  accountType: target.accountType ?? 'bank',
  accountName: (target.accountName ?? 'TEST BANK') + ' (duzenlendi)',
  accountNumber: target.accountNumber ?? 'TR00-TEST',
  currency: target.currency ?? 'TRY',
  description: 'duzenleme testi',
  status: 'active',
  openingBalance: 2500,
};
const p = await fetch(`${BASE}/cash-bank/${target.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(payload) });
const pt = await p.text();
console.log('PATCH /cash-bank/:id ->', p.status, pt.slice(0, 400));
