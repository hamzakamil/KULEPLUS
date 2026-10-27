import { test, expect, type Page } from '@playwright/test';

/**
 * e-Defter duman testi (YAZMA YOK: kilitleme/oluşturma/kaydetme düğmelerine basılmaz):
 *  - Muhasebe → e-Defter sekmesi açılır, yıl ve 12 ay görünür, bir ay seçilince ön kontrol paneli gelir.
 *  - Ayarlar → Firma → Firma bilgileri sayfasında "e-Defter bilgileri" kartı görünür.
 *  - Gider formunda "Belge türü" seçimi görünür ("Diğer" seçilince belge adı alanı çıkar).
 *  - Yevmiye fişi formlarında "Belge" bölümü ve satır "Belge" düğmesi çalışır.
 * Konsol/sayfa hatası ve 4xx/5xx API yanıtı olmamalı. Önkoşul: e2e@test.com şirketinde `accounting` modül hakkı.
 */
const errors: string[] = [];
const shots = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

test.use({ viewport: { width: 1500, height: 1300 } });

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', 'e2e@test.com');
  await page.fill('input[type="password"]', 'TestPassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 });
});

test('Muhasebe → e-Defter: yıl, 12 ay ve seçilen ayın ön kontrolü', async ({ page }) => {
  await page.goto('/accounting');
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: 'e-Defter', exact: true })
    .click();

  const panel = page.getByRole('region', { name: 'e-Defter' });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Yıl', { exact: true })).toBeVisible();

  const months = panel.getByRole('list', { name: 'Aylar' }).getByRole('button');
  await expect(months).toHaveCount(12);
  await expect(months.first()).toContainText('Ocak');
  await expect(months.last()).toContainText('Aralık');
  await shot(page, 'edefter-grid');

  // Bir ay seç → ön kontrol: özet şeridi (+ hata/uyarı listesi) gelir.
  const precheck = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/edefter\/\d{6}\/precheck$/.test(r.url()),
  );
  await months.first().click();
  expect((await precheck).status()).toBe(200);
  await expect(panel.getByRole('heading', { name: /ön kontrol/ })).toBeVisible();
  await expect(panel.getByLabel('Ay özeti')).toBeVisible();
  await expect(panel.getByText('Madde sayısı')).toBeVisible();
  await expect(panel.getByText('Toplam borç')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Defteri oluştur' })).toBeVisible();
  await expect(panel.getByText(/Dosyalar imzasızdır/)).toBeVisible();
  await shot(page, 'edefter-precheck');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Ayarlar → Firma bilgileri: "e-Defter bilgileri" kartı', async ({ page }) => {
  await page.goto('/settings?group=company&tab=profile');
  const card = page.getByRole('region', { name: 'e-Defter bilgileri' });
  await expect(card).toBeVisible();
  await expect(card.getByLabel('NACE faaliyet kodu')).toBeVisible();
  await expect(card.getByLabel('Entegratör yazılım bilgisi')).toBeVisible();
  await expect(card.getByText('VKN##Unvan##Program adı##Sürüm').first()).toBeVisible();

  // "İşletme bünyesinde" işaretlenince sözleşme alanları gizlenir (KAYDEDİLMEZ).
  await expect(card.getByLabel('Sözleşme no (1. kişi)')).toBeVisible();
  await card.getByLabel('Defter işletme bünyesinde tutuluyor').check();
  await expect(card.getByLabel('Sözleşme no (1. kişi)')).toBeHidden();
  await card.getByLabel('Defter işletme bünyesinde tutuluyor').uncheck();
  await shot(page, 'edefter-settings');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Gider formu: "Belge türü" seçimi', async ({ page }) => {
  await page.goto('/expenses/new');
  const kind = page.getByLabel('Belge türü');
  await expect(kind).toBeVisible();
  await expect(page.getByLabel('Belge no')).toBeVisible();
  await expect(page.getByLabel('Belge tarihi')).toBeVisible();

  await kind.click();
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options.filter({ hasText: 'e-Arşiv Fatura' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'Serbest Meslek Makbuzu' })).toHaveCount(1);
  await options.filter({ hasText: 'Diğer' }).first().click();
  await expect(page.getByLabel(/Belgenin adı/)).toBeVisible();
  await shot(page, 'expense-doc-kind');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Yeni fiş formu: belge başlığı ve satıra özel belge (kaydedilmez)', async ({ page }) => {
  await page.goto('/accounting');
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Yevmiye Fişleri/ })
    .click();
  await page.getByRole('button', { name: /Yeni Fiş/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Yeni Yevmiye Fişi' });
  await expect(dialog).toBeVisible();
  const type = dialog.getByLabel('Belge tipi', { exact: true });
  await expect(type).toBeVisible();
  await expect(type.locator('option').first()).toHaveText(/Belgesiz/);
  await expect(dialog.getByLabel('Ödeme yöntemi', { exact: true })).toBeVisible();

  await type.selectOption('other');
  await expect(dialog.getByLabel('Belgenin adı', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Belge', exact: true }).first().click();
  await expect(dialog.getByLabel('Satır 1 Belge tipi')).toBeVisible();
  await shot(page, 'entry-doc-fields');

  expect(errors, errors.join('\n')).toEqual([]);
});
