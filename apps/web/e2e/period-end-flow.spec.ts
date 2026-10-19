import { test, expect, type Page } from '@playwright/test';

/**
 * Dönem sonu ekranı duman testi (Faz 9): KDV mahsup önizlemesi, yıl sonu kapanış önizlemesi,
 * yevmiye "Yeniden sırala". Kalıcı fiş KESMEZ (yalnızca önizleme). Konsol/sayfa hatası ve
 * 4xx/5xx API yanıtı olmamalı. Önkoşul: e2e@test.com şirketinde `accounting` modül hakkı.
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

test('Dönem Sonu: KDV mahsup ve yıl sonu kapanış önizlemesi', async ({ page }) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Dönem Sonu/ })
    .click();
  const vat = page.locator('section', {
    has: page.getByRole('heading', { name: 'Aylık KDV Mahsup Fişi' }),
  });
  await vat.getByRole('button', { name: 'Önizle' }).click();
  await expect(vat.getByText('Hesaplanan KDV (391)')).toBeVisible();
  await expect(vat.getByText('Ödenecek KDV (360.02)')).toBeVisible();

  const ye = page.locator('section', {
    has: page.getByRole('heading', { name: 'Yıl Sonu Kapanış Sihirbazı' }),
  });
  await expect(ye.getByLabel('Mükellef türü')).toBeVisible();
  await ye.getByLabel('KKEG (TL)').fill('1000');
  await ye.getByRole('button', { name: 'Önizle' }).click();
  await expect(
    ye
      .getByRole('alert')
      .or(ye.getByText(/Dönem net (kârı|zararı)/))
      .first(),
  ).toBeVisible();
  await expect(ye.getByRole('button', { name: 'Önizle' })).toBeEnabled();
  await expect(vat.getByRole('button', { name: 'Fişi Kes' })).toBeDisabled(); // satır yok
  await shot(page, 'period-end');
  expect(errors).toEqual([]);
});

test('Yevmiye: Yeniden sırala', async ({ page }) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Yevmiye/ })
    .click();
  await page.getByRole('button', { name: 'Yeniden sırala' }).click();
  await expect(page.getByText(/fişin numarası güncellendi/)).toBeVisible();
  await shot(page, 'entries-resequence');
  expect(errors).toEqual([]);
});
