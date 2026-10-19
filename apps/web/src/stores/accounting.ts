import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hata sözleşmesi: `{ error: { code, message } }` (SPEC §22.1). */
export function errorMessage(err: unknown, fallback: string): string {
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
  /** Mali yıl; madde numarası her yıl 1'den başlar. */
  fiscal_year?: number;
}

export interface CreateEntryInput {
  entry_date: string;
  entry_type: string;
  description: string;
  status: 'draft' | 'posted';
  lines: JournalLine[];
}

/** Muavin (hesap defteri) hareket satırı. `balance`: yürüyen bakiye, borç − alacak. */
export interface LedgerRow {
  line_id: string;
  entry_id: string;
  entry_no: number | null;
  fiscal_year: number | null;
  entry_date: string;
  entry_type: string;
  description: string | null;
  entry_description: string | null;
  account_code: string;
  account_name: string;
  counter_accounts: string | null;
  debit: number;
  credit: number;
  balance: number;
  source_type: string | null;
  source_id: string | null;
}

export interface AccountLedger {
  account: { code: string; name: string; mode: 'account' | 'prefix' };
  from: string;
  to: string;
  opening: { debit: number; credit: number; balance: number };
  period: { debit: number; credit: number };
  closing: { balance: number; side: 'B' | 'A' | '' };
  rows: LedgerRow[];
  total_rows: number;
  truncated: boolean;
}

export interface AccountLedgerParams {
  code?: string;
  prefix?: string;
  from?: string;
  to?: string;
  include_closing?: boolean;
  exclude_sources?: string[];
}

/** Fişin kaynak belge özeti (fatura, gider, çek …). */
export interface EntrySource {
  type: string;
  label: string;
  number?: string | null;
  date?: string | null;
  contact_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  link?: string | null;
}

