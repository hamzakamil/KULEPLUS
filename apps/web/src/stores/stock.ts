import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

export interface StockItem {
  id: string;
  code: string;
  name: string;
  barcode?: string | null;
  unit_id?: string;
  unit_name?: string;
  unit_abbr?: string;
  /** Toplam stok miktarı (tüm depolar). API NUMERIC string döner. */
  quantity?: string | number;
  cost_price?: string | number;
  sale_price?: string | number;
  list_price?: string | number;
  description?: string | null;
  track_inventory?: boolean;
  /** Stok takipsiz ürünün alışta kullanılan varsayılan gider kategorisi. */
  default_expense_category_id?: string | null;
  /** Sınıflandırma ve depo bilgileri (migration 202610620000, 202610630000). */
  category_id?: string | null;
  /** Kategori adı (API, product_categories ile birleştirip döner). */
  category?: string | null;
  brand?: string | null;
  /** Tedarikçi / üretici ürün kodu. */
  supplier_code?: string | null;
  shelf_location?: string | null;
  /** Kritik stok seviyesi; 0 = uyarı yok. API NUMERIC string döner. */
  min_stock?: string | number;
  /** Ürünün varsayılan satış / alış KDV oranı (tax_rates.id). */
  sale_tax_rate_id?: string | null;
  purchase_tax_rate_id?: string | null;
  is_active?: boolean;
  stock_value?: string | number;
  /** Form uyumluluğu için türetilmiş alan. */
  unit?: string;
  price?: string;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  abbreviation?: string;
}

/** Ürün kategorisi — GET /v1/stock/categories. */
export interface ProductCategory {
  id: string;
  name: string;
  product_count: number;
}

/**
 * İçe aktarma tipleri — apps/api/src/modules/stock/{import,opening-stock.import}.service.ts
 * rapor yapılarıyla birebir (SPEC §23.1).
 */
export type StockImportRowStatus = 'valid' | 'invalid' | 'duplicate' | 'created' | 'failed';

export interface StockImportRowIssue {
  field: string;
  message: string;
}

export interface StockImportRowReport {
  line: number;
  name: string | null;
  status: StockImportRowStatus;
  issues: StockImportRowIssue[];
  /** Engellemeyen uyarılar (örn. otomatik oluşturulacak birim, mevcut bakiye). */
  warnings?: StockImportRowIssue[];
  duplicateOf?: string;
  id?: string;
  code?: string;
}

export interface StockImportLimitInfo {
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
}

export interface StockImportReport {
  headers: string[];
  suggestedMapping: Record<string, string | null>;
  mapping: Record<string, string | null>;
  summary: { total: number; valid: number; duplicates: number; invalid: number; toImport: number };
  limit: StockImportLimitInfo;
  rows: StockImportRowReport[];
}

export interface StockImportCommitResult {
  summary: { total: number; created: number; duplicates: number; failed: number };
  limit: StockImportLimitInfo;
  rows: StockImportRowReport[];
}

/** Ürün şablonu hedef alanları — docs/product/import-templates/products.md */
export const PRODUCT_IMPORT_TARGET_FIELDS: { value: string; label: string }[] = [
  { value: 'code', label: 'Ürün kodu' },
  { value: 'name', label: 'Ürün adı' },
  { value: 'unit', label: 'Birim (Adet, Kg…)' },
  { value: 'barcode', label: 'Barkod' },
  { value: 'sale_price', label: 'Satış fiyatı' },
  { value: 'cost_price', label: 'Maliyet fiyatı' },
  { value: 'initial_stock', label: 'Açılış stoğu' },
  { value: 'description', label: 'Açıklama' },
];

/** Açılış stoğu şablonu hedef alanları — docs/product/import-templates/opening-stock.md */
export const OPENING_STOCK_IMPORT_TARGET_FIELDS: { value: string; label: string }[] = [
  { value: 'sku', label: 'Ürün kodu / barkodu' },
  { value: 'warehouse', label: 'Depo' },
  { value: 'quantity', label: 'Miktar' },
  { value: 'unit_cost', label: 'Birim maliyet' },
  { value: 'date', label: 'Açılış tarihi (GG.AA.YYYY)' },
];

