<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Görevler</h1>
        <p class="page-sub">Kayıt sistemini günlük aksiyona dönüştürün — ata, önceliklendir, tamamla.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="showForm = !showForm">
          {{ showForm ? 'Formu Kapat' : '+ Yeni Görev' }}
        </button>
      </div>
    </header>

    <form v-if="showForm" class="create-card" @submit.prevent="submitTask">
      <div class="field">
        <label for="task-title">Başlık</label>
        <input id="task-title" v-model="form.title" class="input" required maxlength="255" />
      </div>
      <div class="field">
        <label for="task-priority">Öncelik</label>
        <select id="task-priority" v-model="form.priority" class="select">
          <option v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">
            {{ p.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="task-due">Son Tarih</label>
        <input id="task-due" v-model="form.due_at" type="datetime-local" class="input" />
      </div>
      <div class="field field-wide">
        <label for="task-desc">Açıklama</label>
        <textarea id="task-desc" v-model="form.description" class="input" rows="2" maxlength="5000" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">Kaydet</button>
      </div>
    </form>

    <div class="toolbar" role="search">
      <select v-model="filters.status" class="select" aria-label="Durum filtresi" @change="fetchTasks">
        <option value="">Tüm Durumlar</option>
        <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <select
        v-model="filters.priority"
        class="select"
        aria-label="Öncelik filtresi"
        @change="fetchTasks"
      >
        <option value="">Tüm Öncelikler</option>
        <option v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">
          {{ p.label }}
        </option>
      </select>
      <input
        v-model="filters.q"
        type="search"
        class="input search"
        placeholder="Görev ara…"
        aria-label="Görev ara"
        @change="fetchTasks"
      />
    </div>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Başlık</th>
            <th scope="col">Öncelik</th>
            <th scope="col">Durum</th>
            <th scope="col">Son Tarih</th>
            <th scope="col" class="num">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td>
              <span class="strong">{{ task.title }}</span>
              <span v-if="task.description" class="muted small block">{{ task.description }}</span>
            </td>
            <td>
              <span class="badge" :class="priorityBadge(task.priority)">
                {{ priorityLabel(task.priority) }}
              </span>
            </td>
            <td>
              <span class="badge" :class="statusBadge(task.status)">
                {{ statusLabel(task.status) }}
              </span>
            </td>
            <td class="nowrap">{{ formatDateTime(task.dueAt) }}</td>
            <td class="num actions">
              <button
                v-if="task.status !== 'completed' && task.status !== 'cancelled'"
                class="link"
                @click="onComplete(task.id)"
              >
                Tamamla
              </button>
              <button class="link danger" @click="onDelete(task.id)">Sil</button>
            </td>
          </tr>
          <tr v-if="!tasks.length && !loading">
            <td colspan="5" class="empty-cell">Henüz görev yok. Yukarıdan yeni görev ekleyin.</td>
          </tr>
          <tr v-if="loading">
            <td colspan="5" class="empty-cell">Yükleniyor…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pager">
      <button class="btn btn-secondary" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useManagementStore, type TaskStatus, type TaskPriority } from '@/stores/management';

const store = useManagementStore();

const tasks = computed(() => store.tasks);
const loading = computed(() => store.loading);
const pagination = computed(() => store.taskPagination);
const filters = computed(() => store.taskFilters);

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Yapılacak' },
  { value: 'in_progress', label: 'Devam Ediyor' },
  { value: 'waiting', label: 'Bekliyor' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal' },
];
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Düşük' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Yüksek' },
  { value: 'urgent', label: 'Acil' },
];

const showForm = ref(false);
const saving = ref(false);
const form = reactive({
  title: '',
  description: '',
  priority: 'normal' as TaskPriority,
  due_at: '',
});

onMounted(fetchTasks);

async function fetchTasks() {
  await store.fetchTasks();
}

function changePage(page: number) {
  store.taskFilters.page = page;
  void fetchTasks();
}

async function submitTask() {
  if (!form.title.trim()) return;
  saving.value = true;
  try {
    await store.createTask({
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      priority: form.priority,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
    });
    form.title = '';
    form.description = '';
    form.priority = 'normal';
    form.due_at = '';
    showForm.value = false;
    void fetchTasks();
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
}

async function onComplete(id: string) {
  try {
    await store.completeTask(id);
  } catch {
    /* hata store'da tutulur */
  }
}

async function onDelete(id: string) {
  if (!window.confirm('Bu görevi silmek istediğinize emin misiniz?')) return;
  try {
    await store.deleteTask(id);
  } catch {
    /* hata store'da tutulur */
  }
}

function priorityLabel(p: TaskPriority): string {
  return PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? p;
}
function priorityBadge(p: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    low: 'badge-neutral',
    normal: 'badge-info',
    high: 'badge-warning',
    urgent: 'badge-danger',
  };
  return map[p];
}
function statusLabel(s: TaskStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
function statusBadge(s: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    todo: 'badge-neutral',
    in_progress: 'badge-info',
    waiting: 'badge-warning',
    completed: 'badge-success',
    cancelled: 'badge-danger',
  };
  return map[s];
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
  grid-template-columns: 2fr 1fr 1fr;
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
