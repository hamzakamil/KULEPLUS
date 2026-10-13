import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
import {
  parseCsv,
  parseFlexibleDate,
  parseNumeric,
  resolveCsvMapping,
  suggestFieldMapping,
  toCsvText,
} from '../../services/csv.js';
import { IMPORT_SYNC_MAX_ROWS } from '../contacts/import.service.js';
import { checkLimit, incrementUsage } from '../entitlement/service.js';
import { IMPORT_LIMIT_KEY } from './import.service.js';
import { StockService } from './service.js';

/**
 * Açılış stoğu içe aktarma — docs/product/import-templates/opening-stock.md.
 *
 * Kurallar:
 * - Ürün (kod/barkod) ve depo önce var olmalı; otomatik oluşturulmaz.
 * - Miktar > 0 olmalı (negatif stok politikası: block).
 * - Satır, `stock_movements`'a `in` tipi + `reference_type='opening_stock'` ile
 *   yazılır; hareketli ortalama maliyet ve bakiye tek transaction'da güncellenir
 *   (StockService.openingStock — SPEC §14.1).
 * - Tarih (GG.AA.YYYY) hareketin `created_at` değeri olur; geleceğe gidilemez.
 */

/** Şablon hedef alanları */
export const OPENING_STOCK_IMPORT_TARGET_FIELDS = [
  'sku',
  'warehouse',
  'quantity',
  'unit_cost',
  'date',
] as const;
export type OpeningStockImportTargetField = (typeof OPENING_STOCK_IMPORT_TARGET_FIELDS)[number];

/** Başlık → hedef alan eşleştirme önerisi (TR/EN takma adlar; normalize edilir) */
const FIELD_ALIASES: Record<OpeningStockImportTargetField, string[]> = {
  sku: ['sku', 'kod', 'code', 'urun_kodu', 'malzeme_kodu', 'stok_kodu', 'barkod', 'barcode'],
  warehouse: ['warehouse', 'depo', 'depo_adi', 'warehouse_name', 'depot'],
  quantity: ['quantity', 'qty', 'miktar', 'amount', 'acilis_stogu', 'stok'],
  unit_cost: [
    'unit_cost',
    'maliyet',
    'maliyet_fiyati',
    'birim_maliyet',
    'cost',
    'cost_price',
    'alis_fiyati',
  ],
  date: ['date', 'tarih', 'acilis_tarihi', 'transaction_date', 'created_at'],
};

export type OpeningStockRowIssue = { field: string; message: string };

export type OpeningStockRowReport = {
  line: number;
  /** Rapor etiketi: "ÜRÜN-KODU @ Depo" */
  name: string | null;
  status: 'valid' | 'invalid' | 'duplicate' | 'created' | 'failed';
  issues: OpeningStockRowIssue[];
  warnings: OpeningStockRowIssue[];
  duplicateOf?: string;
  id?: string;
};

export type OpeningStockLimitInfo = {
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
};

export type OpeningStockImportReport = {
  headers: string[];
  suggestedMapping: Record<string, OpeningStockImportTargetField | null>;
  mapping: Record<string, OpeningStockImportTargetField | null>;
  summary: { total: number; valid: number; duplicates: number; invalid: number; toImport: number };
  limit: OpeningStockLimitInfo;
  rows: OpeningStockRowReport[];
};

export type OpeningStockImportCommitResult = {
  summary: { total: number; created: number; duplicates: number; failed: number };
  limit: OpeningStockLimitInfo;
  rows: OpeningStockRowReport[];
};

type OpeningStockInput = {
  productId: string;
  productLabel: string;
  warehouseId: string;
  warehouseLabel: string;
  quantity: number;
  unitCost: number;
  transactionDate: Date;
};

type ParsedOpeningStockRow = {
  line: number;
  name: string | null;
  issues: OpeningStockRowIssue[];
  warnings: OpeningStockRowIssue[];
  duplicateOf?: string;
  input: OpeningStockInput | null;
};

type ProductRef = { id: string; code: string; name: string };
type WarehouseRef = { id: string; code: string; name: string };

/**
 * Açılış stoğu yazımı başarısız olduğunda kullanıcıya gösterilecek mesaj.
 * AppError mesajı olduğu gibi taşınır; beklenmedik (DB/RLS) hatalarda teknik
 * detay satır raporuna eklenir — aksi halde "neden başarısız" anlaşılıyordu.
 */
function openingStockFailureMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
  return `Açılış stoğu yazılamadı${detail}`;
}

export class OpeningStockImportService {
  private poolInstance: Pool | null = null;
  private readonly providedPool: Pool | null;
  private readonly stock = new StockService();

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private get pool(): Pool {
    if (!this.poolInstance) this.poolInstance = this.providedPool ?? getPool('app');
    return this.poolInstance;
  }

  private async requireTenantId(): Promise<string> {
    const result = await this.pool.query<{ tenant_id: string | null }>(
      'SELECT current_tenant_id() AS tenant_id',
    );
    const tenantId = result.rows[0]?.tenant_id;
    if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant bağlamı yok');
    return tenantId;
  }

  /** Türkçe-duyarlı karşılaştırma anahtarı (İ/ı + aksan) — SPEC §3.1 */
  private trKey(value: string): string {
    return value
      .trim()
      .toLocaleLowerCase('tr')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u')
      .replace(/\s+/g, ' ');
  }

  private async limitInfo(): Promise<OpeningStockLimitInfo> {
    const tenantId = await this.requireTenantId();
    const result = await checkLimit(tenantId, IMPORT_LIMIT_KEY);
    return {
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt.toISOString(),
    };
  }

  /** CSV'yi ayrıştır, ürün/depo referanslarını doğrula, satır bazlı rapor üret */
  private async parseAndValidate(
    csv: string,
    mapping: Record<string, string | null> | undefined,
  ): Promise<{
    parsed: ParsedOpeningStockRow[];
    headers: string[];
    suggestedMapping: Record<string, OpeningStockImportTargetField | null>;
    appliedMapping: Record<string, OpeningStockImportTargetField | null>;
  }> {
    const { headers, rows } = parseCsv(csv);
    const suggestedMapping = suggestFieldMapping(headers, FIELD_ALIASES);
    const appliedMapping = resolveCsvMapping(
      headers,
      suggestedMapping,
      mapping,
      OPENING_STOCK_IMPORT_TARGET_FIELDS,
    );

    // Referans katalogları (tek sorgu): ürün kod/barkod + depo ad/kod + mevcut bakiye
    const productRows = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      barcode: string | null;
    }>(
      `SELECT id, code, name, barcode FROM products
       WHERE tenant_id = current_tenant_id() AND is_active = true`,
    );
    const productsByCode = new Map<string, ProductRef>();
    const productsByBarcode = new Map<string, ProductRef>();
    for (const row of productRows.rows) {
      const ref: ProductRef = { id: row.id, code: row.code, name: row.name };
      productsByCode.set(this.trKey(row.code), ref);
      if (row.barcode) productsByBarcode.set(row.barcode.trim(), ref);
    }

