<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/lib/api';

type GroupId = 'company' | 'finance' | 'reports' | 'management';
type Tab = { id: string; label: string; kind: 'company' | 'preferences' | 'expense-categories' | 'notifications' | 'rules' };

const groups: { id: GroupId; label: string; description: string; tabs: Tab[] }[] = [
  {
    id: 'company',
    label: 'Firma',
    description: 'Şirket bilgileri ve dönem tercihleri',
    tabs: [{ id: 'profile', label: 'Firma bilgileri', kind: 'company' }],
  },
  {
    id: 'finance',
    label: 'Finans',
    description: 'Belge ve finans varsayılanları',
    tabs: [
      { id: 'invoices', label: 'Fatura', kind: 'preferences' },
      { id: 'cheques', label: 'Çek / Senet', kind: 'preferences' },
      { id: 'expenses', label: 'Gider kategorileri', kind: 'expense-categories' },
    ],
  },
  {
    id: 'reports',
    label: 'Raporlar',
    description: 'Rapor görünümü ve dışa aktarma',
    tabs: [{ id: 'defaults', label: 'Varsayılanlar', kind: 'preferences' }],
  },
  {
    id: 'management',
    label: 'Yönetim',
    description: 'Bildirimler ve iş kuralları',
    tabs: [
      { id: 'notifications', label: 'Bildirimler', kind: 'notifications' },
      { id: 'rules', label: 'İş kuralları', kind: 'rules' },
    ],
  },
];

const ExpenseCategoriesView = defineAsyncComponent(
  () => import('@/views/ExpenseCategoriesView.vue'),
);
const ManagementPreferencesView = defineAsyncComponent(
  () => import('@/views/ManagementPreferencesView.vue'),
);
const ManagementRulesView = defineAsyncComponent(() => import('@/views/ManagementRulesView.vue'));

const route = useRoute();
const router = useRouter();
const groupId = computed<GroupId>(() => {
  const id = String(route.query.group ?? 'company');
  return groups.some((group) => group.id === id) ? (id as GroupId) : 'company';
});
const activeGroup = computed(() => groups.find((group) => group.id === groupId.value)!);
const tabId = computed(() => {
  const id = String(route.query.tab ?? activeGroup.value.tabs[0].id);
  return activeGroup.value.tabs.some((tab) => tab.id === id) ? id : activeGroup.value.tabs[0].id;
});
const activeTab = computed(() => activeGroup.value.tabs.find((tab) => tab.id === tabId.value)!);

function selectGroup(id: GroupId) {
  const group = groups.find((item) => item.id === id)!;
  void router.replace({ name: 'settings', query: { group: id, tab: group.tabs[0].id } });
}

function selectTab(id: string) {
  void router.replace({ name: 'settings', query: { group: groupId.value, tab: id } });
}

const loading = ref(true);
const saving = ref(false);
const errorMessage = ref('');
const savedMessage = ref('');
watch([groupId, tabId], () => {
  savedMessage.value = '';
  errorMessage.value = '';
});
const profile = ref<Record<string, any> | null>(null);
const companyDraft = reactive({
  name: '',
  tradeName: '',
  taxOffice: '',
  taxNumber: '',
  currency: 'TRY',
  fiscalYearStart: 1,
  timezone: 'Europe/Istanbul',
});
const preferenceDraft = reactive({
  invoiceSeries: 'FAT',
  invoiceDueDays: 30,
  invoiceVatRate: 20,
  chequeMaturityDays: 30,
  chequeReminderDays: 3,
  reportPeriod: 'month',
  reportComparePrevious: true,
  reportExportFormat: 'xlsx',
});

