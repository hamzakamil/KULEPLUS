import { test, expect } from '@playwright/test';

test.describe('Report Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });

    await page.goto('/reports');
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Raporlar")', { timeout: 15000 });
  });

  test('rapor sayfası ve canlı rapor arayüzü görüntülenir', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Raporlar');
    await expect(page.locator('.report-tabs')).toBeVisible();
    await expect(page.locator('.filter-bar input[type="date"]')).toHaveCount(2);
    await expect(page.locator('button:has-text("Yenile")')).toBeVisible();
  });

  test('Kâr / Zarar canlı sekmesi açılır ve net sonuç gösterir', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Kâr / Zarar' }).click();
    await expect(page.getByText('Net Sonuç', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('tarih aralığı girilebilir', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs).toHaveCount(2);
    await dateInputs.first().fill('2026-10-01');
    await dateInputs.nth(1).fill('2026-10-31');
    await expect(dateInputs.first()).toHaveValue('2026-10-01');
  });

  test('canlı Kâr / Zarar raporu arşivlenebilir', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Kâr / Zarar' }).click();
    await expect(page.locator('section.report-body').first()).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("Bu raporu arşivle")');
    // Arşiv listesi üste eklenen satırla güncellenir.
    await expect(page.locator('.archive table tbody tr:first-child td:first-child')).toContainText(
      'Kâr / Zarar',
      { timeout: 15000 },
    );
  });

  test('Vergi Özeti canlı sekmesi açılır', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Vergi Özeti' }).click();
    await expect(page.getByText('Ödenecek KDV', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('canlı rapor sekmeleri (Faz 6.4/6.5) görüntülenir', async ({ page }) => {
    for (const label of [
      'KDV Hazırlık',
      'Ba-Bs Bildirim',
      'Cari Mutabakat',
      'Nakit Akış Tahmini',
    ]) {
      await expect(page.locator('.report-tabs .tab', { hasText: label })).toBeVisible();
    }
  });

  test('KDV hazırlık raporu sekmesi açılır', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'KDV Hazırlık' }).click();
    await expect(page.getByText('Hesaplanan KDV (satış)', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Beyan Farkı', { exact: true })).toBeVisible();
  });

  test('Ba-Bs bildirim sekmesi açılır ve eşik değiştirilebilir', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Ba-Bs Bildirim' }).click();
    await expect(page.getByText('Banka Hesapları (10)', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Eşik Üstü Satır', { exact: true })).toBeVisible();
    // Eşik girişi mevcut ve değiştirilebilir
    const threshold = page.locator('input[type="number"]').first();
    await threshold.fill('10000');
    await expect(threshold).toHaveValue('10000');
  });

  test('cari mutabakat sekmesinde cari seçicisi görünür', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Cari Mutabakat' }).click();
    const select = page.locator('section select.input');
    await expect(select).toBeVisible({ timeout: 15000 });
    // Seed'de cari varsa ilkini seçip döküm çekmeyi deneriz; yoksa yer tutucu yeterlidir.
    const optionCount = await select.locator('option').count();
    if (optionCount > 1) {
      await select.selectOption({ index: 1 });
      await page.click('button:text("Dökümü Getir")');
      await expect(page.getByText('Kapanış Bakiyesi', { exact: true })).toBeVisible({
        timeout: 15000,
      });
    } else {
      await expect(select).toContainText('Cari seçin…');
    }
  });

  test('nakit akış tahmini sekmesi açılır', async ({ page }) => {
    await page.locator('.report-tabs .tab', { hasText: 'Nakit Akış Tahmini' }).click();
    await expect(page.getByText('Beklenen Giriş', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Haftalık Kovalar', { exact: true })).toBeVisible();
  });
});
