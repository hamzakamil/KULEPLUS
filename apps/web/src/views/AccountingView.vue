<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AccountCodeLink from '@/components/accounting/AccountCodeLink.vue';
import AccountLedgerDrawer from '@/components/accounting/AccountLedgerDrawer.vue';
import PeriodEndPanel from '@/components/accounting/PeriodEndPanel.vue';
import {
  errorMessage as storeErrorMessage,
  useAccountingStore,
  type EntryDetail,
  type JournalLine,
  type TrialBalance,
  type WithholdingReport,
} from '@/stores/accounting';
import { useLedgerDrawerStore } from '@/stores/ledgerDrawer';

const store = useAccountingStore();
const ledgerDrawer = useLedgerDrawerStore();
const activeTab = ref<'accounts' | 'entries' | 'reports' | 'periodEnd'>('accounts');
const info = ref<string | null>(null);

function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}
const today = new Date().toISOString().slice(0, 10);
const yearStart = `${today.slice(0, 4)}-01-01`;
const ENTRY_TYPES = ['mahsup', 'tahsil', 'tediye', 'acilis', 'duzeltme', 'ters'] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  posted: 'Onaylı',
  cancelled: 'İptal',
};
const ENTRY_TYPE_LABELS: Record<string, string> = {
  donem_sonu: 'Dönem sonu',
  kapanis: 'Kapanış',
};
const entryTypeLabel = (t: string) => ENTRY_TYPE_LABELS[t] ?? t;
/** Madde numarası her mali yılda 1'den başlar: 2026/12. */
const entryNoLabel = (e: { entry_no: number | null; fiscal_year?: number }) =>
  e.entry_no === null || e.entry_no === undefined
    ? '—'
    : e.fiscal_year
      ? `${e.fiscal_year}/${e.entry_no}`
      : String(e.entry_no);

/** SPEC §22.1 hata sözleşmesinden (`{ error: { message } }`) mesaj çıkarır. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (
    err as {
      response?: { data?: { error?: { message?: string }; message?: string } };
    }
  )?.response?.data;
  return data?.error?.message || data?.message || fallback;
}

const detailAccounts = computed(() => store.accounts.filter((a) => a.type === 'detail'));

async function loadAccounts() {
  await store.fetchAccounts();
}
async function bootstrapChart() {
  info.value = null;
  try {
    const inserted = await store.bootstrapChart();
    await loadAccounts();
    info.value =
      inserted > 0 ? `${inserted} TDHP hesabı oluşturuldu.` : 'Hesap planı zaten mevcut.';
  } catch {
    info.value = 'Hesap planı kurulamadı.';
  }
}

// --- Yevmiye fişleri ---
async function loadEntries() {
  await store.fetchEntries({ limit: 50 });
}

// Yeniden sırala (madde numaralarını yıl bazında 1'den yeniden verir)
const resequenceYear = ref(new Date().getFullYear());
const resequenceBusy = ref(false);
async function resequence() {
  info.value = null;
  resequenceBusy.value = true;
  try {
    const res = await store.resequenceEntries(Number(resequenceYear.value));
    await loadEntries();
    info.value = `${res.changed} fişin numarası güncellendi.`;
  } catch (err) {
    info.value = storeErrorMessage(err, 'Fişler yeniden sıralanamadı.');
  } finally {
    resequenceBusy.value = false;
  }
}
const showEntryModal = ref(false);
const entryForm = reactive({
  entry_date: today,
  entry_type: 'mahsup' as (typeof ENTRY_TYPES)[number],
  description: '',
  status: 'draft' as 'draft' | 'posted',
  lines: [{ account_id: '', debit: 0, credit: 0 }] as Array<{
    account_id: string;
    debit: number;
    credit: number;
  }>,
});
const entryTotals = computed(() => {
  const debit = entryForm.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = entryForm.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
});
function addLine() {
  entryForm.lines.push({ account_id: '', debit: 0, credit: 0 });
}
function removeLine(i: number) {
  if (entryForm.lines.length > 1) entryForm.lines.splice(i, 1);
}
async function submitEntry() {
  info.value = null;
  try {
    const lines: JournalLine[] = entryForm.lines
      .filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)))
      .map((l) => ({
        account_id: l.account_id,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
    if (lines.length < 2) throw new Error('En az iki satır gerekli.');
    await store.createEntry({
      entry_date: entryForm.entry_date,
      entry_type: entryForm.entry_type,
      description: entryForm.description,
      status: entryForm.status,
      lines,
    });
    showEntryModal.value = false;
    entryForm.description = '';
    entryForm.lines = [{ account_id: '', debit: 0, credit: 0 }];
    await loadEntries();
  } catch {
    info.value = 'Fiş kaydedilemedi (denge veya alanları kontrol edin).';
  }
}

// Fiş satırları: listeden açılır alan (GET /entries/:id), hesap kodları muavine bağlanır.
interface EntryExpand {
  loading: boolean;
  error: string | null;
  detail: EntryDetail | null;
}
const expandedEntries = reactive<Record<string, EntryExpand>>({});
async function toggleEntry(id: string) {
  if (expandedEntries[id]) {
    delete expandedEntries[id];
    return;
  }
  expandedEntries[id] = { loading: true, error: null, detail: null };
  await loadExpanded(id);
}
async function loadExpanded(id: string) {
  const slot = expandedEntries[id];
  if (!slot) return;
  slot.loading = true;
  slot.error = null;
  try {
    slot.detail = await store.fetchEntryDetail(id);
  } catch (err) {
    slot.error = storeErrorMessage(err, 'Fiş satırları yüklenemedi.');
  } finally {
    slot.loading = false;
  }
}
/** Fişin mali yılı: kod bağlantıları o yılın muavinini açar. */
/** YYYY-MM-DD → GG.AA.YYYY (saat dilimi kayması olmadan). */
function formatDay(s?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (s ?? '—');
}