function objectValue(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function syncDrafts(data: Record<string, any>) {
  const tenant = data.tenant ?? {};
  companyDraft.name = tenant.name ?? '';
  companyDraft.tradeName = tenant.trade_name ?? '';
  companyDraft.taxOffice = tenant.tax_office ?? '';
  companyDraft.taxNumber = tenant.tax_number ?? '';
  companyDraft.currency = tenant.currency ?? 'TRY';
  companyDraft.fiscalYearStart = tenant.fiscal_year_start ?? 1;
  companyDraft.timezone = tenant.timezone ?? 'Europe/Istanbul';

  const settings = objectValue(data.settings?.settings);
  const invoice = objectValue(objectValue(settings.finance).invoice);
  const cheque = objectValue(objectValue(settings.finance).cheque);
  const reports = objectValue(settings.reports);
  preferenceDraft.invoiceSeries = invoice.series ?? 'FAT';
  preferenceDraft.invoiceDueDays = invoice.dueDays ?? 30;
  preferenceDraft.invoiceVatRate = invoice.defaultVatRate ?? 20;
  preferenceDraft.chequeMaturityDays = cheque.defaultMaturityDays ?? 30;
  preferenceDraft.chequeReminderDays = cheque.reminderDaysBeforeDue ?? 3;
  preferenceDraft.reportPeriod = reports.defaultPeriod ?? 'month';
  preferenceDraft.reportComparePrevious = reports.comparePrevious ?? true;
  preferenceDraft.reportExportFormat = reports.exportFormat ?? 'xlsx';
}

async function loadSettings() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await api.get('/v1/company/settings');
    profile.value = response.data;
    syncDrafts(response.data);
  } catch {
    errorMessage.value = 'Ayarlar yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.';
  } finally {
    loading.value = false;
  }
}

onMounted(loadSettings);

async function saveCompany() {
  saving.value = true;
  errorMessage.value = '';
  savedMessage.value = '';
  try {
    const response = await api.patch('/v1/company/settings', {
      name: companyDraft.name.trim(),
      tradeName: companyDraft.tradeName.trim() || null,
      taxOffice: companyDraft.taxOffice.trim() || null,
      taxNumber: companyDraft.taxNumber.trim() || null,
      currency: companyDraft.currency,
      fiscalYearStart: Number(companyDraft.fiscalYearStart),
      timezone: companyDraft.timezone.trim(),
    });
    if (profile.value) profile.value.tenant = response.data;
    savedMessage.value = 'Firma bilgileri kaydedildi.';
  } catch {
    errorMessage.value = 'Firma bilgileri kaydedilemedi.';
  } finally {
    saving.value = false;
  }
}

async function savePreferences() {
  saving.value = true;
  errorMessage.value = '';
  savedMessage.value = '';
  const stored = objectValue(profile.value?.settings?.settings);
  const finance = objectValue(stored.finance);
  const reports = objectValue(stored.reports);
  const nextSettings = { ...stored };

  if (groupId.value === 'finance' && tabId.value === 'invoices') {
    nextSettings.finance = {
      ...finance,
      invoice: {
        ...objectValue(finance.invoice),
        series: preferenceDraft.invoiceSeries.trim().toUpperCase(),
        dueDays: Number(preferenceDraft.invoiceDueDays),
        defaultVatRate: Number(preferenceDraft.invoiceVatRate),
      },
    };
  } else if (groupId.value === 'finance' && tabId.value === 'cheques') {
    nextSettings.finance = {
      ...finance,
      cheque: {
        ...objectValue(finance.cheque),
        defaultMaturityDays: Number(preferenceDraft.chequeMaturityDays),
        reminderDaysBeforeDue: Number(preferenceDraft.chequeReminderDays),
      },
    };
  } else {
    nextSettings.reports = {
      ...reports,
      defaultPeriod: preferenceDraft.reportPeriod,
      comparePrevious: preferenceDraft.reportComparePrevious,
      exportFormat: preferenceDraft.reportExportFormat,
    };
  }

  try {
    const response = await api.patch('/v1/company/settings', { settings: nextSettings });
    if (profile.value) profile.value.settings = { ...profile.value.settings, settings: nextSettings };
    else profile.value = response.data;
    savedMessage.value = 'Ayarlar kaydedildi.';
  } catch {
    errorMessage.value = 'Ayarlar kaydedilemedi.';
  } finally {
    saving.value = false;
  }
}

