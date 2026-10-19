/**
 * Tenant varsayılan verileri — KDV oranları, tevkifat türleri, gider kategorileri (Faz 7-3).
 *
 * Neden: kayıt ekranından/başvuru onayıyla açılan tenant'lara bu veriler hiç tohumlanmıyordu
 * (yalnızca migration anında var olan tenant'lara eklenmişti) → yeni şirkette faturaya KDV
 * oranı seçilemiyordu. Tenant oluşturan iki yol (identity.bootstrapTenant,
 * company.approveApplication) bunu aynı transaction'da çağırır. İdempotenttir.
 * Liste 202610560000 migration'ıyla aynıdır; id'ler deterministiktir (ADR-0002).
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

/** md5 → tireli uuid (migration'lardaki `md5(...)::uuid` deseniyle birebir aynı). */
function deterministicId(seed: string): string {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** [ad, e-Fatura kodu, oran payı (x/10), KDV-2 kodu] */
export const DEFAULT_WITHHOLDING_TYPES: ReadonlyArray<readonly [string, string, number, string]> = [
  ['Yapım İşleri ve Mimarlık/Mühendislik', '601', 4, '301'],
  ['Danışmanlık, Denetim, Etüt, Plan-Proje', '602', 9, '302'],
  ['Makine, Demirbaş, Taşıt Bakım-Onarım', '603', 7, '303'],
  ['Yemek Servis Hizmeti (Catering)', '604', 5, '304'],
  ['Organizasyon Hizmetleri', '605', 5, '305'],
  ['İşgücü Temin Hizmetleri', '606', 9, '306'],
  ['Özel Güvenlik Hizmetleri', '607', 9, '307'],
  ['Yapı Denetim Hizmetleri', '608', 9, '308'],
  ['Fason Tekstil, Konfeksiyon, Ayakkabı', '609', 7, '309'],
  ['Turistik Mağazalara Müşteri Bulma', '610', 9, '310'],
  ['Spor Kulüplerinin Reklam/İsim Hakkı', '611', 9, '311'],
  ['Temizlik Hizmetleri', '612', 9, '312'],
  ['Çevre ve Bahçe Bakım Hizmetleri', '613', 9, '313'],
  ['Servis Taşımacılığı (Personel/Öğrenci)', '614', 5, '314'],
  ['Baskı ve Basım Hizmetleri', '615', 7, '315'],
  ['Hurda Metalden Külçe Teslimi', '617', 7, '316'],
  ['Hurda Dışı Külçe Teslimleri', '618', 7, '317'],
  ['Bakır, Çinko, Alüminyum Ürünleri', '619', 7, '318'],
  ['İstisnadan Vazgeçenlerin Hurda Teslimi', '620', 7, '319'],
  ['Atıklardan Elde Edilen Hammadde', '621', 9, '320'],
  ['Pamuk, Yün, Ham Post ve Deri', '622', 9, '321'],
  ['Ağaç ve Orman Ürünleri', '623', 5, '322'],
  ['Yük Taşımacılığı Hizmeti', '624', 2, '323'],
  ['Ticari Reklam Hizmetleri', '625', 3, '324'],
  ['Demir-Çelik Ürünlerinin Teslimi', '627', 5, '325'],
];

/** [kod, ad, oran %] */
export const DEFAULT_TAX_RATES: ReadonlyArray<readonly [string, string, number]> = [
  ['KDV0', 'KDV %0 (Muaf)', 0],
  ['KDV1', 'KDV %1', 1],
  ['KDV10', 'KDV %10', 10],
  ['KDV20', 'KDV %20', 20],
];

/** [kod, ad, açıklama, grup] */
export const DEFAULT_EXPENSE_CATEGORIES: ReadonlyArray<readonly [string, string, string, string]> =
  [
    ['KIRA', 'Kira', 'İşyeri ve depo kiraları', 'kira'],
    ['ELEKTRIK', 'Elektrik', 'Elektrik faturaları', 'kamu-hizmetleri'],
    ['SU', 'Su', 'Su faturaları', 'kamu-hizmetleri'],
    ['ISINMA', 'Isınma', 'Doğalgaz, yakıt, ısınma giderleri', 'kamu-hizmetleri'],
    ['BAKIM', 'Bakım ve Onarım', 'Makine, tesis, araç bakım/onarım', 'isletme'],
    ['KUCUK_DEMIRBAS', 'Küçük Demirbaş', 'Küçük demirbaş alımları (yazıcı vb.)', 'isletme'],
    ['YIYECEK', 'Yiyecek ve İçecek', 'İşletme yeme-içme giderleri', 'isletme'],
    ['ISCILIK', 'İşçilik ve Çalışan', 'Personel ücret, sigorta, yan haklar', 'personel'],
    ['TELECOM', 'Telekom', 'Telefon ve internet giderleri', 'isletme'],
    ['NOTER', 'Noter', 'Noter harç ve tasdik giderleri', 'mevzuat'],
    ['MAHKEME', 'Mahkeme', 'Dava ve yargılama giderleri', 'mevzuat'],
    ['VERGI', 'Vergi, Harç ve Resmi Giderler', 'Vergiler, harçlar, resmi giderler', 'finansal'],
  ];

/**
 * Tenant'a varsayılan verileri ekler. RLS için transaction-local tenant GUC'u bu tenant'a
 * kurulur ve iş bitince önceki değere döndürülür.
 */
export async function ensureTenantDefaults(client: PoolClient, tenantId: string): Promise<void> {
  const prev = await client.query("SELECT current_setting('app.tenant_id', true) AS v");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  try {
    for (const [name, einvoiceCode, numerator, kdv2Code] of DEFAULT_WITHHOLDING_TYPES) {
      await client.query(
        `INSERT INTO withholding_types (id, tenant_id, name, einvoice_code, kdv2_code, rate_numerator)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          deterministicId(`${tenantId}:withholding_types:${einvoiceCode}`),
          tenantId,
          name,
          einvoiceCode,
          kdv2Code,
          numerator,
        ],
      );
    }
    const hasRates = await client.query('SELECT 1 FROM tax_rates WHERE tenant_id = $1 LIMIT 1', [
      tenantId,
    ]);
    if ((hasRates.rowCount ?? 0) === 0) {
      for (const [code, name, rate] of DEFAULT_TAX_RATES) {
        await client.query(
          `INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
           VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT DO NOTHING`,
          [deterministicId(`${tenantId}:tax_rates:${code}`), tenantId, code, name, rate],
        );
      }
    }
    const hasCategories = await client.query(
      'SELECT 1 FROM expense_categories WHERE tenant_id = $1 LIMIT 1',
      [tenantId],
    );
    if ((hasCategories.rowCount ?? 0) === 0) {
      for (const [code, name, description, grup] of DEFAULT_EXPENSE_CATEGORIES) {
        await client.query(
          `INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status)
           VALUES ($1, $2, $3, $4, $5, $6, true, 'active') ON CONFLICT DO NOTHING`,
          [
            deterministicId(`${tenantId}:expense_categories:${code}`),
            tenantId,
            code,
            name,
            description,
            grup,
          ],
        );
      }
    }
  } finally {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [prev.rows[0]?.v ?? '']);
  }
}
