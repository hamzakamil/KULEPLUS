import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
import {
  parseCsv,
  parseNumeric,
  resolveCsvMapping,
  suggestFieldMapping,
  toCsvText,
} from '../../services/csv.js';
import { IMPORT_SYNC_MAX_ROWS } from '../contacts/import.service.js';
import { checkLimit, incrementUsage } from '../entitlement/service.js';
import { StockService } from './service.js';

/**
 * Ürün içe aktarma — SPEC §23.1 (kolon eşleştirme → dry-run → hata raporu →
 * onay → kontrollü batch) + docs/product/import-templates/products.md.
 *
 * Açılış stoğu: şablondaki `initial_stock` kolonu, ürün oluşturulduktan sonra
 * temel depoya giriş hareketi olarak yazılır (SPEC §14 — açılış stoğu hareket
 * üretir, bakiye doğrudan ezilmez).
 *
 * Not: `category` ve `vat_rate` şablon kolonları ürün şemasında karşılığı
 * olmadığı için hedef alan olarak sunulmaz (eşleştirilmeyen kolon atlanır).
 */

/** K-02 limit anahtarı — cari içe aktarmayla aynı aylık kota sayacı. */
export const IMPORT_LIMIT_KEY = 'max_import_rows_monthly';

/** Şablon hedef alanları — docs/product/import-templates/products.md */
export const PRODUCT_IMPORT_TARGET_FIELDS = [
  'code',
  'name',
  'unit',
  'barcode',
  'sale_price',
  'cost_price',
  'initial_stock',
  'description',
] as const;
export type ProductImportTargetField = (typeof PRODUCT_IMPORT_TARGET_FIELDS)[number];

/** Başlık → hedef alan eşleştirme önerisi (TR/EN takma adlar; normalize edilir). */
const FIELD_ALIASES: Record<ProductImportTargetField, string[]> = {
  code: ['code', 'sku', 'kod', 'urun_kodu', 'stok_kodu', 'malzeme_kodu'],
  name: ['name', 'urun_adi', 'ad', 'isim', 'malzeme', 'malzeme_adi'],
  unit: ['unit', 'birim', 'olcu', 'ana_birim'],
  barcode: ['barcode', 'barkod', 'bar_code', 'ean', 'ean13'],
  sale_price: ['sale_price', 'satis_fiyati', 'satis', 'fiyat', 'price'],
  cost_price: ['cost_price', 'maliyet_fiyati', 'maliyet', 'alis_fiyati', 'purchase_price'],
  initial_stock: ['initial_stock', 'acilis_stogu', 'acilis', 'stok', 'miktar', 'quantity'],
  description: ['description', 'aciklama', 'not', 'ozellik'],
};

export type ProductImportRowIssue = { field: string; message: string };

export type ProductImportRowReport = {
  line: number;
  name: string | null;
  status: 'valid' | 'invalid' | 'duplicate' | 'created' | 'failed';
  issues: ProductImportRowIssue[];
  /** Satırı engellemeyen bildirimler (örn. birim katalogda yok → aktarımda oluşur) */
  warnings: ProductImportRowIssue[];
  duplicateOf?: string;
  id?: string;
  code?: string;
};

export type ProductImportLimitInfo = {
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
};

export type ProductImportReport = {
  headers: string[];
  suggestedMapping: Record<string, ProductImportTargetField | null>;
  mapping: Record<string, ProductImportTargetField | null>;
  summary: { total: number; valid: number; duplicates: number; invalid: number; toImport: number };
  limit: ProductImportLimitInfo;
  rows: ProductImportRowReport[];
};

export type ProductImportCommitResult = {
  summary: { total: number; created: number; duplicates: number; failed: number };
  limit: ProductImportLimitInfo;
  rows: ProductImportRowReport[];
};

type ProductImportInput = {
  code: string;
  name: string;
  unit: string;
  barcode: string | null;
  sale_price: number | null;
  cost_price: number | null;
  initial_stock: number | null;
  description: string | null;
};

type ParsedProductRow = {
  line: number;
  issues: ProductImportRowIssue[];
  warnings: ProductImportRowIssue[];
  duplicateOf?: string;
  name: string | null;
  input: ProductImportInput | null;
};

