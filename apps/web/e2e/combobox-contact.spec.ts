import { test, expect } from '@playwright/test';

/**
 * Filtrelenebilir (combobox) dropdown + il → ilçe → vergi dairesi zinciri.
 * Cari kart formunda il seçilince ilçeler otomatik dolar; ilçe ve vergi
 * dairesi yazınca filtrelenir.
 */
test.describe('Filterable location selects', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });

    await page.goto('/contacts/new');
    await page.waitForSelector('h1:text("Yeni Cari Kartı")', { timeout: 15000 });
  });

  test('ilk seçimde ilçe kilitli, il seçilince ilçeler otomatik gelir ve vergi dairesi il bazında listelenir', async ({
    page,
  }) => {
    // İl / ilçe / vergi dairesi alanları "Resmî & Adres" sekmesinde gruplanmıştır.
    await page.getByRole('tab', { name: 'Resmî & Adres' }).click();

    // İlçe, il seçilmeden kilitli olmalı
    await expect(page.locator('#ca-district')).toBeDisabled();

    // İl: yazınca filtreleme → İSTANBUL seç (etiket plaka kodunu da gösterir)
    await page.fill('#ca-province', 'istan');
    await page.locator('.fs-opt', { hasText: 'İSTANBUL' }).first().click();
    await expect(page.locator('#ca-province')).toHaveValue('İSTANBUL (34)');

    // İlçe artık kilitli değil; "kad" yazınca KADIKÖY gelir ve seçilir
    await expect(page.locator('#ca-district')).toBeEnabled();
    await page.fill('#ca-district', 'kad');
    await page.locator('.fs-opt', { hasText: 'KADIKÖY' }).first().click();
    await expect(page.locator('#ca-district')).toHaveValue('KADIKÖY');

    // Vergi dairesi sadece İstanbul listesinden filtrelenir
    await page.fill('#ca-taxoffice', 'kad');
    await page.locator('.fs-opt', { hasText: 'Kadıköy Vergi Dairesi' }).first().click();
    await expect(page.locator('#ca-taxoffice')).toHaveValue('Kadıköy Vergi Dairesi Müdürlüğü');

    // Diğer kombinasyon: il Ankara'ya alınınca ilçe seçimi tazelenir, eski ilçe sıfırlanır
    await page.fill('#ca-province', 'ANKARA');
    await page.locator('.fs-opt', { hasText: 'ANKARA (06)' }).first().click();
    await expect(page.locator('#ca-district')).toHaveValue('');
    await page.fill('#ca-district', 'çank');
    await page.locator('.fs-opt', { hasText: 'ÇANKAYA' }).first().click();
    await expect(page.locator('#ca-district')).toHaveValue('ÇANKAYA');
  });
});
