import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hata sözleşmesi: `{ error: { code, message } }` (SPEC §22.1). */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

export interface AccountingAccount {
  id: string;
  code: string;
  name: string;
  type: 'group' | 'detail';
  is_tdphp: boolean;
  is_active: boolean;
  openingBalance: number;
}

export interface JournalLine {
  account_id: string;
  account_code?: string;
  account_name?: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  entry_no: number | null;
  entry_date: string;
  entry_type: string;
  status: 'draft' | 'posted' | 'cancelled';
  description: string;
  totalDebit: number;
  totalCredit: number;
  source_type?: string | null;
}

export interface CreateEntryInput {
  entry_date: string;
  entry_type: string;
  description: string;
  status: 'draft' | 'posted';
  lines: JournalLine[];
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  /** Kümülatif (devir + dönem) borç. */
  debit: number;
  /** Kümülatif (devir + dönem) alacak. */
  credit: number;
  balance: number;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
}

export interface TrialBalance {
  from: string;
  to: string;
  accounts: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
}

export interface BalanceSheet {
  as_of: string;
  year_start: string;
  aktif: { donenVarliklar: number; duranVarliklar: number; toplam: number };
  pasif: {
    kisaVadeliYabanciKaynaklar: number;
    uzunVadeliYabanciKaynaklar: number;
    ozKaynaklar: number;
    gecmisYillarKarZarari: number;
    donemNetKar: number;
    toplam: number;
  };
  balanced: boolean;
}

export interface IncomeStatement {
  from: string;
  to: string;
  brutSatislar: number;
  satisIndirimleri: number;
  netSatislar: number;
  satislarinMaliyeti: number;
  brutKar: number;
  faaliyetGiderleri: number;
  digerFaaliyetGelirleri: number;
  digerFaaliyetGiderleri: number;
  faaliyetKari: number;
  finansmanGiderleri: number;
  olaganDisiGelirler: number;
  olaganDisiGiderler: number;
  vergiKarsiligi: number;
  maliyetHesaplari7xx: number;
  donemNetKari: number;
}

/** KDV-2 (alış, sorumlu sıfatıyla) tevkifat satırı; `ledger` 360.01 defter bakiyesi. */
export interface WithholdingKdv2Row {
  kdv2Code: string;
  einvoiceCode: string;
  name: string | null;
  /** "4/10" biçiminde oran. */
  rate: string;
  documentCount: number;
  base: number;
  vat: number;
  withheld: number;
  ledger: number;
  difference: number;
}

/** KDV-1 kısmi tevkifat satırı (satış). */
export interface WithholdingKdv1Row {
  einvoiceCode: string;
  name: string | null;
  rate: string;
  documentCount: number;
  base: number;
  vat: number;
  withheld: number;
}

export interface WithholdingReport {
  from: string;
  to: string;
  kdv2: WithholdingKdv2Row[];
  /** Tüm KDV-2 satırlarının tevkif edilen toplamı (sunucu hesabı). */
  kdv2Total: number;
  kdv1: WithholdingKdv1Row[];
  /** Tüm KDV-1 satırlarının tevkif edilen toplamı (sunucu hesabı). */
  kdv1Total: number;
}

export const useAccountingStore = defineStore('accounting', () => {
  const accounts = ref<AccountingAccount[]>([]);
  const entries = ref<JournalEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const fetchAccounts = async (q?: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/accounting', { params: { limit: 100, q } });
      accounts.value = response.data.data ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Hesap planı yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const bootstrapChart = async () => {
    const response = await api.post('/v1/accounting/bootstrap');
    return response.data.inserted as number;
  };

  const fetchEntries = async (params: Record<string, unknown> = {}) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/accounting/entries', { params });
      entries.value = response.data.items ?? response.data.data ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Yevmiye fişleri yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const createEntry = async (input: CreateEntryInput) => {
    const response = await api.post('/v1/accounting/entries', input);
    return response.data as { id: string; entryNo: number | null };
  };

  const reverseEntry = async (id: string, entryDate?: string) => {
    await api.post(
      `/v1/accounting/entries/${id}/reverse`,
      entryDate ? { entry_date: entryDate } : {},
    );
  };

  /** Taslak fişi onaylar (gap-free numara + denge + dönem kontrolü sunucuda). */
  const postEntry = async (id: string) => {
    await api.post(`/v1/accounting/entries/${id}/post`);
  };

  const trialBalance = async (from?: string, to?: string): Promise<TrialBalance> => {
    const response = await api.get('/v1/accounting/reports/trial-balance', {
      params: { from, to },
    });
    return response.data;
  };

  const balanceSheet = async (asOf?: string): Promise<BalanceSheet> => {
    const response = await api.get('/v1/accounting/reports/balance-sheet', {
      params: { as_of: asOf },
    });
    return response.data;
  };

  const incomeStatement = async (from?: string, to?: string): Promise<IncomeStatement> => {
    const response = await api.get('/v1/accounting/reports/income-statement', {
      params: { from, to },
    });
    return response.data;
  };

  const withholdingReport = async (from?: string, to?: string): Promise<WithholdingReport> => {
    const response = await api.get('/v1/accounting/reports/withholding', {
      params: { from, to },
    });
    return response.data;
  };

  return {
    accounts,
    entries,
    loading,
    error,
    fetchAccounts,
    bootstrapChart,
    fetchEntries,
    createEntry,
    reverseEntry,
    postEntry,
    trialBalance,
    balanceSheet,
    incomeStatement,
    withholdingReport,
  };
});
