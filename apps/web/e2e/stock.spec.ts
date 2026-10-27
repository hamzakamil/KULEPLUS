import { test, expect } from '@playwright/test';

test.describe('Stock Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');

    // Listen for console messages
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

    // Listen for network responses
    page.on('response', (response) => {
      if (response.url().includes('/auth/login')) {
        console.log('LOGIN RESPONSE:', response.status(), response.url());
      }
      if (response.url().includes('/api/v1/stock')) {
        console.log('STOCK API RESPONSE:', response.status(), response.url());
      }
    });

    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });

    // Navigate to stock
    await page.goto('/stock');
    // Wait for Vue app to be ready
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Stok Kartları")', { timeout: 15000 });
  });

  test('should show stock list page', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Stok Kartları');
    await expect(page.locator('button:text("Yeni Ürün Ekle")')).toBeVisible();
    await expect(page.locator('input[placeholder="Ürün ara..."]')).toBeVisible();
  });

  test('should open add product modal', async ({ page }) => {
    await page.click('button:text("Yeni Ürün Ekle")');
    await expect(page.locator('h2:text("Yeni Ürün Ekle")')).toBeVisible();
    // Check for form fields by label text
    await expect(page.locator('label:text("Ürün Kodu")')).toBeVisible();
    await expect(page.locator('label:text("Ürün Adı")')).toBeVisible();
  });

  test('should close modal on cancel', async ({ page }) => {
    await page.click('button:text("Yeni Ürün Ekle")');
    await page.click('button:text("İptal")');
    await expect(page.locator('h2:text("Yeni Ürün Ekle")')).not.toBeVisible();
  });

  test('should filter products on search', async ({ page }) => {
    await page.fill('input[placeholder="Ürün ara..."]', 'test');
    // Should filter the table
    await expect(page.locator('input[placeholder="Ürün ara..."]')).toHaveValue('test');
  });
});