function entryYear(e: { fiscal_year?: number | null; entry_date: string }): number {
  return e.fiscal_year || new Date(e.entry_date).getFullYear() || new Date().getFullYear();
}

async function approve(id: string) {
  if (
    !window.confirm(
      'Taslak fiş onaylansın mı?\n\nOnaylanan fiş yevmiye numarası alır ve artık değiştirilemez.',
    )
  )
    return;
  info.value = null;
  try {
    await store.postEntry(id);
    await loadEntries();
    info.value = 'Fiş onaylandı.';
  } catch (err) {
    info.value = apiErrorMessage(err, 'Fiş onaylanamadı.');
  }
}
async function reverse(id: string) {
  if (
    !window.confirm(
      'Fiş ters kayıtla düzeltilsin mi?\n\nOrijinal fiş değişmez; borç/alacak kalemleri yer değiştiren yeni bir "ters" fişi oluşturulur ve yevmiyeye işlenir.',
    )
  )
    return;
  info.value = null;
  try {
    await store.reverseEntry(id);
    await loadEntries();
    info.value = 'Ters kayıt oluşturuldu — yeni "ters" fişi yevmiyeye işlendi.';
  } catch (err) {
    info.value = apiErrorMessage(err, 'Ters kayıt oluşturulamadı.');
  }
}

// --- Raporlar ---
const reportType = ref<'trial' | 'balance' | 'income' | 'withholding'>('trial');
const rangeFrom = ref(yearStart);
const rangeTo = ref(today);
const asOf = ref(today);
const trial = ref<TrialBalance | null>(null);
const balance = ref<Awaited<ReturnType<typeof store.balanceSheet>> | null>(null);
const income = ref<Awaited<ReturnType<typeof store.incomeStatement>> | null>(null);
const withholding = ref<WithholdingReport | null>(null);
async function runReport() {
  info.value = null;
  try {
    if (reportType.value === 'trial')
      trial.value = await store.trialBalance(rangeFrom.value, rangeTo.value);
    else if (reportType.value === 'balance') balance.value = await store.balanceSheet(asOf.value);
    else if (reportType.value === 'withholding')
      withholding.value = await store.withholdingReport(rangeFrom.value, rangeTo.value);
    else income.value = await store.incomeStatement(rangeFrom.value, rangeTo.value);
  } catch {
    info.value = 'Rapor üretilemedi.';
  }
}

