<template>
  <Modal :open="open" title="Cari İçe Aktarma" size="lg" @close="onClose">
    <ol class="mb-4 flex items-center gap-2 text-xs font-medium" aria-label="İçe aktarma adımları">
      <li
        v-for="(label, idx) in steps"
        :key="label"
        class="flex items-center gap-2"
        :aria-current="step === idx + 1 ? 'step' : undefined"
      >
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full border"
          :class="
            step >= idx + 1
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 text-gray-500'
          "
        >
          {{ idx + 1 }}
        </span>
        <span :class="step === idx + 1 ? 'text-blue-700' : 'text-gray-500'">{{ label }}</span>
        <span v-if="idx < steps.length - 1" class="mx-1 text-gray-300" aria-hidden="true">→</span>
      </li>
    </ol>

    <div v-if="error" class="mb-4 rounded bg-red-50 p-3 text-sm text-red-700" role="alert">
      {{ error }}
    </div>

    <div v-if="step === 1">
      <p class="mb-2 text-sm text-gray-600">
        CSV dosyası seçin (UTF-8, en fazla 2 MB, en fazla 1000 satır). Ayırıcı otomatik algılanır.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        :disabled="busy"
        class="w-full rounded border px-3 py-2 text-sm"
        @change="onFile"
      />
      <p v-if="busy" class="mt-2 text-sm text-gray-500">Dosya okunuyor ve önizleme hazırlanıyor…</p>
    </div>

    <div v-if="step === 2 && report">
      <p class="mb-2 text-sm text-gray-600">
        <strong>{{ fileName }}</strong> — {{ report.summary.total }} satır. Her CSV kolonunun hangi
        alana yazılacağını seçin.
      </p>
      <div class="max-h-80 overflow-y-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-gray-500">CSV kolonu</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Hedef alan</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr v-for="header in report.headers" :key="header">
              <td class="px-3 py-2 font-mono text-xs">{{ header }}</td>
              <td class="px-3 py-2">
                <select
                  v-model="mapping[header]"
                  class="w-full rounded border px-2 py-1 text-sm"
                  @change="onMappingChange"
                >
                  <option :value="null">— Eşleştirme yok —</option>
                  <option
                    v-for="field in IMPORT_TARGET_FIELDS"
                    :key="field.value"
                    :value="field.value"
                  >
                    {{ field.label }}
                  </option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="mappingDirty" class="mt-2 text-sm text-amber-700">
        Eşleştirme değişti — önizleme yenilenecek.
      </p>
    </div>

    <div v-if="step === 3 && report">
      <div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <div class="rounded bg-gray-50 p-2">
          <div class="text-gray-500">Toplam</div>
          <div class="font-bold">{{ report.summary.total }}</div>
        </div>
        <div class="rounded bg-green-50 p-2">
          <div class="text-green-700">Geçerli</div>
          <div class="font-bold">{{ report.summary.valid }}</div>
        </div>
        <div class="rounded bg-yellow-50 p-2">
          <div class="text-yellow-700">Mükerrer</div>
          <div class="font-bold">{{ report.summary.duplicates }}</div>
        </div>
        <div class="rounded bg-red-50 p-2">
          <div class="text-red-700">Hatalı</div>
          <div class="font-bold">{{ report.summary.invalid }}</div>
        </div>
        <div class="rounded bg-blue-50 p-2">
          <div class="text-blue-700">Aktarılacak</div>
          <div class="font-bold">{{ report.summary.toImport }}</div>
        </div>
      </div>
      <p class="mb-2 text-xs text-gray-500">{{ limitText }}</p>
      <div class="mb-2 text-xs">
        <label
          >Durum filtresi:
          <select v-model="statusFilter" class="rounded border px-2 py-1">
            <option value="all">Tümü</option>
            <option value="valid">Geçerli</option>
            <option value="invalid">Hatalı</option>
            <option value="duplicate">Mükerrer</option>
          </select>
        </label>
      </div>
      <div class="max-h-80 overflow-y-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Satır</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Kayıt</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Durum</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Açıklama</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr v-for="row in filteredRows.slice(0, 200)" :key="row.line">
              <td class="px-3 py-2">{{ row.line }}</td>
              <td class="px-3 py-2">{{ row.name ?? '—' }}</td>
              <td class="px-3 py-2">
                <span :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
              </td>
              <td class="px-3 py-2 text-xs text-gray-600">{{ rowDescription(row) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="filteredRows.length > 200" class="mt-1 text-xs text-gray-500">
        İlk 200 satır gösteriliyor (toplam {{ filteredRows.length }}).
      </p>
    </div>

    <div v-if="step === 4 && commitResult">
      <div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div class="rounded bg-gray-50 p-2">
          <div class="text-gray-500">Toplam</div>
          <div class="font-bold">{{ commitResult.summary.total }}</div>
        </div>
        <div class="rounded bg-green-50 p-2">
          <div class="text-green-700">Oluşturulan</div>
          <div class="font-bold">{{ commitResult.summary.created }}</div>
        </div>
        <div class="rounded bg-yellow-50 p-2">
          <div class="text-yellow-700">Mükerrer</div>
          <div class="font-bold">{{ commitResult.summary.duplicates }}</div>
        </div>
        <div class="rounded bg-red-50 p-2">
          <div class="text-red-700">Başarısız</div>
          <div class="font-bold">{{ commitResult.summary.failed }}</div>
        </div>
      </div>
      <p class="mb-2 text-xs text-gray-500">{{ limitText }}</p>
      <p v-if="commitResult.summary.failed === 0" class="text-sm text-green-700">
        Tüm satırlar başarıyla aktarıldı.
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="onClose">
        {{ step === 4 ? 'Kapat' : 'Vazgeç' }}
      </button>
      <button
        v-if="step === 2"
        type="button"
        class="btn btn-secondary"
        :disabled="busy"
        @click="step = 1"
      >
        Geri
      </button>
      <button
        v-if="step === 2"
        type="button"
        class="btn btn-secondary"
        :disabled="busy || !mappingDirty"
        @click="refreshPreview"
      >
        {{ busy ? 'Yenileniyor…' : 'Önizlemeyi güncelle' }}
      </button>
      <button
        v-if="step === 2"
        type="button"
        class="btn btn-primary"
        :disabled="busy"
        @click="goReport"
      >
        Raporu gör
      </button>
      <button
        v-if="step === 3"
        type="button"
        class="btn btn-secondary"
        :disabled="busy"
        @click="step = 2"
      >
        Geri
      </button>
      <button
        v-if="step === 3 && report"
        type="button"
        class="btn btn-primary"
        :disabled="busy || report.summary.toImport === 0"
        @click="confirmCommit"
      >
        {{ busy ? 'Aktarılıyor…' : `Onayla ve aktar (${report.summary.toImport})` }}
      </button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Modal } from '@kuleplus/ui';
import {
  useContactStore,
  IMPORT_TARGET_FIELDS,
  type ImportCommitResult,
  type ImportReport,
  type ImportRowReport,
} from '@/stores/contacts';

defineProps<{ open: boolean }>();

const emit = defineEmits<{ (e: 'close'): void; (e: 'imported'): void }>();

const contactStore = useContactStore();

const step = ref(1);
const busy = ref(false);
const error = ref<string | null>(null);
const fileName = ref('');
const csvText = ref('');
const mapping = ref<Record<string, string | null>>({});
const mappingDirty = ref(false);
const report = ref<ImportReport | null>(null);
const commitResult = ref<ImportCommitResult | null>(null);
const statusFilter = ref('all');

const steps = ['Dosya', 'Eşleştirme', 'Önizleme', 'Sonuç'];

const limitInfo = computed(() => report.value?.limit ?? commitResult.value?.limit ?? null);

const limitText = computed(() => {
  const l = limitInfo.value;
  if (!l) return '';
  if (l.limit === null || l.remaining === null)
    return `Aylık kota: sınırsız (bu ay ${l.current} satır)`;
  return `Aylık kota: kalan ${l.remaining} / ${l.limit} (bu ay ${l.current} satır)`;
});

const filteredRows = computed(() => {
  const rows = report.value?.rows ?? [];
  if (statusFilter.value === 'all') return rows;
  return rows.filter((r) => r.status === statusFilter.value);
});

const resultRows = computed(() => commitResult.value?.rows ?? []);

function statusLabel(s: ImportRowReport['status']): string {
  return (
    {
      valid: 'Geçerli',
      invalid: 'Hatalı',
      duplicate: 'Mükerrer',
      created: 'Oluşturuldu',
      failed: 'Başarısız',
    }[s] ?? s
  );
}

function statusClass(s: ImportRowReport['status']): string {
  const base = 'rounded px-2 py-0.5 text-xs font-medium ';
  if (s === 'valid' || s === 'created') return base + 'bg-green-100 text-green-800';
  if (s === 'duplicate') return base + 'bg-yellow-100 text-yellow-800';
  return base + 'bg-red-100 text-red-800';
}

function rowDescription(row: ImportRowReport): string {
  if (row.duplicateOf) return `Mükerrer: ${row.duplicateOf}`;
  return row.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  error.value = null;
  if (file.size > 2_000_000) {
    error.value = 'Dosya 2 MB sınırını aşıyor.';
    input.value = '';
    return;
  }
  busy.value = true;
  try {
    csvText.value = await file.text();
    fileName.value = file.name;
    const result = await contactStore.dryRunImport(csvText.value);
    report.value = result;
    mapping.value = { ...result.suggestedMapping };
    mappingDirty.value = false;
    statusFilter.value = 'all';
    commitResult.value = null;
    step.value = 2;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Dosya okunamadı.';
  } finally {
    busy.value = false;
    if (input) input.value = '';
  }
}

function onMappingChange(): void {
  mappingDirty.value = true;
}

async function refreshPreview(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const result = await contactStore.dryRunImport(csvText.value, { ...mapping.value });
    report.value = result;
    mapping.value = { ...result.mapping };
    mappingDirty.value = false;
    statusFilter.value = 'all';
    step.value = 3;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Önizleme yenilenemedi.';
  } finally {
    busy.value = false;
  }
}

async function goReport(): Promise<void> {
  if (mappingDirty.value) {
    await refreshPreview();
  } else {
    step.value = 3;
  }
}

async function confirmCommit(): Promise<void> {
  if (!report.value) return;
  error.value = null;
  busy.value = true;
  try {
    const result = await contactStore.commitImport(csvText.value, { ...mapping.value });
    commitResult.value = result;
    step.value = 4;
    emit('imported');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Aktarım başarısız.';
  } finally {
    busy.value = false;
  }
}

function reset(): void {
  step.value = 1;
  error.value = null;
  fileName.value = '';
  csvText.value = '';
  mapping.value = {};
  mappingDirty.value = false;
  report.value = null;
  commitResult.value = null;
  statusFilter.value = 'all';
}

function onClose(): void {
  if (busy.value) return;
  reset();
  emit('close');
}
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  transition: all 0.15s ease-in-out;
  border-width: 1px;
  border-style: solid;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background-color: #3b82f6;
  border-color: #3b82f6;
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
  border-color: #2563eb;
}
.btn-secondary {
  background-color: #f3f4f6;
  border-color: #d1d5db;
  color: #111827;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #e5e7eb;
}
</style>
