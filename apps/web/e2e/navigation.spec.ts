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
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });
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
    // Kasa ve Bankalar ayrı ekranlardır (kredi kartları Bankalar'ın alt maddesi)
    await expect(page.locator('.nav-link', { hasText: 'Kasa' })).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Bankalar' })).toBeVisible();
    await expect(page.locator('.nav-link', { hasText: 'Giderler' })).toBeVisible();
  });

  // Banka alt modülleri: her biri kendi bağımsız ekranını açar.
  for (const sub of [
    { label: 'Banka Kredileri', href: '/bank/loans' },
    { label: 'Kredi Kartları', href: '/bank/cards' },
  ]) {
    test(`Bankalar › ${sub.label} alt menüsü ${sub.href} ekranını açar`, async ({ page }) => {
      await page.waitForSelector('.side-nav', { timeout: 10000 });

      // Alt menü maddesi girintili grupta ve doğru rotaya bağlı
      const link = page.locator('.nav-sub .nav-link', { hasText: sub.label });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('href', sub.href);

      // Tıklayınca ilgili bağımsız banka modülü açılır
      await link.click();
      await page.waitForURL(`**${sub.href}`, { timeout: 15_000 });
      await expect(page.locator('h1.page-title')).toContainText(sub.label);

      // Alt rota açıkken hem alt madde hem ana madde işaretlenir
      await expect(link).toHaveClass(/router-link-active/);
      await expect(page.locator('.nav-link', { hasText: 'Bankalar' })).toHaveClass(
        /is-parent-active/,
      );
    });
  }

  test('banka modülleri arasında menüyle geçiş yapılır', async ({ page }) => {
    await page.goto('/bank/loans');
    await expect(page.locator('h1.page-title')).toContainText('Banka Kredileri');

    // Kredi Kartları → /bank/cards
    await page.locator('.nav-sub .nav-link', { hasText: 'Kredi Kartları' }).click();
    await page.waitForURL('**/bank/cards', { timeout: 15_000 });
    await expect(page.locator('h1.page-title')).toContainText('Kredi Kartları');

    // Bankalar ana ekranı → /bank (POS hesapları banka hesabının altındadır)
    await page.locator('.nav-link', { hasText: 'Bankalar' }).click();
    await page.waitForURL(/\/bank$/, { timeout: 15_000 });
    await expect(page.locator('h1.page-title')).toContainText('Bankalar');
    await expect(page.locator('#pos-baslik')).toBeVisible();
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
