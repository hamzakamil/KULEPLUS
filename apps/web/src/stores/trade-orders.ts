import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface SalesOrderLine {
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

export interface SalesOrder {
  id: string;
  number: string;
  quote_id?: string;
  contact_id?: string;
  issue_date: string;
  delivery_date?: string;
  currency: string;
  exchange_rate: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  status: 'draft' | 'confirmed' | 'partial_delivered' | 'delivered' | 'invoiced' | 'cancelled';
  notes?: string;
  lines: SalesOrderLine[];
  contact_name?: string;
}

export const useTradeOrdersStore = defineStore('trade-orders', () => {
  const orders = ref<SalesOrder[]>([]);
  const currentOrder = ref<SalesOrder | null>(null);
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

  const fetchOrders = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
      const response = await api.get(`/v1/trade/orders?${params.toString()}`);
      orders.value = response.data.items ?? [];
      pagination.value = {
        page: response.data.page ?? 1,
        limit: response.data.limit ?? 20,
        total: response.data.total ?? 0,
        pages: response.data.totalPages ?? 0,
      };
    } catch (err) {
      error.value = 'Siparişler yüklenirken bir hata oluştu.';
      console.error(err);
    } finally {
      loading.value = false;
    }
  };

  const fetchOrder = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/trade/orders/${id}`);
      currentOrder.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Sipariş yüklenirken bir hata oluştu.';
      console.error(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const createOrder = async (data: {
    quote_id?: string;
    contact_id?: string;
    issue_date: string;
    delivery_date?: string;
    currency: string;
    exchange_rate: number;
    notes?: string;
    lines: SalesOrderLine[];
  }) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/trade/orders', data);
      orders.value.unshift(response.data);
      return response.data;
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      error.value =
        axiosError.response?.data?.error?.message || 'Sipariş oluşturulurken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateOrder = async (id: string, data: Partial<SalesOrder>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/orders/${id}`, data);
      const index = orders.value.findIndex((o) => o.id === id);
      if (index !== -1) orders.value[index] = response.data;
      if (currentOrder.value?.id === id) currentOrder.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Sipariş güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateOrderStatus = async (id: string, status: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/trade/orders/${id}/status`, { status });
      const index = orders.value.findIndex((o) => o.id === id);
      if (index !== -1) orders.value[index] = response.data;
      if (currentOrder.value?.id === id) currentOrder.value = response.data;
      return response.data;
    } catch (err) {
      error.value = 'Sipariş durumu güncellenirken bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteOrder = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/trade/orders/${id}`);
      orders.value = orders.value.filter((o) => o.id !== id);
      if (currentOrder.value?.id === id) currentOrder.value = null;
    } catch (err) {
      error.value = 'Sipariş silinirken bir hata oluştu.';
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
    orders,
    currentOrder,
    loading,
    error,
    pagination,
    filters,
    fetchOrders,
    fetchOrder,
    createOrder,
    updateOrder,
    updateOrderStatus,
    deleteOrder,
    setFilters,
    resetFilters,
  };
});
