<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Onay Kutusu</h1>
        <p class="page-sub">
          Ödeme limiti, fatura iptali ve fiş onayı taleplerini tek yerden karara bağlayın.
          <span v-if="pendingCount > 0" class="badge badge-warning"
            >{{ pendingCount }} bekliyor</span
          >
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="showForm = !showForm">
          {{ showForm ? 'Formu Kapat' : '+ Yeni Talep' }}
        </button>
      </div>
    </header>

    <form v-if="showForm" class="create-card" @submit.prevent="submitRequest">
      <div class="field">
        <label for="ap-type">Talep Türü</label>
        <select id="ap-type" v-model="form.request_type" class="select" required>
          <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <div class="field field-wide">
        <label for="ap-title">Başlık</label>
        <input id="ap-title" v-model="form.title" class="input" required maxlength="255" />
      </div>
      <div class="field">
        <label for="ap-amount">Tutar</label>
        <input
          id="ap-amount"
          v-model="form.amount"
          type="number"
          min="0"
          step="0.01"
          class="input"
        />
      </div>
      <div class="field">
        <label for="ap-currency">Para Birimi</label>
        <input
          id="ap-currency"
          v-model="form.currency"
          class="input"
          maxlength="3"
          placeholder="TRY"
        />
      </div>
      <div class="field field-wide">
        <label for="ap-summary">Açıklama</label>
        <textarea id="ap-summary" v-model="form.summary" class="input" rows="2" maxlength="5000" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">Kaydet</button>
      </div>
    </form>

    <div class="toolbar" role="search">
      <select v-model="filters.status" class="select" aria-label="Durum filtresi" @change="reload">
        <option value="">Tüm Durumlar</option>
        <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <select
        v-model="filters.request_type"
        class="select"
        aria-label="Tür filtresi"
        @change="reload"
      >
        <option value="">Tüm Türler</option>
        <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
    </div>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Talep</th>
            <th scope="col">Tür</th>
            <th scope="col" class="num">Tutar</th>
            <th scope="col">Durum</th>
            <th scope="col">Tarih</th>
            <th scope="col" class="num">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in approvals" :key="a.id">
            <td>
              <span class="strong">{{ a.title }}</span>
              <span v-if="a.summary" class="muted small block">{{ a.summary }}</span>
              <span v-if="a.decisionNote" class="muted small block">Not: {{ a.decisionNote }}</span>
            </td>
            <td>
              <span class="badge badge-info">{{ typeLabel(a.requestType) }}</span>
            </td>
            <td class="num nowrap">{{ formatMoney(a.amount, a.currency) }}</td>
            <td>
              <span class="badge" :class="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
            </td>
            <td class="nowrap">{{ formatDateTime(a.createdAt) }}</td>
            <td class="num actions">
              <template v-if="a.status === 'pending'">
                <button class="link" @click="openDecision(a, 'approved')">Onayla</button>
                <button class="link danger" @click="openDecision(a, 'rejected')">Reddet</button>
                <button class="link" @click="onCancel(a.id)">İptal</button>
              </template>
              <span v-else class="muted small">{{ formatDateTime(a.decidedAt) }}</span>
            </td>
          </tr>
          <tr v-if="!approvals.length && !loading">
            <td colspan="6" class="empty-cell">Onay talebi yok.</td>
          </tr>
          <tr v-if="loading">
            <td colspan="6" class="empty-cell">Yükleniyor…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pager">
      <button
        class="btn btn-secondary"
        :disabled="pagination.page <= 1"
        @click="changePage(pagination.page - 1)"
      >
        ‹ Önceki
      </button>
      <span>Sayfa {{ pagination.page }} / {{ pagination.pages }}</span>
      <button
        class="btn btn-secondary"
        :disabled="pagination.page >= pagination.pages"
        @click="changePage(pagination.page + 1)"
      >
        Sonraki ›
      </button>
    </div>

    <div v-if="decisionTarget" class="modal-overlay" @click.self="decisionTarget = null">
      <div class="modal modal-md" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2>{{ decision === 'approved' ? 'Talebi Onayla' : 'Talebi Reddet' }}</h2>
          <button
            type="button"
            class="modal-close"
            aria-label="Kapat"
            @click="decisionTarget = null"
          >
            ×
          </button>
        </div>
        <div class="modal-body">
          <p class="strong">{{ decisionTarget.title }}</p>
          <div class="field">
            <label for="ap-decision">Karar</label>
            <select id="ap-decision" v-model="decision" class="select">
              <option value="approved">Onayla</option>
              <option value="rejected">Reddet</option>
            </select>
          </div>
          <div class="field">
            <label for="ap-note">Not (opsiyonel)</label>
            <textarea id="ap-note" v-model="decisionNote" class="input" rows="2" maxlength="2000" />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="decisionTarget = null">
            Vazgeç
          </button>
          <button type="button" class="btn btn-primary" :disabled="saving" @click="confirmDecision">
            {{ decision === 'approved' ? 'Onayla' : 'Reddet' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  useManagementStore,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalRequestType,
} from '@/stores/management';

const store = useManagementStore();

const approvals = computed(() => store.approvals);
const loading = computed(() => store.loading);
const pagination = computed(() => store.approvalPagination);
const filters = computed(() => store.approvalFilters);
const pendingCount = computed(() => store.approvalPendingCount);

const showForm = ref(false);
const saving = ref(false);

const decisionTarget = ref<ApprovalRequest | null>(null);
const decision = ref<'approved' | 'rejected'>('approved');
const decisionNote = ref('');

const TYPE_OPTIONS: { value: ApprovalRequestType; label: string }[] = [
  { value: 'payment_over_limit', label: 'Ödeme Limiti' },
  { value: 'invoice_cancellation', label: 'Fatura İptali' },
  { value: 'journal_entry', label: 'Fiş Onayı' },
];

const STATUS_OPTIONS: { value: ApprovalStatus; label: string }[] = [
  { value: 'pending', label: 'Beklemede' },
  { value: 'approved', label: 'Onaylandı' },
  { value: 'rejected', label: 'Reddedildi' },
  { value: 'cancelled', label: 'İptal' },
];

const form = reactive({
  request_type: 'payment_over_limit' as ApprovalRequestType,
  title: '',
  amount: '' as string | number,
  currency: 'TRY',
  summary: '',
});

onMounted(async () => {
  await Promise.all([reload(), store.fetchApprovalPendingCount()]);
});

async function reload() {
  await store.fetchApprovals();
}

function changePage(page: number) {
  store.approvalFilters.page = page;
  void reload();
}

async function submitRequest() {
  saving.value = true;
  try {
    await store.createApproval({
      request_type: form.request_type,
      title: form.title,
      summary: form.summary || null,
      amount: form.amount === '' ? null : Number(form.amount),
      currency: form.currency || null,
    });
    form.title = '';
    form.summary = '';
    form.amount = '';
    showForm.value = false;
    await Promise.all([reload(), store.fetchApprovalPendingCount()]);
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
}

function openDecision(target: ApprovalRequest, value: 'approved' | 'rejected') {
  decisionTarget.value = target;
  decision.value = value;
  decisionNote.value = '';
}

async function confirmDecision() {
  if (!decisionTarget.value) return;
  saving.value = true;
  try {
    await store.decideApproval(
      decisionTarget.value.id,
      decision.value,
      decisionNote.value || undefined,
    );
    decisionTarget.value = null;
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
}

async function onCancel(id: string) {
  try {
    await store.cancelApproval(id);
  } catch {
    /* hata store'da tutulur */
  }
}

function typeLabel(t: ApprovalRequestType): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}
function statusLabel(s: ApprovalStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
function statusBadge(s: ApprovalStatus): string {
  const map: Record<ApprovalStatus, string> = {
    pending: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-danger',
    cancelled: 'badge-neutral',
  };
  return map[s];
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency || 'TRY',
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
</script>

<style scoped>
.create-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
  margin-bottom: 1.25rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  background: var(--c-surface);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--c-muted);
}
.field-wide {
  grid-column: 1 / -1;
}
.form-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
}
.block {
  display: block;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
}
</style>
