<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  WITHHOLDING_RATE_NUMERATORS,
  useWithholdingStore,
  withholdingErrorMessage,
  type WithholdingType,
  type WithholdingTypeInput,
} from '@/stores/withholding';

defineProps<{ embedded?: boolean }>();

const store = useWithholdingStore();
const info = ref<string | null>(null);

/** Yerel takvim gününü YYYY-MM-DD verir (toISOString UTC'ye kaydırır). */
function localIsoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface TypeDraft {
  name: string;
  einvoice_code: string;
  kdv2_code: string;
  rate_numerator: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
}

function emptyDraft(): TypeDraft {
  return {
    name: '',
    einvoice_code: '',
    kdv2_code: '',
    rate_numerator: 2,
    valid_from: localIsoDate(),
    valid_to: '',
    is_active: true,
  };
}

const CODE_PATTERN = /^\d{3}$/;

/** Sunucu kurallarının istemci karşılığı; ilk ihlali döndürür. */
function validationError(d: TypeDraft): string | null {
  if (!d.name.trim()) return 'Ad zorunlu.';
  if (!CODE_PATTERN.test(d.einvoice_code.trim())) return 'e-Fatura tevkifat kodu 3 haneli olmalı.';
  if (!CODE_PATTERN.test(d.kdv2_code.trim())) return 'KDV-2 kodu 3 haneli olmalı.';
  if (!WITHHOLDING_RATE_NUMERATORS.includes(Number(d.rate_numerator)))
    return 'Oran 2, 3, 4, 5, 7, 9 veya 10 (/10) olmalı.';
  if (d.valid_from && d.valid_to && d.valid_to < d.valid_from)
    return 'Geçerlilik bitişi, başlangıç tarihinden önce olamaz.';
  return null;
}

function toPayload(d: TypeDraft): WithholdingTypeInput {
  return {
    name: d.name.trim(),
    einvoice_code: d.einvoice_code.trim(),
    kdv2_code: d.kdv2_code.trim(),
    rate_numerator: Number(d.rate_numerator),
    valid_from: d.valid_from || undefined,
    valid_to: d.valid_to || null,
    is_active: d.is_active,
  };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('tr-TR');
}

function rateLabel(t: WithholdingType): string {
  return `${t.rate_numerator}/${t.rate_denominator}`;
}

function validityLabel(t: WithholdingType): string {
  return `${formatDate(t.valid_from)} – ${t.valid_to ? formatDate(t.valid_to) : 'süresiz'}`;
}

// --- Yeni tür ---
const draft = reactive<TypeDraft>(emptyDraft());
const creating = ref(false);
const createError = ref<string | null>(null);

async function createType() {
  info.value = null;
  createError.value = validationError(draft);
  if (createError.value) return;
  creating.value = true;
  try {
    await store.createType(toPayload(draft));
    Object.assign(draft, emptyDraft());
    info.value = 'Tevkifat türü eklendi.';
  } catch (err) {
    createError.value = withholdingErrorMessage(err, 'Tevkifat türü eklenemedi.');
  } finally {
    creating.value = false;
  }
}

// --- Satır düzenleme ---
const editingId = ref<string | null>(null);
const editDraft = reactive<TypeDraft>(emptyDraft());
const editError = ref<string | null>(null);
const saving = ref(false);

function startEdit(t: WithholdingType) {
  info.value = null;
  editError.value = null;
  Object.assign(editDraft, {
    name: t.name,
    einvoice_code: t.einvoice_code,
    kdv2_code: t.kdv2_code,
    rate_numerator: t.rate_numerator,
    valid_from: t.valid_from,
    valid_to: t.valid_to ?? '',
    is_active: t.is_active,
  });
  editingId.value = t.id;
}

function cancelEdit() {
  editingId.value = null;
  editError.value = null;
}

async function saveEdit() {
  const id = editingId.value;
  if (!id) return;
  editError.value = validationError(editDraft);
  if (editError.value) return;
  saving.value = true;
  try {
    await store.updateType(id, toPayload(editDraft));
    editingId.value = null;
    info.value = 'Tevkifat türü güncellendi.';
  } catch (err) {
    editError.value = withholdingErrorMessage(err, 'Tevkifat türü güncellenemedi.');
  } finally {
    saving.value = false;
  }
}

onMounted(() => store.fetchTypes());
</script>

