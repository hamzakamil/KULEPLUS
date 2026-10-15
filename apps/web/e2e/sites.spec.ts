import { test, expect } from '@playwright/test';

/**
 * Şantiyeler ekranı + MGM hava durumu (ROADMAP Faz 7.6).
 *
 * Akış: yeni şantiye kaydı (il/ilçe) → listede görünür → kokpitte canlı şantiye
 * ve hava durumu bölümü bu kayda göre dolar. MGM erişilemezse (ağ yok) il/ilçe
 * serbest metin olarak girilir; kokpit satırı "MGM erişilemedi" der.
 */
test.describe('Şantiyeler (saha kayıtları)', () => {
  const siteName = `E2E Şantiye ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });
  });

  test('şantiye eklenir, listede görünür ve kokpit hava durumuna yansır', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/management/sites');
    await expect(page.getByRole('heading', { name: 'Şantiyeler' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Yeni Şantiye/ }).click();
    await page.fill('#site-name', siteName);
    await page.fill('#site-province', 'İstanbul');
    await page.fill('#site-district', 'Başakşehir');
    await page.getByRole('button', { name: 'Kaydet' }).click();

    const row = page.locator('table.data-table tbody tr', { hasText: siteName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('İstanbul / Başakşehir');

    // Kokpit: şantiye bölümü canlı olmalı ve yeni kayıt görünmeli.
    await page.goto('/yonetici-kokpiti');
    const kokpit = page.frameLocator('iframe.cockpit-frame');
    await expect(kokpit.locator('#santSum')).toContainText('canlı', { timeout: 20_000 });
    await expect(kokpit.locator('#santiyeler')).toContainText(siteName);
    await expect(kokpit.locator('#hava')).toContainText(siteName);

    expect(errors, `Kokpit JS hataları: ${errors.join(' | ')}`).toEqual([]);

    // Temizlik: test kaydı silinir (tenant verisi kirletilmez).
    await page.goto('/management/sites');
    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .locator('table.data-table tbody tr', { hasText: siteName })
      .getByRole('button', { name: 'Sil' })
      .click();
    await expect(page.locator('table.data-table tbody tr', { hasText: siteName })).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('il/ilçe seçenekleri MGM listesinden gelir (erişilemezse uyarı gösterilir)', async ({
    page,
  }) => {
    await page.goto('/management/sites');
    await page.getByRole('button', { name: /Yeni Şantiye/ }).click();

    const provinceOptions = page.locator('#mgm-provinces option');
    const warning = page.locator('p.state-msg.error');
    // MGM canlı ise 81 il gelir; ağ yoksa kullanıcı uyarılır ve elle giriş yapılır.
    await expect
      .poll(async () => (await provinceOptions.count()) > 0 || (await warning.count()) > 0, {
        timeout: 20_000,
      })
      .toBe(true);
  });
});
