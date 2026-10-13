import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hatasından kullanıcı mesajı çıkarır. */
function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
}

export type ReportType =
  | 'profit_loss'
  | 'balance_sheet'
  | 'tax_summary'
  | 'cash_flow'
  | 'aged_payable'
  | 'aged_receivable';

export type ReportFormat = 'pdf' | 'excel' | 'csv';
export type ReportStatus = 'generating' | 'completed' | 'failed';

/** Canlı rapor sekmesi anahtarları — `ReportView` sekmeleriyle eşleşir. */
export type LiveReportKey =
  | 'overview'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'stock'
  | 'cash-bank'
  | 'profit-loss'
  | 'tax-summary'
  | 'aged-receivable'
  | 'aged-payable';

export interface ReportRange {
  from: string;
  to: string;
}

/** Modül özeti — oransal alanlar sayıya çevrilir (numeric → string gelir). */
export interface OverviewReport {
  range: ReportRange;
  sales: {
    total: number;
    net: number;
    tax: number;
    paid: number;
    balance: number;
    document_count: number;
  };
  purchases: {
    total: number;
    net: number;
    tax: number;
    paid: number;
    balance: number;
    document_count: number;
  };
  expenses: {
    total: number;
    base_total: number;
    document_count: number;
    unpaid_count: number;
  };
  stock: {
    product_count: number;
    total_quantity: number;
    total_value: number;
    out_of_stock: number;
  };
  cashBank: {
    cash: { accounts: number; balance: number };
    bank: { accounts: number; balance: number };
  };
  counts: {
    quotes: number;
    orders: number;
    purchase_orders: number;
    deliveries: number;
    contacts: number;
  };
  profit: {
    revenue: number;
    cost: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
  };
  /** Modül → son değişiklik ISO zamanı (otomatik yenileme tetikleyicisi). */
  freshness: Record<string, string>;
}

export interface Report {
  id: string;
  report_type: ReportType;
  date_from: string;
  date_to: string;
  format?: ReportFormat;
  status: ReportStatus;
  file_url?: string;
  generated_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GenerateReportInput {
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  format?: ReportFormat;
}

/** Canlı rapor sekmesi tanımı — başlık, ikon ve gereken entitlement. */
export const LIVE_REPORTS: { key: LiveReportKey; label: string; hint: string }[] = [
  { key: 'overview', label: 'Genel Özet', hint: 'Tüm modüllerin toplu görünümü' },
  { key: 'sales', label: 'Satış', hint: 'Satış faturaları ve cari dağılımı' },
  { key: 'purchases', label: 'Satın Alma', hint: 'Alış faturaları ve tedarikçiler' },
  { key: 'expenses', label: 'Giderler', hint: 'Kategori ve grup bazlı giderler' },
  { key: 'profit-loss', label: 'Kâr / Zarar', hint: 'Gelir, maliyet ve net sonuç' },
  { key: 'tax-summary', label: 'Vergi Özeti', hint: 'Hesaplanan ve indirilecek KDV' },
  { key: 'stock', label: 'Stok', hint: 'Ürün, depo ve kritik seviyeler' },
  { key: 'cash-bank', label: 'Kasa & Banka', hint: 'Bakiyeler, krediler, kartlar, POS' },
  { key: 'aged-receivable', label: 'Alacak Yaşlandırma', hint: 'Vadesi geçen alacaklar' },
  { key: 'aged-payable', label: 'Borç Yaşlandırma', hint: 'Vadesi geçen borçlar' },
];

export const useReportStore = defineStore('report', () => {
  const reports = ref<Report[]>([]);
  const currentReport = ref<Report | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Canlı rapor yanıtları — sekme anahtarına göre saklanır. */
  const liveData = ref<Partial<Record<LiveReportKey, unknown>>>({});
  const liveLoading = ref(false);
  const liveError = ref<string | null>(null);
  /** Modül → son değişiklik zamanı; değişince canlı veriler tazelenir. */
  const freshness = ref<Record<string, string>>({});
  const range = ref<{ dateFrom: string; dateTo: string }>(defaultRange());

  function defaultRange() {
    const today = new Date().toISOString().slice(0, 10);
    const firstOfYear = `${today.slice(0, 4)}-01-01`;
    return { dateFrom: firstOfYear, dateTo: today };
  }

  const overview = computed(() => liveData.value.overview as OverviewReport | undefined);

  /** Tarih aralığını değiştir (canlı veriler sonraki yüklemede tazelenir). */
  const setRange = (dateFrom: string, dateTo: string) => {
    range.value = { dateFrom, dateTo };
  };

  /** Arşiv kayıtları (report_generations). */
  const fetchReports = async () => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/reports');
      reports.value = response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Raporlar yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const getReportById = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/reports/${id}`);
      currentReport.value = response.data;
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Rapor bulunamadı');
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Tek bir canlı raporu hesapla ve sakla. */
  const fetchLive = async <K extends LiveReportKey>(key: K): Promise<void> => {
    liveLoading.value = true;
    liveError.value = null;
    try {
      const params = new URLSearchParams({
        dateFrom: range.value.dateFrom,
        dateTo: range.value.dateTo,
      });
      const response = await api.get(`/v1/reports/${key}?${params.toString()}`);
      liveData.value[key] = response.data;
      if (key === 'overview') {
        const data = response.data as OverviewReport;
        if (data.freshness) freshness.value = data.freshness;
      }
    } catch (err) {
      liveError.value = errorMessage(err, 'Rapor hesaplanamadı');
    } finally {
      liveLoading.value = false;
    }
  };

  /** Aynı anda birden çok canlı raporu hesapla. */
  const fetchLiveMany = async (keys: LiveReportKey[]) => {
    await Promise.all(keys.map((k) => fetchLive(k)));
  };

  /**
   * Modüllerde değişiklik var mı? — son bilinen zaman damgalarını tazeler ve
   * fark varsa `true` döner. Rapor ekranı bu sinyalle otomatik yenilenir.
   */
  const refreshIfStale = async (): Promise<boolean> => {
    try {
      const response = await api.get('/v1/reports/freshness');
      const next = response.data as Record<string, string>;
      const changed =
        Object.keys(next).some((m) => !freshness.value[m] || freshness.value[m] !== next[m]) ||
        Object.keys(freshness.value).length !== Object.keys(next).length;
      freshness.value = next;
      return changed;
    } catch {
      return false;
    }
  };

  const generateReport = async (input: GenerateReportInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/reports/generate', input);
      reports.value.unshift(response.data);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Rapor oluşturulamadı');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  return {
    reports,
    currentReport,
    loading,
    error,
    liveData,
    liveLoading,
    liveError,
    freshness,
    range,
    overview,
    setRange,
    fetchReports,
    getReportById,
    fetchLive,
    fetchLiveMany,
    refreshIfStale,
    generateReport,
  };
});
