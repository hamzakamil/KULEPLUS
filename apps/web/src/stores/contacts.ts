import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

/** Cari kart — contacts tablosu (listeleme/detay yanıtı). Alt tablolar yalnızca detayda dolu gelir. */
export interface Contact {
  id: string;
  code: string;
  name: string;
  trade_name: string | null;
  type: 'customer' | 'supplier';
  tax_number: string | null;
  tax_office: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  addresses?: ContactAddress[];
  phones?: ContactPhone[];
  emails?: ContactEmail[];
  relations?: ContactRelation[];
}

/** Yeni cari kartı oluşturma girişi — API createContactSchema zorunlu alanları. */
export interface ContactCreateInput {
  code: string;
  name: string;
  type: 'customer' | 'supplier';
  trade_name?: string | null;
  tax_number?: string | null;
  tax_office?: string | null;
  is_active?: boolean;
  settings?: Record<string, unknown>;
  addresses?: Array<{
    is_primary?: boolean;
    type: string;
    province?: string;
    district?: string;
    neighborhood?: string;
    street?: string;
    building?: string;
    apartment?: string;
    zip_code?: string;
  }>;
  phones?: Array<{ is_primary?: boolean; type: string; number: string }>;
  emails?: Array<{ is_primary?: boolean; type: string; email: string }>;
}

export interface ContactAddress {
  id: string;
  is_primary: boolean;
  type: string;
  province: string | null;
  district: string | null;
  neighborhood: string | null;
  street: string | null;
  building: string | null;
  apartment: string | null;
  zip_code: string | null;
}

export interface ContactPhone {
  id: string;
  is_primary: boolean;
  type: string;
  number: string;
  formatted: string | null;
}

export interface ContactEmail {
  id: string;
  is_primary: boolean;
  type: string;
  email: string;
}

export interface ContactRelation {
  id: string;
  related_contact_id: string;
  relation_type: string;
  notes: string | null;
}

/** Cari hareket (ekstre) satırı — party_ledger_entries. `amount` numeric(20,8) → pg string döner. */
export interface ContactLedgerEntry {
  id: string;
  contact_id: string;
  type: 'receivable' | 'payable';
  document_type: string | null;
  document_number: string | null;
  posted_at: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  description: string | null;
  created_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/** Bakiye dahil cari listesi satırı — `GET /contacts/with-balances`. */
export interface ContactWithBalance extends Contact {
  debit: number;
  credit: number;
  balance: number;
}

/** Cari listesi özet sayaçları — üst KPI şeridi. */
export interface ContactStats {
  total: number;
  customers: number;
  suppliers: number;
  active: number;
  inactive: number;
  missingTaxNumber: number;
  totalReceivable: number;
  totalPayable: number;
  overdueAmount: number;
  netBalance: number;
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

/** Açık belge satırı (cari detayında). */
export interface ContactDocument {
  id: string;
  number: string;
  type: 'sales' | 'purchase' | 'proforma' | 'credit_note' | 'debit_note';
  status: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  days_overdue: number;
}

/** Cari detay paketi — `GET /contacts/:id/summary`. */
export interface ContactSummary {
  balance: { debit: number; credit: number; balance: number; entryCount: number };
  risk: {
    openDocuments: number;
    overdueDocuments: number;
    overdueAmount: number;
    totalReceivable: number;
    totalPayable: number;
    aging: AgingBuckets;
    agingPayable: AgingBuckets;
    invoiceNet: number;
  };
  documents: ContactDocument[];
  documentStats: {
    sales_invoices: string;
    purchase_invoices: string;
    quotes: string;
    orders: string;
    purchase_orders: string;
    deliveries: string;
  };
  recentMovements: {
    id: string;
    type: 'receivable' | 'payable';
    document_type: string | null;
    document_number: string | null;
    posted_at: string;
    amount: number;
    currency: string;
    description: string | null;
  }[];
}

export interface ContactLedgerResult {
  data: ContactLedgerEntry[];
  summary?: {
    debit: number;
    credit: number;
    balance: number;
    openingBalance: number;
    entryCount: number;
  };
  pagination: Pagination;
}

/** İçe aktarma satır durumu — import.service.ts ImportRowReport ile birebir. */
export type ImportRowStatus = 'valid' | 'invalid' | 'duplicate' | 'created' | 'failed';

export interface ImportRowIssue {
  field: string;
  message: string;
}

export interface ImportRowReport {
  line: number;
  name: string | null;
  status: ImportRowStatus;
  issues: ImportRowIssue[];
  duplicateOf?: string;
  id?: string;
  code?: string;
}

export interface ImportLimitInfo {
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
}

export interface ImportReport {
  headers: string[];
  suggestedMapping: Record<string, string | null>;
  mapping: Record<string, string | null>;
  summary: { total: number; valid: number; duplicates: number; invalid: number; toImport: number };
  limit: ImportLimitInfo;
  rows: ImportRowReport[];
}

export interface ImportCommitResult {
  summary: { total: number; created: number; duplicates: number; failed: number };
  limit: ImportLimitInfo;
  rows: ImportRowReport[];
}

/** Şablon hedef alanları — docs/product/import-templates/contacts.md */
export const IMPORT_TARGET_FIELDS: { value: string; label: string }[] = [
  { value: 'contact_type', label: 'Cari tipi (person/company)' },
  { value: 'company_name', label: 'Şirket ünvanı' },
  { value: 'first_name', label: 'Ad' },
  { value: 'last_name', label: 'Soyad' },
  { value: 'tax_number', label: 'VKN' },
  { value: 'identity_number', label: 'TCKN' },
  { value: 'phone', label: 'Telefon' },
  { value: 'email', label: 'E-posta' },
  { value: 'address_line1', label: 'Adres' },
  { value: 'city', label: 'İl' },
  { value: 'district', label: 'İlçe' },
  { value: 'code', label: 'Cari kodu' },
  { value: 'tax_office', label: 'Vergi dairesi' },
  { value: 'type', label: 'Kategori (customer/supplier)' },
];

/** API hata gövdesinden okunabilir mesaj çıkar (SPEC §22.1: { error: { code, message } }). */
function apiMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })
    .response?.data;
  return data?.error?.message ?? data?.message ?? fallback;
}

