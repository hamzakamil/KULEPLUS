<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Denetim Kayıtları</h1>
        <p class="page-sub">Kullanıcı ve sistem işlemlerinin denetim izi (SPEC §27.3).</p>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <!-- Filtreler -->
    <section class="card">
      <header class="card-head">
        <h2 style="font-size: 1.05rem">Filtreler</h2>
        <button class="btn btn-primary" :disabled="store.loading" @click="applyFilters">
          Listele
        </button>
      </header>
      <div class="card-body">
        <div class="filters">
          <label class="field">
            <span>İşlem (action)</span>
            <input
              v-model="filters.action"
              type="text"
              placeholder="ör. invoice.create"
              @keyup.enter="applyFilters"
            />
          </label>
          <label class="field">
            <span>Varlık Tipi</span>
            <input
              v-model="filters.entityType"
              type="text"
              placeholder="ör. invoice"
              @keyup.enter="applyFilters"
            />
          </label>
          <label class="field">
            <span>Başlangıç</span>
            <input v-model="filters.after" type="date" />
          </label>
          <label class="field">
            <span>Bitiş</span>
            <input v-model="filters.before" type="date" />
          </label>
        </div>
      </div>
    </section>

    <!-- Kayıtlar -->
    <section class="card">
      <header class="card-head">
        <h2 style="font-size: 1.05rem">Kayıtlar</h2>
        <span class="muted small">{{ store.total }} kayıt</span>
      </header>
      <div class="card-body">
        <p v-if="store.loading && !store.logs.length" class="state-msg">Yükleniyor…</p>
        <table v-else-if="store.logs.length" class="data-table">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>İşlem</th>
              <th>Varlık</th>
              <th>Kullanıcı</th>
              <th>IP</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in store.logs" :key="log.id">
              <td>{{ fmtDateTime(log.created_at) }}</td>
              <td>
                <span class="badge badge-info">{{ log.action }}</span>
              </td>
              <td>
                <template v-if="log.entity_type">
                  {{ log.entity_type }}
                  <span class="muted small">({{ shortId(log.entity_id) }})</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>{{ shortId(log.user_id) }}</td>
              <td>{{ log.ip_address ?? '—' }}</td>
              <td class="num">
                <button class="btn btn-sm" @click="store.fetchLog(log.id)">Detay</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="!store.error" class="muted small">Kayıt bulunamadı.</p>

        <!-- Sayfalama -->
        <div v-if="store.total > store.limit" class="pagination">
          <button class="btn btn-sm" :disabled="store.page <= 1" @click="goTo(store.page - 1)">
            ‹ Önceki
          </button>
          <span class="muted small">Sayfa {{ store.page }} / {{ totalPages }}</span>
          <button
            class="btn btn-sm"
            :disabled="store.page >= totalPages"
            @click="goTo(store.page + 1)"
          >
            Sonraki ›
          </button>
        </div>
      </div>
    </section>

    <!-- Detay modalı -->
    <div v-if="store.current" class="modal-backdrop" @click.self="store.clearCurrent()">
      <div class="modal">
        <header class="card-head">
          <h2 style="font-size: 1.05rem">Denetim Detayı</h2>
          <button class="btn btn-sm" @click="store.clearCurrent()">Kapat</button>
        </header>
        <div class="card-body">
          <dl class="detail-list">
            <dt>İşlem</dt>
            <dd>{{ store.current.action }}</dd>
            <dt>Zaman</dt>
            <dd>{{ fmtDateTime(store.current.created_at) }}</dd>
            <dt>Varlık</dt>
            <dd>{{ store.current.entity_type ?? '—' }} {{ store.current.entity_id ?? '' }}</dd>
            <dt>Kullanıcı</dt>
            <dd>{{ store.current.user_id ?? '—' }}</dd>
            <dt>İstek ID</dt>
            <dd>{{ store.current.request_id ?? '—' }}</dd>
            <dt>User-Agent</dt>
            <dd class="small">{{ store.current.user_agent ?? '—' }}</dd>
          </dl>
          <h3 style="font-size: 0.95rem; margin: 12px 0 4px">Önceki Değerler</h3>
          <pre class="json-block">{{ pretty(store.current.old_values) }}</pre>
          <h3 style="font-size: 0.95rem; margin: 12px 0 4px">Sonraki Değerler</h3>
          <pre class="json-block">{{ pretty(store.current.new_values) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { useAuditStore, type AuditListParams } from '@/stores/audit';

/**
 * Denetim kayıtları ekranı — filtreli liste + detay modalı.
 * Sayfalama backend `{ page, limit, total }` sözleşmesine bağlı.
 */
const store = useAuditStore();

const filters = reactive<{ action: string; entityType: string; after: string; before: string }>({
  action: '',
  entityType: '',
  after: '',
  before: '',
});

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.limit)));

onMounted(() => {
  void store.fetchLogs();
});

function buildParams(page = 1): AuditListParams {
  const params: AuditListParams = { page };
  if (filters.action.trim()) params.action = filters.action.trim();
  if (filters.entityType.trim()) params.entityType = filters.entityType.trim();
  if (filters.after) params.after = new Date(filters.after).toISOString();
  if (filters.before) {
    // Bitiş günü gün sonu: 23:59:59 dahil
    const end = new Date(filters.before);
    end.setHours(23, 59, 59, 999);
    params.before = end.toISOString();
  }
  return params;
}

function applyFilters() {
  void store.fetchLogs(buildParams(1));
}

function goTo(p: number) {
  void store.fetchLogs(buildParams(p));
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—';
}

function fmtDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR');
}

function pretty(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : '—';
}
</script>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}
.detail-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
.detail-list dt {
  color: var(--text-muted, #6b7280);
  font-size: 0.85rem;
}
.detail-list dd {
  margin: 0;
  font-size: 0.9rem;
}
.json-block {
  background: var(--surface-2, #f3f4f6);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 0.8rem;
  overflow: auto;
  max-height: 200px;
  margin: 0;
}
</style>
