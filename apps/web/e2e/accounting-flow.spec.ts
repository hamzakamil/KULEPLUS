import { test, expect, type Page } from '@playwright/test';

/**
 * Muhasebe arayüzü duman testi (Faz 1–7): giriş → muhasebe sekmeleri/raporlar → fatura
 * kesinleşme rozeti → ayarlardaki tevkifat türleri → yevmiye ve çek ekranları.
 * Konsol/sayfa hatası ve 4xx/5xx API yanıtı olmamalı.
 * Önkoşul: e2e@test.com şirketinde `accounting` ve `cheque` modül hakkı ve en az bir kesinleşmiş
 * fatura. Ekran görüntüleri için E2E_SHOTS klasörü verilirse kaydedilir.
 */
const errors: string[] = [];
const shots = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function login(page: Page) {
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
}

test.describe('Muhasebe arayüzü', () => {
  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    await login(page);
  });

  test('mizan, bilanço, gelir tablosu ve tevkifat raporu açılır', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Muhasebe', level: 1 })).toBeVisible();
    await page
      .getByLabel('Muhasebe sekmeleri')
      .getByRole('button', { name: /Raporlar/ })
      .click();
    const select = page.locator('select.select').first();
    for (const [value, name] of [
      ['trial', 'mizan'],
      ['balance', 'bilanco'],
      ['income', 'gelir'],
      ['withholding', 'tevkifat'],
    ] as const) {
      await select.selectOption(value);
      await page.getByRole('button', { name: 'Raporla', exact: true }).click();
      await page.waitForTimeout(700);
      await shot(page, `02-${name}`);
    }
    await expect(page.getByText('KDV-2 (alışlar').first()).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('fatura listesinde kesinleşme rozeti görünür', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Faturalar' }).first()).toBeVisible();
    await expect(page.getByText('Kesinleşti').first()).toBeVisible();
    await shot(page, '03-faturalar');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('ayarlarda tevkifat türleri listelenir', async ({ page }) => {
    await page.goto('/settings?group=finance&tab=withholding');
    await page.waitForTimeout(1500);
    await expect(page.getByText('Yapım İşleri').first()).toBeVisible();
    await shot(page, '04-tevkifat-turleri');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('yevmiye fişleri listesi ve çek ekranı açılır', async ({ page }) => {
    await page.goto('/accounting');
    await page
      .getByLabel('Muhasebe sekmeleri')
      .getByRole('button', { name: /Yevmiye/ })
      .click();
    await page.waitForTimeout(800);
    await shot(page, '05-yevmiye');
    await page.goto('/cheques');
    await page.waitForTimeout(800);
    await shot(page, '06-cekler');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
