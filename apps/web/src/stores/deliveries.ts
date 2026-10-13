import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface DeliveryLine {
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

export interface Delivery {
  id: string;
  number: string;
  sales_order_id?: string;
  contact_id?: string;
  issue_date: string;
  delivery_date?: string;
  currency: string;
  exchange_rate: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  status: 'draft' | 'prepared' | 'shipped' | 'delivered' | 'returned' | 'cancelled';
  notes?: string;
  lines: DeliveryLine[];
  contact_name?: string;
}

export const useDeliveriesStore = defineStore('deliveries', () => {
  const deliveries = ref<Delivery[]>([]);
  const currentDelivery = ref<Delivery | null>(null);
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

  const fetchDeliveries = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
      const response = await api.get(`/v1/trade/deliveries?${params.toString()}`);
      deliveries.value = response.data.items ?? [];
      pagination.value = {
        page: response.data.page ?? 1,
        limit: response.data.limit ?? 20,
        total: response.data.total ?? 0,
        pages: response.data.totalPages ?? 0,
      };
    } catch (err) {
      error.value = 'Teslimatlar yüklenirken bir hata oluştu.';
      console.error(err);
    } finally {
      loading.value = false;
    }
  };

  const fetchDelivery = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/trade/deliveries/${id}`);
      currentDelivery.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teslimat yüklenirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const createDelivery = async (data: {
    sales_order_id?: string;
    contact_id?: string;
    issue_date: string;
    delivery_date?: string;
    currency: string;
    exchange_rate: number;
    notes?: string;
    lines: DeliveryLine[];
  }) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/trade/deliveries', data);
      deliveries.value.unshift(response.data);
      return response.data;
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Teslimat oluşturulurken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateDelivery = async (id: string, data: Partial<Delivery>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/deliveries/${id}`, data);
      const index = deliveries.value.findIndex((d) => d.id === id);
      if (index !== -1) deliveries.value[index] = response.data;
      if (currentDelivery.value?.id === id) currentDelivery.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teslimat güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateDeliveryStatus = async (id: string, status: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/deliveries/${id}/status`, { status });
      const index = deliveries.value.findIndex((d) => d.id === id);
      if (index !== -1) deliveries.value[index] = response.data;
      if (currentDelivery.value?.id === id) currentDelivery.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Teslimat durumu güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteDelivery = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/trade/deliveries/${id}`);
      deliveries.value = deliveries.value.filter((d) => d.id !== id);
      if (currentDelivery.value?.id === id) currentDelivery.value = null;
    } catch (err) {
      error.value = 'Teslimat silinirken bir hata oluştu.';
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
    deliveries,
    currentDelivery,
    loading,
    error,
    pagination,
    filters,
    fetchDeliveries,
    fetchDelivery,
    createDelivery,
    updateDelivery,
    updateDeliveryStatus,
    deleteDelivery,
    setFilters,
    resetFilters,
  };
});
