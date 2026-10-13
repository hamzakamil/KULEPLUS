import { test, expect } from '@playwright/test';

test.describe('Report Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 30000 });

    await page.goto('/reports');
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Raporlar")', { timeout: 15000 });
  });

  test('rapor sayfası ve oluşturma formu görüntülenir', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Raporlar');
    await expect(page.locator('h2:text("Yeni Rapor Oluştur")')).toBeVisible();
    await expect(page.locator('button:text("Rapor Oluştur")')).toBeVisible();
  });

  test('rapor tipi seçenekleri mevcuttur', async ({ page }) => {
    // Rapor tipi artık filtrelenebilir combobox
    await expect(page.locator('#rpt-type')).toHaveValue('Kâr / Zarar');
    await page.locator('#rpt-type').click();
    await expect(page.locator('#rpt-type-list .fs-opt')).toContainText([
      'Kâr / Zarar',
      'Bilanço',
      'Vergi Özeti',
    ]);
  });

  test('tarih aralığı girilebilir', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs).toHaveCount(2);
    await dateInputs.first().fill('2026-10-01');
    await dateInputs.nth(1).fill('2026-10-31');
    await expect(dateInputs.first()).toHaveValue('2026-10-01');
  });

  test('Kâr/Zarar raporu oluşturulabilir', async ({ page }) => {
    await page.locator('#rpt-type').click();
    await page.locator('.fs-opt', { hasText: 'Kâr / Zarar' }).click();
    await page.fill('label:text("Başlangıç") + input', '2026-10-01');
    await page.fill('label:text("Bitiş") + input', '2026-10-31');
    await page.click('button:text("Rapor Oluştur")');
    // Wait for report to be generated - check table row
    await expect(page.locator('table tbody tr:first-child td:first-child')).toContainText(
      'Kâr / Zarar',
      { timeout: 15000 },
    );
    await expect(page.locator('table tbody tr:first-child td:has-text("Tamamlandı")')).toBeVisible({
      timeout: 15000,
    });
  });

  test('Bilanço raporu oluşturulabilir', async ({ page }) => {
    await page.locator('#rpt-type').click();
    await page.locator('.fs-opt', { hasText: 'Bilanço' }).click();
    await page.fill('label:text("Başlangıç") + input', '2026-10-01');
    await page.fill('label:text("Bitiş") + input', '2026-10-31');
    await page.click('button:text("Rapor Oluştur")');
    await expect(page.locator('table tbody tr:first-child td:first-child')).toContainText(
      'Bilanço',
      { timeout: 15000 },
    );
    await expect(page.locator('table tbody tr:first-child td:has-text("Tamamlandı")')).toBeVisible({
      timeout: 15000,
    });
  });
});