const BARCODE_RE = /^[0-9A-Za-z-]{3,64}$/;

export class ProductImportService {
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

  private async limitInfo(): Promise<ProductImportLimitInfo> {
    const tenantId = await this.requireTenantId();
    const result = await checkLimit(tenantId, IMPORT_LIMIT_KEY);
    return {
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt.toISOString(),
    };
  }

  /** Eşleştirmeyi doğrula: bilinmeyen alan + aynı alana iki kolon engeli */
  private resolveMapping(
    headers: string[],
    suggested: Record<string, ProductImportTargetField | null>,
    mapping: Record<string, string | null> | undefined,
  ): Record<string, ProductImportTargetField | null> {
    return resolveCsvMapping(headers, suggested, mapping, PRODUCT_IMPORT_TARGET_FIELDS);
  }

  /** CSV'yi ayrıştır, eşleştir, satır bazlı doğrula ve mükerrerleri işaretle */
  private async parseAndValidate(
    csv: string,
    mapping: Record<string, string | null> | undefined,
  ): Promise<{
    parsed: ParsedProductRow[];
    headers: string[];
    suggestedMapping: Record<string, ProductImportTargetField | null>;
    appliedMapping: Record<string, ProductImportTargetField | null>;
  }> {
    const { headers, rows } = parseCsv(csv);
    const suggestedMapping = suggestFieldMapping(headers, FIELD_ALIASES);
    const appliedMapping = this.resolveMapping(headers, suggestedMapping, mapping);

    // Mükerrer tespiti için mevcut ürün kümesi (tek sorgu)
    const existing = await this.pool.query<{ code: string; name: string; barcode: string | null }>(
      'SELECT code, name, barcode FROM products WHERE tenant_id = current_tenant_id()',
    );
    const dbCodes = new Set(existing.rows.map((r) => this.trKey(r.code)));
    const dbNames = new Set(existing.rows.map((r) => this.trKey(r.name)));
    const dbBarcodes = new Set(
      existing.rows.map((r) => r.barcode).filter((b): b is string => Boolean(b)),
    );

    // Birim kataloğu: katalogda olmayan birim uyarı üretir, aktarımda oluşturulur
    const unitRows = await this.pool.query<{ name: string }>(
      'SELECT name FROM units WHERE tenant_id = current_tenant_id() AND is_active = true',
    );
    const knownUnits = new Set(unitRows.rows.map((r) => this.trKey(r.name)));

    const seenCodes = new Map<string, number>();
    const seenNames = new Map<string, number>();
    const seenBarcodes = new Map<string, number>();

    const parsed: ParsedProductRow[] = rows.map((cells, idx) => {
      const line = idx + 1;
      const values: Partial<Record<ProductImportTargetField, string>> = {};
      headers.forEach((header, colIdx) => {
        const target = appliedMapping[header];
        if (target) values[target] = (cells[colIdx] ?? '').trim();
      });

      const issues: ProductImportRowIssue[] = [];
      const warnings: ProductImportRowIssue[] = [];
      const name = values.name ?? '';
      const code = values.code ?? '';
      const unit = values.unit ?? '';
      const barcode = values.barcode ?? '';

      if (!name) issues.push({ field: 'name', message: 'Ürün adı zorunlu' });
      if (!unit) issues.push({ field: 'unit', message: 'Birim zorunlu (örn: ADET, KG, LİTRE)' });

      let salePrice: number | null = null;
      if (values.sale_price) {
        salePrice = parseNumeric(values.sale_price);
        if (salePrice === null) {
          issues.push({ field: 'sale_price', message: 'Satış fiyatı sayı olmalı (örn: 12,50)' });
        } else if (salePrice < 0) {
          issues.push({ field: 'sale_price', message: 'Satış fiyatı negatif olamaz' });
        }
      }

      let costPrice: number | null = null;
      if (values.cost_price) {
        costPrice = parseNumeric(values.cost_price);
        if (costPrice === null) {
          issues.push({ field: 'cost_price', message: 'Maliyet fiyatı sayı olmalı (örn: 8,00)' });
        } else if (costPrice < 0) {
          issues.push({ field: 'cost_price', message: 'Maliyet fiyatı negatif olamaz' });
        }
      }

      let initialStock: number | null = null;
      if (values.initial_stock) {
        initialStock = parseNumeric(values.initial_stock);
        if (initialStock === null) {
          issues.push({ field: 'initial_stock', message: 'Açılış stoğu sayı olmalı (örn: 100)' });
        } else if (initialStock < 0) {
          issues.push({
            field: 'initial_stock',
            message: 'Açılış stoğu negatif olamaz (negatif stok politikası: block)',
          });
        }
      }

      if (barcode && !BARCODE_RE.test(barcode)) {
        issues.push({ field: 'barcode', message: 'Barkod 3-64 karakter, harf/rakam olmalı' });
      }
      if (unit && !knownUnits.has(this.trKey(unit))) {
        warnings.push({
          field: 'unit',
          message: `Birim "${unit}" katalogda yok — aktarımda otomatik oluşturulacak`,
        });
      }

      // Mükerrerlik: kod benzersiz olmalı (products_tenant_code_unique); ad/barkod da işaretlenir
      let duplicateOf: string | undefined;
      const codeKey = code ? this.trKey(code) : '';
      const nameKey = name ? this.trKey(name) : '';
      if (codeKey && dbCodes.has(codeKey)) duplicateOf = `mevcut ürün (kod ${code})`;
      else if (codeKey && seenCodes.has(codeKey))
        duplicateOf = `dosya içi ${seenCodes.get(codeKey)}. satır (kod ${code})`;
      else if (nameKey && dbNames.has(nameKey)) duplicateOf = `mevcut ürün (ad ${name})`;
      else if (nameKey && seenNames.has(nameKey))
        duplicateOf = `dosya içi ${seenNames.get(nameKey)}. satır (ad ${name})`;
      else if (barcode && dbBarcodes.has(barcode)) duplicateOf = `mevcut ürün (barkod ${barcode})`;
      else if (barcode && seenBarcodes.has(barcode))
        duplicateOf = `dosya içi ${seenBarcodes.get(barcode)}. satır (barkod ${barcode})`;

      if (codeKey && !seenCodes.has(codeKey)) seenCodes.set(codeKey, line);
      if (nameKey && !seenNames.has(nameKey)) seenNames.set(nameKey, line);
      if (barcode && !seenBarcodes.has(barcode)) seenBarcodes.set(barcode, line);

      const input: ProductImportInput | null =
        issues.length === 0 && !duplicateOf && name
          ? {
              code,
              name: name.trim(),
              unit: unit.trim(),
              barcode: barcode || null,
              sale_price: salePrice,
              cost_price: costPrice,
              initial_stock: initialStock,
              description: (values.description ?? '').trim() || null,
            }
          : null;

      return { line, issues, warnings, duplicateOf, name: name || null, input };
    });

    return { parsed, headers, suggestedMapping, appliedMapping };
  }

