<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue';
import { trackEvent } from '@kuleplus/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useContactStore } from '@/stores/contacts';
import { useStockStore } from '@/stores/stock';
import { useInvoiceStore } from '@/stores/invoices';
import { useBackupStore, type BackupJob } from '@/stores/backup';
import { useManagementStore, type TrafficStatus } from '@/stores/management';

const auth = useAuthStore();
const contactStore = useContactStore();
const stockStore = useStockStore();
const invoiceStore = useInvoiceStore();
const backup = useBackupStore();
const managementStore = useManagementStore();

onMounted(() => {
  contactStore.fetchContacts();
  stockStore.fetchStock();
  invoiceStore.fetchInvoices();
  backup.startTimers();
  void backup.fetchStatus();
  void backup.fetchList();
  void managementStore.fetchDashboard();
});

onUnmounted(() => {
  backup.stopTimers();
});

const company = computed(() => auth.company);

// KPI'lar store'lardan gerçek veriyle türetilir.
const customerCount = computed(
  () => contactStore.contacts.filter((c) => c.type === 'customer').length,
);
const supplierCount = computed(
  () => contactStore.contacts.filter((c) => c.type === 'supplier').length,
);
const productCount = computed(() => stockStore.stock.length);
const invoiceCount = computed(() => invoiceStore.invoices.length);
const loading = computed(() => contactStore.loading || stockStore.loading || invoiceStore.loading);

// Patron Görünümü v3 — kural bazlı trafik ışığı göstergeleri (SPEC §26).
const dashboard = computed(() => managementStore.dashboard);
const overallLabel = computed(() => {
  const s = dashboard.value?.overall;
  if (s === 'red') return 'Acil müdahale gerekiyor';
  if (s === 'amber') return 'Dikkat gerektiren konular var';
  return 'Her şey yolunda';
});
const statusText: Record<TrafficStatus, string> = {
  green: 'İyi',
  amber: 'Dikkat',
  red: 'Kritik',
};
function formatTry(amount?: number): string {
  if (amount === undefined) return '';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount);
}

// Hızlı erişim kartları
const shortcuts = [
  { to: '/contacts', label: 'Cari Hesaplar', hint: 'Müşteri ve tedarikçi kartları' },
  { to: '/invoices', label: 'Faturalar', hint: 'Satış ve alış faturaları' },
  { to: '/stock', label: 'Stok', hint: 'Ürün kartları ve miktarlar' },
  { to: '/expenses', label: 'Giderler', hint: 'Gider kayıtları' },
  { to: '/cash-bank', label: 'Kasa & Banka', hint: 'Nakit ve banka hareketleri' },
  { to: '/reports', label: 'Raporlar', hint: 'Finansal raporlar' },
];

/**
 * Onboarding kontrol listesi — Faz 2 "Ortak" iş listesi + aktivasyon ölçümü.
 * Adımlar gerçek veriden hesaplanır; sunucuda ayrıca bir durum tablosu tutulmaz.
 */
const onboardingSteps = computed(() => [
  {
    key: 'contact',
    label: 'İlk cari kartını oluştur',
    hint: 'Müşteri veya tedarikçi ekle',
    to: '/contacts/new',
    done: contactStore.contacts.length > 0,
  },
  {
    key: 'product',
    label: 'İlk ürününü ekle',
    hint: 'Ürün kartı ve açılış stoğu tanımla',
    to: '/stock',
    done: stockStore.stock.length > 0,
  },
  {
    key: 'invoice',
    label: 'İlk faturanı kes',
    hint: 'Satış faturası oluştur',
    to: '/invoices',
    done: invoiceStore.invoices.length > 0,
  },
  {
    key: 'backup',
    label: 'Otomatik yedeği aç',
    hint: 'Verilerin düzenli yedeklensin',
    to: '#yedekleme',
    done: backup.settings?.enabled === true,
  },
]);
const onboardingDoneCount = computed(() => onboardingSteps.value.filter((s) => s.done).length);
const onboardingFinished = computed(
  () => onboardingDoneCount.value === onboardingSteps.value.length,
);

/** Tam veri dışa aktarması (SPEC §23.2) — yönetici izni ister, 403'te sessiz kalır. */
const exporting = ref(false);
const exportError = ref<string | null>(null);