// --- Tevkifat raporu yardımcıları ---
/**
 * Defter (360.01) bakiyesi KDV-2 koduna göre gelir; aynı kod birden çok satırda tekrarlanabildiği
 * için toplamda kod başına bir kez sayılır. Tevkif toplamı sunucunun kdv2Total değeridir.
 */
const whTotals = computed(() => {
  const kdv2 = withholding.value?.kdv2 ?? [];
  const kdv1 = withholding.value?.kdv1 ?? [];
  const ledgerByCode = new Map<string, number>();
  kdv2.forEach((r) => ledgerByCode.set(r.kdv2Code, r.ledger));
  const kdv2Ledger = [...ledgerByCode.values()].reduce((s, v) => s + v, 0);
  return {
    kdv2Base: kdv2.reduce((s, r) => s + r.base, 0),
    kdv2Vat: kdv2.reduce((s, r) => s + r.vat, 0),
    kdv2Ledger,
    kdv2Difference: (withholding.value?.kdv2Total ?? 0) - kdv2Ledger,
    kdv1Base: kdv1.reduce((s, r) => s + r.base, 0),
    kdv1Vat: kdv1.reduce((s, r) => s + r.vat, 0),
  };
});
function hasDifference(v: number): boolean {
  return Math.abs(v) >= 0.005;
}

// --- Mizan: devir sütunları ve bakiye kolonları ---
const showOpening = ref(false);
/** Mizan satırları: tek bakiye alanı pozitifse borç, negatifse alacak bakiyesine yazılır. */
const trialRows = computed(() =>
  (trial.value?.accounts ?? []).map((row) => {
    const value = Number(row.balance);
    return {
      ...row,
      debitBalance: value > 0 ? value : null,
      creditBalance: value < 0 ? -value : null,
    };
  }),
);
const trialBalanceTotals = computed(() =>
  trialRows.value.reduce(
    (sum, row) => ({
      debit: sum.debit + (row.debitBalance ?? 0),
      credit: sum.credit + (row.creditBalance ?? 0),
    }),
    { debit: 0, credit: 0 },
  ),
);

onMounted(async () => {
  await loadAccounts();
  await loadEntries();
});

// Muavin panelinden düzeltme fişi kaydedilince açık ekranlar kendini yeniler.
watch(
  () => ledgerDrawer.lastSavedAt,
  async () => {
    await loadEntries();
    for (const id of Object.keys(expandedEntries)) void loadExpanded(id);
    if (activeTab.value === 'reports') {
      if (
        (reportType.value === 'trial' && trial.value) ||
        (reportType.value === 'balance' && balance.value) ||
        (reportType.value === 'income' && income.value) ||
        (reportType.value === 'withholding' && withholding.value)
      )
        await runReport();
    }
  },
);
</script>

