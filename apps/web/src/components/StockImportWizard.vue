<template>
  <Modal :open="open" :title="cfg.title" size="lg" @close="onClose">
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

    <!-- 1. adım: dosya seçimi + şablon -->
    <div v-if="step === 1">
      <p class="mb-2 text-sm text-gray-600">{{ cfg.hint }}</p>
      <input
        type="file"
        accept=".csv,text/csv"
        :disabled="busy"
        class="w-full rounded border px-3 py-2 text-sm"
        @change="onFile"
      />
      <button
        type="button"
        class="btn btn-ghost mt-3 text-sm"
        :disabled="busy || downloadingTemplate"
        @click="onDownloadTemplate"
      >
        {{ downloadingTemplate ? 'İndiriliyor…' : 'Örnek şablonu indir (CSV)' }}
      </button>
      <p v-if="busy" class="mt-2 text-sm text-gray-500">Dosya okunuyor ve önizleme hazırlanıyor…</p>
    </div>

    <!-- 2. adım: kolon eşleştirme -->
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
                  <option v-for="field in cfg.fields" :key="field.value" :value="field.value">
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

    <!-- 3. adım: dry-run raporu -->
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
        <div class="rounded" :class="warningTotal ? 'bg-amber-50' : 'bg-gray-50'">
          <div :class="warningTotal ? 'text-amber-700' : 'text-gray-500'">Uyarı</div>
          <div class="font-bold">{{ warningTotal }}</div>
        </div>
      </div>
      <p class="mb-2 text-xs text-gray-500">{{ limitText }}</p>
      <div class="mb-2 flex items-center gap-2 text-sm">
        <label>
          Durum filtresi:
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

    <!-- 4. adım: aktarım sonucu -->
    <div v-if="step === 4 && commitResult">
      <div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div class="rounded bg-gray-50 p-2">
          <div class="text-gray-500">Toplam</div>
          <div class="font-bold">{{ commitResult.summary.total }}</div>
        </div>
        <div class="rounded bg-green-50 p-2">
          <div class="text-green-700">{{ cfg.createdLabel }}</div>
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
      <div v-if="failedRows.length" class="max-h-60 overflow-y-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Satır</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Kayıt</th>
              <th class="px-3 py-2 text-left font-medium text-gray-500">Neden</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr v-for="row in failedRows.slice(0, 200)" :key="row.line">
              <td class="px-3 py-2">{{ row.line }}</td>
              <td class="px-3 py-2">{{ row.name ?? '—' }}</td>
              <td class="px-3 py-2 text-xs text-gray-600">{{ rowDescription(row) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
import { computed, ref, watch } from 'vue';
import { Modal, trackEvent } from '@kuleplus/ui';
import {
  useStockStore,
  PRODUCT_IMPORT_TARGET_FIELDS,
  OPENING_STOCK_IMPORT_TARGET_FIELDS,
  type StockImportCommitResult,
  type StockImportReport,
  type StockImportRowReport,
} from '@/stores/stock';

/**
 * Stok tarafı CSV içe aktarma sihirbazı (SPEC §23.1):
 * şablon → dosya → kolon eşleştirme → dry-run raporu → onay → sonuç.
 * `mode` ile ürün listesi veya açılış stoğu akışı seçilir.
 */
const props = defineProps<{ open: boolean; mode: 'products' | 'opening-stock' }>();

const emit = defineEmits<{ (e: 'close'): void; (e: 'imported'): void }>();

const stockStore = useStockStore();

const step = ref(1);
const busy = ref(false);
const downloadingTemplate = ref(false);
const error = ref<string | null>(null);
const fileName = ref('');
const csvText = ref('');
const mapping = ref<Record<string, string | null>>({});
const mappingDirty = ref(false);
const report = ref<StockImportReport | null>(null);
const commitResult = ref<StockImportCommitResult | null>(null);
const statusFilter = ref('all');

const steps = ['Dosya', 'Eşleştirme', 'Önizleme', 'Sonuç'];

interface WizardConfig {
  title: string;
  hint: string;
  createdLabel: string;
  fields: { value: string; label: string }[];
  dryRun: (csv: string, map?: Record<string, string | null>) => Promise<StockImportReport>;
  commit: (csv: string, map?: Record<string, string | null>) => Promise<StockImportCommitResult>;
  downloadTemplate: () => Promise<void>;
  event: string;
}

const configs: Record<'products' | 'opening-stock', WizardConfig> = {
  products: {
    title: 'Ürün İçe Aktarma',
    hint: 'Ürün listesi CSV dosyası seçin (UTF-8, en fazla 2 MB, en fazla 1000 satır). Bilinmeyen birimler otomatik oluşturulur; açılış stoğu temel depoya yazılır.',
    createdLabel: 'Oluşturulan ürün',
    fields: PRODUCT_IMPORT_TARGET_FIELDS,
    dryRun: (csv, map) => stockStore.dryRunProductImport(csv, map),
    commit: (csv, map) => stockStore.commitProductImport(csv, map),
    downloadTemplate: () => stockStore.downloadProductTemplate(),
    event: 'stock_product_import',
  },
  'opening-stock': {
    title: 'Açılış Stoğu İçe Aktarma',
    hint: 'Açılış stoğu CSV dosyası seçin (UTF-8, en fazla 2 MB, en fazla 1000 satır). Ürün ve depo önceden var olmalı; her satır açılış hareketi olarak yazılır.',
    createdLabel: 'Açılış hareketi',
    fields: OPENING_STOCK_IMPORT_TARGET_FIELDS,
    dryRun: (csv, map) => stockStore.dryRunOpeningStockImport(csv, map),
    commit: (csv, map) => stockStore.commitOpeningStockImport(csv, map),
    downloadTemplate: () => stockStore.downloadOpeningStockTemplate(),
    event: 'stock_opening_import',
  },
};

const cfg = computed(() => configs[props.mode]);

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

const failedRows = computed(() =>
  (commitResult.value?.rows ?? []).filter((r) => r.status === 'failed' || r.status === 'invalid'),
);

const warningTotal = computed(() =>
  (report.value?.rows ?? []).reduce((sum, r) => sum + (r.warnings?.length ?? 0), 0),
);

function statusLabel(s: StockImportRowReport['status']): string {
  return (
    {
      valid: 'Geçerli',
      invalid: 'Hatalı',
      duplicate: 'Mükerrer',
      created: 'Aktarıldı',
      failed: 'Başarısız',
    }[s] ?? s
  );
}

function statusClass(s: StockImportRowReport['status']): string {
  const base = 'rounded px-2 py-0.5 text-xs font-medium ';
  if (s === 'valid' || s === 'created') return base + 'bg-green-100 text-green-800';
  if (s === 'duplicate') return base + 'bg-yellow-100 text-yellow-800';
  return base + 'bg-red-100 text-red-800';
}

function rowDescription(row: StockImportRowReport): string {
  const parts: string[] = [];
  if (row.duplicateOf) parts.push(`Mükerrer: ${row.duplicateOf}`);
  parts.push(...row.issues.map((i) => `${i.field}: ${i.message}`));
  parts.push(...(row.warnings ?? []).map((w) => `Uyarı — ${w.field}: ${w.message}`));
  return parts.join(' · ');
}

async function onDownloadTemplate(): Promise<void> {
  error.value = null;
  downloadingTemplate.value = true;
  try {
    await cfg.value.downloadTemplate();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Şablon indirilemedi.';
  } finally {
    downloadingTemplate.value = false;
  }
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
    const result = await cfg.value.dryRun(csvText.value);
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
    const result = await cfg.value.dryRun(csvText.value, { ...mapping.value });
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
    const result = await cfg.value.commit(csvText.value, { ...mapping.value });
    commitResult.value = result;
    step.value = 4;
    trackEvent(cfg.value.event, {
      props: {
        created: result.summary.created,
        duplicates: result.summary.duplicates,
        failed: result.summary.failed,
      },
    });
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

// Farklı moda geçildiğinde yarım kalmış akış temizlenir
watch(
  () => [props.open, props.mode],
  ([open]) => {
    if (!open) reset();
  },
);

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
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: #2563eb;
}
.btn-ghost:hover:not(:disabled) {
  text-decoration: underline;
}
</style>
