<script setup lang="ts">
// e-Defter (GİB yevmiye + kebir XML) — entegratör üzerinden. Biz aylık imzasız XML üretiriz;
// kullanıcı zip'i indirip entegratöre verir (imza, berat ve GİB yüklemesi orada yapılır).
// Her şey tek ekranda: yıl → 12 ay ızgarası → seçilen ayın ön kontrolü ve işlemleri.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  errorMessage,
  useEdefterStore,
  type EdefterIssue,
  type EdefterPart,
  type EdefterPrecheck,
  type EdefterProfileStatus,
} from '@/stores/edefter';

const emit = defineEmits<{ (e: 'go-entries'): void }>();

const store = useEdefterStore();
const router = useRouter();

function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}
const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];
const STATUS_LABEL = {
  none: 'Oluşturulmadı',
  generated: 'Oluşturuldu',
  delivered: 'Entegratöre gönderildi',
} as const;
const STATUS_BADGE = {
  none: 'badge-neutral',
  generated: 'badge-info',
  delivered: 'badge-success',
} as const;
type MonthStatus = keyof typeof STATUS_LABEL;

const periodOf = (year: number, month: number) => `${year}${String(month).padStart(2, '0')}`;
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(4)) - 1]} ${p.slice(0, 4)}`;
const prevPeriodOf = (p: string) => {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(4));
  return m === 1 ? periodOf(y - 1, 12) : periodOf(y, m - 1);
};
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2).replace('.', ',')} MB`;
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
}
function formatDateTime(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('tr-TR');
}

// --- Yıl ---
const now = new Date();
/** Ocak ayındaysak geçen yılın defteri beklenir. */
const year = ref(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
const yearOptions = computed(() => {
  const top = now.getFullYear() + 1;
  return Array.from({ length: 8 }, (_, i) => top - i);
});

// --- Firma e-Defter bilgileri ---
const profile = ref<EdefterProfileStatus | null>(null);
async function loadProfile() {
  try {
    profile.value = await store.profileStatus();
  } catch {
    profile.value = null;
  }
}
function openProfileSettings() {
  void router.push({
    name: 'settings',
    query: { group: 'company', tab: 'profile' },
    hash: '#edefter-bilgileri',
  });
}

// --- 12 ay ızgarası ---
const parts = ref<EdefterPart[]>([]);
const yearLoading = ref(false);
const yearError = ref<string | null>(null);
let yearToken = 0;
async function loadYear() {
  const token = ++yearToken;
  yearLoading.value = true;
  yearError.value = null;
  try {
    const res = await store.fetchYear(year.value);
    if (token === yearToken) parts.value = res.parts ?? [];
  } catch (err) {
    if (token === yearToken) {
      parts.value = [];
      yearError.value = errorMessage(err, 'e-Defter listesi yüklenemedi.');
    }
  } finally {
    if (token === yearToken) yearLoading.value = false;
  }
}

interface MonthRow {
  month: number;
  period: string;
  name: string;
  status: MonthStatus;
  fileCount: number;
  firstEntry: number | null;
  lastEntry: number | null;
  debit: number;
  credit: number;
}
const rows = computed<MonthRow[]>(() =>
  Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const period = periodOf(year.value, month);
    const mine = parts.value.filter((p) => p.period === period);
    const yev = mine.filter((p) => p.book_type === 'Y');
    const firsts = yev.map((p) => p.first_entry_no).filter((n): n is number => n != null);
    const lasts = yev.map((p) => p.last_entry_no).filter((n): n is number => n != null);
    const status: MonthStatus =
      mine.length === 0
        ? 'none'
        : mine.every((p) => p.status === 'delivered')
          ? 'delivered'
          : 'generated';
    return {
      month,
      period,
      name: MONTHS[i],
      status,
      fileCount: mine.length,
      firstEntry: firsts.length ? Math.min(...firsts) : null,
      lastEntry: lasts.length ? Math.max(...lasts) : null,
      debit: yev.reduce((s, p) => s + Number(p.total_debit || 0), 0),
      credit: yev.reduce((s, p) => s + Number(p.total_credit || 0), 0),
    };
  }),
);
/** Yalnızca en son oluşturulan ay silinebilir. */
const latestGenerated = computed(() => {
  const withParts = rows.value.filter((r) => r.fileCount > 0);
  return withParts.length ? withParts[withParts.length - 1].period : null;
});

