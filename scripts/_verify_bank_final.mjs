// Banka PATCH duzeltmesini dogrula + test kayitlarini temizle
const BASE = 'http://localhost:3000/api/v1';
const login = await fetch(BASE + '/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'e2e@test.com', password: 'TestPassword123' }),
});
const { accessToken } = await login.json();
const H = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

const list = await (await fetch(BASE + '/cash-bank?limit=50', { headers: H })).json();
const items = list.items ?? [];
console.log('hesap sayisi:', items.length);

const testAccounts = items.filter((a) => (a.account_name ?? a.accountName ?? '').includes('TEST BANK'));
for (const a of testAccounts) {
  const name = a.account_name ?? a.accountName;
  const p = await fetch(`${BASE}/cash-bank/${a.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({
      accountType: a.account_type ?? 'bank',
      accountName: name,
      accountNumber: a.account_number ?? 'TR00-TEST',
      currency: a.currency ?? 'TRY',
      description: 'final dogrulama',
      status: 'active',
      openingBalance: 2500,
    }),
  });
  console.log('PATCH', name, '->', p.status, p.ok ? '(duzenleme ÇALIŞIYOR)' : (await p.text()).slice(0, 150));
  const d = await fetch(`${BASE}/cash-bank/${a.id}`, { method: 'DELETE', headers: H });
  console.log('  DELETE test hesabi ->', d.status);
}

// DIAG carilerini temizle
const cl = await (await fetch(BASE + '/contacts?q=DIAG&limit=50', { headers: H })).json();
for (const c of cl.data ?? []) {
  const d = await fetch(`${BASE}/contacts/${c.id}`, { method: 'DELETE', headers: H });
  console.log('DELETE cari', c.code, '->', d.status);
}

const after = await (await fetch(BASE + '/cash-bank?limit=50', { headers: H })).json();
console.log('kalan hesap:', (after.items ?? []).map((a) => a.account_name ?? a.accountName).join(' | '));