const embeddedView = computed(() => {
  if (activeTab.value.kind === 'expense-categories') return ExpenseCategoriesView;
  if (activeTab.value.kind === 'notifications') return ManagementPreferencesView;
  if (activeTab.value.kind === 'rules') return ManagementRulesView;
  return null;
});
</script>

<template>
  <div class="settings-page">
    <header class="settings-heading">
      <div>
        <p class="settings-eyebrow">ÇALIŞMA ALANI</p>
        <h1 class="page-title">Ayarlar</h1>
        <p class="page-sub">Firma, finans ve yönetim tercihlerini tek yerden düzenleyin.</p>
      </div>
      <span class="settings-context">{{ activeGroup.description }}</span>
    </header>

    <nav class="settings-groups" aria-label="Ayar bölümleri" role="tablist">
      <button
        v-for="group in groups"
        :key="group.id"
        class="settings-group-tab"
        :class="{ active: group.id === groupId }"
        type="button"
        role="tab"
        :aria-selected="group.id === groupId"
        @click="selectGroup(group.id)"
      >
        {{ group.label }}
      </button>
    </nav>

    <div class="settings-workspace">
      <nav class="settings-subtabs" aria-label="Alt ayarlar" role="tablist">
        <button
          v-for="tab in activeGroup.tabs"
          :key="tab.id"
          class="settings-subtab"
          :class="{ active: tab.id === tabId }"
          type="button"
          role="tab"
          :aria-selected="tab.id === tabId"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <section class="settings-content" :aria-label="`${activeGroup.label} ayarları: ${activeTab.label}`">
        <p v-if="loading" class="state-msg">Ayarlar yükleniyor…</p>
        <p v-else-if="errorMessage && !profile" class="alert alert-error" role="alert">
          {{ errorMessage }}
          <button class="btn btn-secondary btn-sm" type="button" @click="loadSettings">Yeniden dene</button>
        </p>
        <component v-else-if="embeddedView" :is="embeddedView" embedded />

        <template v-else-if="activeTab.kind === 'company'">
          <div class="settings-section-heading">
            <div>
              <h2>Firma bilgileri</h2>
              <p>Fatura ve raporlarda kullanılan temel şirket bilgileri.</p>
            </div>
            <span class="settings-section-mark">01</span>
          </div>
          <form class="settings-form" @submit.prevent="saveCompany">
            <label class="settings-field wide">
              <span>Firma unvanı</span>
              <input v-model="companyDraft.name" class="input" required maxlength="200" />
            </label>
            <label class="settings-field wide">
              <span>Ticari unvan</span>
              <input v-model="companyDraft.tradeName" class="input" maxlength="200" />
            </label>
            <label class="settings-field">
              <span>Vergi dairesi</span>
              <input v-model="companyDraft.taxOffice" class="input" maxlength="100" />
            </label>
            <label class="settings-field">
              <span>Vergi numarası / TCKN</span>
              <input v-model="companyDraft.taxNumber" class="input" maxlength="20" />
            </label>
            <label class="settings-field">
              <span>Para birimi</span>
              <select v-model="companyDraft.currency" class="select">
                <option value="TRY">TRY · Türk lirası</option>
                <option value="EUR">EUR · Euro</option>
                <option value="USD">USD · ABD doları</option>
              </select>
            </label>
            <label class="settings-field">
              <span>Mali yıl başlangıcı</span>
              <select v-model.number="companyDraft.fiscalYearStart" class="select">
                <option v-for="month in 12" :key="month" :value="month">
                  {{ new Date(2026, month - 1).toLocaleString('tr-TR', { month: 'long' }) }}
                </option>
              </select>
            </label>
            <label class="settings-field wide">
              <span>Saat dilimi</span>
              <input v-model="companyDraft.timezone" class="input" required />
            </label>
            <div class="settings-actions wide">
              <span v-if="savedMessage" class="settings-saved" role="status">{{ savedMessage }}</span>
              <button class="btn btn-primary btn-sm" type="submit" :disabled="saving || !companyDraft.name.trim()">
                {{ saving ? 'Kaydediliyor…' : 'Firma bilgilerini kaydet' }}
              </button>
            </div>
            <p v-if="errorMessage" class="settings-error wide" role="alert">{{ errorMessage }}</p>
          </form>
        </template>

        <template v-else-if="groupId === 'finance' && tabId === 'invoices'">
          <div class="settings-section-heading">
            <div><h2>Fatura varsayılanları</h2><p>Yeni faturalarda kullanılacak başlangıç değerleri.</p></div>
            <span class="settings-section-mark">02</span>
          </div>
          <form class="settings-form" @submit.prevent="savePreferences">
            <label class="settings-field"><span>Seri ön eki</span><input v-model="preferenceDraft.invoiceSeries" class="input" maxlength="10" /></label>
            <label class="settings-field"><span>Varsayılan vade (gün)</span><input v-model.number="preferenceDraft.invoiceDueDays" class="input" type="number" min="0" max="365" /></label>
            <label class="settings-field"><span>Varsayılan KDV (%)</span><input v-model.number="preferenceDraft.invoiceVatRate" class="input" type="number" min="0" max="100" step="0.01" /></label>
            <div class="settings-actions wide">
              <span v-if="savedMessage" class="settings-saved" role="status">{{ savedMessage }}</span>
              <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">{{ saving ? 'Kaydediliyor…' : 'Kaydet' }}</button>
            </div>
            <p v-if="errorMessage" class="settings-error wide" role="alert">{{ errorMessage }}</p>
          </form>
        </template>

        <template v-else-if="groupId === 'finance' && tabId === 'cheques'">
          <div class="settings-section-heading">
            <div><h2>Çek / senet varsayılanları</h2><p>Vade ve yaklaşan ödeme hatırlatmaları.</p></div>
            <span class="settings-section-mark">03</span>
          </div>
          <form class="settings-form" @submit.prevent="savePreferences">
            <label class="settings-field"><span>Varsayılan vade (gün)</span><input v-model.number="preferenceDraft.chequeMaturityDays" class="input" type="number" min="0" max="3650" /></label>
            <label class="settings-field"><span>Vade öncesi hatırlatma (gün)</span><input v-model.number="preferenceDraft.chequeReminderDays" class="input" type="number" min="0" max="365" /></label>
            <div class="settings-actions wide">
              <span v-if="savedMessage" class="settings-saved" role="status">{{ savedMessage }}</span>
              <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">{{ saving ? 'Kaydediliyor…' : 'Kaydet' }}</button>
            </div>
            <p v-if="errorMessage" class="settings-error wide" role="alert">{{ errorMessage }}</p>
          </form>
        </template>

        <template v-else-if="groupId === 'reports'">
          <div class="settings-section-heading">
            <div><h2>Rapor varsayılanları</h2><p>Rapor ekranları için tercih edilen dönem ve dışa aktarma biçimi.</p></div>
            <span class="settings-section-mark">04</span>
          </div>
          <form class="settings-form" @submit.prevent="savePreferences">
            <label class="settings-field"><span>Varsayılan dönem</span><select v-model="preferenceDraft.reportPeriod" class="select"><option value="month">Bu ay</option><option value="quarter">Bu çeyrek</option><option value="year">Bu yıl</option></select></label>
            <label class="settings-field"><span>Dışa aktarma biçimi</span><select v-model="preferenceDraft.reportExportFormat" class="select"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="pdf">PDF</option></select></label>
            <label class="settings-check wide"><input v-model="preferenceDraft.reportComparePrevious" type="checkbox" /><span>Önceki dönemle karşılaştır</span></label>
            <div class="settings-actions wide">
              <span v-if="savedMessage" class="settings-saved" role="status">{{ savedMessage }}</span>
              <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">{{ saving ? 'Kaydediliyor…' : 'Kaydet' }}</button>
            </div>
            <p v-if="errorMessage" class="settings-error wide" role="alert">{{ errorMessage }}</p>
          </form>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  --settings-ink: #182b3a;
  --settings-muted: #718092;
  --settings-line: #e0e7ec;
  --settings-accent: #147d76;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0.25rem 0 2rem;
  color: var(--settings-ink);
}
.settings-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.25rem;
}
.settings-eyebrow {
  margin: 0 0 0.35rem;
  color: var(--settings-accent);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.settings-context {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--settings-line);
  border-radius: 999px;
  color: var(--settings-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}
.settings-groups {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding: 0.25rem;
  border: 1px solid var(--settings-line);
  border-radius: 0.75rem;
  background: #f4f7f8;
  scrollbar-width: thin;
}
.settings-group-tab,
.settings-subtab {
  flex: 0 0 auto;
  border: 0;
  border-radius: 0.55rem;
  background: transparent;
  color: #5d6b78;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.settings-group-tab {
  min-width: 7.25rem;
  padding: 0.62rem 1rem;
}
.settings-group-tab.active {
  background: #fff;
  color: var(--settings-ink);
  box-shadow: 0 1px 3px #1834491a, 0 0 0 1px #d9e1e7;
}
.settings-workspace {
  margin-top: 0.8rem;
  overflow: hidden;
  border: 1px solid var(--settings-line);
  border-radius: 0.85rem;
  background: #fff;
  box-shadow: 0 8px 26px #18344908;
}
.settings-subtabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.7rem 1rem 0;
  border-bottom: 1px solid var(--settings-line);
  scrollbar-width: thin;
}
.settings-subtab {
  position: relative;
  padding: 0.65rem 0.8rem 0.75rem;
  border-radius: 0.45rem 0.45rem 0 0;
  font-size: 0.76rem;
  white-space: nowrap;
}
.settings-subtab.active {
  color: var(--settings-accent);
}
.settings-subtab.active::after {
  position: absolute;
  right: 0.7rem;
  bottom: -1px;
  left: 0.7rem;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--settings-accent);
  content: '';
}
.settings-group-tab:focus-visible,
.settings-subtab:focus-visible {
  outline: 2px solid var(--settings-accent);
  outline-offset: 2px;
}
.settings-content {
  min-height: 15rem;
  padding: 1.2rem 1.35rem 1.45rem;
}
.settings-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
}
.settings-section-heading h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 730;
  letter-spacing: -0.02em;
}
.settings-section-heading p {
  margin: 0.25rem 0 0;
  color: var(--settings-muted);
  font-size: 0.78rem;
}
.settings-section-mark {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid #d5e9e5;
  border-radius: 0.6rem;
  background: #f0f8f6;
  color: var(--settings-accent);
  font-size: 0.68rem;
  font-weight: 800;
}
.settings-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem 1.1rem;
  max-width: 760px;
}
.settings-field {
  display: grid;
  gap: 0.35rem;
  color: #526272;
  font-size: 0.73rem;
  font-weight: 650;
}
.settings-field.wide,
.settings-actions.wide,
.settings-error.wide,
.settings-check.wide {
  grid-column: 1 / -1;
}
.settings-field :deep(.input),
.settings-field :deep(.select) {
  min-height: 2.35rem;
  font-size: 0.82rem;
}
.settings-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.85rem;
  padding-top: 0.45rem;
  border-top: 1px solid #edf1f3;
}
.settings-saved {
  color: #16754d;
  font-size: 0.76rem;
}
.settings-error {
  margin: 0;
  color: #b42318;
  font-size: 0.78rem;
}
.settings-check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: #526272;
  font-size: 0.78rem;
}
.settings-check input {
  accent-color: var(--settings-accent);
}
.settings-content :deep(.management-view),
.settings-content :deep(.cat-settings) {
  max-width: none;
  margin: 0;
  padding: 0;
}
@media (max-width: 640px) {
  .settings-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.6rem;
  }
  .settings-context {
    white-space: normal;
  }
  .settings-content {
    padding: 1rem 0.85rem 1.1rem;
  }
  .settings-form {
    grid-template-columns: 1fr;
  }
  .settings-field.wide,
  .settings-actions.wide,
  .settings-error.wide,
  .settings-check.wide {
    grid-column: auto;
  }
}
</style>