<template>
  <div class="wh-types">
    <header v-if="!embedded" class="page-header">
      <div>
        <h1 class="page-title">Tevkifat Türleri</h1>
        <p class="page-sub">KDV tevkifatı kodları ve oranları.</p>
      </div>
    </header>

    <p v-if="info" class="alert" role="status">{{ info }}</p>
    <p v-if="store.error" class="alert alert-error" role="alert">{{ store.error }}</p>

    <p class="wh-note">
      Oran veya kod değiştiğinde mevcut kaydı bitiş tarihiyle kapatın ve yeni geçerlilik tarihiyle
      yeni kayıt açın; kesinleşmiş faturalar etkilenmez.
    </p>

    <section class="card" aria-labelledby="wh-new-title">
      <div class="card-head">
        <h2 id="wh-new-title" class="card-title">Yeni Tevkifat Türü</h2>
      </div>
      <form class="wh-form" @submit.prevent="createType">
        <label class="wh-field wh-field-wide">
          <span>Ad *</span>
          <input v-model="draft.name" class="input" type="text" maxlength="200" required />
        </label>
        <label class="wh-field">
          <span>e-Fatura kodu *</span>
          <input
            v-model="draft.einvoice_code"
            class="input mono"
            type="text"
            inputmode="numeric"
            maxlength="3"
            placeholder="601"
            required
          />
        </label>
        <label class="wh-field">
          <span>KDV-2 kodu *</span>
          <input
            v-model="draft.kdv2_code"
            class="input mono"
            type="text"
            inputmode="numeric"
            maxlength="3"
            placeholder="601"
            required
          />
        </label>
        <label class="wh-field">
          <span>Oran *</span>
          <select v-model.number="draft.rate_numerator" class="select">
            <option v-for="n in WITHHOLDING_RATE_NUMERATORS" :key="n" :value="n">{{ n }}/10</option>
          </select>
        </label>
        <label class="wh-field">
          <span>Geçerlilik başlangıcı</span>
          <input v-model="draft.valid_from" class="input" type="date" />
        </label>
        <label class="wh-field">
          <span>Geçerlilik bitişi</span>
          <input v-model="draft.valid_to" class="input" type="date" />
        </label>
        <label class="wh-check">
          <input v-model="draft.is_active" type="checkbox" />
          <span>Aktif</span>
        </label>
        <div class="wh-actions">
          <p v-if="createError" class="wh-error" role="alert">{{ createError }}</p>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="creating">
            {{ creating ? 'Ekleniyor…' : '＋ Tevkifat Türü Ekle' }}
          </button>
        </div>
      </form>
    </section>

    <section class="card" aria-labelledby="wh-list-title">
      <div class="card-head">
        <h2 id="wh-list-title" class="card-title">Tevkifat Türleri ({{ store.types.length }})</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">e-Fatura Kodu</th>
              <th scope="col">KDV-2 Kodu</th>
              <th scope="col">Ad</th>
              <th scope="col">Oran</th>
              <th scope="col">Geçerlilik</th>
              <th scope="col">Durum</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="t in store.types" :key="t.id">
              <tr v-if="editingId !== t.id">
                <td class="mono">{{ t.einvoice_code }}</td>
                <td class="mono">{{ t.kdv2_code }}</td>
                <td>{{ t.name }}</td>
                <td class="mono">{{ rateLabel(t) }}</td>
                <td>{{ validityLabel(t) }}</td>
                <td>
                  <span class="pill" :class="t.is_active ? 'wh-active' : 'wh-passive'">
                    {{ t.is_active ? 'Aktif' : 'Pasif' }}
                  </span>
                </td>
                <td class="num">
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    :disabled="editingId !== null"
                    @click="startEdit(t)"
                  >
                    Düzenle
                  </button>
                </td>
              </tr>
              <tr v-else class="wh-edit-row">
                <td>
                  <input
                    v-model="editDraft.einvoice_code"
                    class="input mono"
                    type="text"
                    inputmode="numeric"
                    maxlength="3"
                    aria-label="e-Fatura tevkifat kodu"
                  />
                </td>
                <td>
                  <input
                    v-model="editDraft.kdv2_code"
                    class="input mono"
                    type="text"
                    inputmode="numeric"
                    maxlength="3"
                    aria-label="KDV-2 kodu"
                  />
                </td>
                <td>
                  <input
                    v-model="editDraft.name"
                    class="input"
                    type="text"
                    maxlength="200"
                    aria-label="Ad"
                  />
                </td>
                <td>
                  <select
                    v-model.number="editDraft.rate_numerator"
                    class="select"
                    aria-label="Oran"
                  >
                    <option v-for="n in WITHHOLDING_RATE_NUMERATORS" :key="n" :value="n">
                      {{ n }}/10
                    </option>
                  </select>
                </td>
                <td>
                  <div class="wh-dates">
                    <input
                      v-model="editDraft.valid_from"
                      class="input"
                      type="date"
                      aria-label="Geçerlilik başlangıcı"
                    />
                    <input
                      v-model="editDraft.valid_to"
                      class="input"
                      type="date"
                      aria-label="Geçerlilik bitişi (boş: süresiz)"
                    />
                  </div>
                </td>
                <td>
                  <label class="wh-check">
                    <input v-model="editDraft.is_active" type="checkbox" />
                    <span>Aktif</span>
                  </label>
                </td>
                <td class="wh-actions-cell">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="saving"
                    @click="saveEdit"
                  >
                    {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    :disabled="saving"
                    @click="cancelEdit"
                  >
                    Vazgeç
                  </button>
                  <p v-if="editError" class="wh-error" role="alert">{{ editError }}</p>
                </td>
              </tr>
            </template>
            <tr v-if="!store.loading && store.types.length === 0">
              <td colspan="7" class="muted">Henüz tevkifat türü yok. Yukarıdaki formla ekleyin.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wh-types {
  display: grid;
  gap: 14px;
}
.wh-note {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.85rem;
}
.wh-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
  align-items: end;
}
.wh-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #555;
  font-size: 0.8rem;
}
.wh-field-wide {
  grid-column: span 2;
}
.wh-check {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 2.25rem;
  color: #555;
  font-size: 0.85rem;
}
.wh-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.wh-actions .wh-error {
  flex: 1;
}
.wh-error {
  margin: 0;
  color: #b42318;
  font-size: 0.85rem;
}
.wh-edit-row td {
  background: #f8fafc;
  vertical-align: top;
}
.wh-edit-row .input,
.wh-edit-row .select {
  width: 100%;
  min-width: 6rem;
}
.wh-dates {
  display: grid;
  gap: 4px;
}
.wh-actions-cell {
  white-space: nowrap;
}
.wh-actions-cell .btn {
  margin-right: 4px;
}
.wh-actions-cell .wh-error {
  margin-top: 6px;
  white-space: normal;
}
.wh-active {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}
.wh-passive {
  color: #64748b;
}
</style>