export const useContactStore = defineStore('contacts', () => {
  const contacts = ref<Contact[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pagination = ref<Pagination | null>(null);

  /**
   * Cari listesi (sunucu tarafı arama/filtre/sayfalama — ADR-0014, SPEC §9).
   * `q` ada/koda göre ILIKE, `type` müşteri/tedarikçi filtresi (routes.ts).
   */
  const fetchContacts = async (params?: {
    q?: string;
    type?: 'customer' | 'supplier';
    page?: number;
    limit?: number;
  }) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/contacts', { params });
      // API sayfalı döner ({ data, pagination }) — diziyi güvenli çöz.
      const payload = response.data as { data?: Contact[]; pagination?: Pagination } | null;
      contacts.value = payload?.data ?? [];
      pagination.value = payload?.pagination ?? null;
    } catch (err) {
      error.value = 'Müşteriler yüklenirken bir hata oluştu.';
      console.error(err);
    } finally {
      loading.value = false;
    }
  };

  const createContact = async (data: ContactCreateInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/contacts', data);
      contacts.value.push(response.data);
      return response.data;
    } catch (err) {
      error.value = 'Müşteri oluşturulurken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateContact = async (id: string, data: Partial<Contact>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put(`/v1/contacts/${id}`, data);
      const index = contacts.value.findIndex((c) => c.id === id);
      if (index !== -1) {
        contacts.value[index] = { ...contacts.value[index], ...response.data };
      }
      return response.data;
    } catch (err) {
      error.value = 'Müşteri güncellenirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteContact = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/contacts/${id}`);
      contacts.value = contacts.value.filter((c) => c.id !== id);
    } catch (err) {
      error.value = 'Müşteri silinirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /** Dry-run: yazmadan doğrulama raporu (SPEC §23.1). Hata fırlatır, store.error'a dokunmaz. */
  const dryRunImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<ImportReport> => {
    try {
      const response = await api.post('/v1/contacts/import', { csv, mapping });
      return response.data as ImportReport;
    } catch (err) {
      throw new Error(apiMessage(err, 'Önizleme alınırken bir hata oluştu.'), { cause: err });
    }
  };

  /** Commit: geçerli satırları aktarır. Hata fırlatır, store.error'a dokunmaz. */
  const commitImport = async (
    csv: string,
    mapping?: Record<string, string | null>,
  ): Promise<ImportCommitResult> => {
    try {
      const response = await api.post('/v1/contacts/import', { csv, mapping, commit: true });
      return response.data as ImportCommitResult;
    } catch (err) {
      throw new Error(apiMessage(err, 'Aktarım sırasında bir hata oluştu.'), { cause: err });
    }
  };

  /** Dışa aktarma: CSV indirir (UTF-8 BOM'lu). Dosya adını döndürür. */
  const exportContacts = async (): Promise<string> => {
    try {
      const response = await api.get('/v1/contacts/export', { responseType: 'blob' });
      const disposition = (response.headers?.['content-disposition'] as string | undefined) ?? '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `cari-listesi-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = window.URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      return filename;
    } catch (err) {
      throw new Error(apiMessage(err, 'Dışa aktarma sırasında bir hata oluştu.'), { cause: err });
    }
  };

  /** Cari kartı detaylı getir (adres, telefon, e-posta, ilişki dahil). */
  const fetchContact = async (id: string): Promise<Contact> => {
    try {
      const response = await api.get(`/v1/contacts/${id}`);
      return response.data as Contact;
    } catch (err) {
      throw new Error(apiMessage(err, 'Cari kartı yüklenirken bir hata oluştu.'), { cause: err });
    }
  };

  /** Cari hareketleri (ekstre) getir. */
  const fetchContactLedger = async (
    id: string,
    params?: {
      page?: number;
      limit?: number;
      type?: 'receivable' | 'payable';
      date_from?: string;
      date_to?: string;
    },
  ): Promise<ContactLedgerResult> => {
    try {
      const response = await api.get(`/v1/contacts/${id}/ledger`, { params });
      return response.data as ContactLedgerResult;
    } catch (err) {
      throw new Error(apiMessage(err, 'Cari hareketler yüklenirken bir hata oluştu.'), {
        cause: err,
      });
    }
  };

  /** Bakiye dahil cari listesi — listede anlık bakiye için (ön muhasebe standardı). */
  const fetchContactsWithBalances = async (
    params?: {
      q?: string;
      type?: 'customer' | 'supplier';
      is_active?: boolean;
      page?: number;
      limit?: number;
      sort?: string;
      order?: 'asc' | 'desc';
      only_with_balance?: boolean;
    },
  ): Promise<{ data: ContactWithBalance[]; pagination: Pagination }> => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/contacts/with-balances', { params });
      const payload = response.data as { data: ContactWithBalance[]; pagination: Pagination };
      contacts.value = payload.data;
      pagination.value = payload.pagination;
      return payload;
    } catch (err) {
      error.value = apiMessage(err, 'Cari listesi yüklenemedi.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /** Cari listesi özet sayaçları — KPI şeridi için. */
  const fetchStats = async (): Promise<ContactStats | null> => {
    try {
      const response = await api.get('/v1/contacts/stats');
      return response.data as ContactStats;
    } catch (err) {
      console.error('Cari istatistikleri alınamadı', err);
      return null;
    }
  };

  /** Cari detay paketi — bakiye, risk, açık belgeler, yaşlandırma. */
  const fetchContactSummary = async (id: string): Promise<ContactSummary> => {
    try {
      const response = await api.get(`/v1/contacts/${id}/summary`);
      return response.data as ContactSummary;
    } catch (err) {
      throw new Error(apiMessage(err, 'Cari özeti yüklenemedi.'), { cause: err });
    }
  };

  return {
    contacts,
    pagination,
    loading,
    error,
    fetchContacts,
    createContact,
    updateContact,
    deleteContact,
    dryRunImport,
    commitImport,
    exportContacts,
    fetchContact,
    fetchContactLedger,
    fetchContactsWithBalances,
    fetchStats,
    fetchContactSummary,
  };
});
