import { test, expect } from '@playwright/test';

/**
 * Yedekleme — Dashboard paneli (automated backup).
 *
 * Login → /dashboard → yedek panelinin varlığı, canlı geri sayım, manuel
 * yedek başlatma → "Başarılı" durumuna dönüş ve ayar kaydetme akışı.
 *
 * Not: Yedek üretimi API'de arka planda ~1 sn sürer; panel 20 sn'de bir
 * poll eder → "Başarılı" rozeti en geç poll sonrası yansır.
 */
test.describe('Backup Dashboard Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 30000 });
  });

  test('panel render eder: durum, geri sayım, ayarlar ve geçmiş', async ({ page }) => {
    // Yedek paneli başlığı
    await expect(page.locator('h2:text("Yedekleme")').first()).toBeVisible();
    await expect(page.locator('button:text("Şimdi Yedekle")').first()).toBeVisible();

    // Durum kartı: geri sayım metni (otomatik yedekleme açıksa)
    await expect(page.locator('.backup-countdown').first()).toBeVisible();
    await expect(page.locator('input[type="checkbox"].switch')).toBeChecked();

    // Ayarlar: sıklık select + saklama sayısı input
    await expect(page.locator('label', { hasText: 'Yedek sıklığı' })).toBeVisible();
    await expect(page.locator('select.select').first()).toBeVisible();
    await expect(page.locator('input[type="number"]').first()).toBeVisible();

    // .backup-status-card görünür
    await expect(page.locator('.backup-status-card')).toBeVisible();
  });

  test('manüel yedek başlatır ve "Başarılı" rozetine döner', async ({ page }) => {
    test.setTimeout(60000);

    // Geçmiş tablosu yüklensin
    await expect(page.locator('.backup-history-card')).toBeVisible();
    await page.waitForSelector('.backup-status-card', { timeout: 10000 });
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    await page.click('button:text("Şimdi Yedekle")');

    // Ya "Yedekleniyor…" rozeti ya da hemen "Başarılı" görünür
    await expect
      .poll(
        async () =>
          (await page.locator('span:text("Yedekleniyor…")').count()) > 0 ||
          (await page.locator('.data-table tbody tr').first())
            .textContent()
            .then((t) => (t ?? '').includes('Başarılı')),
        { timeout: 15000 },
      )
      .toBe(true);

    // En üstteki satır en geç 20 sn'lik poll sonrası "Başarılı" olur.
    // (Not: retention budaması eski satırları silebilir — bu yüzden sayıya değil
    // en yeni satırın durumuna bakıyoruz.)
    await expect
      .poll(async () => (await page.locator('.data-table tbody tr').first().textContent()) ?? '', {
        timeout: 40000,
      })
      .toContain('Başarılı');

    // Dosya üretilmişse "İndir" butonu etkin olmalı
    const downloadButtons = page.locator('button:has-text("İndir")');
    if ((await downloadButtons.count()) > 0) {
      await expect(downloadButtons.first()).toBeEnabled();
    }
  });

  test('ayar değişikliği kaydedilir ve "kaydedildi" bilgisi döner', async ({ page }) => {
    await expect(page.locator('select.select').first()).toBeVisible();
    await page.selectOption('select.select', '5');
    await expect(page.locator('.alert-success')).toContainText('Yedek ayarları kaydedildi.');
  });
});