/** API hata gövdesi { error: { code, message } } (SPEC §22.1); eski düz `message` de okunur. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

export const useStockStore = defineStore('stock', () => {
  const stock = ref<StockItem[]>([]);
  const units = ref<Unit[]>([]);
  const categories = ref<ProductCategory[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref('');
  const pagination = ref({ page: 1, limit: 50, total: 0, pages: 0 });

  const filteredStock = computed(() => {
    if (!searchQuery.value) return stock.value;
    const q = searchQuery.value.toLowerCase();
    return stock.value.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.code?.toLowerCase().includes(q) ||
        (item.barcode ?? '').includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.brand ?? '').toLowerCase().includes(q) ||
        (item.supplier_code ?? '').toLowerCase().includes(q),
    );
  });

  /** Stok özeti — sayfa üstü KPI kartları için. */
  const summary = computed(() => {
    const items = stock.value;
    // Kritik: miktar sıfır/negatif ya da ürün kartındaki kritik stok seviyesinin altında.
    const lowStock = items.filter(
      (i) => i.track_inventory !== false && Number(i.quantity ?? 0) <= Number(i.min_stock ?? 0),
    ).length;
    return {
      total: pagination.value.total || items.length,
      lowStock,
      tracked: items.filter((i) => i.track_inventory !== false).length,
      stockValue: items.reduce((sum, i) => sum + Number(i.stock_value ?? 0), 0),
    };
  });

  /** Liste süzgeci: kategori kimliği veya 'none' (kategorisiz). Sayfalama sunucuda süzülür. */
  const categoryFilter = ref('');

  const fetchStock = async (params?: { page?: number; limit?: number }) => {
    loading.value = true;
    error.value = null;
    try {
      const qs = new URLSearchParams();
      if (params?.page) qs.append('page', String(params.page));
      qs.append('limit', String(params?.limit ?? pagination.value.limit));
      if (categoryFilter.value) qs.append('category_id', categoryFilter.value);
      const response = await api.get(`/v1/stock?${qs.toString()}`);
      stock.value = response.data.data ?? [];
      const p = response.data.pagination ?? {};
      pagination.value = {
        page: p.page ?? 1,
        limit: p.limit ?? pagination.value.limit,
        total: p.total ?? stock.value.length,
        pages: p.total
          ? Math.ceil(p.total / (p.limit ?? pagination.value.limit))
          : stock.value.length
            ? 1
            : 0,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Ürünler yüklenirken bir hata oluştu.');
    } finally {
      loading.value = false;
    }
  };

  const fetchUnits = async () => {
    try {
      const response = await api.get('/v1/stock/units');
      units.value = response.data.data ?? response.data ?? [];
    } catch {
      units.value = [];
    }
  };

  /**
   * Birim ekler (kod addan türetilir) ve listeye katar. Aynı ad varsa API CONFLICT verir;
   * hata mesajı çağıran ekranda gösterilsin diye `Error` olarak fırlatılır.
   */
  const createUnit = async (name: string, abbreviation?: string): Promise<Unit> => {
    try {
      const response = await api.post('/v1/stock/units', {
        name,
        abbreviation: abbreviation || undefined,
      });
      const unit = response.data as Unit;
      units.value = [...units.value, unit].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      return unit;
    } catch (err) {
      throw new Error(errorMessage(err, 'Birim eklenemedi.'), { cause: err });
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await api.get('/v1/stock/categories');
      categories.value = response.data.data ?? [];
    } catch {
      categories.value = [];
    }
  };

  /** Kategori ekler ve listeye katar; hata mesajı `Error` olarak fırlatılır. */
  const createCategory = async (name: string): Promise<ProductCategory> => {
    try {
      const response = await api.post('/v1/stock/categories', { name });
      await fetchCategories();
      return categories.value.find((c) => c.id === response.data.id) ?? response.data;
    } catch (err) {
      throw new Error(errorMessage(err, 'Kategori eklenemedi.'), { cause: err });
    }
  };

  /** Ürün satırlarındaki kategori adı sunucuda birleştirilir; ad değişince liste tazelenir. */
  const renameCategory = async (id: string, name: string): Promise<void> => {
    try {
      await api.patch(`/v1/stock/categories/${id}`, { name });
      await Promise.all([fetchCategories(), fetchStock()]);
    } catch (err) {
      throw new Error(errorMessage(err, 'Kategori yeniden adlandırılamadı.'), { cause: err });
    }
  };

  const deleteCategory = async (id: string): Promise<void> => {
    try {
      await api.delete(`/v1/stock/categories/${id}`);
      if (categoryFilter.value === id) categoryFilter.value = '';
      await Promise.all([fetchCategories(), fetchStock()]);
    } catch (err) {
      throw new Error(errorMessage(err, 'Kategori silinemedi.'), { cause: err });
    }
  };

  /** `sourceId` kategorisindeki ürünleri `targetId`'ye taşır; kaynak silinir. Taşınan ürün sayısını döner. */
  const mergeCategories = async (sourceId: string, targetId: string): Promise<number> => {
    try {
      const response = await api.post(`/v1/stock/categories/${sourceId}/merge`, {
        target_id: targetId,
      });
      if (categoryFilter.value === sourceId) categoryFilter.value = targetId;
      await Promise.all([fetchCategories(), fetchStock()]);
      return Number(response.data.moved ?? 0);
    } catch (err) {
      throw new Error(errorMessage(err, 'Kategoriler birleştirilemedi.'), { cause: err });
    }
  };

  /** Form uyumluluğu: `unit` metnini `unit_id`'ye çevirir (yoksa ilk birim). */
  const resolveUnitId = (unitName?: string): string | undefined => {
    if (!unitName) return units.value[0]?.id;
    const u = units.value.find(
      (x) =>
        x.name.toLowerCase() === unitName.toLowerCase() ||
        x.abbreviation?.toLowerCase() === unitName.toLowerCase() ||
        x.code.toLowerCase() === unitName.toLowerCase(),
    );
    return u?.id ?? units.value[0]?.id;
  };

  const createStockItem = async (data: Partial<StockItem>) => {
    loading.value = true;
    error.value = null;
    try {
      const payload = {
        code: data.code,
        name: data.name,
        unit_id: data.unit_id ?? resolveUnitId(data.unit),
        sale_price: Number(data.price ?? data.sale_price ?? 0),
        cost_price: Number(data.cost_price ?? 0),
        barcode: data.barcode || undefined,
        description: data.description || undefined,
        track_inventory: data.track_inventory,
        default_expense_category_id: data.default_expense_category_id || null,
        category_id: data.category_id || null,
        brand: data.brand || undefined,
        supplier_code: data.supplier_code || undefined,
        shelf_location: data.shelf_location || undefined,
        min_stock: Number(data.min_stock ?? 0),
        sale_tax_rate_id: data.sale_tax_rate_id || null,
        purchase_tax_rate_id: data.purchase_tax_rate_id || null,
      };
      const response = await api.post('/v1/stock', payload);
      stock.value.unshift(response.data);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Ürün eklenirken bir hata oluştu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateStockItem = async (id: string, data: Partial<StockItem>) => {
    loading.value = true;
    error.value = null;
    try {
      const payload: Record<string, unknown> = {};
      if (data.code !== undefined) payload.code = data.code;
      if (data.name !== undefined) payload.name = data.name;
      if (data.barcode !== undefined) payload.barcode = data.barcode || null;
      if (data.unit_id !== undefined || data.unit !== undefined) {
        payload.unit_id = data.unit_id ?? resolveUnitId(data.unit);
      }
      if (data.price !== undefined || data.sale_price !== undefined) {
        payload.sale_price = Number(data.price ?? data.sale_price ?? 0);
      }
      if (data.cost_price !== undefined) payload.cost_price = Number(data.cost_price);
      if (data.description !== undefined) payload.description = data.description || null;
      if (data.track_inventory !== undefined) payload.track_inventory = data.track_inventory;
      if (data.default_expense_category_id !== undefined) {
        payload.default_expense_category_id = data.default_expense_category_id || null;
      }
      // Boş metin / seçim "temizle" demektir: API'ye null gider (alan sıfırlanır).
      if (data.category_id !== undefined) payload.category_id = data.category_id || null;
      if (data.brand !== undefined) payload.brand = data.brand || null;
      if (data.supplier_code !== undefined) payload.supplier_code = data.supplier_code || null;
      if (data.shelf_location !== undefined) payload.shelf_location = data.shelf_location || null;
      if (data.min_stock !== undefined) payload.min_stock = Number(data.min_stock) || 0;
      if (data.sale_tax_rate_id !== undefined)
        payload.sale_tax_rate_id = data.sale_tax_rate_id || null;
      if (data.purchase_tax_rate_id !== undefined) {
        payload.purchase_tax_rate_id = data.purchase_tax_rate_id || null;
      }

      // API yalnızca PATCH /v1/stock/:id tanımlar (apps/api/src/modules/stock/routes.ts).
      const response = await api.patch(`/v1/stock/${id}`, payload);
      const index = stock.value.findIndex((s) => s.id === id);
      if (index !== -1) stock.value[index] = { ...stock.value[index], ...response.data };
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Ürün güncellenirken bir hata oluştu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteStockItem = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/stock/${id}`);
      stock.value = stock.value.filter((s) => s.id !== id);
      pagination.value.total = Math.max(0, pagination.value.total - 1);
    } catch (err) {
      error.value = errorMessage(err, 'Ürün silinirken bir hata oluştu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const setSearchQuery = (query: string) => {
    searchQuery.value = query;
  };

  /** API hata gövdesinden okunabilir mesaj — { error: { code, message } } (SPEC §22.1). */
  const importErrorMessage = (err: unknown, fallback: string): string => {
    const data = (
      err as { response?: { data?: { error?: { message?: string }; message?: string } } }
    ).response?.data;
    return data?.error?.message ?? data?.message ?? fallback;
  };

  /** CSV şablonunu indir (UTF-8 BOM) — SPEC §23.1 adım 1. */
  const downloadImportTemplate = async (path: string, filename: string): Promise<void> => {
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      throw new Error(importErrorMessage(err, 'Şablon indirilemedi.'), { cause: err });
    }
  };

  /** Ürün içe aktarma önizlemesi (dry-run) — POST /v1/stock/import. */
  const dryRunProductImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<StockImportReport> => {
    try {
      const response = await api.post('/v1/stock/import', { csv, mapping });
      return response.data as StockImportReport;
    } catch (err) {
      throw new Error(importErrorMessage(err, 'Önizleme hazırlanamadı.'), { cause: err });
    }
  };

  /** Ürün içe aktarmayı onayla — POST /v1/stock/import (commit: true). */
  const commitProductImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<StockImportCommitResult> => {
    try {
      const response = await api.post('/v1/stock/import', { csv, mapping, commit: true });
      return response.data as StockImportCommitResult;
    } catch (err) {
      throw new Error(importErrorMessage(err, 'Aktarım başarısız oldu.'), { cause: err });
    }
  };

  const downloadProductTemplate = async (): Promise<void> =>
    downloadImportTemplate('/v1/stock/import/template', 'urun-ice-aktarma-sablonu.csv');

  /** Açılış stoğu içe aktarma önizlemesi — POST /v1/stock/opening-stock/import. */
  const dryRunOpeningStockImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<StockImportReport> => {
    try {
      const response = await api.post('/v1/stock/opening-stock/import', { csv, mapping });
      return response.data as StockImportReport;
    } catch (err) {
      throw new Error(importErrorMessage(err, 'Önizleme hazırlanamadı.'), { cause: err });
    }
  };

  /** Açılış stoğu aktarımını onayla — POST /v1/stock/opening-stock/import (commit: true). */
  const commitOpeningStockImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<StockImportCommitResult> => {
    try {
      const response = await api.post('/v1/stock/opening-stock/import', {
        csv,
        mapping,
        commit: true,
      });
      return response.data as StockImportCommitResult;
    } catch (err) {
      throw new Error(importErrorMessage(err, 'Aktarım başarısız oldu.'), { cause: err });
    }
  };

  const downloadOpeningStockTemplate = async (): Promise<void> =>
    downloadImportTemplate('/v1/stock/opening-stock/import/template', 'acilis-stogu-sablonu.csv');

  return {
    stock,
    units,
    categories,
    categoryFilter,
    filteredStock,
    summary,
    loading,
    error,
    searchQuery,
    pagination,
    fetchStock,
    fetchUnits,
    createUnit,
    fetchCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    mergeCategories,
    resolveUnitId,
    createStockItem,
    updateStockItem,
    deleteStockItem,
    setSearchQuery,
    dryRunProductImport,
    commitProductImport,
    downloadProductTemplate,
    dryRunOpeningStockImport,
    commitOpeningStockImport,
    downloadOpeningStockTemplate,
  };
});
