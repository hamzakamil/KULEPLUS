import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface InvoiceLine {
  id?: string;
  /** Stok ürünü satırı (alış/satış). Gider kategorisiyle birlikte gönderilemez. */
  product_id?: string;
  /** Gider kategorisi satırı (alış). Ürünle birlikte gönderilemez. */
  expense_category_id?: string;
  description: string;
  quantity: number;
  unit_id?: string;
  unit_price: number;
  discount_percent: number;
  tax_rate_id?: string;
  sort_order: number;
  /** API'den gelen hesaplanmış alanlar (detay dönüşünde dolu). */
  tax_amount?: number;
  line_total?: number;
  /** KDV tevkifatı türü (yalnızca satış/alış faturasında ve KDV'li satırda). */
  withholding_type_id?: string | null;
  /** Tevkifat alanları (detay dönüşünde dolu; oran yüzde, ör. 40). */
  withholding_rate?: number;
  withholding_amount?: number;
  withholding_einvoice_code?: string | null;
  withholding_kdv2_code?: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  type: 'sales' | 'purchase' | 'proforma' | 'credit_note' | 'debit_note';
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'cancelled' | 'overdue';
  contact_id?: string;
  warehouse_id?: string;
  issue_date: string;
  due_date?: string;
  currency: string;
  exchange_rate: number;
  /** Kurun referans alındığı tarih (dövizli belgeler; TRY'de null). */
  rate_date?: string | null;
  /** TRY karşılık: total * exchange_rate (DB generated). */
  base_total?: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  paid_amount: number;
  balance: number;
  notes?: string;
  lines: InvoiceLine[];
  payments: Payment[];
  contact_name?: string;
  /** Tevkif edilen KDV toplamı (satır tevkifatlarının toplamı). */
  withholding_total?: number;
  /** Bağlı iadelerle düşülen tutar. */
  returned_amount?: number;
  /** Orijinal fatura bağı (iade faturaları için 'invoice'). */
  reference_type?: string | null;
  reference_id?: string | null;
  /** Kesinleşme durumu; iade faturasının orijinali 'posted' olmalıdır. */
  posting_status?: string;
  /** Alış faturası: tedarikçinin belge numarası (mükerrer kontrolü; muhasebe aktifken zorunlu). */
  supplier_document_no?: string | null;
}

export interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
}

export interface TaxRate {
  id: string;
  code: string;
  name: string;
  rate: number;
}

/** KDV tevkifatı türü. Oran = rate_numerator / rate_denominator (genelde /10). */
export interface WithholdingType {
  id: string;
  name: string;
  einvoice_code: string;
  kdv2_code: string;
  rate_numerator: number;
  rate_denominator: number;
  is_active: boolean;
  valid_from: string;
  valid_to: string | null;
}

/** Kesinleştirme (muhasebeleştirme) sonucu: POST /v1/invoices/:id/post. */
export interface PostInvoiceResult {
  invoiceId: string;
  entryId: string | null;
  entryNo: string | null;
  alreadyPosted: boolean;
  /** Muhasebe modülü kapalıysa false (yevmiye fişi üretilmez). */
  journal?: boolean;
}

/** Yeni fatura gövdesi (POST /v1/invoices ve POST /v1/invoices/quick ortak). */
export interface CreateInvoiceInput {
  type: string;
  contact_id?: string;
  warehouse_id?: string;
  issue_date?: string;
  due_date?: string;
  currency: string;
  exchange_rate?: number;
  rate_date?: string;
  notes?: string;
  reference_type?: string;
  reference_id?: string;
  supplier_document_no?: string;
  lines: InvoiceLine[];
}

/** Tek ekran akışında peşin ödeme/tahsilat (POST /v1/invoices/quick gövdesi). */
export interface QuickPaymentInput {
  /** Boşsa faturanın ödenecek tutarı kullanılır. */
  amount?: number;
  payment_date?: string;
  payment_method: 'cash' | 'bank_transfer' | 'check' | 'credit_card' | 'other';
  cash_bank_account_id?: string;
  /** Yalnızca alışta şirket kredi kartı. */
  credit_card_id?: string;
  reference?: string;
  notes?: string;
}

