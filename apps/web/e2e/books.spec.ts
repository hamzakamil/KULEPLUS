import { test, expect, type Page } from '@playwright/test';

/**
 * Resmî defterler duman testi: Raporlar → Yevmiye Defteri / Defter-i Kebir ekranları, CSV indirme
 * ve yazdırma görünümü (`emulateMedia print`). Kalıcı veri yazılmaz. Konsol/sayfa hatası ve 4xx/5xx
 * API yanıtı olmamalı. Önkoşul: e2e@test.com şirketinde `accounting` modül hakkı ve en az bir fiş.
 */
const errors: string[] = [];

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
  await page.goto('/accounting');
});

/** Varsayılan açık/kapalı durum hesap sayısına bağlı; kapat düğmesi etkinse tıkla. */
async function closeAll(page: Page) {
  const btn = page.getByRole('button', { name: 'Tümünü kapat' });
  if (await btn.isEnabled()) await btn.click();
}

async function openReport(page: Page, label: string) {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Raporlar/ })
    .click();
  await page.locator('.report-controls select').selectOption({ label });
  await page.getByRole('button', { name: 'Raporla', exact: true }).click();
}

test('Yevmiye Defteri: fiş blokları, düğmeler, CSV indirme ve yazdırma görünümü', async ({
  page,
}) => {
  await openReport(page, 'Yevmiye Defteri');

  const entry = page.locator('article.jb-entry').first();
  await expect(entry).toBeVisible();
  await expect(entry.getByText('Fiş toplamı')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Genel toplam' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yazdır / PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel (CSV)' })).toBeVisible();

  // Hesap kodu muavin panelini açar (kapanış fişleri dahil işaretli).
  await entry.locator('tbody td button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Kapanış fişi dahil')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // CSV: kimlik doğrulamalı blob indirmesi
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel (CSV)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^yevmiye-defteri-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );

  // Yazdırma görünümü: yalnızca defter içeriği, sayfa numarası ve devreden/nakledilen satırları
  await page.emulateMedia({ media: 'print' });
  const printRoot = page.locator('.book-print-root');
  await expect(printRoot.getByText('YEVMİYE DEFTERİ', { exact: true }).first()).toBeVisible();
  await expect(printRoot.getByText(/Sayfa 1 \//).first()).toBeVisible();
  await expect(printRoot.getByText('Devreden').first()).toBeVisible();
  await expect(printRoot.getByText('Sayfa toplamı').first()).toBeVisible();
  await expect(page.getByLabel('Muhasebe sekmeleri')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(printRoot).toBeHidden();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Defter-i Kebir: hesap blokları, aç/kapa, Devir satırı, CSV ve yazdırma görünümü', async ({
  page,
}) => {
  await openReport(page, 'Defter-i Kebir');

  const blocks = page.locator('section.gl-acc');
  await expect(blocks.first()).toBeVisible();
  await expect(page.getByLabel('Yalnız hareketli hesaplar')).toBeChecked();
  await expect(page.getByLabel('Ana hesap düzeyinde (alt hesaplar toplansın)')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Yazdır / PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel (CSV)' })).toBeVisible();

  // Tümünü kapat → bir blok aç → Devir satırı görünür
  await closeAll(page);
  const toggle = blocks.first().locator('button[aria-expanded]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(blocks.first().getByText('Devir', { exact: true })).toBeVisible();
  await expect(blocks.first().getByText('Dönem toplamı')).toBeVisible();

  // Ön ek süzgeci yalnız rakam ve nokta kabul eder
  const prefix = page.getByLabel('Hesap kodu ön eki');
  await prefix.fill('a1b.2c');
  await expect(prefix).toHaveValue('1.2');
  await prefix.fill('');

  // CSV
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel (CSV)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^defter-i-kebir-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );

  // Yazdırma görünümü: başlık + sayfa no; kapalı bloklar da basılır (Devir satırı)
  await closeAll(page);
  await page.emulateMedia({ media: 'print' });
  const printRoot = page.locator('.book-print-root');
  await expect(printRoot.getByText('DEFTER-İ KEBİR', { exact: true }).first()).toBeVisible();
  await expect(printRoot.getByText(/Sayfa 1 \//).first()).toBeVisible();
  await expect(printRoot.getByText('Devir', { exact: true }).first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Defterler: rapor yüklenmeden yazdırma uyarı verir', async ({ page }) => {
  await page
    .getByLabel('Muhasebe sekmeleri')
    .getByRole('button', { name: /Raporlar/ })
    .click();
  await page.locator('.report-controls select').selectOption({ label: 'Yevmiye Defteri' });
  await page.getByRole('button', { name: 'Yazdır / PDF' }).click();
  await expect(page.getByText('Önce raporu oluşturun.')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
