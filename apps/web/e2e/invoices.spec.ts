import { test, expect } from '@playwright/test';

test.describe('Invoices Flow', () => {
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
      if (response.url().includes('/api/v1/invoices')) {
        console.log('INVOICES API RESPONSE:', response.status(), response.url());
      }
    });

    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });

    // Navigate to invoices
    await page.goto('/invoices');
    // Wait for Vue app to be ready
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Faturalar")', { timeout: 15000 });
  });

  test('should show invoices list page', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Faturalar');
    await expect(page.locator('button:text("Yeni Fatura")')).toBeVisible();
    // Durum filtresi artık filtrelenebilir combobox
    await expect(page.locator('input[aria-label="Durum filtresi"]')).toBeVisible();
  });

  test('should open new invoice modal', async ({ page }) => {
    await page.click('button:text("Yeni Fatura")');
    await expect(page.locator('h2:text("Yeni Fatura")')).toBeVisible();
    // Tip seçimi modalda artık filtrelenebilir combobox
    await expect(page.locator('#f-type')).toBeVisible();
    // Fatura Tarihi date input (first date input in modal)
    await expect(page.locator('label:text("Fatura Tarihi") + input[type="date"]')).toBeVisible();
  });

  test('should close modal on cancel', async ({ page }) => {
    await page.click('button:text("Yeni Fatura")');
    await page.click('button:text("İptal")');
    await expect(page.locator('h2:text("Yeni Fatura")')).not.toBeVisible();
  });

  test('should show invoice types in dropdown', async ({ page }) => {
    await page.click('button:text("Yeni Fatura")');
    // Combobox'u aç ve seçenek etiketlerini doğrula
    await page.locator('#f-type').click();
    await expect(page.locator('#f-type-list .fs-opt')).toHaveText([
      'Satış',
      'Alış',
      'Proforma',
      'Alınan İade',
      'Verilen İade',
    ]);
  });

  test('should filter by status', async ({ page }) => {
    // Durum filtresi combobox üzerinden seç
    const statusFilter = page.locator('input[aria-label="Durum filtresi"]');
    await statusFilter.fill('Taslak');
    await page.locator('.fs-opt', { hasText: 'Taslak' }).click();
    await expect(statusFilter).toHaveValue('Taslak');
  });
});