// --- Seçilen ay: ön kontrol ---
const selected = ref<string | null>(null);
const check = ref<EdefterPrecheck | null>(null);
const checkLoading = ref(false);
const checkError = ref<string | null>(null);
const showAllIssues = ref(false);
let checkToken = 0;

async function loadCheck(period: string) {
  const token = ++checkToken;
  checkLoading.value = true;
  checkError.value = null;
  try {
    const res = await store.precheck(period);
    if (token === checkToken) check.value = res;
  } catch (err) {
    if (token === checkToken) {
      check.value = null;
      checkError.value = errorMessage(err, 'Ön kontrol yapılamadı.');
    }
  } finally {
    if (token === checkToken) checkLoading.value = false;
  }
}

function selectPeriod(period: string) {
  const y = Number(period.slice(0, 4));
  selected.value = period;
  message.value = null;
  showAllIssues.value = false;
  check.value = null;
  if (y !== year.value) year.value = y; // yıl izleyicisi listeyi yeniler, seçimi korur
  void loadCheck(period);
}

watch(year, () => {
  if (selected.value && !selected.value.startsWith(String(year.value))) {
    selected.value = null;
    check.value = null;
  }
  void loadYear();
});

onMounted(() => {
  void loadProfile();
  void loadYear();
});

const selectedRow = computed(() => rows.value.find((r) => r.period === selected.value) ?? null);
const selectedParts = computed(() =>
  parts.value
    .filter((p) => p.period === selected.value)
    .sort((a, b) =>
      a.book_type === b.book_type ? a.part_no - b.part_no : a.book_type < b.book_type ? 1 : -1,
    ),
);

const errors = computed(() => check.value?.issues.filter((i) => i.level === 'error') ?? []);
const warnings = computed(() => check.value?.issues.filter((i) => i.level === 'warning') ?? []);
const ISSUE_LIMIT = 15;
const shownErrors = computed(() =>
  showAllIssues.value ? errors.value : errors.value.slice(0, ISSUE_LIMIT),
);
const shownWarnings = computed(() =>
  showAllIssues.value ? warnings.value : warnings.value.slice(0, ISSUE_LIMIT),
);
const hiddenCount = computed(
  () =>
    Math.max(0, errors.value.length - ISSUE_LIMIT) +
    Math.max(0, warnings.value.length - ISSUE_LIMIT),
);
/** Yevmiye fişleri ekranında çözülebilen hata kodları. */
const ENTRY_FIX_CODES = ['drafts', 'document', 'account', 'bank_reference'];

// --- İşlemler ---
const busy = ref<'' | 'lock' | 'generate' | 'download' | 'delivered' | 'remove'>('');
const message = ref<{ kind: 'ok' | 'error'; text: string } | null>(null);

async function refreshAll() {
  if (!selected.value) return;
  await Promise.all([loadYear(), loadCheck(selected.value)]);
}

async function lockSelected() {
  const p = selected.value;
  if (!p) return;
  if (
    !window.confirm(
      `${periodLabel(p)} ayı kilitlenecek; bu tarihe kadar fiş girilemez/değiştirilemez. Devam?`,
    )
  )
    return;
  busy.value = 'lock';
  message.value = null;
  try {
    await store.lockMonth(p);
    message.value = { kind: 'ok', text: `${periodLabel(p)} ayı kilitlendi.` };
    await refreshAll();
  } catch (err) {
    message.value = { kind: 'error', text: errorMessage(err, 'Ay kilitlenemedi.') };
  } finally {
    busy.value = '';
  }
}

