import { test, expect } from '@playwright/test';

test.describe('Expense Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 30000 });

    await page.goto('/expenses');
    await page.waitForFunction(() => document.querySelector('#app') !== null);
    await page.waitForSelector('h1:text("Giderler")', { timeout: 15000 });
  });

  test('gider liste sayfası görüntülenir', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Giderler');
    await expect(page.locator('a:text("Yeni Gider")')).toBeVisible();
  });

  test('yeni gider formu açılır', async ({ page }) => {
    await page.click('a:text("Yeni Gider")');
    await expect(page).toHaveURL(/\/expenses\/new$/);
    await expect(page.locator('h1')).toContainText('Yeni Gider');
    await expect(page.locator('label:text("Gider Tarihi")')).toBeVisible();
    await expect(page.locator('label:text("Kategori")')).toBeVisible();
    await expect(page.locator('label:text("Tutar")')).toBeVisible();
    // Wait for categories to load
    await expect(page.locator('#exp-category')).toBeEnabled({ timeout: 15000 });
  });

  test('formdan geri dönülebilir', async ({ page }) => {
    await page.goto('/expenses/new');
    await page.click('a:text("Geri")');
    await expect(page).toHaveURL(/\/expenses$/);
  });

  test('ödemesi yapılmamış giderler filtrelenebilir', async ({ page }) => {
    const paymentFilter = page.locator('input[aria-label="Ödeme durumu filtresi"]');
    await paymentFilter.fill('Öden');
    await page.locator('.fs-opt', { hasText: 'Ödenmedi' }).click();
    await expect(paymentFilter).toHaveValue('Ödenmedi');
  });

  test('yeni gider oluşturulabilir', async ({ page }) => {
    await page.click('a:text("Yeni Gider")');
    // Wait for categories to load
    await expect(page.locator('#exp-category')).toBeEnabled({ timeout: 15000 });
    await page.fill('label:text("Gider Tarihi") + input', new Date().toISOString().split('T')[0]);
    await page.locator('#exp-category').click();
    await page.locator('#exp-category-list .fs-opt').first().click();
    await page.fill('label:text("Açıklama") + input', 'Test gideri - ofis malzemeleri');
    await page.fill('label:text("Tutar") + input', '150.75');
    await expect(page.locator('#exp-currency')).toHaveValue('TRY');
    await expect(page.locator('#exp-payment')).toHaveValue('Ödenmedi');
    await expect(page.locator('#exp-status')).toHaveValue('Taslak');
    await page.click('button:text("Kaydet")');
    await expect(page).toHaveURL(/\/expenses$/, { timeout: 10000 });
    await expect(page.locator('text=Test gideri - ofis malzemeleri')).toBeVisible({
      timeout: 10000,
    });
  });

  test('gider düzenlenebilir', async ({ page }) => {
    // First create an expense to edit
    await page.click('a:text("Yeni Gider")');
    // Wait for categories to load
    await expect(page.locator('#exp-category')).toBeEnabled({ timeout: 15000 });
    await page.fill('label:text("Gider Tarihi") + input', new Date().toISOString().split('T')[0]);
    await page.locator('#exp-category').click();
    await page.locator('#exp-category-list .fs-opt').first().click();
    await page.fill('label:text("Açıklama") + input', 'Düzenlenecek gider');
    await page.fill('label:text("Tutar") + input', '100');
    await expect(page.locator('#exp-currency')).toHaveValue('TRY');
    await page.click('button:text("Kaydet")');
    await expect(page).toHaveURL(/\/expenses$/, { timeout: 10000 });

    // Click edit on the created expense
    await page.locator('a:text("Düzenle")').first().click();
    await expect(page).toHaveURL(/\/expenses\/.+\/edit$/);
    // Wait for categories to load in edit form
    await expect(page.locator('#exp-category')).toBeEnabled({ timeout: 15000 });
    await page.fill('label:text("Açıklama") + input', 'Düzenlenmiş gider');
    await page.click('button:text("Güncelle")');
    await expect(page).toHaveURL(/\/expenses$/, { timeout: 10000 });
    await expect(page.locator('text=Düzenlenmiş gider')).toBeVisible({ timeout: 10000 });
  });

  test('gider silinebilir', async ({ page }) => {
    // First create an expense to delete
    await page.click('a:text("Yeni Gider")');
    // Wait for categories to load
    await expect(page.locator('#exp-category')).toBeEnabled({ timeout: 15000 });
    await page.fill('label:text("Gider Tarihi") + input', new Date().toISOString().split('T')[0]);
    await page.locator('#exp-category').click();
    await page.locator('#exp-category-list .fs-opt').first().click();
    await page.fill('label:text("Açıklama") + input', 'Silinecek gider');
    await page.fill('label:text("Tutar") + input', '50');
    await expect(page.locator('#exp-currency')).toHaveValue('TRY');
    await page.click('button:text("Kaydet")');
    await expect(page).toHaveURL(/\/expenses$/, { timeout: 10000 });

    // Click delete on the created expense
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('button:text("Sil")').first().click();
    await expect(page.locator('text=Silinecek gider')).not.toBeVisible({ timeout: 10000 });
  });
});