export interface EntryDetailLine {
  id?: string;
  account_id?: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface EntryDetail {
  id: string;
  entry_no: number | string | null;
  fiscal_year?: number | null;
  entry_date: string;
  entry_type: string;
  status: 'draft' | 'posted' | 'cancelled';
  description: string;
  source_type?: string | null;
  totalDebit?: number;
  totalCredit?: number;
  lines: EntryDetailLine[];
  source: EntrySource | null;
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

export interface VatOffsetLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface VatOffsetPreview {
  year: number;
  month: number;
  entry_date: string;
  hesaplanan_kdv: number;
  indirilecek_kdv: number;
  devreden_onceki: number;
  odenecek_kdv: number;
  devreden_sonraki: number;
  sorumlu_kdv: number;
  lines: VatOffsetLine[];
  warnings: string[];
  existing_entry: { id: string; entry_no: number | null } | null;
}

export interface VatOffsetResult extends VatOffsetPreview {
  entry_id: string;
  entry_no: number | null;
}

export interface TaxSettings {
  taxpayer_type: 'kurumlar' | 'gelir';
  corporate_tax_rate: number;
}

export interface YearEndReflectionInput {
  source_code: string;
  target_code: string;
}

export interface YearEndInput {
  fiscal_year: number;
  reflections?: YearEndReflectionInput[];
  tax?: { kkeg?: number; deductions?: number; rate?: number; amount?: number };
  transfer_result?: boolean;
}

export interface YearEndReflection {
  source_code: string;
  reflect_code: string;
  target_code: string;
  amount: number;
}

export interface YearEndTax {
  ticari_kar: number;
  kkeg: number;
  deductions: number;
  matrah: number;
  rate: number;
  computed: number;
  amount: number;
  prepaid_offset: number;
  payable: number;
}

export interface YearEndEntryLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface YearEndEntry {
  entry_type: string;
  source_type: string;
  entry_date: string;
  description: string;
  entry_id?: string;
  entry_no?: number | null;
  lines: YearEndEntryLine[];
}

export interface YearEndResult {
  fiscal_year: number;
  year_end: string;
  opening_date: string;
  errors: string[];
  warnings: string[];
  tax_settings: TaxSettings;
  reflections: YearEndReflection[];
  tax: YearEndTax | null;
  net_result: number;
  entries: YearEndEntry[];
  closed: boolean;
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
      accounts.value = response.data.items ?? response.data.data ?? [];
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
    return response.data as {
      id: string;
      entryNo: number | null;
      status?: 'draft' | 'posted' | 'cancelled';
    };
  };

  /**
   * Hesap araması (store durumunu değiştirmez): fiş formundaki hesap seçicisi kullanır.
   * Yalnızca detay (fiş kesilebilir) ve aktif hesaplar; sayfa başına en çok 100.
   */
  const searchAccounts = async (q = '', page = 1) => {
    const response = await api.get('/v1/accounting', {
      params: { limit: 100, page, q: q || undefined, type: 'detail', is_active: true },
    });
    const list = (response.data.items ?? response.data.data ?? []) as AccountingAccount[];
    return { items: list, totalPages: Number(response.data.totalPages ?? 1) };
  };

  /** Hesap muavini: `code` (alt hesaplarıyla) ya da `prefix` ile, devir + hareketler + bakiye. */
  const accountLedger = async (params: AccountLedgerParams): Promise<AccountLedger> => {
    const { exclude_sources, include_closing, ...rest } = params;
    const response = await api.get('/v1/accounting/reports/account-ledger', {
      params: {
        ...rest,
        include_closing: include_closing ? 'true' : undefined,
        exclude_sources: exclude_sources?.length ? exclude_sources.join(',') : undefined,
      },
    });
    return response.data;
  };

  /** Fiş detayı: satırlar + kaynak belge özeti. */
  const fetchEntryDetail = async (id: string): Promise<EntryDetail> => {
    const response = await api.get(`/v1/accounting/entries/${id}`);
    return response.data;
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

  const vatOffsetPreview = async (year: number, month: number): Promise<VatOffsetPreview> => {
    const response = await api.get('/v1/accounting/vat-offset/preview', {
      params: { year, month },
    });
    return response.data;
  };

  const createVatOffset = async (year: number, month: number): Promise<VatOffsetResult> => {
    const response = await api.post('/v1/accounting/vat-offset', { year, month });
    return response.data;
  };

  const getTaxSettings = async (): Promise<TaxSettings> => {
    const response = await api.get('/v1/accounting/year-end/tax-settings');
    return response.data;
  };

  const saveTaxSettings = async (input: TaxSettings): Promise<TaxSettings> => {
    const response = await api.put('/v1/accounting/year-end/tax-settings', input);
    return response.data;
  };

  const yearEndPreview = async (input: YearEndInput): Promise<YearEndResult> => {
    const response = await api.post('/v1/accounting/year-end/preview', input);
    return response.data;
  };

  const yearEndClose = async (input: YearEndInput): Promise<YearEndResult> => {
    const response = await api.post('/v1/accounting/year-end/close', input);
    return response.data;
  };

  const yearEndUndo = async (fiscalYear: number) => {
    const response = await api.post('/v1/accounting/year-end/undo', {
      fiscal_year: fiscalYear,
    });
    return response.data as { fiscal_year: number; removed_entries: number; reopened: boolean };
  };

  const resequenceEntries = async (fiscalYear: number) => {
    const response = await api.post('/v1/accounting/entries/resequence', {
      fiscal_year: fiscalYear,
    });
    return response.data as { fiscal_year: number; changed: number };
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
    searchAccounts,
    accountLedger,
    fetchEntryDetail,
    reverseEntry,
    postEntry,
    trialBalance,
    balanceSheet,
    incomeStatement,
    withholdingReport,
    vatOffsetPreview,
    createVatOffset,
    getTaxSettings,
    saveTaxSettings,
    yearEndPreview,
    yearEndClose,
    yearEndUndo,
    resequenceEntries,
  };
});
