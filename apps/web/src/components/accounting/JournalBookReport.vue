<script setup lang="ts">
// Yevmiye Defteri: ekran görünümü + resmî defter yazdırma (sayfalı) + Excel (CSV) indirme.
import { computed, ref } from 'vue';
import AccountCodeLink from '@/components/accounting/AccountCodeLink.vue';
import {
  JOURNAL_ROWS_PER_PAGE,
  addMoney,
  entryNoLabel,
  entryTypeLabel,
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
  type JournalBook,
  type JournalBookEntry,
} from '@/stores/accounting';

const props = defineProps<{ from: string; to: string }>();

const store = useAccountingStore();
const { print } = useBookPrintScope();
const company = useCompanyHeader();

const book = ref<JournalBook | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const notice = ref<string | null>(null);
const downloading = ref(false);
const downloadError = ref<string | null>(null);
let seq = 0;

const TRUNCATED_TEXT = 'İlk 5000 fiş gösteriliyor; tarih aralığını daraltın';

/** Üst bileşenin "Raporla" düğmesi bunu çağırır. */
async function load() {
  const mine = ++seq;
  notice.value = null;
  loadError.value = null;
  if (!props.from || !props.to || props.from > props.to) {
    loadError.value = 'Geçerli bir tarih aralığı seçin (başlangıç bitişten sonra olamaz).';
    return;
  }
  loading.value = true;
  try {
    const [res] = await Promise.all([store.journalBook(props.from, props.to), company.load()]);
    if (mine === seq) book.value = res;
  } catch (err) {
    if (mine === seq) {
      book.value = null;
      loadError.value = errorMessage(err, 'Yevmiye defteri yüklenemedi.');
    }
  } finally {
    if (mine === seq) loading.value = false;
  }
}
defineExpose({ load, hasData: computed(() => book.value !== null) });

const totals = computed(() => {
  let debit = 0;
  let credit = 0;
  for (const e of book.value?.entries ?? []) {
    debit = addMoney(debit, Number(e.total_debit));
    credit = addMoney(credit, Number(e.total_credit));
  }
  return { debit, credit };
});

const entryHeading = (e: JournalBookEntry) =>
  [entryNoLabel(e), formatDate(e.entry_date), entryTypeLabel(e.entry_type), e.description]
    .filter((x) => x !== null && x !== undefined && x !== '')
    .join(' · ');

// --- Excel (CSV) ---
async function downloadCsv() {
  downloadError.value = null;
  downloading.value = true;
  const from = book.value?.from ?? props.from;
  const to = book.value?.to ?? props.to;
  try {
    await store.downloadJournalBookCsv(from, to);
  } catch (err) {
    downloadError.value = errorMessage(err, 'CSV indirilemedi.');
  } finally {
    downloading.value = false;
  }
}

// --- Yazdırma: sabit satırlı resmî defter sayfaları ---
type PrintRow =
  | { kind: 'head'; key: string; no: string; date: string; text: string }
  | {
      kind: 'line';
      key: string;
      code: string;
      text: string;
      debit: number;
      credit: number;
    };
interface PrintPage {
  rows: PrintRow[];
  carryDebit: number;
  carryCredit: number;
  pageDebit: number;
  pageCredit: number;
  cumDebit: number;
  cumCredit: number;
}

