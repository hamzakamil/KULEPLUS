import { test, expect } from '@playwright/test';

/**
 * Cari Hesaplar — profesyonel master-detail akışı.
 * Login → /contacts → liste/detay/oluşturma doğrulamaları.
 */
test.describe('Contacts Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');

    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 30000 });

    // Navigate to contacts
    await page.goto('/contacts');
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Cari Hesaplar")', { timeout: 15000 });
  });

  test('should show contacts master-detail page', async ({ page }) => {
    await page.screenshot({ path: 'test-results/contacts-page.png' });

    await expect(page.locator('h1')).toContainText('Cari Hesaplar');
    await expect(page.locator('a:text("Yeni Cari")')).toBeVisible();
    // Filtre çubuğu (arama + tür + durum — tür/durum artık filtrelenebilir combobox)
    await expect(page.locator('input[aria-label="Cari ara"]')).toBeVisible();
    await expect(page.locator('input[aria-label="Cari türü filtresi"]')).toBeVisible();
    await expect(page.locator('input[aria-label="Durum filtresi"]')).toBeVisible();
    // Özet kartları
    await expect(page.locator('.stat-card').first()).toBeVisible();
    // Sağ taraf başlangıçta boş durum gösterir
    await expect(page.locator('.detail-empty')).toBeVisible();
  });

  test('should navigate to create page and validate required fields', async ({ page }) => {
    await page.click('a:text("Yeni Cari")');
    await page.waitForURL('**/contacts/new');

    await expect(page.locator('h1')).toContainText('Yeni Cari Kartı');
    // Cari kodu boş bırakılamaz; otomatik üretilen kod dolu olmalı
    await expect(page.locator('#ca-code')).toHaveValue(/\S/);

    // İsim boşken kaydetmeyi dene → zorunlu alan uyarısı
    await page.click('button:text("Cari Kartı Kaydet")');
    await expect(page.locator('.alert-error')).toBeVisible();
  });

  test('should open contact detail with tabs when a contact is selected', async ({ page }) => {
    const items = page.locator('.contact-item');
    if ((await items.count()) === 0) {
      test.skip();
      return;
    }

    await items.first().click();
    await expect(page.locator('.detail-card')).toBeVisible();
    await expect(page.locator('.detail-tabs button').first()).toBeVisible();
    // Ekstre sekmesi varsayılan olarak açık
    await expect(page.locator('.detail-tabs button.active')).toContainText('Ekstre');
  });
});
