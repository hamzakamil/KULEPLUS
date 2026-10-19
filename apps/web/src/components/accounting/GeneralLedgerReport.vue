<script setup lang="ts">
// Defter-i Kebir: hesap başına açılır/kapanır bloklar + resmî defter yazdırma + Excel (CSV).
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import AccountCodeLink from '@/components/accounting/AccountCodeLink.vue';
import {
  LEDGER_ROWS_PER_PAGE,
  entryNoLabel,
  formatDate,
  formatMoney,
  moneyOrBlank,
  paginateGroups,
  useBookPrintScope,
  useCompanyHeader,
} from '@/components/accounting/bookPrint';
import {
  errorMessage,
  useAccountingStore,
  type GeneralLedger,
  type GeneralLedgerAccount,
  type GeneralLedgerParams,
} from '@/stores/accounting';

const props = defineProps<{ from: string; to: string }>();

const store = useAccountingStore();
const { print } = useBookPrintScope();
const company = useCompanyHeader();

// --- Filtreler ---
const mainLevel = ref(false);
const onlyActive = ref(true);
const codePrefix = ref('');

watch(codePrefix, (v) => {
  const clean = v.replace(/[^0-9.]/g, '');
  if (clean !== v) codePrefix.value = clean;
});

const ledger = ref<GeneralLedger | null>(null);
/** Son başarılı yüklemede kullanılan parametreler (yazdırma/CSV aynı veriyi hedefler). */
const loadedParams = ref<GeneralLedgerParams | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const notice = ref<string | null>(null);
const downloading = ref(false);
const downloadError = ref<string | null>(null);
let seq = 0;

const TRUNCATED_TEXT = 'Sonuç kısaltıldı; tarih aralığını daraltın ya da hesap kodu ön eki girin';

function currentParams(): GeneralLedgerParams {
  return {
    from: props.from,
    to: props.to,
    level: mainLevel.value ? 'main' : 'detail',
    only_active: onlyActive.value,
    code_prefix: codePrefix.value.trim() || undefined,
  };
}

/** Hesap blokları: kayıt yoksa/çok azsa açık, değilse kapalı başlar. */
const expanded = reactive<Record<string, boolean>>({});

async function load() {
  const mine = ++seq;
  notice.value = null;
  loadError.value = null;
  if (!props.from || !props.to || props.from > props.to) {
    loadError.value = 'Geçerli bir tarih aralığı seçin (başlangıç bitişten sonra olamaz).';
    return;
  }
  const params = currentParams();
  loading.value = true;
  try {
    const [res] = await Promise.all([store.generalLedger(params), company.load()]);
    if (mine !== seq) return;
    ledger.value = res;
    loadedParams.value = params;
    for (const k of Object.keys(expanded)) delete expanded[k];
    const open = res.accounts.length <= 5;
    for (const a of res.accounts) expanded[a.code] = open;
  } catch (err) {
    if (mine !== seq) return;
    ledger.value = null;
    loadedParams.value = null;
    loadError.value = errorMessage(err, 'Defter-i kebir yüklenemedi.');
  } finally {
    if (mine === seq) loading.value = false;
  }
}
defineExpose({ load, hasData: computed(() => ledger.value !== null) });

// Rapor bir kez yüklendiyse süzgeç değişince kendini yeniler (ön ek biraz bekletilir).
let timer: ReturnType<typeof setTimeout> | undefined;
watch([mainLevel, onlyActive, codePrefix], () => {
  if (!ledger.value) return;
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 400);
});
onBeforeUnmount(() => clearTimeout(timer));

// --- Aç / kapat ---
const allOpen = computed(
  () => !!ledger.value?.accounts.length && ledger.value.accounts.every((a) => expanded[a.code]),
);
function setAll(open: boolean) {
  for (const a of ledger.value?.accounts ?? []) expanded[a.code] = open;
}
const panelId = (code: string) => `gl-panel-${code.replace(/[^0-9A-Za-z]/g, '_')}`;