  /** Dry-run: doğrulama + rapor; yazma yapmaz (SPEC §23.1) */
  async dryRun(csv: string, mapping?: Record<string, string | null>): Promise<ProductImportReport> {
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

  /** Birim adını çöz (katalogda yoksa oluşturulur + önbelleğe alınır) — şablon kuralı */
  private async resolveUnitId(unitName: string, cache: Map<string, string>): Promise<string> {
    const key = this.trKey(unitName);
    const cached = cache.get(key);
    if (cached) return cached;

    const found = await this.pool.query<{ id: string }>(
      `SELECT id FROM units
       WHERE tenant_id = current_tenant_id() AND is_active = true AND lower(name) = lower($1)
       ORDER BY is_base DESC LIMIT 1`,
      [unitName],
    );
    if (found.rows[0]?.id) {
      cache.set(key, found.rows[0].id);
      return found.rows[0].id;
    }

    const code =
      unitName
        .toLocaleUpperCase('tr')
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10) || 'BRM';
    const created = await this.stock.createUnit({ code, name: unitName, is_base: true });
    cache.set(key, created.id);
    return created.id;
  }

  /** Temel depo (yoksa "Merkez Depo" açılır — ücretsiz planda tek depo, SPEC §14.3) */
  private async ensureWarehouseId(): Promise<string> {
    const found = await this.pool.query<{ id: string }>(
      `SELECT id FROM warehouses
       WHERE tenant_id = current_tenant_id() AND is_active = true
       ORDER BY is_base DESC, created_at LIMIT 1`,
    );
    if (found.rows[0]?.id) return found.rows[0].id;
    const created = await this.stock.createWarehouse({
      code: 'MERKEZ',
      name: 'Merkez Depo',
      is_base: true,
    });
    return created.id;
  }

