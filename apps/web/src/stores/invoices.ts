import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface InvoiceLine {
  id?: string;
  product_id?: string;
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
  lines: InvoiceLine[];
}

const DRAFT_KEY = 'erp_invoice_draft_v1';
const PANEL_KEY = 'erp_invoice_panel_v1';

export const useInvoiceStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([]);
  const currentInvoice = ref<Invoice | null>(null);
  const taxRates = ref<TaxRate[]>([]);
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

  const createInvoice = async (data: {
    type: string;
    contact_id?: string;
    warehouse_id?: string;
    issue_date?: string;
    due_date?: string;
    currency: string;
    exchange_rate?: number;
    rate_date?: string;
    notes?: string;
    lines: InvoiceLine[];
  }) => {
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

  const updateInvoice = async (id: string, data: Partial<Invoice>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/invoices/${id}`, data);
      const index = invoices.value.findIndex((i) => i.id === id);
      if (index !== -1) invoices.value[index] = response.data;
      if (currentInvoice.value?.id === id) currentInvoice.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Fatura güncellenirken bir hata oluştu.';
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
    } catch (err) {
      error.value = 'Ödeme eklenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const fetchTaxRates = async () => {
    try {
      const response = await api.get('/v1/invoices/tax-rates');
      taxRates.value = response.data.data ?? [];
    } catch (err) {
      console.error(err);
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
    updateInvoice,
    replaceLines,
    deleteInvoice,
    addPayment,
    fetchTaxRates,
    setFilters,
    resetFilters,
  };
});