function closingText(a: GeneralLedgerAccount): string {
  const b = Number(a.closing.balance ?? 0);
  if (!b) return formatMoney(0);
  const side = a.closing.side || (b > 0 ? 'B' : 'A');
  return `${formatMoney(Math.abs(b))} ${side}`;
}
function balanceText(b: number): string {
  const n = Number(b ?? 0);
  if (Math.abs(n) < 0.005) return formatMoney(0);
  return `${formatMoney(Math.abs(n))} ${n > 0 ? 'B' : 'A'}`;
}

// --- Excel (CSV) ---
async function downloadCsv() {
  downloadError.value = null;
  downloading.value = true;
  try {
    await store.downloadGeneralLedgerCsv(loadedParams.value ?? currentParams());
  } catch (err) {
    downloadError.value = errorMessage(err, 'CSV indirilemedi.');
  } finally {
    downloading.value = false;
  }
}

// --- Yazdırma: sabit satırlı resmî defter sayfaları (tüm hesaplar açık) ---
type PrintRow =
  | { kind: 'acct'; key: string; acct: GeneralLedgerAccount }
  | { kind: 'cont'; key: string; acct: GeneralLedgerAccount }
  | { kind: 'open'; key: string; acct: GeneralLedgerAccount }
  | {
      kind: 'row';
      key: string;
      acct: GeneralLedgerAccount;
      date: string;
      no: string;
      text: string;
      debit: number;
      credit: number;
      balance: number;
    }
  | { kind: 'total'; key: string; acct: GeneralLedgerAccount };

const pages = computed<PrintRow[][]>(() => {
  const groups: PrintRow[][] = [];
  for (const a of ledger.value?.accounts ?? []) {
    const head: PrintRow[] = [
      { kind: 'acct', key: `${a.code}-h`, acct: a },
      { kind: 'open', key: `${a.code}-o`, acct: a },
    ];
    const rows: PrintRow[] = a.rows.map((r, i) => ({
      kind: 'row',
      key: `${a.code}-r${i}`,
      acct: a,
      date: formatDate(r.entry_date),
      no: entryNoLabel(r),
      text: r.description ?? '',
      debit: Number(r.debit),
      credit: Number(r.credit),
      balance: Number(r.balance),
    }));
    const total: PrintRow = { kind: 'total', key: `${a.code}-t`, acct: a };
    if (rows.length === 0) {
      groups.push([...head, total]);
    } else if (rows.length === 1) {
      groups.push([...head, rows[0], total]);
    } else {
      // Başlık + Devir + ilk satır birlikte kalır; son satır dönem toplamıyla birlikte.
      groups.push([...head, rows[0]]);
      for (let i = 1; i < rows.length - 1; i++) groups.push([rows[i]]);
      groups.push([rows[rows.length - 1], total]);
    }
  }
  return paginateGroups(groups, LEDGER_ROWS_PER_PAGE).map((pg) =>
    // Hesap bir önceki sayfadan devam ediyorsa sayfa başına hesap adı satırı eklenir.
    pg[0] && (pg[0].kind === 'row' || pg[0].kind === 'total')
      ? [{ kind: 'cont' as const, key: `${pg[0].key}-c`, acct: pg[0].acct }, ...pg]
      : pg,
  );
});

const periodText = computed(
  () =>
    `${formatDate(ledger.value?.from ?? props.from)} – ${formatDate(ledger.value?.to ?? props.to)}`,
);

function onPrint() {
  notice.value = null;
  if (!ledger.value) {
    notice.value = 'Önce raporu oluşturun.';
    return;
  }
  if (ledger.value.truncated && !window.confirm(`${TRUNCATED_TEXT}. Yine de yazdırılsın mı?`))
    return;
  print();
}
</script>