  /** Dosyada kod yoksa kullanılmayan URN kodu üret (products_tenant_code_unique) */
  private nextCode(usedCodes: Set<string>): string {
    for (let i = 1; i < 1_000_000; i++) {
      const candidate = `URN-${String(i).padStart(6, '0')}`;
      const key = candidate.toLocaleLowerCase('tr');
      if (!usedCodes.has(key)) {
        usedCodes.add(key);
        return candidate;
      }
    }
    throw new AppError('VALIDATION_ERROR', 'Ürün kodu havuzu tükendi');
  }

  /** Commit: geçerli satırları aktar — satır başına kendi işlemi (SPEC §23.1) */
  async commit(
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<ProductImportCommitResult> {
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

    const unitCache = new Map<string, string>();
    const existingCodes = await this.pool.query<{ code: string }>(
      'SELECT code FROM products WHERE tenant_id = current_tenant_id()',
    );
    const usedCodes = new Set(existingCodes.rows.map((r) => r.code.toLocaleLowerCase('tr')));

    let warehouseId: string | null = null;
    const rows: ProductImportRowReport[] = [];
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
      const input = p.input as ProductImportInput;
      const code = input.code ? input.code : this.nextCode(usedCodes);
      let createdProductId: string | null = null;
      try {
        const unitId = await this.resolveUnitId(input.unit, unitCache);
        const product = await this.stock.createProduct({
          code,
          name: input.name,
          unit_id: unitId,
          barcode: input.barcode ?? undefined,
          cost_price: input.cost_price ?? 0,
          sale_price: input.sale_price ?? 0,
          description: input.description ?? undefined,
        });
        createdProductId = product.id;

        // Açılış stoğu → temel depoya `reference_type='opening_stock'` giriş hareketi
        // (hareketli ortalama maliyet + bakiye tek transaction'da güncellenir — SPEC §14.1)
        if (input.initial_stock && input.initial_stock > 0) {
          if (!warehouseId) warehouseId = await this.ensureWarehouseId();
          await this.stock.openingStock({
            product_id: product.id,
            warehouse_id: warehouseId,
            quantity: input.initial_stock,
            cost_price: input.cost_price ?? 0,
            notes: 'İçe aktarma — açılış stoğu',
          });
        }

        created += 1;
        rows.push({
          line: p.line,
          name: p.name,
          status: 'created',
          issues: [],
          warnings: p.warnings,
          id: product.id,
          code: (product.code as string | undefined) ?? code,
        });
      } catch (err) {
        const reason = err instanceof AppError ? err.message : 'Ürün oluşturulamadı';
        rows.push({
          line: p.line,
          name: p.name,
          status: 'failed',
          warnings: p.warnings,
          id: createdProductId ?? undefined,
          issues: [
            {
              field: createdProductId ? 'initial_stock' : '_',
              message: createdProductId
                ? `Ürün oluşturuldu, açılış stoğu yazılamadı: ${reason}`
                : reason,
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

    const newLimit = await this.limitInfo();
    return {
      summary: {
        total: parsed.length,
        created,
        duplicates: rows.filter((r) => r.status === 'duplicate').length,
        failed: rows.filter((r) => r.status === 'failed' || r.status === 'invalid').length,
      },
      limit: newLimit,
      rows,
    };
  }

  /** Örnek şablon (UTF-8 BOM) — docs/product/import-templates/products.md */
  templateCsv(): string {
    return toCsvText(
      [
        'name',
        'code',
        'unit',
        'barcode',
        'sale_price',
        'cost_price',
        'initial_stock',
        'description',
      ],
      [
        ['Vida M4', 'VIDA-M4', 'ADET', '8691234567890', '12,50', '8,00', '100', 'Paslanmaz'],
        ['Badana Boyası', '', 'LİTRE', '', '85', '60', '20', 'İç cephe'],
      ],
    );
  }
}
