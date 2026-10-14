<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">e-Dönüşüm</h1>
        <p class="page-sub">e-Fatura / e-Arşiv gönderimleri ve gelen kutusu (Faz 4 — SPEC §21).</p>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>
    <p v-else-if="store.notice" class="state-msg success">{{ store.notice }}</p>

    <!-- Sekmeler -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'outbox' }" @click="switchTab('outbox')">
        Gönderimler
      </button>
      <button class="tab" :class="{ active: activeTab === 'inbox' }" @click="switchTab('inbox')">
        Gelen Kutusu
      </button>
    </div>

    <!-- Gönderimler -->
    <template v-if="activeTab === 'outbox'">
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Gönderim Kutusu</h2>
          <button class="btn btn-primary" @click="showSend = true">Belge Gönder</button>
        </header>
        <div class="card-body">
          <p v-if="store.loading && !store.documents.length" class="state-msg">Yükleniyor…</p>
          <table v-else-if="store.documents.length" class="data-table">
            <thead>
              <tr>
                <th>Kaynak</th>
                <th>Belge Tipi</th>
                <th>Durum</th>
                <th>Deneme</th>
                <th>Tarih</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in store.documents" :key="doc.id">
                <td>{{ sourceLabel(doc.source_type) }}</td>
                <td>{{ docTypeLabel(doc.document_type) }}</td>
                <td>
                  <span class="badge" :class="statusClass(doc.status)">
                    {{ statusLabel(doc.status) }}
                  </span>
                </td>
                <td class="num">{{ doc.attempts }}/{{ doc.max_attempts }}</td>
                <td>{{ fmtDate(doc.created_at) }}</td>
                <td class="num">
                  <button
                    v-if="canCancel(doc.status)"
                    class="btn btn-danger btn-sm"
                    @click="cancel(doc)"
                  >
                    İptal
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Gönderilmiş belge bulunmuyor.</p>
        </div>
      </section>
    </template>

    <!-- Gelen kutusu -->
    <template v-else>
      <section class="card">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Gelen Kutusu</h2>
          <button class="btn btn-primary" :disabled="store.loading" @click="sync">
            {{ store.loading ? 'Tazeleniyor…' : 'Sağlayıcıdan Çek' }}
          </button>
        </header>
        <div class="card-body">
          <p v-if="store.loading && !store.inbox.length" class="state-msg">Yükleniyor…</p>
          <table v-else-if="store.inbox.length" class="data-table">
            <thead>
              <tr>
                <th>Başlık</th>
                <th>Harici No</th>
                <th>Belge Tipi</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in store.inbox" :key="inv.id">
                <td>{{ inv.title }}</td>
                <td>{{ inv.external_invoice_id }}</td>
                <td>{{ inv.document_type }}</td>
                <td>{{ fmtDate(inv.received_at) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Gelen kutusu boş.</p>
        </div>
      </section>
    </template>

    <!-- Gönderim modalı -->
    <div v-if="showSend" class="modal-backdrop" @click.self="showSend = false">
      <div class="modal">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Belge Gönder</h2>
          <button class="btn btn-sm" @click="showSend = false">Kapat</button>
        </header>
        <div class="card-body">
          <label class="field">
            <span>Kaynak Tipi</span>
            <select v-model="sendForm.sourceType">
              <option value="invoice">Fatura</option>
              <option value="sales_order">Satış Siparişi</option>
              <option value="purchase_order">Satınalma Siparişi</option>
              <option value="delivery">Teslimat</option>
              <option value="manual">Manuel</option>
            </select>
          </label>
          <label class="field">
            <span>Kaynak ID</span>
            <input v-model="sendForm.sourceId" type="text" placeholder="Fatura/sipariş UUID" />
          </label>
          <button
            class="btn btn-primary"
            :disabled="!sendForm.sourceId || store.loading"
            @click="send"
          >
            Gönder
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  useEinvoiceStore,
  type EInvoiceDocument,
  type InvoiceStatus,
  type SourceType,
  type DocumentType,
} from '@/stores/einvoice';

/**
 * e-Dönüşüm ekranı (Faz 4 — SPEC §21).
 * Gönderim kutusu + gelen kutusu sekmeleri; gönderme modalı ve iptal
 * (iptal gerekçesi backend'de zorunlu — `POST /:id/cancel { reason }`).
 */
const store = useEinvoiceStore();

const activeTab = ref<'outbox' | 'inbox'>('outbox');
const showSend = ref(false);
const sendForm = reactive<{ sourceType: SourceType; sourceId: string }>({
  sourceType: 'invoice',
  sourceId: '',
});

onMounted(() => {
  void store.fetchDocuments();
});

function switchTab(tab: 'outbox' | 'inbox') {
  activeTab.value = tab;
  if (tab === 'inbox' && !store.inbox.length) {
    void store.fetchInbox('incoming');
  }
}

async function send() {
  if (!sendForm.sourceId) return;
  const documentId = await store.sendDocument(sendForm.sourceType, sendForm.sourceId);
  if (documentId) {
    sendForm.sourceId = '';
    showSend.value = false;
  }
}

function sync() {
  void store.syncInbox();
}

function cancel(doc: EInvoiceDocument) {
  const reason = window.prompt('İptal gerekçesi (zorunlu):');
  if (!reason || !reason.trim()) return;
  void store.cancelDocument(doc.id, reason.trim());
}

const CANCELLABLE: InvoiceStatus[] = ['draft', 'sent'];

function canCancel(status: InvoiceStatus): boolean {
  return CANCELLABLE.includes(status);
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Taslak',
  sent: 'Gönderildi',
  delivered: 'Ulaştı',
  accepted: 'Kabul',
  rejected: 'Red',
  cancelled: 'İptal',
  expired: 'Süresi Doldu',
};

function statusLabel(status: InvoiceStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function statusClass(status: InvoiceStatus): string {
  switch (status) {
    case 'accepted':
    case 'delivered':
      return 'badge-success';
    case 'sent':
      return 'badge-info';
    case 'rejected':
    case 'expired':
      return 'badge-danger';
    case 'cancelled':
      return 'badge-neutral';
    default:
      return 'badge-warning';
  }
}

const SOURCE_LABELS: Record<SourceType, string> = {
  sales_quote: 'Teklif',
  sales_order: 'Satış Siparişi',
  purchase_order: 'Satınalma Siparişi',
  delivery: 'Teslimat',
  invoice: 'Fatura',
  manual: 'Manuel',
};

function sourceLabel(source: SourceType): string {
  return SOURCE_LABELS[source] ?? source;
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'e-Fatura',
  credit_note: 'İade Faturası',
  debit_note: 'Fark Faturası',
  delivery_note: 'İrsaliye',
  original_evrak: 'Özgün Evrak',
  evrak_eni: 'Evrak ENİ',
};

function docTypeLabel(type: DocumentType): string {
  return DOC_TYPE_LABELS[type] ?? type;
}

function fmtDate(value: string | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
}
</script>
