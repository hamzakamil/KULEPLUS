<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Randevular</h1>
        <p class="page-sub">Talep, onay, tamamlama ve iptal akışını tek yerden yönetin.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="showForm = !showForm">
          {{ showForm ? 'Formu Kapat' : '+ Yeni Randevu' }}
        </button>
      </div>
    </header>

    <form v-if="showForm" class="create-card" @submit.prevent="submitAppointment">
      <div class="field">
        <label for="appt-title">Başlık</label>
        <input id="appt-title" v-model="form.title" class="input" required maxlength="255" />
      </div>
      <div class="field">
        <label for="appt-start">Başlangıç</label>
        <input
          id="appt-start"
          v-model="form.starts_at"
          type="datetime-local"
          class="input"
          required
        />
      </div>
      <div class="field">
        <label for="appt-end">Bitiş</label>
        <input id="appt-end" v-model="form.ends_at" type="datetime-local" class="input" />
      </div>
      <div class="field">
        <label for="appt-location">Konum</label>
        <input id="appt-location" v-model="form.location" class="input" maxlength="255" />
      </div>
      <div class="field field-wide">
        <label for="appt-notes">Notlar</label>
        <textarea id="appt-notes" v-model="form.notes" class="input" rows="2" maxlength="5000" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">Kaydet</button>
      </div>
    </form>

    <div class="toolbar" role="search">
      <select
        v-model="filters.status"
        class="select"
        aria-label="Durum filtresi"
        @change="fetchAppointments"
      >
        <option value="">Tüm Durumlar</option>
        <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
    </div>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Başlık</th>
            <th scope="col">Başlangıç</th>
            <th scope="col">Konum</th>
            <th scope="col">Durum</th>
            <th scope="col" class="num">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="appt in appointments" :key="appt.id">
            <td>
              <span class="strong">{{ appt.title }}</span>
              <span v-if="appt.notes" class="muted small block">{{ appt.notes }}</span>
            </td>
            <td class="nowrap">{{ formatDateTime(appt.startsAt) }}</td>
            <td>{{ appt.location || '—' }}</td>
            <td>
              <span class="badge" :class="statusBadge(appt.status)">
                {{ statusLabel(appt.status) }}
              </span>
            </td>
            <td class="num actions">
              <select
                class="select select-sm"
                :value="appt.status"
                aria-label="Randevu durumu"
                @change="
                  onStatusChange(
                    appt.id,
                    ($event.target as HTMLSelectElement).value as AppointmentStatus,
                  )
                "
              >
                <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">
                  {{ s.label }}
                </option>
              </select>
            </td>
          </tr>
          <tr v-if="!appointments.length && !loading">
            <td colspan="5" class="empty-cell">
              Henüz randevu yok. Yukarıdan yeni randevu ekleyin.
            </td>
          </tr>
          <tr v-if="loading">
            <td colspan="5" class="empty-cell">Yükleniyor…</td>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useManagementStore, type AppointmentStatus } from '@/stores/management';

const store = useManagementStore();

const appointments = computed(() => store.appointments);
const loading = computed(() => store.loading);
const pagination = computed(() => store.appointmentPagination);
const filters = computed(() => store.appointmentFilters);

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'pending', label: 'Bekliyor' },
  { value: 'confirmed', label: 'Onaylandı' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal' },
  { value: 'no_show', label: 'Gelmedi' },
];

const showForm = ref(false);
const saving = ref(false);
const form = reactive({
  title: '',
  starts_at: '',
  ends_at: '',
  location: '',
  notes: '',
});

onMounted(fetchAppointments);

async function fetchAppointments() {
  await store.fetchAppointments();
}

function changePage(page: number) {
  store.appointmentFilters.page = page;
  void fetchAppointments();
}

async function submitAppointment() {
  if (!form.title.trim() || !form.starts_at) return;
  saving.value = true;
  try {
    await store.createAppointment({
      title: form.title.trim(),
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    });
    form.title = '';
    form.starts_at = '';
    form.ends_at = '';
    form.location = '';
    form.notes = '';
    showForm.value = false;
    void fetchAppointments();
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
}

async function onStatusChange(id: string, status: AppointmentStatus) {
  try {
    await store.setAppointmentStatus(id, status);
  } catch {
    /* hata store'da tutulur */
  }
}

function statusLabel(s: AppointmentStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
function statusBadge(s: AppointmentStatus): string {
  const map: Record<AppointmentStatus, string> = {
    pending: 'badge-warning',
    confirmed: 'badge-info',
    completed: 'badge-success',
    cancelled: 'badge-danger',
    no_show: 'badge-neutral',
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
.select-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.8125rem;
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
