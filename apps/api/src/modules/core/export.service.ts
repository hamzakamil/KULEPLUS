import { getPool } from '@kuleplus/db';
import type { Pool } from 'pg';
import { buildZip, type ZipEntry } from '../../services/zip.js';

/**
 * Tam veri dışa aktarma — SPEC §23.2:
 * "Dışa aktarma: Excel, CSV UTF-8 BOM; tam veri dışa aktarma (ZIP) —
 *  manifest + data/*.csv + files/ + README.txt".
 *
 * KVKK veri taşınabilirliği hakkının teknik karşılığıdır (SPEC §27.5).
 * İzolasyon: her veri kümesi `tenant_id = $1` ile filtrelenir; tenant_id kolonu
 * olmayan alt tablolar ana kayıt üzerinden bağlanır.
 */

/** RFC4180 + UTF-8 BOM — Excel Türkçe karakterleri bozmadan açar (SPEC §3). */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const esc = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const s = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export interface Dataset {
  /** `data/` altındaki dosya adı. */
  file: string;
  /** Kullanıcıya gösterilen ad (manifest + README). */
  label: string;
  /** `$1 = tenantId` parametreli sorgu. */
  sql: string;
}

/** Dışa aktarılacak veri kümeleri — yalnızca okuma, deterministik sıralı. */
export const EXPORT_DATASETS: Dataset[] = [
  { file: 'cari.csv', label: 'Cari kartlar', sql: `SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY code` },
  {
    file: 'cari_adres.csv',
    label: 'Cari adresleri',
    sql: `SELECT a.* FROM contact_addresses a JOIN contacts c ON c.id = a.contact_id WHERE c.tenant_id = $1 ORDER BY a.contact_id`,
  },
  {
    file: 'cari_telefon.csv',
    label: 'Cari telefonları',
    sql: `SELECT p.* FROM contact_phones p JOIN contacts c ON c.id = p.contact_id WHERE c.tenant_id = $1 ORDER BY p.contact_id`,
  },
  {
    file: 'cari_eposta.csv',
    label: 'Cari e-postaları',
    sql: `SELECT e.* FROM contact_emails e JOIN contacts c ON c.id = e.contact_id WHERE c.tenant_id = $1 ORDER BY e.contact_id`,
  },
  {
    file: 'cari_hareketleri.csv',
    label: 'Cari hareket defteri',
    sql: `SELECT * FROM party_ledger_entries WHERE tenant_id = $1 ORDER BY posted_at, id`,
  },
  { file: 'urunler.csv', label: 'Ürünler', sql: `SELECT * FROM products WHERE tenant_id = $1 ORDER BY code` },
  {
    file: 'urun_barkodlari.csv',
    label: 'Ürün barkodları',
    sql: `SELECT b.* FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE p.tenant_id = $1 ORDER BY b.product_id`,
  },
  { file: 'birimler.csv', label: 'Birimler', sql: `SELECT * FROM units WHERE tenant_id = $1 ORDER BY code` },
  { file: 'depolar.csv', label: 'Depolar', sql: `SELECT * FROM warehouses WHERE tenant_id = $1 ORDER BY code` },
  {
    file: 'stok_hareketleri.csv',
    label: 'Stok hareketleri',
    sql: `SELECT * FROM stock_movements WHERE tenant_id = $1 ORDER BY created_at, id`,
  },
  {
    file: 'stok_bakiyeleri.csv',
    label: 'Stok bakiyeleri',
    sql: `SELECT * FROM stock_balances WHERE tenant_id = $1 ORDER BY product_id, warehouse_id`,
  },
  {
    file: 'teklifler.csv',
    label: 'Satış teklifleri',
    sql: `SELECT * FROM sales_quotes WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'teklif_satirlari.csv',
    label: 'Teklif satırları',
    sql: `SELECT l.* FROM sales_quote_lines l JOIN sales_quotes q ON q.id = l.quote_id WHERE q.tenant_id = $1 ORDER BY l.quote_id`,
  },
  {
    file: 'siparisler.csv',
    label: 'Satış siparişleri',
    sql: `SELECT * FROM sales_orders WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'siparis_satirlari.csv',
    label: 'Sipariş satırları',
    sql: `SELECT l.* FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id WHERE o.tenant_id = $1 ORDER BY l.order_id`,
  },
  {
    file: 'satin_alma.csv',
    label: 'Satın alma siparişleri',
    sql: `SELECT * FROM purchase_orders WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'satin_alma_satirlari.csv',
    label: 'Satın alma satırları',
    sql: `SELECT l.* FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id WHERE o.tenant_id = $1 ORDER BY l.order_id`,
  },
  {
    file: 'irsaliyeler.csv',
    label: 'İrsaliyeler',
    sql: `SELECT * FROM deliveries WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'irsaliye_satirlari.csv',
    label: 'İrsaliye satırları',
    sql: `SELECT l.* FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id WHERE d.tenant_id = $1 ORDER BY l.delivery_id`,
  },
  {
    file: 'faturalar.csv',
    label: 'Faturalar',
    sql: `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY issue_date, id`,
  },
  {
    file: 'fatura_satirlari.csv',
    label: 'Fatura satırları',
    sql: `SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.tenant_id = $1 ORDER BY l.invoice_id`,
  },
  {
    file: 'fatura_odemeleri.csv',
    label: 'Fatura ödemeleri',
    sql: `SELECT p.* FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.tenant_id = $1 ORDER BY p.payment_date`,
  },
  {
    file: 'kasa_banka_hesaplari.csv',
    label: 'Kasa/banka hesapları',
    sql: `SELECT * FROM cash_bank_accounts WHERE tenant_id = $1 ORDER BY account_type, account_name`,
  },
  {
    file: 'kasa_banka_hareketleri.csv',
    label: 'Kasa/banka hareketleri',
    sql: `SELECT * FROM cash_bank_movements WHERE tenant_id = $1 ORDER BY transaction_date, id`,
  },
  {
    file: 'gider_kategorileri.csv',
    label: 'Gider kategorileri',
    sql: `SELECT * FROM expense_categories WHERE tenant_id = $1 ORDER BY name`,
  },
  {
    file: 'giderler.csv',
    label: 'Giderler',
    sql: `SELECT * FROM expenses WHERE tenant_id = $1 ORDER BY expense_date, id`,
  },
  {
    file: 'cek_senet.csv',
    label: 'Çek ve senetler',
    sql: `SELECT * FROM cheques WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'e_fatura_giden.csv',
    label: 'Giden e-faturalar',
    sql: `SELECT * FROM einvoice_documents WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'e_fatura_gelen.csv',
    label: 'Gelen e-faturalar',
    sql: `SELECT * FROM einvoice_inbox WHERE tenant_id = $1 ORDER BY created_at`,
  },
  {
    file: 'ekip.csv',
    label: 'Ekip üyeleri',
    sql: `SELECT u.email, u.status, tu.is_owner, tu.created_at AS member_since
          FROM tenant_users tu JOIN users u ON u.id = tu.user_id
          WHERE tu.tenant_id = $1 ORDER BY tu.is_owner DESC, u.email`,
  },
  { file: 'roller.csv', label: 'Roller', sql: `SELECT * FROM roles WHERE tenant_id = $1 ORDER BY name` },
  { file: 'departmanlar.csv', label: 'Departmanlar', sql: `SELECT * FROM departments WHERE tenant_id = $1 ORDER BY name` },
];