<template>
  <div class="gl">
    <div class="gl-filters">
      <label class="gl-check">
        <input v-model="mainLevel" type="checkbox" />
        Ana hesap düzeyinde (alt hesaplar toplansın)
      </label>
      <label class="gl-check">
        <input v-model="onlyActive" type="checkbox" />
        Yalnız hareketli hesaplar
      </label>
      <label class="gl-prefix">
        <span>Hesap kodu ön eki</span>
        <input
          v-model="codePrefix"
          type="text"
          class="input"
          inputmode="numeric"
          autocomplete="off"
          placeholder="örn. 320 (boş = hepsi)"
        />
      </label>
    </div>

    <div class="gl-actions">
      <button type="button" class="btn btn-secondary btn-sm" @click="onPrint">Yazdır / PDF</button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="downloading"
        @click="downloadCsv"
      >
        Excel (CSV)
      </button>
      <template v-if="ledger && ledger.accounts.length > 0">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="allOpen"
          @click="setAll(true)"
        >
          Tümünü aç
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="!ledger.accounts.some((a) => expanded[a.code])"
          @click="setAll(false)"
        >
          Tümünü kapat
        </button>
      </template>
    </div>

    <p v-if="notice" class="alert" role="alert">{{ notice }}</p>
    <p v-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</p>
    <p v-if="downloadError" class="alert alert-error" role="alert">{{ downloadError }}</p>
    <p v-if="loading" class="muted" role="status">Defter-i kebir yükleniyor…</p>

    <template v-if="ledger">
      <p v-if="ledger.truncated" class="alert" role="status">{{ TRUNCATED_TEXT }}.</p>
      <p class="gl-summary">
        {{ formatDate(ledger.from) }} – {{ formatDate(ledger.to) }} dönemi ·
        <b>{{ ledger.accounts.length }}</b> hesap
      </p>
      <p v-if="ledger.accounts.length === 0" class="muted">Koşullara uyan hesap yok.</p>

      <section v-for="a in ledger.accounts" :key="a.code" class="gl-acc">
        <h3 class="gl-head" @click="expanded[a.code] = !expanded[a.code]">
          <button
            type="button"
            class="gl-toggle"
            :aria-expanded="!!expanded[a.code]"
            :aria-controls="panelId(a.code)"
            :aria-label="`${a.code} — ${a.name} hesabını ${expanded[a.code] ? 'kapat' : 'aç'}`"
            @click.stop="expanded[a.code] = !expanded[a.code]"
          >
            <span class="gl-chevron" :class="{ open: expanded[a.code] }" aria-hidden="true">▸</span>
          </button>
          <span class="gl-title">
            <AccountCodeLink :code="a.code" :from="ledger.from" :to="ledger.to" include-closing />
            <span> — {{ a.name }}</span>
          </span>
          <span class="gl-close" :title="'Kapanış bakiyesi'">{{ closingText(a) }}</span>
        </h3>
        <div v-if="expanded[a.code]" :id="panelId(a.code)" class="table-wrap">
          <table class="data-table gl-table">
            <thead>
              <tr>
                <th scope="col">Tarih</th>
                <th scope="col">Madde</th>
                <th scope="col">Açıklama</th>
                <th scope="col" class="num">Borç</th>
                <th scope="col" class="num">Alacak</th>
                <th scope="col" class="num">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              <tr class="gl-open">
                <td colspan="3"><b>Devir</b></td>
                <td class="num">{{ moneyOrBlank(a.opening.debit) }}</td>
                <td class="num">{{ moneyOrBlank(a.opening.credit) }}</td>
                <td class="num">{{ balanceText(a.opening.balance) }}</td>
              </tr>
              <tr v-for="(r, i) in a.rows" :key="`${r.entry_id}-${i}`">
                <td class="nowrap">{{ formatDate(r.entry_date) }}</td>
                <td class="nowrap">{{ entryNoLabel(r) }}</td>
                <td>{{ r.description }}</td>
                <td class="num">{{ moneyOrBlank(r.debit) }}</td>
                <td class="num">{{ moneyOrBlank(r.credit) }}</td>
                <td class="num">{{ balanceText(r.balance) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan="3">Dönem toplamı</th>
                <th class="num">{{ formatMoney(a.period.debit) }}</th>
                <th class="num">{{ formatMoney(a.period.credit) }}</th>
                <th class="num">{{ closingText(a) }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </template>
    <p v-else-if="!loading && !loadError" class="muted">
      Süzgeçleri ve tarih aralığını seçip “Raporla”ya basın.
    </p>

    <!-- Resmî defter yazdırma kökü: ekranda gizli, yazdırmada tek görünen alan -->
    <Teleport to="body">
      <div v-if="ledger" class="book-print-root">
        <section v-for="(pg, pi) in pages" :key="pi" class="book-page">
          <header class="book-head">
            <div class="book-company">
              {{ company.companyName() }}
              <span v-if="company.taxLine()" class="book-tax">{{ company.taxLine() }}</span>
            </div>
            <div class="book-title">DEFTER-İ KEBİR</div>
            <div class="book-period">{{ periodText }}</div>
            <div class="book-pageno">Sayfa {{ pi + 1 }} / {{ pages.length }}</div>
          </header>
          <table class="book-table">
            <colgroup>
              <col style="width: 11%" />
              <col style="width: 11%" />
              <col style="width: 31%" />
              <col style="width: 15.5%" />
              <col style="width: 15.5%" />
              <col style="width: 16%" />
            </colgroup>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Madde No</th>
                <th>Açıklama</th>
                <th class="num">Borç</th>
                <th class="num">Alacak</th>
                <th class="num">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in pg" :key="r.key">
                <tr v-if="r.kind === 'acct'" class="acct-head">
                  <td colspan="6">{{ r.acct.code }} — {{ r.acct.name }}</td>
                </tr>
                <tr v-else-if="r.kind === 'cont'" class="cont-head">
                  <td colspan="6">{{ r.acct.code }} — {{ r.acct.name }} (devam)</td>
                </tr>
                <tr v-else-if="r.kind === 'open'" class="carry">
                  <td colspan="3">Devir</td>
                  <td class="num">{{ moneyOrBlank(r.acct.opening.debit) }}</td>
                  <td class="num">{{ moneyOrBlank(r.acct.opening.credit) }}</td>
                  <td class="num">{{ balanceText(r.acct.opening.balance) }}</td>
                </tr>
                <tr v-else-if="r.kind === 'row'">
                  <td>{{ r.date }}</td>
                  <td>{{ r.no }}</td>
                  <td>{{ r.text }}</td>
                  <td class="num">{{ moneyOrBlank(r.debit) }}</td>
                  <td class="num">{{ moneyOrBlank(r.credit) }}</td>
                  <td class="num">{{ balanceText(r.balance) }}</td>
                </tr>
                <tr v-else class="total">
                  <td colspan="3">Dönem toplamı</td>
                  <td class="num">{{ formatMoney(r.acct.period.debit) }}</td>
                  <td class="num">{{ formatMoney(r.acct.period.credit) }}</td>
                  <td class="num">{{ closingText(r.acct) }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>
        <section v-if="pages.length === 0" class="book-page">
          <header class="book-head">
            <div class="book-company">{{ company.companyName() }}</div>
            <div class="book-title">DEFTER-İ KEBİR</div>
            <div class="book-period">{{ periodText }}</div>
            <div class="book-pageno">Sayfa 1 / 1</div>
          </header>
          <p>Koşullara uyan hesap yok.</p>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gl-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: flex-end;
  margin: 4px 0 8px;
}
.gl-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  min-height: 2.25rem;
}
.gl-prefix {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.gl-prefix .input {
  width: 12rem;
}
.gl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
}
.gl-summary {
  margin: 8px 0;
  font-size: 0.9rem;
  color: var(--c-muted, #64748b);
}
.gl-acc {
  margin: 0 0 8px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--c-surface, #fff);
}
.gl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0.375rem 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--c-bg, #f8fafc);
  cursor: pointer;
}
.gl-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  border-radius: 4px;
}
.gl-toggle:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
}
.gl-chevron {
  display: inline-block;
  transition: transform 0.12s ease;
}
.gl-chevron.open {
  transform: rotate(90deg);
}
.gl-title {
  flex: 1;
  min-width: 0;
}
.gl-close {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gl-table tfoot th {
  font-weight: 700;
  text-align: left;
}
.gl-table tfoot th.num {
  text-align: right;
}
.gl-table .num {
  font-variant-numeric: tabular-nums;
}
.gl-open td {
  background: var(--c-bg, #f8fafc);
}
</style>
