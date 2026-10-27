import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * e-Defter yazma akışları — API yanıtları taklit edilir (gerçek şirkette ay kilitlenmez/defter
 * oluşturulmaz): "Ayı kilitle" → ön kontrol yenilenir → "Defteri oluştur" → "İndir (zip)" →
 * "Entegratöre gönderildi" işareti. Ekranın doğru uçları doğru sırayla çağırdığını doğrular.
 */
test.use({ viewport: { width: 1500, height: 1300 } });

const calls: string[] = [];
let locked = false;
let generated = false;
let delivered = false;

const summary = {
  entryCount: 3,
  lineCount: 8,
  firstEntry: 1,
  lastEntry: 3,
  totalDebit: 52100,
  totalCredit: 52100,
};
const parts = () =>
  generated
    ? ['Y', 'K'].map((b) => ({
        period: '202501',
        book_type: b,
        part_no: 0,
        unique_id: `${b === 'Y' ? 'YEV' : 'KEB'}202501000001`,
        file_name: `1234567808-202501-${b}-000000.xml`,
        status: delivered ? 'delivered' : 'generated',
        size_bytes: 12345,
        sha256: 'abcdef0123456789',
        first_entry_no: 1,
        last_entry_no: 3,
        entry_count: 3,
        line_count: 8,
        total_debit: 52100,
        total_credit: 52100,
        created_at: '2026-10-19T10:00:00Z',
      }))
    : [];

async function mockApi(page: Page) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/\/api\/v1\/edefter(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\/v1\/edefter/, '');
    calls.push(`${req.method()} ${path}`);
    if (path === '/profile')
      return json(route, { settings: {}, vkn: '1234567808', title: 'Deneme A.Ş.', issues: [] });
    if (path === '/202501/precheck') {
      return json(route, {
        period: '202501',
        fiscalYear: 2025,
        ready: locked,
        issues: locked
          ? []
          : [{ level: 'error', code: 'not_locked', message: 'Ay kilitli değil.' }],
        profileIssues: [],
        summary,
        existing: parts(),
      });
    }
    if (path.endsWith('/precheck')) {
      return json(route, {
        period: path.slice(1, 7),
        fiscalYear: 2025,
        ready: false,
        issues: [],
        profileIssues: [],
        summary: { ...summary, entryCount: 0 },
        existing: [],
      });
    }
    if (path === '/202501/lock' && req.method() === 'POST') {
      locked = true;
      return json(route, { id: 'x', lock_date: '2025-02-01' });
    }
    if (path === '/202501/generate' && req.method() === 'POST') {
      generated = true;
      return json(
        route,
        {
          period: '202501',
          parts: parts().map((p) => ({
            book: p.book_type,
            partNo: 0,
            uniqueId: p.unique_id,
            fileName: p.file_name,
            periodStart: '2025-01-01',
            periodEnd: '2025-01-31',
            sizeBytes: 12345,
            sha256: p.sha256,
            signaturePending: 9,
          })),
          summary,
        },
        201,
      );
    }
    if (path === '/202501/download') {
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'Content-Disposition': 'attachment; filename="1234567808-202501-edefter.zip"' },
        body: Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary'),
      });
    }
    if (path === '/202501/delivered' && req.method() === 'POST') {
      delivered = req.postDataJSON()?.delivered !== false;
      return json(route, { period: '202501', status: delivered ? 'delivered' : 'generated' });
    }
    if (path === '' || path === '/') return json(route, { year: 2025, parts: parts() });
    return json(route, { error: { code: 'NOT_FOUND', message: path } }, 404);
  });
}

test('e-Defter: kilitle → oluştur → indir → gönderildi işareti', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/login');
  await page.fill('input[type="email"]', 'e2e@test.com');
  await page.fill('input[type="password"]', 'TestPassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 });
  await mockApi(page);
  await page.goto('/accounting');
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /e-Defter/ })
    .click();
  await page.locator('#ed-year-select').selectOption('2025');
  await page.getByRole('button', { name: /^Ocak 2025/ }).click();

  await expect(page.getByText('Ay kilitli değil.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Defteri oluştur' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ayı kilitle' }).click();
  await expect(page.getByRole('button', { name: 'Defteri oluştur' })).toBeEnabled();

  await page.getByRole('button', { name: 'Defteri oluştur' }).click();
  await expect(page.getByText(/GİB kurallarından geçti/)).toBeVisible();
  await expect(page.getByText('1234567808-202501-Y-000000.xml').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'İndir (zip)' }).click();
  expect((await download).suggestedFilename()).toBe('1234567808-202501-edefter.zip');

  await page.getByRole('button', { name: /Entegratöre gönderildi olarak işaretle/ }).click();
  await expect(page.getByRole('button', { name: 'İşareti kaldır' })).toBeVisible();

  expect(calls).toEqual(
    expect.arrayContaining([
      'POST /202501/lock',
      'POST /202501/generate',
      'GET /202501/download',
      'POST /202501/delivered',
    ]),
  );
  const order = [
    'POST /202501/lock',
    'POST /202501/generate',
    'GET /202501/download',
    'POST /202501/delivered',
  ].map((c) => calls.indexOf(c));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});
