import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Abonelik & Faturalama ekranı (Faz 4 Hat B — SPEC §8).
 * Backend `/api/v1/subscription` altında; listeler SAYFALI döner:
 * `{ data, page, limit, total }`. Para alanları API'den NUMERIC string gelir.
 */

/** API hata sözleşmesi: `{ error: { code, message } }` (SPEC §22.1). */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

const BASE = '/v1/subscription';

export type SubscriptionStatus =
  'pending_activation' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'expired';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

export type PaymentMethod = 'card' | 'bank_transfer' | null;

export type BillingPaymentStatus = 'pending' | 'succeeded' | 'failed';

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

export interface Subscription {
  id: string;
  plan_version_id: string;
  status: SubscriptionStatus;
  started_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialOrder {
  id: string;
  order_no: string;
  plan_version_id: string;
  amount: string;
  currency: string;
  payment_method: PaymentMethod;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

export interface BillingPayment {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  status: BillingPaymentStatus;
  provider_ref: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface BillingInvoice {
  id: string;
  order_id: string;
  number: string;
  subtotal: string;
  vat_total: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  issued_at: string | null;
  created_at: string;
}

/** Sayfalı liste yanıtı (subscription listResource çıktısı). */
interface Paged<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export const useSubscriptionStore = defineStore('subscription', () => {
  const subscriptions = ref<Subscription[]>([]);
  const orders = ref<CommercialOrder[]>([]);
  const payments = ref<BillingPayment[]>([]);
  const invoices = ref<BillingInvoice[]>([]);

  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Sıralı listeler — en güncel kayıt başta. */
  const latestSubscription = ref<Subscription | null>(null);
  const latestInvoice = ref<BillingInvoice | null>(null);

  function sortByCreatedDesc<T extends { created_at: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const [subRes, ordRes, payRes, invRes] = await Promise.all([
        api.get<Paged<Subscription>>(`${BASE}/subscriptions`),
        api.get<Paged<CommercialOrder>>(`${BASE}/orders`),
        api.get<Paged<BillingPayment>>(`${BASE}/payments`),
        api.get<Paged<BillingInvoice>>(`${BASE}/invoices`),
      ]);
      subscriptions.value = subRes.data.data ?? [];
      orders.value = ordRes.data.data ?? [];
      payments.value = payRes.data.data ?? [];
      invoices.value = invRes.data.data ?? [];

      latestSubscription.value = sortByCreatedDesc(subscriptions.value)[0] ?? null;
      latestInvoice.value = sortByCreatedDesc(invoices.value)[0] ?? null;
    } catch (err) {
      error.value = errorMessage(err, 'Abonelik bilgileri yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  /**
   * Havale/EFT ile ödeme bildirimi — SPEC §8.5 (backend `POST /orders/:id/manual-confirm`).
   * Bildirim sonrası listeler tazelenir; sipariş `paid` olur, fatura+abonelik+entitlement
   * aynı transaction'da ilerler (bkz. subscription service `confirmManualPayment`).
   */
  async function confirmManualPayment(
    orderId: string,
    input: { reference?: string; note?: string },
  ): Promise<boolean> {
    error.value = null;
    try {
      await api.post(`${BASE}/orders/${orderId}/manual-confirm`, input);
      await fetchAll();
      return true;
    } catch (err) {
      error.value = errorMessage(err, 'Ödeme onayı iletilemedi');
      return false;
    }
  }

  return {
    subscriptions,
    orders,
    payments,
    invoices,
    latestSubscription,
    latestInvoice,
    loading,
    error,
    fetchAll,
    confirmManualPayment,
  };
});