    const warehouseRows = await this.pool.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM warehouses
       WHERE tenant_id = current_tenant_id() AND is_active = true`,
    );
    const warehousesByName = new Map<string, WarehouseRef>();
    for (const row of warehouseRows.rows) {
      const ref: WarehouseRef = { id: row.id, code: row.code, name: row.name };
      warehousesByName.set(this.trKey(row.name), ref);
      warehousesByName.set(this.trKey(row.code), ref);
    }

    const balanceRows = await this.pool.query<{
      product_id: string;
      warehouse_id: string | null;
      quantity: string;
    }>(
      `SELECT product_id, warehouse_id, quantity FROM stock_balances
       WHERE tenant_id = current_tenant_id()`,
    );
    const balances = new Map<string, number>();
    for (const row of balanceRows.rows) {
      balances.set(`${row.product_id}|${row.warehouse_id ?? ''}`, Number(row.quantity));
    }

    const seenPairs = new Map<string, number>();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const parsed: ParsedOpeningStockRow[] = rows.map((cells, idx) => {
      const line = idx + 1;
      const values: Partial<Record<OpeningStockImportTargetField, string>> = {};
      headers.forEach((header, colIdx) => {
        const target = appliedMapping[header];
        if (target) values[target] = (cells[colIdx] ?? '').trim();
      });

      const issues: OpeningStockRowIssue[] = [];
      const warnings: OpeningStockRowIssue[] = [];
      const sku = values.sku ?? '';
      const warehouse = values.warehouse ?? '';

      const product = sku
        ? (productsByCode.get(this.trKey(sku)) ?? productsByBarcode.get(sku))
        : undefined;
      const warehouseRef = warehouse ? warehousesByName.get(this.trKey(warehouse)) : undefined;

      if (!sku) issues.push({ field: 'sku', message: 'Ürün kodu/barkodu zorunlu' });
      else if (!product)
        issues.push({
          field: 'sku',
          message: `Ürün bulunamadı (${sku}) — önce ürün listesini içe aktarın`,
        });

      if (!warehouse) issues.push({ field: 'warehouse', message: 'Depo zorunlu' });
      else if (!warehouseRef)
        issues.push({ field: 'warehouse', message: `Depo bulunamadı (${warehouse})` });

      let quantity: number | null = null;
      if (!values.quantity) {
        issues.push({ field: 'quantity', message: 'Miktar zorunlu' });
      } else {
        quantity = parseNumeric(values.quantity);
        if (quantity === null) {
          issues.push({ field: 'quantity', message: 'Miktar sayı olmalı (örn: 100)' });
        } else if (quantity <= 0) {
          issues.push({
            field: 'quantity',
            message: 'Açılış stoğu sıfırdan büyük olmalı (negatif stok politikası: block)',
          });
        }
      }

      let unitCost = 0;
      if (values.unit_cost) {
        const parsedCost = parseNumeric(values.unit_cost);
        if (parsedCost === null) {
          issues.push({ field: 'unit_cost', message: 'Birim maliyet sayı olmalı (örn: 8,00)' });
        } else if (parsedCost < 0) {
          issues.push({ field: 'unit_cost', message: 'Birim maliyet negatif olamaz' });
        } else {
          unitCost = parsedCost;
        }
      } else {
        warnings.push({
          field: 'unit_cost',
          message: 'Birim maliyet yok — 0 olarak kaydedilir (stok değeri hesaplanamaz)',
        });
      }

      let transactionDate: Date | null = null;
      if (!values.date) {
        issues.push({ field: 'date', message: 'Açılış tarihi zorunlu (GG.AA.YYYY)' });
      } else {
        transactionDate = parseFlexibleDate(values.date);
        if (!transactionDate) {
          issues.push({ field: 'date', message: 'Tarih formatı geçersiz (GG.AA.YYYY)' });
        } else if (transactionDate.getTime() > endOfToday.getTime()) {
          issues.push({ field: 'date', message: 'Açılış tarihi gelecekte olamaz' });
        }
      }

      // Aynı ürün+depo kombinasyonu dosyada tekrar ediyorsa ikinci satır mükerrerdir
      let duplicateOf: string | undefined;
      if (product && warehouseRef) {
        const pairKey = `${product.id}|${warehouseRef.id}`;
        const previousLine = seenPairs.get(pairKey);
        if (previousLine) duplicateOf = `dosya içi ${previousLine}. satır (${product.code})`;
        else seenPairs.set(pairKey, line);

        const currentBalance = balances.get(pairKey) ?? 0;
        if (currentBalance > 0) {
          warnings.push({
            field: 'quantity',
            message: `Bu depoda mevcut ${currentBalance} stok var — açılış stoğu üzerine eklenir`,
          });
        }
      }

      const name = product
        ? `${product.code}${warehouseRef ? ` @ ${warehouseRef.name}` : ''}`
        : sku || null;

      const input: OpeningStockInput | null =
        issues.length === 0 &&
        !duplicateOf &&
        product &&
        warehouseRef &&
        quantity &&
        transactionDate
          ? {
              productId: product.id,
              productLabel: product.code,
              warehouseId: warehouseRef.id,
              warehouseLabel: warehouseRef.name,
              quantity,
              unitCost,
              transactionDate,
            }
          : null;

      return { line, name, issues, warnings, duplicateOf, input };
    });

    return { parsed, headers, suggestedMapping, appliedMapping };
  }

  /** Dry-run: yazmadan doğrulama raporu (SPEC §23.1) */
  async dryRun(
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<OpeningStockImportReport> {
    const limit = await this.limitInfo();
    const { parsed, headers, suggestedMapping, appliedMapping } = await this.parseAndValidate(
      csv,
      mapping,
    );

    const valid = parsed.filter((p) => p.input).length;
    const duplicates = parsed.filter((p) => p.duplicateOf && p.issues.length === 0).length;
    const invalid = parsed.filter((p) => p.issues.length > 0).length;

    return {
      headers,
      suggestedMapping,
      mapping: appliedMapping,
      summary: { total: parsed.length, valid, duplicates, invalid, toImport: valid },
      limit,
      rows: parsed.map((p) => ({
        line: p.line,
        name: p.name,
        status: p.issues.length > 0 ? 'invalid' : p.duplicateOf ? 'duplicate' : 'valid',
        issues: p.issues,
        warnings: p.warnings,
        duplicateOf: p.duplicateOf,
      })),
    };
  }

  /** Commit: geçerli satırları açılış hareketi olarak yaz — satır başına kendi işlemi */
  async commit(
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<OpeningStockImportCommitResult> {
    if (csv.length > 2_000_000) {
      throw new AppError('VALIDATION_ERROR', 'CSV boyutu 2 MB sınırını aşıyor');
    }
    const { parsed } = await this.parseAndValidate(csv, mapping);

    if (parsed.length > IMPORT_SYNC_MAX_ROWS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${IMPORT_SYNC_MAX_ROWS} satır üstü içe aktarma kuyruğa alınır (Faz 3)`,
      );
    }

    // K-02: aylık import satırı kotası — aktarılacak satır kadar yer olmalı
    const limit = await this.limitInfo();
    const validCount = parsed.filter((p) => p.input).length;
    if (limit.remaining !== null && validCount > limit.remaining) {
      throw new AppError(
        'LIMIT_EXCEEDED',
        `Aylık içe aktarma kotası aşılıyor: kalan ${limit.remaining}, aktarılacak ${validCount} satır`,
      );
    }

    const rows: OpeningStockRowReport[] = [];
    let created = 0;

    for (const p of parsed) {
      if (p.issues.length > 0) {
        rows.push({
          line: p.line,
          name: p.name,
          status: 'invalid',
          issues: p.issues,
          warnings: p.warnings,
        });
        continue;
      }
      if (p.duplicateOf) {
        rows.push({
          line: p.line,
          name: p.name,
          status: 'duplicate',
          issues: [],
          warnings: p.warnings,
          duplicateOf: p.duplicateOf,
        });
        continue;
      }
      const input = p.input as OpeningStockInput;
      try {
        const movement = await this.stock.openingStock({
          product_id: input.productId,
          warehouse_id: input.warehouseId,
          quantity: input.quantity,
          cost_price: input.unitCost,
          transaction_date: input.transactionDate,
          notes: 'İçe aktarma — açılış stoğu',
        });
        created += 1;
        rows.push({
          line: p.line,
          name: p.name,
          status: 'created',
          issues: [],
          warnings: p.warnings,
          id: movement?.id,
        });
      } catch (err) {
        rows.push({
          line: p.line,
          name: p.name,
          status: 'failed',
          warnings: p.warnings,
          issues: [
            {
              field: '_',
              message: openingStockFailureMessage(err),
            },
          ],
        });
      }
    }

    // Kullanım sayacı: yalnızca başarılı aktarımlar sayılır (K-02)
    if (created > 0) {
      const tenantId = await this.requireTenantId();
      await incrementUsage(tenantId, IMPORT_LIMIT_KEY, undefined, created);
    }

    return {
      summary: {
        total: parsed.length,
        created,
        duplicates: rows.filter((r) => r.status === 'duplicate').length,
        failed: rows.filter((r) => r.status === 'failed' || r.status === 'invalid').length,
      },
      limit: await this.limitInfo(),
      rows,
    };
  }

  /** Örnek şablon (UTF-8 BOM) — docs/product/import-templates/opening-stock.md */
  templateCsv(): string {
    return toCsvText(
      ['sku', 'warehouse', 'quantity', 'unit_cost', 'date'],
      [
        ['VIDA-M4', 'Merkez Depo', '100', '8,00', '01.01.2026'],
        ['URN-000002', 'Merkez Depo', '20', '60,00', '01.01.2026'],
      ],
    );
  }
}
