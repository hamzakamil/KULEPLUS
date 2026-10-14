<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Abonelik & Faturalama</h1>
        <p class="page-sub">Mevcut planınız, faturalarınız ve ödeme geçmişiniz (Faz 4).</p>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>
    <p v-else-if="store.loading && !store.subscriptions.length" class="state-msg">Yükleniyor…</p>

    <template v-else>
      <!-- Mevcut abonelik -->
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Mevcut Abonelik</h2>
          <span
            v-if="store.latestSubscription"
            class="badge"
            :class="statusClass(store.latestSubscription.status)"
          >
            {{ statusLabel(store.latestSubscription.status) }}
          </span>
        </header>
        <div v-if="store.latestSubscription" class="card-body grid cards-grid">
          <div>
            <span class="muted small">Başlangıç</span>
            <div>{{ fmtDate(store.latestSubscription.started_at) }}</div>
          </div>
          <div>
            <span class="muted small">Dönem başı</span>
            <div>{{ fmtDate(store.latestSubscription.current_period_start) }}</div>
          </div>
          <div>
            <span class="muted small">Dönem sonu</span>
            <div>{{ fmtDate(store.latestSubscription.current_period_end) }}</div>
          </div>
          <div>
            <span class="muted small">Dönem sonunda iptal</span>
            <div>{{ store.latestSubscription.cancel_at_period_end ? 'Evet' : 'Hayır' }}</div>
          </div>
        </div>
        <p v-else class="muted small">Aktif abonelik bulunmuyor.</p>
      </section>

      <!-- Son fatura özeti -->
      <section v-if="store.latestInvoice" class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Son Fatura</h2>
          <span class="badge" :class="invoiceClass(store.latestInvoice.status)">
            {{ invoiceLabel(store.latestInvoice.status) }}
          </span>
        </header>
        <div class="card-body">
          <strong>{{ store.latestInvoice.number }}</strong>
          <div class="muted small">
            Ara toplam {{ fmtMoney(store.latestInvoice.subtotal, store.latestInvoice.currency) }} ·
            KDV {{ fmtMoney(store.latestInvoice.vat_total, store.latestInvoice.currency) }}
          </div>
          <div style="font-size: 1.15rem; font-weight: 600">
            {{ fmtMoney(store.latestInvoice.total, store.latestInvoice.currency) }}
          </div>
        </div>
      </section>

      <!-- Fatura geçmişi -->
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Fatura Geçmişi</h2>
          <span class="muted small">{{ store.invoices.length }} kayıt</span>
        </header>
        <div class="card-body">
          <table v-if="store.invoices.length" class="data-table">
            <thead>
              <tr>
                <th>Fatura No</th>
                <th>Tarih</th>
                <th>Durum</th>
                <th class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in store.invoices" :key="inv.id">
                <td>{{ inv.number }}</td>
                <td>{{ fmtDate(inv.issued_at || inv.created_at) }}</td>
                <td>
                  <span class="badge" :class="invoiceClass(inv.status)">
                    {{ invoiceLabel(inv.status) }}
                  </span>
                </td>
                <td class="num">{{ fmtMoney(inv.total, inv.currency) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Henüz faturanız yok.</p>
        </div>
      </section>

      <!-- Ödeme geçmişi -->
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Ödeme Geçmişi</h2>
          <span class="muted small">{{ store.payments.length }} kayıt</span>
        </header>
        <div class="card-body">
          <table v-if="store.payments.length" class="data-table">
            <thead>
              <tr>
                <th>Referans</th>
                <th>Tarih</th>
                <th>Durum</th>
                <th class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pay in store.payments" :key="pay.id">
                <td>{{ pay.provider_ref || '—' }}</td>
                <td>{{ fmtDate(pay.paid_at || pay.created_at) }}</td>
                <td>
                  <span class="badge" :class="paymentClass(pay.status)">
                    {{ paymentLabel(pay.status) }}
                  </span>
                </td>
                <td class="num">{{ fmtMoney(pay.amount, pay.currency) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Henüz ödemeniz yok.</p>
        </div>
      </section>

      <!-- Sipariş geçmişi -->
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Sipariş Geçmişi</h2>
          <span class="muted small">{{ store.orders.length }} kayıt</span>
        </header>
        <div class="card-body">
          <table v-if="store.orders.length" class="data-table">
            <thead>
              <tr>
                <th>Sipariş No</th>
                <th>Tarih</th>
                <th>Durum</th>
                <th class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ord in store.orders" :key="ord.id">
                <td>{{ ord.order_no }}</td>
                <td>{{ fmtDate(ord.created_at) }}</td>
                <td>
                  <span class="badge" :class="orderClass(ord.status)">
                    {{ orderLabel(ord.status) }}
                  </span>
                </td>
                <td class="num">{{ fmtMoney(ord.amount, ord.currency) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Henüz siparişiniz yok.</p>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useSubscriptionStore } from '@/stores/subscription';

const store = useSubscriptionStore();
onMounted(() => store.fetchAll());

const fmtDate = (v: string | null): string => (v ? new Date(v).toLocaleDateString('tr-TR') : '—');

/** NUMERIC string → yerelleştirilmiş para (float yok, sözleşme §22.1). */
const fmtMoney = (amount: string | null | undefined, currency: string): string => {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  if (!Number.isFinite(num)) return amount;
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency || 'TRY',
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
};

const SUB_STATUS_CLASS: Record<string, string> = {
  active: 'badge-success',
  pending_activation: 'badge-warning',
  past_due: 'badge-warning',
  suspended: 'badge-danger',
  cancelled: 'badge-neutral',
  expired: 'badge-neutral',
};

const SUB_STATUS_LABEL: Record<string, string> = {
  pending_activation: 'Aktivasyon Bekliyor',
  active: 'Aktif',
  past_due: 'Ödeme Gecikmiş',
  suspended: 'Askıda',
  cancelled: 'İptal Edildi',
  expired: 'Süresi Doldu',
};

const statusClass = (s: string): string => SUB_STATUS_CLASS[s] ?? 'badge-neutral';
const statusLabel = (s: string): string => SUB_STATUS_LABEL[s] ?? s;

const INVOICE_CLASS: Record<string, string> = {
  issued: 'badge-success',
  draft: 'badge-neutral',
  cancelled: 'badge-danger',
};

const INVOICE_LABEL: Record<string, string> = {
  draft: 'Taslak',
  issued: 'Kesildi',
  cancelled: 'İptal',
};

const invoiceClass = (s: string): string => INVOICE_CLASS[s] ?? 'badge-neutral';
const invoiceLabel = (s: string): string => INVOICE_LABEL[s] ?? s;

const ORDER_CLASS: Record<string, string> = {
  paid: 'badge-success',
  pending: 'badge-warning',
  failed: 'badge-danger',
  cancelled: 'badge-neutral',
  refunded: 'badge-info',
};

const ORDER_LABEL: Record<string, string> = {
  pending: 'Beklemede',
  paid: 'Ödendi',
  failed: 'Başarısız',
  cancelled: 'İptal',
  refunded: 'İade Edildi',
};

const orderClass = (s: string): string => ORDER_CLASS[s] ?? 'badge-neutral';
const orderLabel = (s: string): string => ORDER_LABEL[s] ?? s;

const PAYMENT_CLASS: Record<string, string> = {
  succeeded: 'badge-success',
  pending: 'badge-warning',
  failed: 'badge-danger',
};

const PAYMENT_LABEL: Record<string, string> = {
  succeeded: 'Başarılı',
  pending: 'Beklemede',
  failed: 'Başarısız',
};

const paymentClass = (s: string): string => PAYMENT_CLASS[s] ?? 'badge-neutral';
const paymentLabel = (s: string): string => PAYMENT_LABEL[s] ?? s;
</script>