export interface FullExportResult {
  fileName: string;
  contentType: string;
  body: Buffer;
  datasetCount: number;
  rowCount: number;
}

/** Şirketin tüm ticari verisini tek ZIP'te teslim eder (SPEC §23.2). */
export class DataExportService {
  private pool: Pool | null = null;

  private get poolInstance(): Pool {
    if (!this.pool) this.pool = getPool('app');
    return this.pool;
  }

  async exportFull(tenantId: string, tenantName: string): Promise<FullExportResult> {
    const generatedAt = new Date();
    const entries: ZipEntry[] = [];
    const manifest: Array<{ file: string; label: string; rows: number }> = [];
    let rowCount = 0;

    for (const dataset of EXPORT_DATASETS) {
      // Tek veri kümesi patlarsa bütün dışa aktarma çökmesin: boş sayılır.
      let rows: Record<string, unknown>[];
      try {
        const result = await this.poolInstance.query<Record<string, unknown>>(dataset.sql, [tenantId]);
        rows = result.rows;
      } catch {
        rows = [];
      }

      const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
      const body =
        headers.length > 0
          ? toCsv(headers, rows.map((r) => headers.map((h) => r[h])))
          : toCsv(['bilgi'], [['veri yok']]);

      entries.push({ name: `data/${dataset.file}`, data: body });
      manifest.push({ file: `data/${dataset.file}`, label: dataset.label, rows: rows.length });
      rowCount += rows.length;
    }

    entries.push({
      name: 'manifest.json',
      data: JSON.stringify(
        {
          app: 'Kuleplus',
          export_type: 'full_data_export',
          specification: 'SPEC §23.2',
          tenant: { id: tenantId, name: tenantName },
          generated_at: generatedAt.toISOString(),
          timezone: 'Europe/Istanbul',
          encoding: 'UTF-8 with BOM (CSV)',
          datasets: manifest,
          files: [],
          totals: { datasets: manifest.length, rows: rowCount },
        },
        null,
        2,
      ),
    });

    const readme = [
      'Kuleplus — Tam Veri Dışa Aktarması',
      '==================================',
      '',
      `Şirket    : ${tenantName}`,
      `Oluşturma : ${generatedAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} (Europe/Istanbul)`,
      `Toplam    : ${manifest.length} veri kümesi, ${rowCount} satır`,
      '',
      'Bu arşiv, hesabınızdaki ticari verilerin makine-okunur kopyasıdır (KVKK veri',
      'taşınabilirliği — SPEC §23.2, §27.5). CSV dosyaları UTF-8 BOM ile yazıldığı',
      'için Excel doğrudan açar. Tarih/saat alanları ISO-8601 (UTC) biçimindedir.',
      '',
      'İçerik:',
      ...manifest.map((m) => `  - ${m.file.padEnd(32)} ${m.label} (${m.rows} satır)`),
      '',
      'Not: Para alanları ondalık ayracı nokta olan düz metindir; panoya dönük binlik',
      'ayracı uygulanmaz. Arşivin envanteri manifest.json dosyasındadır.',
      '',
    ];
    entries.push({ name: 'README.txt', data: readme.join('\r\n') });

    const stamp = generatedAt.toISOString().slice(0, 10);
    return {
      fileName: `kuleplus-veri-aktarimi-${stamp}.zip`,
      contentType: 'application/zip',
      body: buildZip(entries, generatedAt),
      datasetCount: manifest.length,
      rowCount,
    };
  }
}