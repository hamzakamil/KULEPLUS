import { test, expect, type Page } from '@playwright/test';

/**
 * Tek ekran fatura akışı: alış faturası (gider + KDV + tevkifat) → "Kaydet, Kesinleştir ve Öde".
 * Önkoşul: e2e@test.com şirketinde accounting modülü, en az bir cari ve banka hesabı.
 */
test.use({ viewport: { width: 1500, height: 1300 } });
const shots = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

async function pick(page: Page, combo: ReturnType<Page['getByRole']>, optionText: string | RegExp) {
  await combo.click();
  await page.locator('[role=option]', { hasText: optionText }).first().click();
}

test('alış faturası: gider + KDV + tevkifat → kaydet, kesinleştir ve öde (tek ekran)', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/') && !r.url().includes('/quick')) {
      problems.push(`http ${r.status()} ${r.url()}`);
    }
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', 'e2e@test.com');
  await page.fill('input[type="password"]', 'TestPassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'));

  await page.goto('/invoices');
  await page.getByRole('button', { name: '+ Alış Faturası' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('textbox', { name: 'Tedarikçi belge no' }).fill(`E2E-${Date.now()}`);
  await pick(page, dialog.getByRole('combobox', { name: 'Cari *' }), 'Test Müşteri');

  await dialog.getByRole('button', { name: '+ Satır Ekle' }).click();
  await pick(page, dialog.getByRole('combobox', { name: 'Cinsi' }), 'Gider');
  await pick(page, dialog.getByRole('combobox', { name: 'Gider kategorisi' }), 'Kira');
  const numbers = dialog.locator('tbody tr').first().getByRole('spinbutton');
  // satır içinde 0: Miktar, 1: Birim fiyat, 2: İskonto
  await numbers.nth(1).fill('1000');
  await pick(page, dialog.getByRole('combobox', { name: '%0' }), /20/);
  await pick(page, dialog.getByRole('combobox', { name: 'Tevkifat' }), /601/);
  await shot(page, '11-alis-formu-dolu');

  // toplamlar: matrah 1000 + KDV 200 − tevkifat 80 = ödenecek 1120
  await expect(dialog.getByText('Tevkif Edilen KDV')).toBeVisible();
  await expect(dialog.getByText('Ödenecek Tutar')).toBeVisible();
  await expect(dialog.getByText('₺1.120,00').first()).toBeVisible();

  // 3. düğme: ödeme bölümünü açar (ilk basış), hesap seçilince ikinci basışta gönderir
  await dialog.getByRole('button', { name: 'Kaydet, Kesinleştir ve Öde' }).click();
  await pick(page, dialog.getByRole('combobox', { name: 'Ödeme yöntemi *' }), 'Banka');
  await dialog
    .getByRole('region', { name: 'Peşin ödeme veya tahsilat' })
    .getByRole('combobox')
    .nth(1)
    .click();
  await page.locator('[role=option]').first().click();
  await shot(page, '12-pesin-odeme');
  await dialog.getByRole('button', { name: 'Kaydet, Kesinleştir ve Öde' }).click();

  // başarı: panel kapanır, liste güncellenir, mesaj görünür
  await expect(page.getByText('Fatura kesinleştirildi ve ödeme/tahsilat kaydedildi.')).toBeVisible({
    timeout: 15000,
  });
  await expect(dialog).toBeHidden();
  await shot(page, '13-basari');
  expect(problems).toEqual([]);
});
