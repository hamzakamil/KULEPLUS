import { test, expect, type Page } from '@playwright/test';

/**
 * Muavin paneli duman testi: Raporlar → Mizan'da hesap koduna tıklayınca sağdan panel açılır
 * (Devir satırı), bir harekete tıklayınca fiş ayrıntısı + kaynak belge görünür, düzeltme fişi formu
 * açılır ama KAYDEDİLMEZ, Esc ile kapanır. Dönem Sonu ekranındaki KDV kodu da paneli açar.
 * Konsol/sayfa hatası ve 4xx/5xx API yanıtı olmamalı. Önkoşul: e2e@test.com şirketinde
 * `accounting` modül hakkı.
 */
const errors: string[] = [];
const shots = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

test.use({ viewport: { width: 1500, height: 1300 } });

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', 'e2e@test.com');
  await page.fill('input[type="password"]', 'TestPassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 });
  await page.goto('/accounting');
});

test('Mizan: hesap koduna tıkla → muavin paneli, fiş ayrıntısı, düzeltme formu, Esc', async ({
  page,
}) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Raporlar/ })
    .click();
  await page.getByRole('button', { name: 'Raporla', exact: true }).click();

  const firstCode = page.locator('.trial-table tbody td button').first();
  await expect(firstCode).toBeVisible();
  await firstCode.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Devir', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Kapanış bakiyesi')).toBeVisible();
  await expect(dialog.getByLabel('Kapanış fişi dahil')).toBeVisible();
  await shot(page, 'ledger-drawer-list');

  // Bir hareket varsa fiş ayrıntısına in: satırlar ve kaynak belge kutusu.
  const entryLink = dialog.locator('tbody tr.ld-row button').first();
  if (await entryLink.count()) {
    await entryLink.click();
    await expect(dialog.locator('#ld-title')).toContainText('Fiş');
    await expect(dialog.getByText('Fiş satırları')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Kaynak belge' })).toBeVisible();
    await shot(page, 'ledger-drawer-entry');
    await dialog.getByRole('button', { name: /Muavine dön/ }).click();
    await expect(dialog.getByText('Devir', { exact: true })).toBeVisible();
  }

  // Düzeltme fişi formu: açılır, dengesizken onay kapalı; KAYDEDİLMEZ.
  await dialog.getByRole('button', { name: 'Düzeltme fişi gir' }).click();
  await expect(dialog.getByLabel('Fiş türü')).toBeVisible();
  await expect(dialog.getByLabel('Satır 1 borç')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Kaydet ve onayla' })).toBeDisabled();
  await dialog.getByLabel('Satır 1 borç').fill('10');
  await expect(dialog.getByRole('button', { name: 'Kaydet ve onayla' })).toBeDisabled();
  await shot(page, 'ledger-drawer-form');
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(dialog.getByText('Devir', { exact: true })).toBeVisible();

  // Esc paneli kapatır.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Dönem Sonu: KDV özetindeki 391 kodu muavin panelini açar', async ({ page }) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Dönem Sonu/ })
    .click();
  const vat = page.locator('section', {
    has: page.getByRole('heading', { name: 'Aylık KDV Mahsup Fişi' }),
  });
  await vat.getByRole('button', { name: 'Önizle' }).click();
  await expect(vat.getByText('Hesaplanan KDV (391)')).toBeVisible();
  await vat.getByRole('button', { name: 'Muavin: 391' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /391/ })).toBeVisible();
  await expect(dialog.getByText('Devir', { exact: true })).toBeVisible();
  await page.mouse.click(10, 10); // örtüye tıklayınca kapanır
  await expect(dialog).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Muavin panelinden düzeltme fişi taslak kaydedilir (sonra silinir)', async ({
  page,
  request,
}) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Raporlar/ })
    .click();
  await page.getByRole('button', { name: 'Raporla', exact: true }).click();
  await page.locator('.trial-table tbody td button').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Düzeltme fişi gir' }).click();
  await dialog.getByLabel('Açıklama', { exact: true }).fill('E2E muavin düzeltme taslağı');
  await dialog.getByLabel('Satır 1 borç').fill('1');
  const acc2 = dialog.getByLabel('Satır 2 hesap');
  await acc2.click();
  await acc2.fill('100');
  await page
    .getByRole('listbox')
    .getByRole('option')
    .filter({ hasNotText: 'bulunamadı' })
    .first()
    .click();
  await dialog.getByLabel('Satır 2 alacak').fill('1');
  await expect(dialog.getByRole('button', { name: 'Kaydet ve onayla' })).toBeEnabled();
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/accounting\/entries$/.test(r.url()),
  );
  await dialog.getByRole('button', { name: 'Taslak kaydet' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await expect(dialog.getByText(/taslak olarak kaydedildi/)).toBeVisible();
  await expect(dialog.getByText('Devir', { exact: true })).toBeVisible();

  // temizlik: taslağı API ile sil
  const login = await request.post('http://localhost:4000/api/v1/auth/login', {
    data: { email: 'e2e@test.com', password: 'TestPassword123' },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const del = await request.delete(`http://localhost:4000/api/v1/accounting/entries/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(del.status()).toBeLessThan(300);
  expect(errors).toEqual([]);
});
