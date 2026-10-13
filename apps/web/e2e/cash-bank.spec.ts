import { test, expect } from '@playwright/test';

test.describe('Cash & Bank Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 30000 });

    await page.goto('/cash-bank');
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Kasa & Banka")', { timeout: 15000 });
    // Wait for accounts to load
    await page.waitForSelector('table tbody tr, td:text("Henüz hesap bulunmuyor")', {
      timeout: 15000,
    });
  });

  test('hesap listesi ve sekmeler görüntülenir', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Kasa & Banka');
    await expect(page.locator('button:text("Hesaplar")')).toBeVisible();
    await expect(page.locator('button:text("Hareketler")')).toBeVisible();
  });

  test('yeni hesap modalı açılır', async ({ page }) => {
    await page.click('button:text("Yeni Hesap Ekle")');
    await expect(page.locator('h2:text("Yeni Hesap Ekle")')).toBeVisible();
    await expect(page.locator('label:text("Hesap Adı")')).toBeVisible();
    await expect(page.locator('label:text("Açılış Bakiyesi")')).toBeVisible();
  });

  test('hesap modalı İptal ile kapanır', async ({ page }) => {
    await page.click('button:text("Yeni Hesap Ekle")');
    await page.click('button:text("İptal")');
    await expect(page.locator('h2:text("Yeni Hesap Ekle")')).not.toBeVisible();
  });

  test('hareketler sekmesine geçilebilir', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load in movements tab
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await expect(page.locator('button:text("Para Yatır")')).toBeVisible();
    await expect(page.locator('button:text("Para Çek")')).toBeVisible();
    await expect(page.locator('button:text("Transfer")')).toBeVisible();
  });

  test('para yatırma modalı açılır', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await page.click('button:text("Para Yatır")');
    await expect(page.locator('h2:text("Para Yatır")')).toBeVisible();
    await expect(page.locator('label:text("Tarih")')).toBeVisible();
    await expect(page.locator('label:text("Tutar")')).toBeVisible();
  });

  test('transfer modalı hedef hesap alanı gösterir', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await page.click('button:text("Transfer")');
    await expect(page.locator('h2:text("Hesaplar Arası Transfer")')).toBeVisible();
    await expect(page.locator('label:text("Hedef Hesap")')).toBeVisible();
  });

  test('yeni kasa hesabı oluşturulabilir', async ({ page }) => {
    await page.click('button:text("Yeni Hesap Ekle")');
    await expect(page.locator('h2:text("Yeni Hesap Ekle")')).toBeVisible();
    await page.fill('label:text("Hesap Adı") + input', 'Test Kasası');
    await page.selectOption('label:text("Tip") + select', 'cash');
    await page.selectOption('label:text("Parite") + select', 'TRY');
    await page.fill('label:text("Açılış Bakiyesi") + input', '1000');
    await page.selectOption('label:text("Durum") + select', 'active');
    // Click the submit button inside the modal (not the header button)
    await page.locator('.modal-content button:text("Ekle")').click();
    await expect(page.locator('h2:text("Yeni Hesap Ekle")')).not.toBeVisible({ timeout: 10000 });
    // Verify account appears in list
    await expect(page.locator('text=Test Kasası')).toBeVisible({ timeout: 10000 });
  });

  test('para yatırma işlemi yapılabilir', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load in dropdown
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await page.click('button:text("Para Yatır")');
    await expect(page.locator('h2:text("Para Yatır")')).toBeVisible();
    // Wait for dropdown to have options
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 10000,
      state: 'attached',
    });
    await page.selectOption('label:text("Hesap") + select', { index: 1 }); // Select first account
    await page.fill('label:text("Tarih") + input', new Date().toISOString().split('T')[0]);
    await page.fill('label:text("Tutar") + input', '500');
    await page.fill('label:text("Referans") + input', 'TEST-DEPOSIT-001');
    await page.locator('.modal-content button:text("Kaydet")').click();
    await expect(page.locator('h2:text("Para Yatır")')).not.toBeVisible({ timeout: 10000 });
  });

  test('para çekme işlemi yapılabilir', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load in dropdown
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await page.click('button:text("Para Çek")');
    await expect(page.locator('h2:text("Para Çek")')).toBeVisible();
    // Wait for dropdown to have options
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 10000,
      state: 'attached',
    });
    await page.selectOption('label:text("Hesap") + select', { index: 1 });
    await page.fill('label:text("Tarih") + input', new Date().toISOString().split('T')[0]);
    await page.fill('label:text("Tutar") + input', '200');
    await page.fill('label:text("Referans") + input', 'TEST-WITHDRAWAL-001');
    await page.locator('.modal-content button:text("Kaydet")').click();
    await expect(page.locator('h2:text("Para Çek")')).not.toBeVisible({ timeout: 10000 });
  });

  test('transfer işlemi yapılabilir', async ({ page }) => {
    await page.click('button:text("Hareketler")');
    // Wait for accounts to load in dropdown
    await page.waitForSelector('label:text("Hesap") + select option[value]', {
      timeout: 15000,
      state: 'attached',
    });
    await page.click('button:text("Transfer")');
    await expect(page.locator('h2:text("Hesaplar Arası Transfer")')).toBeVisible();
    // Wait for dropdowns to have options
    await page.waitForSelector('label:text("Kaynak Hesap") + select option[value]', {
      timeout: 10000,
      state: 'attached',
    });
    await page.waitForSelector('label:text("Hedef Hesap") + select option[value]', {
      timeout: 10000,
      state: 'attached',
    });
    await page.selectOption('label:text("Kaynak Hesap") + select', { index: 1 });
    await page.selectOption('label:text("Hedef Hesap") + select', { index: 2 });
    await page.fill('label:text("Tarih") + input', new Date().toISOString().split('T')[0]);
    await page.fill('label:text("Tutar") + input', '300');
    await page.fill('label:text("Referans") + input', 'TEST-TRANSFER-001');
    await page.locator('.modal-content button:text("Kaydet")').click();
    await expect(page.locator('h2:text("Hesaplar Arası Transfer")')).not.toBeVisible({
      timeout: 10000,
    });
  });
});