const pages = computed<PrintPage[]>(() => {
  const entries = book.value?.entries ?? [];
  // Her fiş bölünmez bir grup; sayfadan büyük fişler (başlık + satırlar) başlığı tekrarlayarak bölünür.
  const cap = JOURNAL_ROWS_PER_PAGE;
  const groups: PrintRow[][] = [];
  for (const e of entries) {
    const label = [entryTypeLabel(e.entry_type), e.description].filter(Boolean).join(' · ');
    const lines: PrintRow[] = e.lines.map((l, i) => ({
      kind: 'line',
      key: `${e.entry_id}-${i}`,
      code: l.account_code,
      text: l.description ? `${l.account_name} — ${l.description}` : l.account_name,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
    const head = (part: number): PrintRow => ({
      kind: 'head',
      key: `${e.entry_id}-h${part}`,
      no: entryNoLabel(e),
      date: formatDate(e.entry_date),
      text: part > 0 ? `${label} (devam)` : label,
    });
    if (lines.length + 1 <= cap) {
      groups.push([head(0), ...lines]);
    } else {
      const per = cap - 1;
      for (let i = 0, part = 0; i < lines.length; i += per, part++) {
        groups.push([head(part), ...lines.slice(i, i + per)]);
      }
    }
  }
  const out: PrintPage[] = [];
  let cumDebit = 0;
  let cumCredit = 0;
  for (const rows of paginateGroups(groups, cap)) {
    const carryDebit = cumDebit;
    const carryCredit = cumCredit;
    let pageDebit = 0;
    let pageCredit = 0;
    for (const r of rows) {
      if (r.kind === 'line') {
        pageDebit = addMoney(pageDebit, r.debit);
        pageCredit = addMoney(pageCredit, r.credit);
      }
    }
    cumDebit = addMoney(cumDebit, pageDebit);
    cumCredit = addMoney(cumCredit, pageCredit);
    out.push({ rows, carryDebit, carryCredit, pageDebit, pageCredit, cumDebit, cumCredit });
  }
  return out;
});

const periodText = computed(
  () => `${formatDate(book.value?.from ?? props.from)} – ${formatDate(book.value?.to ?? props.to)}`,
);

function onPrint() {
  notice.value = null;
  if (!book.value) {
    notice.value = 'Önce raporu oluşturun.';
    return;
  }
  if (book.value.truncated && !window.confirm(`${TRUNCATED_TEXT}. Yine de yazdırılsın mı?`)) return;
  print();
}
</script>

<template>
  <div class="jb">
    <div class="jb-actions">
      <button type="button" class="btn btn-secondary btn-sm" @click="onPrint">Yazdır / PDF</button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="downloading"
        @click="downloadCsv"
      >
        Excel (CSV)
      </button>
    </div>

    <p v-if="notice" class="alert" role="alert">{{ notice }}</p>
    <p v-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</p>
    <p v-if="downloadError" class="alert alert-error" role="alert">{{ downloadError }}</p>
    <p v-if="loading" class="muted" role="status">Yevmiye defteri yükleniyor…</p>

    <template v-if="book">
      <p v-if="book.truncated" class="alert" role="status">{{ TRUNCATED_TEXT }}.</p>
      <p class="jb-summary">
        {{ formatDate(book.from) }} – {{ formatDate(book.to) }} dönemi ·
        <b>{{ book.entries.length }}</b> fiş
        <template v-if="book.truncated">(toplam {{ book.total_entries }})</template>
      </p>
      <p v-if="book.entries.length === 0" class="muted">Bu dönemde yevmiye kaydı yok.</p>

      <article v-for="e in book.entries" :key="e.entry_id" class="jb-entry">
        <h3 class="jb-entry-head">{{ entryHeading(e) }}</h3>
        <div class="table-wrap">
          <table class="data-table jb-table">
            <thead>
              <tr>
                <th scope="col">Hesap kodu</th>
                <th scope="col">Hesap adı</th>
                <th scope="col">Açıklama</th>
                <th scope="col" class="num">Borç</th>
                <th scope="col" class="num">Alacak</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in e.lines" :key="i">
                <td>
                  <AccountCodeLink
                    :code="l.account_code"
                    :from="book.from"
                    :to="book.to"
                    include-closing
                  />
                </td>
                <td>{{ l.account_name }}</td>
                <td class="muted">{{ l.description }}</td>
                <td class="num">{{ moneyOrBlank(l.debit) }}</td>
                <td class="num">{{ moneyOrBlank(l.credit) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan="3">Fiş toplamı</th>
                <th class="num">{{ formatMoney(e.total_debit) }}</th>
                <th class="num">{{ formatMoney(e.total_credit) }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>

      <div class="jb-grand" role="group" aria-label="Genel toplam">
        <span>Genel toplam · {{ book.entries.length }} fiş</span>
        <span class="num">Borç {{ formatMoney(totals.debit) }}</span>
        <span class="num">Alacak {{ formatMoney(totals.credit) }}</span>
      </div>
    </template>
    <p v-else-if="!loading && !loadError" class="muted">Tarih aralığını seçip “Raporla”ya basın.</p>

    <!-- Resmî defter yazdırma kökü: ekranda gizli, yazdırmada tek görünen alan -->
    <Teleport to="body">
      <div v-if="book" class="book-print-root">
        <section v-for="(pg, pi) in pages" :key="pi" class="book-page">
          <header class="book-head">
            <div class="book-company">
              {{ company.companyName() }}
              <span v-if="company.taxLine()" class="book-tax">{{ company.taxLine() }}</span>
            </div>
            <div class="book-title">YEVMİYE DEFTERİ</div>
            <div class="book-period">{{ periodText }}</div>
            <div class="book-pageno">Sayfa {{ pi + 1 }} / {{ pages.length }}</div>
          </header>
          <table class="book-table">
            <colgroup>
              <col style="width: 15%" />
              <col style="width: 11%" />
              <col style="width: 12%" />
              <col style="width: 34%" />
              <col style="width: 14%" />
              <col style="width: 14%" />
            </colgroup>
            <thead>
              <tr>
                <th>Madde No</th>
                <th>Tarih</th>
                <th>Hesap Kodu</th>
                <th>Hesap Adı / Açıklama</th>
                <th class="num">Borç</th>
                <th class="num">Alacak</th>
              </tr>
            </thead>
            <tbody>
              <tr class="carry">
                <td colspan="4">Devreden</td>
                <td class="num">{{ formatMoney(pg.carryDebit) }}</td>
                <td class="num">{{ formatMoney(pg.carryCredit) }}</td>
              </tr>
              <template v-for="r in pg.rows" :key="r.key">
                <tr v-if="r.kind === 'head'" class="entry-head">
                  <td>{{ r.no }}</td>
                  <td>{{ r.date }}</td>
                  <td colspan="4">{{ r.text }}</td>
                </tr>
                <tr v-else>
                  <td></td>
                  <td></td>
                  <td>{{ r.code }}</td>
                  <td>{{ r.text }}</td>
                  <td class="num">{{ moneyOrBlank(r.debit) }}</td>
                  <td class="num">{{ moneyOrBlank(r.credit) }}</td>
                </tr>
              </template>
            </tbody>
            <tfoot>
              <tr class="sum">
                <td colspan="4">Sayfa toplamı</td>
                <td class="num">{{ formatMoney(pg.pageDebit) }}</td>
                <td class="num">{{ formatMoney(pg.pageCredit) }}</td>
              </tr>
              <tr :class="pi === pages.length - 1 ? 'sum grand' : 'sum'">
                <td colspan="4">{{ pi === pages.length - 1 ? 'Genel toplam' : 'Nakledilen' }}</td>
                <td class="num">{{ formatMoney(pg.cumDebit) }}</td>
                <td class="num">{{ formatMoney(pg.cumCredit) }}</td>
              </tr>
            </tfoot>
          </table>
        </section>
        <section v-if="pages.length === 0" class="book-page">
          <header class="book-head">
            <div class="book-company">{{ company.companyName() }}</div>
            <div class="book-title">YEVMİYE DEFTERİ</div>
            <div class="book-period">{{ periodText }}</div>
            <div class="book-pageno">Sayfa 1 / 1</div>
          </header>
          <p>Bu dönemde yevmiye kaydı yok.</p>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.jb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 12px;
}
.jb-summary {
  margin: 8px 0;
  font-size: 0.9rem;
  color: var(--c-muted, #64748b);
}
.jb-entry {
  margin: 0 0 14px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--c-surface, #fff);
}
.jb-entry-head {
  margin: 0;
  padding: 0.5rem 0.875rem;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--c-bg, #f8fafc);
  border-bottom: 1px solid var(--c-border, #e2e8f0);
}
.jb-table tfoot th {
  font-weight: 700;
  text-align: left;
}
.jb-table tfoot th.num {
  text-align: right;
}
.jb-grand {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  justify-content: space-between;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.5rem;
  background: var(--c-primary-soft, #eff6ff);
  font-weight: 700;
}
.num {
  font-variant-numeric: tabular-nums;
}
</style>