<template>
  <div class="acc-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Muhasebe</h1>
        <p class="page-sub">Hesap planı, yevmiye fişleri ve mali tablolar (TDHP).</p>
      </div>
    </header>

    <p v-if="info" class="alert" role="status">{{ info }}</p>
    <p v-if="store.error" class="alert alert-error" role="alert">{{ store.error }}</p>

    <nav class="tabs" aria-label="Muhasebe sekmeleri">
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'accounts' }"
        @click="activeTab = 'accounts'"
      >
        Hesap Planı
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'entries' }"
        @click="activeTab = 'entries'"
      >
        Yevmiye Fişleri
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'reports' }"
        @click="activeTab = 'reports'"
      >
        Raporlar
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'periodEnd' }"
        @click="activeTab = 'periodEnd'"
      >
        Dönem Sonu
      </button>
    </nav>

    <section v-if="activeTab === 'accounts'" class="card">
      <div class="card-head">
        <h2 class="card-title">Hesap Planı ({{ store.accounts.length }})</h2>
        <button type="button" class="btn btn-primary btn-sm" @click="bootstrapChart">
          Hesap Planını Kur (TDHP)
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Kod</th>
              <th scope="col">Ad</th>
              <th scope="col">Tip</th>
              <th scope="col" class="num">Açılış Bakiye</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in store.accounts" :key="a.id">
              <td class="mono">
                <AccountCodeLink :code="a.code" :from="yearStart" :to="today" />
              </td>
              <td>{{ a.name }}</td>
              <td>{{ a.type === 'group' ? 'Grup' : 'Detay' }}</td>
              <td class="num">{{ formatMoney(a.openingBalance) }}</td>
            </tr>
            <tr v-if="store.accounts.length === 0">
              <td colspan="4" class="muted">
                Henüz hesap yok. "Hesap Planını Kur" ile TDHP'yi yükleyin.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="activeTab === 'entries'" class="card">
      <div class="card-head">
        <h2 class="card-title">Yevmiye Fişleri</h2>
        <button type="button" class="btn btn-primary btn-sm" @click="showEntryModal = true">
          ＋ Yeni Fiş
        </button>
      </div>
      <div class="resequence-bar">
        <label>
          <span>Yıl</span>
          <input
            v-model.number="resequenceYear"
            type="number"
            min="2000"
            max="2100"
            class="input"
          />
        </label>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="resequenceBusy"
          title="Seçili yılın onaylı fişlerine madde numarasını 1'den başlayarak yeniden verir"
          @click="resequence"
        >
          Yeniden sırala
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">No</th>
              <th scope="col">Tarih</th>
              <th scope="col">Tür</th>
              <th scope="col">Açıklama</th>
              <th scope="col" class="num">Borç</th>
              <th scope="col" class="num">Alacak</th>
              <th scope="col">Durum</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="e in store.entries" :key="e.id">
              <tr>
                <td class="mono">
                  <button
                    type="button"
                    class="entry-toggle mono"
                    :aria-expanded="!!expandedEntries[e.id]"
                    :aria-controls="`entry-lines-${e.id}`"
                    title="Fiş satırlarını göster/gizle"
                    @click="toggleEntry(e.id)"
                  >
                    <span aria-hidden="true">{{ expandedEntries[e.id] ? '▾' : '▸' }}</span>
                    {{ entryNoLabel(e) }}
                  </button>
                </td>
                <td>{{ formatDay(e.entry_date) }}</td>
                <td>{{ entryTypeLabel(e.entry_type) }}</td>
                <td>{{ e.description }}</td>
                <td class="num">{{ formatMoney(e.totalDebit) }}</td>
                <td class="num">{{ formatMoney(e.totalCredit) }}</td>
                <td>
                  <span v-if="e.entry_type === 'ters'" class="pill pill-rev">TERS KAYIT</span>
                  <span class="pill">{{ STATUS_LABELS[e.status] ?? e.status }}</span>
                </td>
                <td class="num">
                  <button
                    v-if="e.status === 'draft'"
                    type="button"
                    class="btn btn-primary btn-sm"
                    title="Taslağı onaylar — yevmiye numarası verilir, fiş kilitlenir"
                    @click="approve(e.id)"
                  >
                    Onayla
                  </button>
                  <button
                    v-if="e.status === 'posted' && e.entry_type !== 'ters'"
                    type="button"
                    class="btn btn-secondary btn-sm"
                    title="Onaylı fişi ters kayıtla düzeltir — silmez, yeni 'ters' fişi oluşturur"
                    @click="reverse(e.id)"
                  >
                    Ters Kayıt
                  </button>
                </td>
              </tr>
              <tr v-if="expandedEntries[e.id]" :id="`entry-lines-${e.id}`" class="entry-lines-row">
                <td colspan="8">
                  <p v-if="expandedEntries[e.id].loading" class="muted" role="status">
                    Satırlar yükleniyor…
                  </p>
                  <p v-else-if="expandedEntries[e.id].error" class="alert alert-error" role="alert">
                    {{ expandedEntries[e.id].error }}
                  </p>
                  <table v-else-if="expandedEntries[e.id].detail" class="data-table entry-lines">
                    <thead>
                      <tr>
                        <th scope="col">Hesap kodu</th>
                        <th scope="col">Hesap adı</th>
                        <th scope="col">Satır açıklaması</th>
                        <th scope="col" class="num">Borç</th>
                        <th scope="col" class="num">Alacak</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(l, i) in expandedEntries[e.id].detail!.lines" :key="l.id ?? i">
                        <td class="mono">
                          <AccountCodeLink
                            :code="l.account_code"
                            :from="`${entryYear(e)}-01-01`"
                            :to="`${entryYear(e)}-12-31`"
                          />
                        </td>
                        <td>{{ l.account_name }}</td>
                        <td class="muted">{{ l.description || '' }}</td>
                        <td class="num">{{ l.debit ? formatMoney(l.debit) : '—' }}</td>
                        <td class="num">{{ l.credit ? formatMoney(l.credit) : '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
            <tr v-if="store.entries.length === 0">
              <td colspan="8" class="muted">Kayıt yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <PeriodEndPanel v-else-if="activeTab === 'periodEnd'" />

    <section v-else class="card">
      <div class="card-head">
        <h2 class="card-title">Mali Tablolar</h2>
      </div>
      <div class="report-controls">
        <label
          ><span>Rapor</span>
          <select v-model="reportType" class="select">
            <option value="trial">Mizan</option>
            <option value="balance">Bilanço</option>
            <option value="income">Gelir Tablosu</option>
            <option value="withholding">Tevkifat (KDV-2 / KDV-1)</option>
          </select>
        </label>
        <template v-if="reportType === 'balance'">
          <label><span>Tarih</span><input v-model="asOf" type="date" class="input" /></label>
        </template>
        <template v-else>
          <label
            ><span>Başlangıç</span><input v-model="rangeFrom" type="date" class="input"
          /></label>
          <label><span>Bitiş</span><input v-model="rangeTo" type="date" class="input" /></label>
        </template>
        <button type="button" class="btn btn-primary btn-sm" @click="runReport">Raporla</button>
      </div>

      <div v-if="reportType === 'trial' && trial">
        <label class="trial-toggle">
          <input v-model="showOpening" type="checkbox" />
          Devir sütunlarını göster
        </label>
        <div class="table-wrap">
          <table class="data-table trial-table">
            <thead>
              <tr>
                <th>Kod</th>
                <th>Hesap</th>
                <th v-if="showOpening" class="num">Devir Borç</th>
                <th v-if="showOpening" class="num">Devir Alacak</th>
                <th class="num">Dönem Borç</th>
                <th class="num">Dönem Alacak</th>
                <th class="num">Toplam Borç</th>
                <th class="num">Toplam Alacak</th>
                <th class="num">Borç Bakiyesi</th>
                <th class="num">Alacak Bakiyesi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in trialRows" :key="r.code">
                <td class="mono">
                  <AccountCodeLink :code="r.code" :from="trial.from" :to="trial.to" />
                </td>
                <td>{{ r.name }}</td>
                <td v-if="showOpening" class="num">{{ formatMoney(r.openingDebit) }}</td>
                <td v-if="showOpening" class="num">{{ formatMoney(r.openingCredit) }}</td>
                <td class="num">{{ formatMoney(r.periodDebit) }}</td>
                <td class="num">{{ formatMoney(r.periodCredit) }}</td>
                <td class="num">{{ formatMoney(r.debit) }}</td>
                <td class="num">{{ formatMoney(r.credit) }}</td>
                <td class="num">
                  {{ r.debitBalance === null ? '—' : formatMoney(r.debitBalance) }}
                </td>
                <td class="num">
                  {{ r.creditBalance === null ? '—' : formatMoney(r.creditBalance) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colspan="2">Toplam ({{ trial.balanced ? 'Dengeli' : 'Dengesiz!' }})</th>
                <th v-if="showOpening" class="num">{{ formatMoney(trial.openingDebit) }}</th>
                <th v-if="showOpening" class="num">{{ formatMoney(trial.openingCredit) }}</th>
                <th class="num">{{ formatMoney(trial.periodDebit) }}</th>
                <th class="num">{{ formatMoney(trial.periodCredit) }}</th>
                <th class="num">{{ formatMoney(trial.totalDebit) }}</th>
                <th class="num">{{ formatMoney(trial.totalCredit) }}</th>
                <th class="num">{{ formatMoney(trialBalanceTotals.debit) }}</th>
                <th class="num">{{ formatMoney(trialBalanceTotals.credit) }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div v-else-if="reportType === 'balance' && balance" class="bs-grid">
        <div class="bs-col">
          <h3>Aktif</h3>
          <p>
            <span
              ><AccountCodeLink
                plain
                prefix="1"
                label="Dönen Varlıklar"
                :from="balance.year_start"
                :to="balance.as_of" /></span
            ><b>{{ formatMoney(balance.aktif.donenVarliklar) }}</b>
          </p>
          <p>
            <span
              ><AccountCodeLink
                plain
                prefix="2"
                label="Duran Varlıklar"
                :from="balance.year_start"
                :to="balance.as_of" /></span
            ><b>{{ formatMoney(balance.aktif.duranVarliklar) }}</b>
          </p>
          <p class="total">
            <span>Aktif Toplam</span><b>{{ formatMoney(balance.aktif.toplam) }}</b>
          </p>
        </div>
        <div class="bs-col">
          <h3>Pasif</h3>
          <p>
            <span
              ><AccountCodeLink
                plain
                prefix="3"
                label="Kısa Vadeli Yab. Kaynak"
                :from="balance.year_start"
                :to="balance.as_of" /></span
            ><b>{{ formatMoney(balance.pasif.kisaVadeliYabanciKaynaklar) }}</b>
          </p>
          <p>
            <span
              ><AccountCodeLink
                plain
                prefix="4"
                label="Uzun Vadeli Yab. Kaynak"
                :from="balance.year_start"
                :to="balance.as_of" /></span
            ><b>{{ formatMoney(balance.pasif.uzunVadeliYabanciKaynaklar) }}</b>
          </p>
          <p>
            <span
              ><AccountCodeLink
                plain
                prefix="5"
                label="Öz Kaynaklar"
                :from="balance.year_start"
                :to="balance.as_of" /></span
            ><b>{{ formatMoney(balance.pasif.ozKaynaklar) }}</b>
          </p>
          <p>
            <span>Geçmiş Yıllar Kâr/Zararı</span
            ><b>{{ formatMoney(balance.pasif.gecmisYillarKarZarari) }}</b>
          </p>
          <p>
            <span>Dönem Net Kârı</span><b>{{ formatMoney(balance.pasif.donemNetKar) }}</b>
          </p>
          <p class="total">
            <span>Pasif Toplam</span><b>{{ formatMoney(balance.pasif.toplam) }}</b>
          </p>
        </div>
      </div>

      <div v-else-if="reportType === 'income' && income" class="is-list">
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="60"
              label="Brüt Satışlar"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.brutSatislar) }}</b>
        </p>
        <p>
          <span>Net Satışlar</span><b>{{ formatMoney(income.netSatislar) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="62"
              label="Satışların Maliyeti"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.satislarinMaliyeti) }}</b>
        </p>
        <p>
          <span>Brüt Kâr</span><b>{{ formatMoney(income.brutKar) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="63"
              label="Faaliyet Giderleri"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.faaliyetGiderleri) }}</b>
        </p>
        <p>
          <span>Faaliyet Kârı</span><b>{{ formatMoney(income.faaliyetKari) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="64"
              label="Diğer Faaliyet Gelirleri"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.digerFaaliyetGelirleri) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="65"
              label="Diğer Faaliyet Giderleri"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.digerFaaliyetGiderleri) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="66"
              label="Finansman Giderleri"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.finansmanGiderleri) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="67"
              label="Olağandışı Gelirler"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.olaganDisiGelirler) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="68"
              label="Olağandışı Giderler"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.olaganDisiGiderler) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="691"
              label="Vergi Karşılığı"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.vergiKarsiligi) }}</b>
        </p>
        <p>
          <span
            ><AccountCodeLink
              plain
              prefix="7"
              label="Maliyet Hesapları (7xx)"
              :from="income.from"
              :to="income.to"
              :exclude-sources="['year_end_result']" /></span
          ><b>{{ formatMoney(income.maliyetHesaplari7xx) }}</b>
        </p>
        <p class="total">
          <span>Dönem Net Kârı</span><b>{{ formatMoney(income.donemNetKari) }}</b>
        </p>
      </div>

      <div v-else-if="reportType === 'withholding' && withholding" class="wh-report">
        <div class="wh-block">
          <h3>KDV-2 (alışlar — sorumlu sıfatıyla)</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>KDV-2 Kodu</th>
                  <th>e-Fatura Kodu</th>
                  <th>İşlem Türü</th>
                  <th>Oran</th>
                  <th class="num">Belge</th>
                  <th class="num">Matrah</th>
                  <th class="num">KDV</th>
                  <th class="num">Tevkif Edilen</th>
                  <th class="num">Defter (360.01)</th>
                  <th class="num">Fark</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in withholding.kdv2" :key="i">
                  <td class="mono">
                    <AccountCodeLink
                      :code="`360.01.${r.kdv2Code}`"
                      :label="r.kdv2Code"
                      :from="withholding.from"
                      :to="withholding.to"
                    />
                  </td>
                  <td class="mono">{{ r.einvoiceCode }}</td>
                  <td>{{ r.name ?? '—' }}</td>
                  <td class="mono">{{ r.rate }}</td>
                  <td class="num">{{ r.documentCount }}</td>
                  <td class="num">{{ formatMoney(r.base) }}</td>
                  <td class="num">{{ formatMoney(r.vat) }}</td>
                  <td class="num">{{ formatMoney(r.withheld) }}</td>
                  <td class="num">{{ formatMoney(r.ledger) }}</td>
                  <td class="num" :class="{ 'wh-diff': hasDifference(r.difference) }">
                    {{ formatMoney(r.difference) }}
                  </td>
                </tr>
                <tr v-if="withholding.kdv2.length === 0">
                  <td colspan="10" class="muted">Bu dönemde KDV-2 tevkifatlı alış yok.</td>
                </tr>
              </tbody>
              <tfoot v-if="withholding.kdv2.length > 0">
                <tr>
                  <th colspan="5">Toplam</th>
                  <th class="num">{{ formatMoney(whTotals.kdv2Base) }}</th>
                  <th class="num">{{ formatMoney(whTotals.kdv2Vat) }}</th>
                  <th class="num">{{ formatMoney(withholding.kdv2Total) }}</th>
                  <th class="num">{{ formatMoney(whTotals.kdv2Ledger) }}</th>
                  <th class="num" :class="{ 'wh-diff': hasDifference(whTotals.kdv2Difference) }">
                    {{ formatMoney(whTotals.kdv2Difference) }}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="wh-block">
          <h3>KDV-1 kısmi tevkifat (satışlar)</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>e-Fatura Kodu</th>
                  <th>İşlem Türü</th>
                  <th>Oran</th>
                  <th class="num">Belge</th>
                  <th class="num">Matrah</th>
                  <th class="num">KDV</th>
                  <th class="num">Tevkif Edilen</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in withholding.kdv1" :key="i">
                  <td class="mono">{{ r.einvoiceCode }}</td>
                  <td>{{ r.name ?? '—' }}</td>
                  <td class="mono">{{ r.rate }}</td>
                  <td class="num">{{ r.documentCount }}</td>
                  <td class="num">{{ formatMoney(r.base) }}</td>
                  <td class="num">{{ formatMoney(r.vat) }}</td>
                  <td class="num">{{ formatMoney(r.withheld) }}</td>
                </tr>
                <tr v-if="withholding.kdv1.length === 0">
                  <td colspan="7" class="muted">Bu dönemde KDV-1 kısmi tevkifatlı satış yok.</td>
                </tr>
              </tbody>
              <tfoot v-if="withholding.kdv1.length > 0">
                <tr>
                  <th colspan="4">Toplam</th>
                  <th class="num">{{ formatMoney(whTotals.kdv1Base) }}</th>
                  <th class="num">{{ formatMoney(whTotals.kdv1Vat) }}</th>
                  <th class="num">{{ formatMoney(withholding.kdv1Total) }}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="showEntryModal"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-title"
    >
      <div class="modal-card">
        <h2 id="entry-title" class="card-title">Yeni Yevmiye Fişi</h2>
        <div class="entry-grid">
          <label
            ><span>Tarih</span><input v-model="entryForm.entry_date" type="date" class="input"
          /></label>
          <label
            ><span>Tür</span
            ><select v-model="entryForm.entry_type" class="select">
              <option v-for="t in ENTRY_TYPES" :key="t" :value="t">{{ t }}</option>
            </select></label
          >
          <label
            ><span>Durum</span
            ><select v-model="entryForm.status" class="select">
              <option value="draft">Taslak</option>
              <option value="posted">Onayla</option>
            </select></label
          >
          <label class="full"
            ><span>Açıklama</span
            ><input v-model="entryForm.description" type="text" class="input" maxlength="200"
          /></label>
        </div>
        <table class="data-table lines">
          <thead>
            <tr>
              <th>Hesap</th>
              <th class="num">Borç</th>
              <th class="num">Alacak</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, i) in entryForm.lines" :key="i">
              <td>
                <select v-model="line.account_id" class="select">
                  <option value="">Seçin…</option>
                  <option v-for="a in detailAccounts" :key="a.id" :value="a.id">
                    {{ a.code }} — {{ a.name }}
                  </option>
                </select>
              </td>
              <td class="num">
                <input
                  v-model.number="line.debit"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input num"
                />
              </td>
              <td class="num">
                <input
                  v-model.number="line.credit"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input num"
                />
              </td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" @click="removeLine(i)">
                  ×
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>Toplam</th>
              <th class="num">{{ formatMoney(entryTotals.debit) }}</th>
              <th class="num">{{ formatMoney(entryTotals.credit) }}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary btn-sm" @click="addLine">＋ Satır</button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm" @click="showEntryModal = false">
            İptal
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!entryTotals.balanced"
            @click="submitEntry"
          >
            Kaydet
          </button>
        </div>
        <p v-if="!entryTotals.balanced" class="muted small">
          Borç ve alacak eşit olmalı ({{ formatMoney(entryTotals.debit) }} ≠
          {{ formatMoney(entryTotals.credit) }}).
        </p>
      </div>
    </div>

    <AccountLedgerDrawer />
  </div>
