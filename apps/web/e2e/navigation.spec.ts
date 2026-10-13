import { test, expect } from '@playwright/test';

/**
 * Ağaç navigasyon — menü grupları tıklanınca açılıp kapanır (gizlenebilir);
 * Ticaret + Finans birleşerek "Muhasebe" başlığı altında toplanır.
 */
test.describe('Tree Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 30000 });
  });

  test('Ticaret ve Finans "Muhasebe" altında birleşir; eski gruplar görünmez', async ({ page }) => {
    await page.waitForSelector('.side-nav', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/nav-tree.png' });

    // Birleşik "Muhasebe" grubu mevcut
    await expect(page.locator('.nav-group-toggle', { hasText: 'Muhasebe' })).toHaveCount(1);
    // Eski "Ticaret" ve "Finans" grup başlıkları artık yok
    await expect(page.locator('.nav-group-toggle', { hasText: 'Ticaret' })).toHaveCount(0);
    await expect(page.locator('.nav-group-toggle', { hasText: 'Finans' })).toHaveCount(0);

    // Varsayılan açık: Muhasebe alt menüleri görünür (ticari + finansal)
    await expect(page.locator('.nav-link', { hasText: 'Cari' })).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Kasa & Banka' })).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Giderler' })).toBeVisible();
  });

  test('grup başlığına tıklayınca alt menüler gizlenir ve tekrar tıklanınca açılır', async ({
    page,
  }) => {
    await page.waitForSelector('.side-nav', { timeout: 10000 });

    const muhasebeToggle = page.locator('.nav-group-toggle', { hasText: 'Muhasebe' });
    await expect(muhasebeToggle).toHaveAttribute('aria-expanded', 'true');

    // Gizle
    await muhasebeToggle.click();
    await expect(muhasebeToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.nav-link', { hasText: 'Cari' })).toHaveCount(0);
    await expect(page.locator('.nav-link', { hasText: 'Giderler' })).toHaveCount(0);

    // Yeniden aç
    await muhasebeToggle.click();
    await expect(muhasebeToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.nav-link', { hasText: 'Cari' })).toBeVisible();
  });
});