/** Çalışma alanı ile ilgili kirli durum — draft'ın kalıcılığı (erp-workspace-panels). */
export interface InvoiceDraft {
  id?: string;
  type: 'sales' | 'purchase' | 'proforma' | 'credit_note' | 'debit_note';
  contact_id: string;
  warehouse_id: string;
  issue_date: string;
  due_date: string;
  currency: string;
  /** Bilinçli kur; boş/undefined ise API tarih bazlı otomatik kur çözer. */
  exchange_rate?: number;
  /** Kurun referans alındığı tarih (dövizli belgeler). */
  rate_date?: string;
  notes: string;
  /** İade faturasının bağlı olduğu orijinal fatura (reference_type='invoice'). */
  reference_id?: string;
  /** Alış faturası: tedarikçi belge no (yalnızca alışta gönderilir). */
  supplier_document_no?: string;
  /** Düzenlenen faturanın kesinleşme durumu; kesinleşmiş fatura formda kilitlenir (yalnız düzenlemede dolu). */
  posting_status?: string;
  lines: InvoiceLine[];
}

/** Idempotency-Key (8–200 karakter). randomUUID yalnızca güvenli bağlamda bulunur; yoksa yedek anahtar. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const DRAFT_KEY = 'erp_invoice_draft_v1';
const PANEL_KEY = 'erp_invoice_panel_v1';

export const useInvoiceStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([]);
  const currentInvoice = ref<Invoice | null>(null);
  const taxRates = ref<TaxRate[]>([]);
  const withholdingTypes = ref<WithholdingType[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // ── Kalıcı çalışma alanı durumu (erp-workspace-panels) ──
  const workspaceOpen = ref(false);
  const workspaceMode = ref<'create' | 'edit'>('create');
  const draft = ref<InvoiceDraft | null>(null);
  const panelBodyRef = ref<HTMLElement | null>(null);

  function loadDraft(): InvoiceDraft | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as InvoiceDraft;
      if (!parsed || !Array.isArray(parsed.lines)) {
        localStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed;
    } catch {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
  }

  function persistDraft(value: InvoiceDraft | null) {
    if (value) localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    else localStorage.removeItem(DRAFT_KEY);
    window.dispatchEvent(new CustomEvent('erp:invoice-draft-changed', { detail: value }));
  }

  function loadPanelState() {
    try {
      const raw = localStorage.getItem(PANEL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed.open === 'boolean') workspaceOpen.value = parsed.open;
    } catch {
      localStorage.removeItem(PANEL_KEY);
    }
  }

  function persistPanelState() {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ open: workspaceOpen.value }));
  }

  function openWorkspace(mode: 'create' | 'edit', value: InvoiceDraft | null) {
    workspaceMode.value = mode;
    draft.value = value;
    workspaceOpen.value = true;
    persistPanelState();
    window.dispatchEvent(new CustomEvent('erp:invoice-draft-changed', { detail: value }));
  }

  function updateDraft(value: InvoiceDraft) {
    draft.value = value;
    persistDraft(value);
  }

  function closeWorkspace() {
    workspaceOpen.value = false;
    persistPanelState();
  }

  function discardDraft() {
    draft.value = null;
    workspaceOpen.value = false;
    persistDraft(null);
    persistPanelState();
  }
  const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const filters = ref({
    page: 1,
    limit: 20,
    sort: 'issue_date' as string,
    order: 'desc' as string,
    type: undefined as string | undefined,
    status: undefined as string | undefined,
    contact_id: undefined as string | undefined,
    date_from: undefined as string | undefined,
    date_to: undefined as string | undefined,
    q: undefined as string | undefined,
  });

  const fetchInvoices = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
      const response = await api.get(`/v1/invoices?${params.toString()}`);
      invoices.value = response.data.data ?? [];
      pagination.value = response.data.pagination ?? pagination.value;
    } catch (err) {
      error.value = 'Faturalar yüklenirken bir hata oluştu.';
      console.error(err);
    } finally {
      loading.value = false;
    }
  };

  const fetchInvoice = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/invoices/${id}`);
      currentInvoice.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Fatura yüklenirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const createInvoice = async (data: CreateInvoiceInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/invoices', data);
      invoices.value.unshift(response.data);
      return response.data;
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Fatura oluşturulurken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /** Son tek-ekran isteğinin anahtarı; ağ hatasında aynı gövde yeniden gönderilirse aynı anahtar kullanılır. */
  let pendingQuick: { key: string; fingerprint: string } | null = null;

  /**
   * Tek transaction'da kaydet [+ kesinleştir] [+ peşin ödeme/tahsilat] (POST /v1/invoices/quick).
   * Hata varsa hiçbir kayıt kalıcı olmaz; store.error sunucu mesajıyla yazılır ve istek yeniden fırlatılır.
   * Başarıda liste tazelenir ve oluşan fatura döner.
   */
  const createInvoiceQuick = async (
    data: CreateInvoiceInput,
    options: { finalize?: boolean; payment?: QuickPaymentInput } = {},
  ): Promise<Invoice> => {
    const body = {
      ...data,
      finalize: options.finalize ?? false,
      ...(options.payment ? { payment: options.payment } : {}),
    };
    const fingerprint = JSON.stringify(body);
    const key =
      pendingQuick && pendingQuick.fingerprint === fingerprint
        ? pendingQuick.key
        : newIdempotencyKey();
    pendingQuick = { key, fingerprint };

    loading.value = true;
    error.value = null;
    let created: Invoice;
    try {
      const response = await api.post<Invoice>('/v1/invoices/quick', body, {
        headers: { 'Idempotency-Key': key },
      });
      created = response.data;
      pendingQuick = null;
    } catch (err: unknown) {
      // Yanıt gelmediyse (ağ hatası) sonuç belirsizdir; anahtar korunur. Yanıt geldiyse istek sonlanmıştır.
      const axiosError = err as {
        response?: { data?: { error?: { message?: string } } };
      };
      if (axiosError.response) pendingQuick = null;
      error.value =
        axiosError.response?.data?.error?.message || 'Fatura kaydedilirken bir hata oluştu.';
      loading.value = false;
      throw err;
    }
    // Kayıt sunucuda tamamlandı; tazeleme hatası kaydı geri almaz (fetchInvoices kendi hatasını yazar).
    await fetchInvoices();
    loading.value = false;
    return created;
  };

  const updateInvoice = async (id: string, data: Partial<Invoice>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/invoices/${id}`, data);
      const index = invoices.value.findIndex((i) => i.id === id);
      if (index !== -1) invoices.value[index] = response.data;
      if (currentInvoice.value?.id === id) currentInvoice.value = response.data;
      return response.data;
    } catch (err: unknown) {
      // Sunucu mesajı (ör. mükerrer belge 409) kullanıcıya gösterilir.
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Fatura güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const replaceLines = async (invoiceId: string, lines: InvoiceLine[]) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put(`/v1/invoices/${invoiceId}/lines`, { lines });
      if (currentInvoice.value?.id === invoiceId) currentInvoice.value = response.data;
      const index = invoices.value.findIndex((i) => i.id === invoiceId);
      if (index !== -1) invoices.value[index] = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Satırlar güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteInvoice = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/invoices/${id}`);
      invoices.value = invoices.value.filter((i) => i.id !== id);
      if (currentInvoice.value?.id === id) currentInvoice.value = null;
    } catch (err) {
      error.value = 'Fatura silinirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const addPayment = async (
    invoiceId: string,
    data: {
      amount: number;
      payment_date?: string;
      payment_method: string;
      reference?: string;
      notes?: string;
    },
  ) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post(`/v1/invoices/${invoiceId}/payments`, data);
      if (currentInvoice.value?.id === invoiceId) currentInvoice.value = response.data;
      const index = invoices.value.findIndex((i) => i.id === invoiceId);
      if (index !== -1) invoices.value[index] = response.data;
      return response.data;
    } catch (err: unknown) {
      // Muhasebe kuralı (ör. yalnız kesinleşmiş faturaya ödeme) sunucu mesajıyla gösterilir.
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Ödeme eklenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Faturayı kesinleştirir (muhasebeleştirir). Her çağrıda yeni Idempotency-Key gönderilir;
   * zaten kesinleşmişse sunucu { alreadyPosted: true } döner. Başarıdan sonra detay ve liste tazelenir.
   */
  const postInvoice = async (id: string): Promise<PostInvoiceResult> => {
    loading.value = true;
    error.value = null;
    let result: PostInvoiceResult;
    try {
      const response = await api.post<PostInvoiceResult>(`/v1/invoices/${id}/post`, undefined, {
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      result = response.data;
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Fatura kesinleştirilirken bir hata oluştu.';
      loading.value = false;
      throw err;
    }
    // Kesinleşme sunucuda tamamlandı; tazeleme hatası kesinleşmeyi geri almaz.
    await Promise.allSettled([fetchInvoice(id), fetchInvoices()]);
    loading.value = false;
    return result;
  };

  const fetchTaxRates = async () => {
    try {
      const response = await api.get('/v1/invoices/tax-rates');
      taxRates.value = response.data.data ?? [];
    } catch (err) {
      console.error(err);
    }
  };

  let withholdingSeq = 0;
  /** Tevkifat türleri; activeOn verilirse o tarihte geçerli aktif türler gelir. */
  const fetchWithholdingTypes = async (activeOn?: string) => {
    const seq = ++withholdingSeq;
    const query = activeOn ? `?active_on=${encodeURIComponent(activeOn)}` : '';
    try {
      const response = await api.get(`/v1/invoices/withholding-types${query}`);
      // Tarih hızla değişirse yalnızca son isteğin sonucu yazılır.
      if (seq === withholdingSeq) withholdingTypes.value = response.data.data ?? [];
    } catch (err) {
      console.error(err);
    }
  };

  /**
   * İade faturası bağı için carinin kesinleşmiş faturaları (mevcut listeleme uç noktası).
   * Ana liste durumuna (invoices / filters / pagination) dokunmaz.
   */
  const fetchReferenceInvoices = async (
    contactId: string,
    type: 'sales' | 'purchase',
  ): Promise<Invoice[]> => {
    const params = new URLSearchParams({
      type,
      contact_id: contactId,
      sort: 'issue_date',
      order: 'desc',
      limit: '100',
    });
    try {
      const response = await api.get(`/v1/invoices?${params.toString()}`);
      const rows = (response.data.data ?? []) as Invoice[];
      return rows.filter((i) => i.posting_status === 'posted');
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const setFilters = (newFilters: Partial<typeof filters.value>) => {
    filters.value = { ...filters.value, ...newFilters };
  };

  const resetFilters = () => {
    filters.value = {
      page: 1,
      limit: 20,
      sort: 'issue_date',
      order: 'desc',
      type: undefined,
      status: undefined,
      contact_id: undefined,
      date_from: undefined,
      date_to: undefined,
      q: undefined,
    };
  };

  return {
    invoices,
    currentInvoice,
    taxRates,
    withholdingTypes,
    loading,
    error,
    pagination,
    filters,
    workspaceOpen,
    workspaceMode,
    draft,
    panelBodyRef,
    loadDraft,
    loadPanelState,
    openWorkspace,
    updateDraft,
    closeWorkspace,
    discardDraft,
    fetchInvoices,
    fetchInvoice,
    createInvoice,
    createInvoiceQuick,
    updateInvoice,
    replaceLines,
    deleteInvoice,
    addPayment,
    postInvoice,
    fetchTaxRates,
    fetchWithholdingTypes,
    fetchReferenceInvoices,
    setFilters,
    resetFilters,
  };
});