</template>

<style scoped>
/* Mizan: 8 sütun kartın içine sığsın — hesap adı satır kırar, hücreler sıkı. */
.trial-table th,
.trial-table td {
  padding: 0.5rem 0.5rem;
}
.trial-table th {
  font-size: 0.6875rem;
  letter-spacing: 0;
}
.trial-table td:nth-child(2) {
  white-space: normal;
  min-width: 8rem;
  max-width: 13rem;
}
.trial-table td.num,
.trial-table th.num {
  font-size: 0.875rem;
}
.tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0;
  border-bottom: 1px solid #e5e7eb;
}
.entry-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--c-primary, #1d4ed8);
}
.entry-toggle:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
  border-radius: 2px;
}
.entry-lines-row > td {
  background: var(--c-bg, #f8fafc);
  padding: 0.5rem 0.875rem 0.875rem;
}
.entry-lines {
  background: var(--c-surface, #fff);
}
.pill-rev {
  margin-right: 6px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.tab {
  padding: 8px 14px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-weight: 600;
  color: #555;
}
.tab.active {
  color: var(--c-primary, #1d4ed8);
  border-bottom: 2px solid var(--c-primary, #1d4ed8);
}
.resequence-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin: 8px 0;
}
.resequence-bar label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.resequence-bar .input {
  width: 6rem;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.report-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin: 12px 0;
}
.report-controls label,
.entry-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.bs-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.bs-col h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
}
.bs-col p,
.is-list p {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
  margin: 0;
}
.bs-col p.total,
.is-list p.total {
  font-weight: 700;
  border-top: 2px solid #cbd5e1;
}
.is-list {
  max-width: 520px;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(820px, 94vw);
  max-height: 90vh;
  overflow: auto;
}
.entry-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 12px 0;
}
.entry-grid .full {
  grid-column: 1 / -1;
}
.data-table.lines select,
.data-table.lines input {
  width: 100%;
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.modal-actions .spacer {
  flex: 1;
}
.wh-report {
  display: grid;
  gap: 20px;
}
.wh-block h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
}
.wh-diff {
  background: #fef2f2;
  color: #b42318;
  font-weight: 700;
}
.trial-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.875rem;
  color: #555;
  cursor: pointer;
}
</style>