async function downloadFullExport() {
  exporting.value = true;
  exportError.value = null;
  try {
    const res = await api.get('/v1/core/exports/full', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kuleplus-veri-aktarimi-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    trackEvent('data_export_full');
  } catch {
    exportError.value = 'Dışa aktarma tamamlanamadı. Bu işlem için şirket ayarı izni gerekir.';
  } finally {
    exporting.value = false;
  }
}

// Aktivasyon ölçümü — ilk tamamlanan adım sonrası tek olay (docs/product/seo-analytics.md)
watch(
  onboardingFinished,
  (finished) => {
    if (finished) trackEvent('onboarding_completed');
  },
  { once: false },
);

// === Yedekleme paneli ===
const intervalOptions = [
  { value: 5, label: '5 dakika' },
  { value: 10, label: '10 dakika' },
  { value: 15, label: '15 dakika' },
  { value: 30, label: '30 dakika' },
  { value: 60, label: 'Saatte bir' },
  { value: 180, label: '3 saatte bir' },
  { value: 720, label: '12 saatte bir' },
  { value: 1440, label: 'Günde bir' },
];

const statusTitle = computed(() => {
  if (backup.hasRunning) return 'Yedekleniyor…';
  if (!backup.settings?.enabled) return 'Otomatik yedekleme kapalı';
  return 'Sonraki yedek';
});

const statusCaption = computed(() => {
  if (backup.hasRunning) return 'Veritabanınız yedekleniyor; tamamlanınca listede göreceksiniz.';
  if (!backup.settings?.enabled) return 'Ayarlardan otomatik yedeklemeyi açabilirsiniz.';
  if (backup.settings.lastStatus === 'failed') {
    return `Son yedek başarısız: ${backup.settings.lastError || 'bilinmeyen hata'}`;
  }
  return `Son yedek: ${backup.lastBackupLabel}`;
});

const statusDotClass = computed(() => {
  if (backup.hasRunning) return 'running';
  if (backup.settings?.lastStatus === 'failed') return 'danger';
  return 'ok';
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function jobBadgeLabel(job: BackupJob): string {
  if (job.status === 'running') return 'Yedekleniyor…';
  if (job.status === 'success') return 'Başarılı';
  return 'Hata';
}

function jobBadgeClass(job: BackupJob): string {
  if (job.status === 'running') return 'badge-warning';
  if (job.status === 'success') return 'badge-success';
  return 'badge-danger';
}

async function onRunNow(): Promise<void> {
  try {
    await backup.runNow();
    void backup.fetchStatus();
  } catch {
    // Hata store'da error olarak gösterilir.
  }
}

async function onToggleEnabled(event: Event): Promise<void> {
  try {
    await backup.updateSettings({ enabled: (event.target as HTMLInputElement).checked });
  } catch {
    // Hata store'da error olarak gösterilir.
  }
}

async function onIntervalChange(event: Event): Promise<void> {
  try {
    await backup.updateSettings({
      intervalMinutes: Number((event.target as HTMLSelectElement).value),
    });
  } catch {
    // Hata store'da error olarak gösterilir.
  }
}

async function onRetentionChange(event: Event): Promise<void> {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 1) return;
  try {
    await backup.updateSettings({ retentionCount: Math.min(100, Math.trunc(value)) });
  } catch {
    // Hata store'da error olarak gösterilir.
  }
}

async function onRemove(job: BackupJob): Promise<void> {
  if (!window.confirm('Bu yedeği silmek istediğinize emin misiniz?')) return;
  try {
    await backup.remove(job.id);
  } catch {
    // Hata store'da error olarak gösterilir.
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Panel</h1>
        <p v-if="company" class="welcome">
          Hoş geldin, <strong>{{ company.name }}</strong>
        </p>
      </div>
    </header>

    <div v-if="loading" class="state-msg">Yükleniyor…</div>

    <template v-else>
      <!-- KPI kutuları -->
      <div class="kpi-grid">
        <div class="card kpi">
          <span class="kpi-label">Müşteri</span>
          <span class="kpi-value">{{ customerCount }}</span>
        </div>
        <div class="card kpi">
          <span class="kpi-label">Tedarikçi</span>
          <span class="kpi-value">{{ supplierCount }}</span>
        </div>
        <div class="card kpi">
          <span class="kpi-label">Ürün</span>
          <span class="kpi-value">{{ productCount }}</span>
        </div>
        <div class="card kpi">
          <span class="kpi-label">Fatura</span>
          <span class="kpi-value">{{ invoiceCount }}</span>
        </div>
      </div>

      <!-- Patron Görünümü v3 — trafik ışığı göstergeleri (SPEC §26) -->
      <section v-if="dashboard" class="section-block" aria-labelledby="durum-gostergeleri">
        <div class="checklist-head">
          <h2 id="durum-gostergeleri">Durum göstergeleri</h2>
          <span class="overall-badge" :class="`tl-${dashboard.overall}`">{{ overallLabel }}</span>
        </div>
        <div class="traffic-grid">
          <RouterLink
            v-for="ind in dashboard.indicators"
            :key="ind.key"
            :to="ind.link"
            class="card traffic-card"
            :class="`tl-${ind.status}`"
          >
            <div class="traffic-head">
              <span class="traffic-dot" :class="`tl-${ind.status}`" aria-hidden="true"></span>
              <span class="traffic-status">{{ statusText[ind.status] }}</span>
            </div>
            <span class="traffic-label">{{ ind.label }}</span>
            <span v-if="ind.amount !== undefined && ind.amount > 0" class="traffic-value">
              {{ formatTry(ind.amount) }}
            </span>
            <span v-else-if="ind.count !== undefined && ind.count > 0" class="traffic-value">
              {{ ind.count }}
            </span>
            <span class="traffic-hint">{{ ind.hint }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- Onboarding kontrol listesi (Faz 2 — aktivasyon ölçümü) -->
      <section v-if="!onboardingFinished" class="section-block" aria-labelledby="kurulum">
        <div class="checklist-head">
          <h2 id="kurulum">Kurulum adımları</h2>
          <span class="checklist-progress"
            >{{ onboardingDoneCount }}/{{ onboardingSteps.length }} tamam</span
          >
        </div>
        <ol class="checklist">
          <li v-for="step in onboardingSteps" :key="step.key" :class="{ done: step.done }">
            <RouterLink :to="step.to" class="checklist-link">
              <span class="checklist-box" aria-hidden="true">{{ step.done ? '✓' : '' }}</span>
              <span class="checklist-text">
                <span class="checklist-label">{{ step.label }}</span>
                <span class="checklist-hint">{{ step.hint }}</span>
              </span>
            </RouterLink>
          </li>
        </ol>
      </section>

      <!-- Veri taşınabilirliği (SPEC §23.2) -->
      <section class="section-block" aria-labelledby="veri-aktarim">
        <div class="backup-head">
          <div>
            <h2 id="veri-aktarim">Verilerimi dışa aktar</h2>
            <p class="backup-subtitle">
              Cari, stok, fatura ve kasa/banka kayıtlarının tamamını tek ZIP arşivi olarak indirin
              (CSV + manifest + README).
            </p>
          </div>
          <button class="btn btn-secondary" :disabled="exporting" @click="downloadFullExport">
            {{ exporting ? 'Hazırlanıyor…' : 'ZIP olarak indir' }}
          </button>
        </div>
        <p v-if="exportError" class="export-error" role="alert">{{ exportError }}</p>
      </section>

      <!-- Hızlı erişim -->
      <section class="section-block" aria-labelledby="kisayollar">
        <h2 id="kisayollar">Hızlı erişim</h2>
        <div class="shortcut-grid">
          <RouterLink v-for="s in shortcuts" :key="s.to" :to="s.to" class="card shortcut">
            <span class="shortcut-label">{{ s.label }}</span>
            <span class="shortcut-hint">{{ s.hint }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- Yedekleme paneli -->
      <section class="section-block backup-panel" aria-labelledby="yedekleme">
        <div class="backup-head">
          <div>
            <h2 id="yedekleme">Yedekleme</h2>
            <p class="backup-subtitle">
              Veritabanınız seçtiğiniz sıklıkta otomatik yedeklenir; yedekleri indirebilir veya
              silebilirsiniz.
            </p>
          </div>
          <button
            class="btn btn-primary"
            :disabled="backup.running || backup.hasRunning"
            @click="onRunNow"
          >
            {{ backup.running ? 'Başlatılıyor…' : 'Şimdi Yedekle' }}
          </button>
        </div>

        <div v-if="backup.error" class="alert alert-error">{{ backup.error }}</div>
        <div v-if="backup.notice" class="alert alert-success">{{ backup.notice }}</div>

        <!-- Durum + geri sayım -->
        <div class="card backup-status-card">
          <div class="backup-status-row">
            <span class="status-dot" :class="statusDotClass" aria-hidden="true"></span>
            <div class="backup-status-text">
              <strong>{{ statusTitle }}</strong>
              <span>{{ statusCaption }}</span>
            </div>
            <span class="backup-countdown" v-if="backup.settings?.enabled && !backup.hasRunning">
              {{ backup.countdownLabel }}
            </span>
            <span class="backup-countdown running-text" v-else-if="backup.hasRunning">
              {{ backup.countdownLabel }}
            </span>
          </div>
          <div
            v-if="backup.settings?.enabled && !backup.hasRunning"
            class="backup-progress"
            role="progressbar"
            aria-label="Bir sonraki yedeğe kalan süre"
            :aria-valuenow="backup.progressPercent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="backup-progress-fill"
              :style="{ width: backup.progressPercent + '%' }"
            ></div>
          </div>
          <div v-else-if="backup.hasRunning" class="backup-progress">
            <div class="backup-progress-fill running-pulse"></div>
          </div>
        </div>

        <!-- Ayarlar -->
        <div class="card backup-settings-card">
          <h3 class="card-title">Yedek ayarları</h3>
          <div class="backup-settings-grid">
            <label class="switch-row">
              <input
                type="checkbox"
                class="switch"
                :checked="backup.settings?.enabled ?? false"
                @change="onToggleEnabled"
              />
              <span>Otomatik yedekleme açık</span>
            </label>

            <label class="field">
              <span class="field-label">Yedek sıklığı</span>
              <select
                class="select"
                :value="backup.settings?.intervalMinutes ?? 15"
                :disabled="backup.saving"
                @change="onIntervalChange"
              >
                <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">Saklanacak yedek sayısı</span>
              <input
                class="input"
                type="number"
                min="1"
                max="100"
                :value="backup.settings?.retentionCount ?? 20"
                :disabled="backup.saving"
                @change="onRetentionChange"
              />
            </label>
          </div>
        </div>

        <!-- Geçmiş -->
        <div class="card backup-history-card">
          <div class="backup-history-head">
            <h3 class="card-title">Yedek geçmişi</h3>
            <span class="badge badge-neutral">{{ backup.total }} kayıt</span>
          </div>
          <div v-if="backup.items.length === 0" class="state-msg">
            Henüz yedek yok — ilk yedeğinizi hemen alabilirsiniz.
          </div>
          <div v-else class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Durum</th>
                  <th>Boyut</th>
                  <th class="num">İşlem</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="job in backup.items" :key="job.id">
                  <td>{{ formatDateTime(job.started_at) }}</td>
                  <td>
                    <span class="badge" :class="jobBadgeClass(job)">
                      {{ jobBadgeLabel(job) }}
                    </span>
                  </td>
                  <td>{{ job.size_bytes ? formatBytes(job.size_bytes) : '—' }}</td>
                  <td class="num backup-actions">
                    <button
                      class="btn btn-sm btn-ghost"
                      :disabled="job.status === 'running'"
                      @click="backup.download(job.id, job.file_name || undefined)"
                    >
                      İndir
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      :disabled="job.status === 'running'"
                      @click="onRemove(job)"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.welcome {
  margin: 0.25rem 0 0;
  color: var(--c-muted);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kpi-label {
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.kpi-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}

.section-block {
  margin-top: 1rem;
}
.section-block h2 {
  font-size: 1.125rem;
  margin: 0 0 1rem;
}
.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 1rem;
}
.shortcut {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.shortcut:hover {
  border-color: var(--c-primary);
  box-shadow: 0 1px 3px rgb(15 23 42 / 0.08);
}
.shortcut-label {
  font-weight: 600;
}
.shortcut-hint {
  font-size: 0.875rem;
  color: var(--c-muted);
}

/* === Yedekleme paneli === */
.backup-panel {
  margin-top: 2.5rem;
}
.backup-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.backup-head h2 {
  margin: 0;
  font-size: 1.125rem;
}
.backup-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--c-muted);
}

.backup-status-card,
.backup-settings-card,
.backup-history-card {
  margin-bottom: 1rem;
}

.backup-status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.status-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--c-muted);
  flex-shrink: 0;
}
.status-dot.ok {
  background: var(--c-success, #16a34a);
}
.status-dot.danger {
  background: var(--c-danger, #dc2626);
}
.status-dot.running {
  background: var(--c-warning, #d97706);
  animation: status-blink 1s ease-in-out infinite;
}
@keyframes status-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.backup-status-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.backup-status-text strong {
  font-size: 0.9375rem;
}
.backup-status-text span {
  font-size: 0.8125rem;
  color: var(--c-muted);
}
.backup-countdown {
  font-size: 1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--c-primary);
  white-space: nowrap;
}
.backup-countdown.running-text {
  color: var(--c-warning, #d97706);
}

.backup-progress {
  margin-top: 0.875rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--c-bg);
  overflow: hidden;
}
.backup-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--c-primary);
  transition: width 1s linear;
}
.backup-progress-fill.running-pulse {
  width: 45%;
  background: linear-gradient(90deg, var(--c-primary), #60a5fa, var(--c-primary));
  background-size: 200% 100%;
  animation: progress-slide 1.4s linear infinite;
}
@keyframes progress-slide {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.backup-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 1rem;
  align-items: end;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-size: 0.9375rem;
  cursor: pointer;
}
.switch {
  appearance: none;
  width: 2.5rem;
  height: 1.375rem;
  border-radius: 999px;
  background: var(--c-border);
  position: relative;
  transition: background 0.15s ease;
  cursor: pointer;
  flex-shrink: 0;
}
.switch:checked {
  background: var(--c-primary);
}
.switch::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.15s ease;
}
.switch:checked::after {
  transform: translateX(1.125rem);
}
.switch:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.field-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--c-muted);
}

.backup-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.backup-history-head .card-title {
  margin: 0;
}
.backup-actions {
  white-space: nowrap;
}
.backup-actions .btn {
  margin-left: 0.375rem;
}
/* === Onboarding kontrol listesi === */
.checklist-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
.checklist-progress {
  color: var(--c-muted, #64748b);
  font-size: 0.8125rem;
  font-weight: 600;
}
.checklist {
  display: grid;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}
.checklist-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.625rem;
  background: var(--c-surface, #fff);
  text-decoration: none;
  color: inherit;
}
.checklist-link:hover {
  border-color: var(--c-primary, #1d4ed8);
}
.checklist-link:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
}
.checklist-box {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  border: 1px solid var(--c-border, #cbd5e1);
  border-radius: 0.3125rem;
  background: #fff;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
}
.checklist li.done .checklist-box {
  border-color: var(--c-primary, #1d4ed8);
  background: var(--c-primary, #1d4ed8);
}
.checklist li.done .checklist-label {
  color: var(--c-muted, #64748b);
  text-decoration: line-through;
}
.checklist-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.checklist-label {
  font-size: 0.9375rem;
  font-weight: 600;
}
.checklist-hint {
  color: var(--c-muted, #64748b);
  font-size: 0.8125rem;
}
.export-error {
  margin: 0.75rem 0 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.875rem;
}

/* === Patron Görünümü v3 — trafik ışığı kartları === */
.overall-badge {
  padding: 0.1875rem 0.625rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.traffic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 1rem;
  margin-top: 0.75rem;
}
.traffic-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-decoration: none;
  color: inherit;
  border-left: 4px solid var(--c-border);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.traffic-card:hover {
  box-shadow: 0 1px 3px rgb(15 23 42 / 0.08);
}
.traffic-card.tl-green {
  border-left-color: #16a34a;
}
.traffic-card.tl-amber {
  border-left-color: #d97706;
}
.traffic-card.tl-red {
  border-left-color: #dc2626;
}
.traffic-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.traffic-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  flex: none;
}
.traffic-dot.tl-green {
  background: #16a34a;
}
.traffic-dot.tl-amber {
  background: #d97706;
}
.traffic-dot.tl-red {
  background: #dc2626;
}
.traffic-status {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--c-muted);
}
.traffic-label {
  font-weight: 600;
}
.traffic-value {
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--c-text);
}
.traffic-hint {
  font-size: 0.8125rem;
  color: var(--c-muted);
}
.overall-badge.tl-green {
  background: #dcfce7;
  color: #166534;
}
.overall-badge.tl-amber {
  background: #fef3c7;
  color: #92400e;
}
.overall-badge.tl-red {
  background: #fee2e2;
  color: #991b1b;
}
</style>
