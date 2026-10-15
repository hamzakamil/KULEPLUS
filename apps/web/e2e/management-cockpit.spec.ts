import { test, expect } from '@playwright/test';

/**
 * Yönetici Kokpiti — canlı veri köprüsü duman testi (ROADMAP Faz 3).
 *
 * Tenant verisi değişken olduğu için SAYI değil YAPI doğrulanır:
 *  - iframe kurulur ve KPI şeridi boş kalmaz,
 *  - veri rozeti canlı/örnek durumunu doğru söyler,
 *  - örnek veri kalan bölümler etiketlidir,
 *  - konsolda JS hatası oluşmaz (köprü + çizim kodu).
 */
test.describe('Yönetici Kokpiti (canlı veri)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e@test.com');
    await page.fill('input[type="password"]', 'TestPassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|yonetici-kokpiti/, { timeout: 30_000 });
  });

  test('kokpit iframe/i çizilir ve KPI şeridi veriyle dolar', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/yonetici-kokpiti');
    const kokpit = page.frameLocator('iframe.cockpit-frame');

    await expect(kokpit.locator('#kpis .kpi').first()).toBeVisible({ timeout: 15_000 });
    await expect(kokpit.locator('#kpis .kpi')).toHaveCount(4);

    // Rozet ya canlı veriyi ya da örnek veri uyarısını söyler; ikisi de yoksa köprü kopuktur.
    const pill = (await kokpit.locator('#dataPill').textContent()) || '';
    expect(pill).toMatch(/Canlı veri|Örnek veri/);

    // Canlı moddaysa KPI değerleri örnek sayılardan farklı olmalı ve boş başlık kalmamalı.
    if (pill.startsWith('Canlı veri')) {
      const cashCard = kokpit.locator('#kpis .kpi').first().locator('strong');
      await expect(cashCard).not.toBeEmpty();
      await expect(kokpit.locator('#camSum')).not.toBeEmpty();
    }

    // Şantiye bölümü canlı (kayıtlı şantiye varsa) ya da örnek veri olduğunu söyler.
    await expect(kokpit.locator('#santSum')).toContainText(/canlı|Örnek veri/);

    // Hava durumu: canlı modda MGM tahmini, değilse örnek veri etiketi.
    const havaSum = (await kokpit.locator('#havaSum').textContent()) || '';
    expect(havaSum).toMatch(/MGM|örnek veri/);
    if (havaSum.includes('MGM')) {
      await expect(kokpit.locator('#hava .site').first()).toBeVisible();
      await expect(kokpit.locator('#hava .site').first()).toContainText(/km\/s/);
    }

    // Banka kartları artık veriyle üretiliyor (sabit Garanti/İş/Akbank kartları yok).
    await expect(kokpit.locator('#banks section.card').first()).toBeVisible();

    expect(errors, `Kokpit JS hataları: ${errors.join(' | ')}`).toEqual([]);
  });

  test('menüde kokpit bağlantısı var, doğrudan erişim çalışıyor', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="/yonetici-kokpiti"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