async function generateSelected() {
  const p = selected.value;
  if (!p || !check.value?.ready) return;
  if (
    selectedParts.value.length > 0 &&
    !window.confirm(
      `${periodLabel(p)} defteri yeniden oluşturulacak; önceki dosyalar geçersiz olur. Devam?`,
    )
  )
    return;
  busy.value = 'generate';
  message.value = null;
  try {
    await store.generate(p);
    message.value = {
      kind: 'ok',
      text: 'Yevmiye ve kebir oluşturuldu, GİB kurallarından geçti (imza entegratörde).',
    };
    await refreshAll();
  } catch (err) {
    message.value = { kind: 'error', text: errorMessage(err, 'Defter oluşturulamadı.') };
  } finally {
    busy.value = '';
  }
}

async function downloadSelected() {
  const p = selected.value;
  if (!p) return;
  busy.value = 'download';
  message.value = null;
  try {
    const vkn = profile.value?.vkn || 'firma';
    const name = await store.downloadZip(p, `${vkn}-${p}-edefter.zip`);
    message.value = { kind: 'ok', text: `${name} indirildi. Entegratörünüze iletebilirsiniz.` };
  } catch (err) {
    message.value = { kind: 'error', text: errorMessage(err, 'Zip indirilemedi.') };
  } finally {
    busy.value = '';
  }
}

async function toggleDelivered(delivered: boolean) {
  const p = selected.value;
  if (!p) return;
  busy.value = 'delivered';
  message.value = null;
  try {
    await store.setDelivered(p, delivered);
    message.value = {
      kind: 'ok',
      text: delivered
        ? `${periodLabel(p)} entegratöre gönderildi olarak işaretlendi.`
        : `${periodLabel(p)} işareti kaldırıldı.`,
    };
    await refreshAll();
  } catch (err) {
    message.value = { kind: 'error', text: errorMessage(err, 'İşaret değiştirilemedi.') };
  } finally {
    busy.value = '';
  }
}

async function removeSelected() {
  const p = selected.value;
  if (!p) return;
  if (
    !window.confirm(
      `${periodLabel(p)} defteri silinecek (dosyalar geçersiz olur; ay yeniden oluşturulabilir). Devam?`,
    )
  )
    return;
  busy.value = 'remove';
  message.value = null;
  try {
    await store.removeMonth(p);
    message.value = { kind: 'ok', text: `${periodLabel(p)} defteri silindi.` };
    await refreshAll();
  } catch (err) {
    message.value = { kind: 'error', text: errorMessage(err, 'Defter silinemedi.') };
  } finally {
    busy.value = '';
  }
}

const issueEntryLabel = (i: EdefterIssue) =>
  i.entryNo !== undefined && i.entryNo !== null && i.entryNo !== '' ? `Madde ${i.entryNo}` : '';
</script>

