import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface SalesQuoteLine {
  id?: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_id?: string;
  unit_price: number;
  discount_percent: number;
  tax_rate_id?: string;
  sort_order: number;
}

export interface SalesQuote {
  id: string;
  number: string;
  series_id?: string;
  contact_id?: string;
  issue_date: string;
  valid_until?: string;
  currency: string;
  exchange_rate: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  notes?: string;
  lines: SalesQuoteLine[];
  contact_name?: string;
}

export const useTradeQuotesStore = defineStore('trade-quotes', () => {
  const quotes = ref<SalesQuote[]>([]);
  const currentQuote = ref<SalesQuote | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const filters = ref({
    page: 1,
    limit: 20,
    sort: 'issue_date',
    order: 'desc',
    status: undefined,
    contact_id: undefined,
    search: undefined,
    sortBy: 'issueDate',
    sortOrder: 'desc',
  });

  const fetchQuotes = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
      const response = await api.get(`/v1/trade/quotes?${params.toString()}`);
      quotes.value = response.data.items ?? [];
      pagination.value = {
        page: response.data.page ?? 1,
        limit: response.data.limit ?? 20,
        total: response.data.total ?? 0,
        pages: response.data.totalPages ?? 0,
      };
    } catch (err) {
      error.value = 'Teklifler yüklenirken bir hata oluştu.';
      console.error(err);
    } finally {
      loading.value = false;
    }
  };

  const fetchQuote = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/trade/quotes/${id}`);
      currentQuote.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teklif yüklenirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const createQuote = async (data: {
    contact_id?: string;
    issue_date: string;
    valid_until?: string;
    currency: string;
    exchange_rate: number;
    series_id?: string;
    notes?: string;
    lines: SalesQuoteLine[];
  }) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/trade/quotes', data);
      quotes.value.unshift(response.data);
      return response.data;
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Teklif oluşturulurken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateQuote = async (id: string, data: Partial<SalesQuote>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/quotes/${id}`, data);
      const index = quotes.value.findIndex((q) => q.id === id);
      if (index !== -1) quotes.value[index] = response.data;
      if (currentQuote.value?.id === id) currentQuote.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teklif güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateQuoteStatus = async (id: string, status: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/quotes/${id}/status`, { status });
      const index = quotes.value.findIndex((q) => q.id === id);
      if (index !== -1) quotes.value[index] = response.data;
      if (currentQuote.value?.id === id) currentQuote.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teklif durumu güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteQuote = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/trade/quotes/${id}`);
      quotes.value = quotes.value.filter((q) => q.id !== id);
      if (currentQuote.value?.id === id) currentQuote.value = null;
    } catch (err) {
      error.value = 'Teklif silinirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
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
      status: undefined,
      contact_id: undefined,
      search: undefined,
      sortBy: 'issueDate',
      sortOrder: 'desc',
    };
  };

  return {
    quotes,
    currentQuote,
    loading,
    error,
    pagination,
    filters,
    fetchQuotes,
    fetchQuote,
    createQuote,
    updateQuote,
    updateQuoteStatus,
    deleteQuote,
    setFilters,
    resetFilters,
  };
});