<template>
  <section class="card ed" aria-labelledby="ed-title">
    <div class="ed-head">
      <div>
        <h2 id="ed-title" class="card-title">e-Defter</h2>
        <p class="muted small">
          Aylık yevmiye ve kebir defterini üretin, zip olarak indirip entegratörünüze verin.
        </p>
      </div>
      <div class="ed-year">
        <label for="ed-year-select">Yıl</label>
        <select id="ed-year-select" v-model.number="year" class="select">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
    </div>

    <div v-if="profile && profile.issues.length" class="ed-warn" role="alert">
      <div>
        <strong>e-Defter bilgileri eksik</strong>
        <ul>
          <li v-for="i in profile.issues" :key="i.field + i.message">{{ i.message }}</li>
        </ul>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" @click="openProfileSettings">
        Firma Profili'nde tamamla
      </button>
    </div>

    <p v-if="yearError" class="alert alert-error" role="alert">{{ yearError }}</p>
    <p v-if="yearLoading && parts.length === 0" class="muted" role="status">Yükleniyor…</p>

    <ul class="ed-months" aria-label="Aylar">
      <li v-for="r in rows" :key="r.period">
        <button
          type="button"
          class="ed-month"
          :class="{ active: selected === r.period }"
          :aria-pressed="selected === r.period"
          :aria-label="`${r.name} ${year}: ${STATUS_LABEL[r.status]}`"
          @click="selectPeriod(r.period)"
        >
          <span class="ed-month-top">
            <strong>{{ r.name }}</strong>
            <span class="badge" :class="STATUS_BADGE[r.status]">{{ STATUS_LABEL[r.status] }}</span>
          </span>
          <span class="ed-month-line">
            <span class="muted">Madde</span>
            <span class="mono">
              {{ r.firstEntry !== null ? `${r.firstEntry}–${r.lastEntry}` : '—' }}
            </span>
          </span>
          <span class="ed-month-line">
            <span class="muted">Borç = Alacak</span>
            <span class="mono">
              {{ r.fileCount ? formatMoney(r.debit) : '—' }}
            </span>
          </span>
          <span v-if="r.fileCount && Math.abs(r.debit - r.credit) >= 0.005" class="ed-diff">
            Alacak {{ formatMoney(r.credit) }} — denk değil
          </span>
          <span class="ed-month-line">
            <span class="muted">Dosya</span>
            <span class="mono">{{ r.fileCount }}</span>
          </span>
        </button>
      </li>
    </ul>

    <p v-if="!selected" class="muted small ed-hint">
      Ön kontrol ve işlemler için bir ay seçin. Aylar sırayla oluşturulur; ay bitmeden ve
      kilitlenmeden üretilemez.
    </p>

    <!-- ============ Seçilen ay ============ -->
    <div v-if="selected && selectedRow" class="ed-month-panel" aria-live="polite">
      <div class="ed-month-head">
        <h3>{{ periodLabel(selected) }} — ön kontrol</h3>
        <span class="badge" :class="STATUS_BADGE[selectedRow.status]">
          {{ STATUS_LABEL[selectedRow.status] }}
        </span>
      </div>

      <p v-if="checkLoading && !check" class="muted" role="status">Ön kontrol yapılıyor…</p>
      <p v-if="checkError" class="alert alert-error" role="alert">{{ checkError }}</p>

      <template v-if="check">
        <dl class="ed-summary" aria-label="Ay özeti">
          <div>
            <dt>Madde sayısı</dt>
            <dd>{{ check.summary.entryCount }}</dd>
          </div>
          <div>
            <dt>Madde aralığı</dt>
            <dd>
              {{
                check.summary.firstEntry !== null
                  ? `${check.summary.firstEntry}–${check.summary.lastEntry}`
                  : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Satır sayısı</dt>
            <dd>{{ check.summary.lineCount }}</dd>
          </div>
          <div>
            <dt>Toplam borç</dt>
            <dd>{{ formatMoney(check.summary.totalDebit) }}</dd>
          </div>
          <div>
            <dt>Toplam alacak</dt>
            <dd>{{ formatMoney(check.summary.totalCredit) }}</dd>
          </div>
        </dl>

        <p v-if="check.ready" class="ed-ready" role="status">
          Ön kontrol temiz: defter oluşturulabilir.
        </p>

        <div v-if="check.profileIssues.length" class="ed-issues-box ed-err">
          <h4>Firma e-Defter bilgileri eksik ({{ check.profileIssues.length }})</h4>
          <ul v-if="!profile?.issues.length" class="ed-issues">
            <li v-for="i in check.profileIssues" :key="i.field + i.message">
              <span class="ed-issue-text">{{ i.message }}</span>
            </li>
          </ul>
          <button type="button" class="btn btn-secondary btn-sm" @click="openProfileSettings">
            Firma Profili'nde tamamla
          </button>
        </div>

        <div v-if="errors.length" class="ed-issues-box ed-err">
          <h4>Düzeltilmesi gerekenler ({{ errors.length }})</h4>
          <ul class="ed-issues">
            <li v-for="(i, idx) in shownErrors" :key="`e${idx}`">
              <span class="ed-issue-text">
                <b v-if="issueEntryLabel(i)">{{ issueEntryLabel(i) }}: </b>{{ i.message }}
              </span>
              <span class="ed-issue-actions">
                <button
                  v-if="i.code === 'not_locked'"
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="busy !== ''"
                  @click="lockSelected"
                >
                  Ayı kilitle
                </button>
                <button
                  v-if="i.code === 'numbering'"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="emit('go-entries')"
                >
                  Yevmiye Fişleri'nde yeniden sırala
                </button>
                <button
                  v-if="i.code === 'previous_missing'"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="selectPeriod(prevPeriodOf(selected))"
                >
                  {{ periodLabel(prevPeriodOf(selected)) }} ayına geç
                </button>
                <button
                  v-if="ENTRY_FIX_CODES.includes(i.code)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="emit('go-entries')"
                >
                  Yevmiye Fişleri'ne git
                </button>
              </span>
            </li>
          </ul>
        </div>

        <div v-if="warnings.length" class="ed-issues-box ed-warning">
          <h4>Uyarılar ({{ warnings.length }})</h4>
          <ul class="ed-issues">
            <li v-for="(i, idx) in shownWarnings" :key="`w${idx}`">
              <span class="ed-issue-text">
                <b v-if="issueEntryLabel(i)">{{ issueEntryLabel(i) }}: </b>{{ i.message }}
              </span>
              <span v-if="ENTRY_FIX_CODES.includes(i.code)" class="ed-issue-actions">
                <button type="button" class="btn btn-secondary btn-sm" @click="emit('go-entries')">
                  Yevmiye Fişleri'ne git
                </button>
              </span>
            </li>
          </ul>
        </div>

        <button
          v-if="hiddenCount > 0"
          type="button"
          class="btn btn-ghost btn-sm"
          @click="showAllIssues = !showAllIssues"
        >
          {{ showAllIssues ? 'Listeyi kısalt' : `${hiddenCount} madde daha göster` }}
        </button>
      </template>

      <p
        v-if="message"
        class="alert ed-msg"
        :class="message.kind === 'ok' ? 'alert-success' : 'alert-error'"
        :role="message.kind === 'ok' ? 'status' : 'alert'"
      >
        {{ message.text }}
      </p>

      <div class="ed-actions">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!check?.ready || busy !== ''"
          :title="check?.ready ? '' : 'Önce yukarıdaki hataları giderin'"
          @click="generateSelected"
        >
          {{ busy === 'generate' ? 'Oluşturuluyor…' : 'Defteri oluştur' }}
        </button>
        <button
          v-if="selectedParts.length"
          type="button"
          class="btn btn-secondary"
          :disabled="busy !== ''"
          @click="downloadSelected"
        >
          İndir (zip)
        </button>
        <button
          v-if="selectedParts.length && selectedRow.status !== 'delivered'"
          type="button"
          class="btn btn-secondary"
          :disabled="busy !== ''"
          @click="toggleDelivered(true)"
        >
          Entegratöre gönderildi olarak işaretle
        </button>
        <button
          v-if="selectedParts.length && selectedRow.status === 'delivered'"
          type="button"
          class="btn btn-secondary"
          :disabled="busy !== ''"
          @click="toggleDelivered(false)"
        >
          İşareti kaldır
        </button>
        <button
          v-if="selectedParts.length && latestGenerated === selected"
          type="button"
          class="btn btn-danger"
          :disabled="busy !== '' || selectedRow.status === 'delivered'"
          :title="
            selectedRow.status === 'delivered'
              ? 'Entegratöre gönderilmiş defter silinemez; önce işareti kaldırın'
              : ''
          "
          @click="removeSelected"
        >
          Sil
        </button>
      </div>

      <div v-if="selectedParts.length" class="table-wrap">
        <table class="data-table ed-files">
          <caption class="ed-caption">
            Oluşturulmuş dosyalar
          </caption>
          <thead>
            <tr>
              <th scope="col">Dosya adı</th>
              <th scope="col">Kontrol no</th>
              <th scope="col" class="num">Boyut</th>
              <th scope="col">SHA-256</th>
              <th scope="col">Oluşturma zamanı</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in selectedParts" :key="p.unique_id">
              <td class="mono wrap">{{ p.file_name }}</td>
              <td class="mono wrap">{{ p.unique_id }}</td>
              <td class="num">{{ formatSize(p.size_bytes) }}</td>
              <td class="mono" :title="p.sha256">{{ p.sha256.slice(0, 12) }}</td>
              <td>{{ formatDateTime(p.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="muted small ed-note">
        Dosyalar imzasızdır. İmzalama (mali mühür), berat ve GİB'e yükleme entegratörünüz tarafından
        yapılır.
      </p>
    </div>
  </section>
</template>

<style scoped>
.ed-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.ed-head .card-title {
  margin-bottom: 2px;
}
.ed-year {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.ed-year .select {
  min-width: 7rem;
}
.ed-warn {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0.75rem 1rem;
  margin-bottom: 14px;
  border: 1px solid #fcd34d;
  border-radius: 0.5rem;
  background: var(--c-warning-soft, #fffbeb);
  color: #92400e;
  font-size: 0.875rem;
}
.ed-warn ul {
  margin: 4px 0 0;
  padding-left: 1.1rem;
}
.ed-months {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ed-month {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--c-border, #e5e7eb);
  border-radius: 0.6rem;
  background: var(--c-surface, #fff);
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.ed-month:hover {
  border-color: var(--c-primary, #1d4ed8);
}
.ed-month:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
}
.ed-month.active {
  border-color: var(--c-primary, #1d4ed8);
  box-shadow: 0 0 0 1px var(--c-primary, #1d4ed8);
}
.ed-month-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 0.9rem;
}
.ed-month-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.ed-diff {
  color: #b42318;
  font-size: 0.75rem;
}
.ed-hint {
  margin: 12px 0 0;
}
.ed-month-panel {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--c-border, #e5e7eb);
}
.ed-month-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ed-month-head h3 {
  margin: 0;
  font-size: 1rem;
}
.ed-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 8px;
  margin: 0 0 12px;
}
.ed-summary > div {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--c-border, #e5e7eb);
  border-radius: 0.5rem;
  background: var(--c-bg, #f8fafc);
}
.ed-summary dt {
  font-size: 0.72rem;
  color: var(--c-muted, #64748b);
}
.ed-summary dd {
  margin: 2px 0 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ed-ready {
  margin: 0 0 12px;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--c-success-soft, #ecfdf5);
  color: #047857;
  font-size: 0.875rem;
}
.ed-issues-box {
  margin-bottom: 12px;
  padding: 0.65rem 0.85rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
.ed-issues-box h4 {
  margin: 0 0 6px;
  font-size: 0.85rem;
}
.ed-issues-box.ed-err {
  border-color: #fecaca;
  background: var(--c-danger-soft, #fef2f2);
  color: #b91c1c;
}
.ed-issues-box.ed-warning {
  border-color: #fcd34d;
  background: var(--c-warning-soft, #fffbeb);
  color: #92400e;
}
.ed-issues {
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
}
.ed-issues li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.ed-issues li:first-child {
  border-top: 0;
}
.ed-issue-text {
  flex: 1 1 18rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ed-issue-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ed-msg {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0 0 12px;
}
.ed-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 14px;
}
.ed-caption {
  padding: 0 0 6px;
  text-align: left;
  font-size: 0.85rem;
  font-weight: 600;
}
.ed-files td.wrap {
  word-break: break-all;
}
.ed-note {
  margin: 12px 0 0;
}
@media (max-width: 640px) {
  .ed-months {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
