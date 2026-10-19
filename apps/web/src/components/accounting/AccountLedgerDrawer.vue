<script setup lang="ts">
// Muavin paneli: sağdan açılan tek örnekli çekmece. Bir hesabın (veya ön ekin) hareketlerini
// listeler, fişe/kaynak belgeye iner ve aynı yerden düzeltme fişi girmeyi sağlar.
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import FilterableSelect from '@/components/FilterableSelect.vue';
import {
  errorMessage,
  useAccountingStore,
  type AccountingAccount,
  type AccountLedger,
  type EntryDetail,
} from '@/stores/accounting';
import { useLedgerDrawerStore } from '@/stores/ledgerDrawer';

const store = useAccountingStore();
const drawer = useLedgerDrawerStore();
const router = useRouter();

type View = 'list' | 'entry' | 'form';
const view = ref<View>('list');
const panelEl = ref<HTMLElement | null>(null);
const titleEl = ref<HTMLElement | null>(null);

// --- Biçimleyiciler ---
function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}
const money = (v: number | null | undefined) => (Number(v ?? 0) === 0 ? '—' : formatMoney(v));
/** Bakiye: pozitif Borç (B), negatif Alacak (A). */
function formatBalance(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (Math.abs(n) < 0.005) return formatMoney(0);
  return `${formatMoney(Math.abs(n))} ${n > 0 ? 'B' : 'A'}`;
}
function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('tr-TR');
}
function fmtSourceAmount(a: number | string, currency?: string | null): string {
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency || 'TRY',
    }).format(Number(a));
  } catch {
    return `${a} ${currency ?? ''}`.trim();
  }
}
const ENTRY_TYPE_LABELS: Record<string, string> = {
  mahsup: 'Mahsup',
  tahsil: 'Tahsil',
  tediye: 'Tediye',
  acilis: 'Açılış',
  duzeltme: 'Düzeltme',
  ters: 'Ters kayıt',
  donem_sonu: 'Dönem sonu',
  kapanis: 'Kapanış',
};
const entryTypeLabel = (t: string) => ENTRY_TYPE_LABELS[t] ?? t;
const STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  posted: 'Onaylı',
  cancelled: 'İptal',
};
function entryNoLabel(e: {
  entry_no: number | string | null;
  fiscal_year?: number | null;
}): string {
  if (e.entry_no === null || e.entry_no === undefined || e.entry_no === '') return 'Taslak';
  return e.fiscal_year ? `${e.fiscal_year}/${e.entry_no}` : String(e.entry_no);
}

// --- Muavin yükleme ---
const ledger = ref<AccountLedger | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const includeClosing = ref(false);
const notice = ref<string | null>(null);
let ledgerSeq = 0;

async function loadLedger() {
  if (!drawer.open || (!drawer.code && !drawer.prefix) || !drawer.from || !drawer.to) return;
  const seq = ++ledgerSeq;
  loading.value = true;
  loadError.value = null;
  try {
    const res = await store.accountLedger({
      code: drawer.code,
      prefix: drawer.prefix,
      from: drawer.from,
      to: drawer.to,
      include_closing: includeClosing.value,
      exclude_sources: drawer.excludeSources,
    });
    if (seq !== ledgerSeq) return;
    ledger.value = res;
  } catch (err) {
    if (seq !== ledgerSeq) return;
    ledger.value = null;
    loadError.value = errorMessage(err, 'Muavin yüklenemedi.');
  } finally {
    if (seq === ledgerSeq) loading.value = false;
  }
}

const isPrefix = computed(() => !drawer.code && !!drawer.prefix);
const defaultTitle = computed(() => {
  if (isPrefix.value) return `${drawer.prefix} ile başlayan hesaplar`;
  const a = ledger.value?.account;
  if (a && a.code === drawer.code) return `${a.code} — ${a.name}`;
  return drawer.code ?? '';
});
const heading = computed(() => drawer.title || defaultTitle.value);
const showAccountCol = computed(
  () =>
    isPrefix.value ||
    (ledger.value?.rows ?? []).some((r) => r.account_code !== ledger.value?.account.code),
);
/** Devir satırında tarih/madde/(hesap)/açıklama/karşı hesap sütunları birleşir. */
const lead = computed(() => (showAccountCol.value ? 5 : 4));

watch(
  () => [
    drawer.open,
    drawer.code,
    drawer.prefix,
    drawer.from,
    drawer.to,
    drawer.excludeSources.join(','),
    includeClosing.value,
  ],
  () => {
    if (drawer.open) void loadLedger();
  },
);

// Hesap/ön ek değişince (ya da panel açılınca) listeye dön, eski veriyi temizle.
let lastFocus: HTMLElement | null = null;
watch(
  () => [drawer.open, drawer.code, drawer.prefix],
  async ([isOpen], [wasOpen]) => {
    if (isOpen) {
      if (!wasOpen) {
        lastFocus = document.activeElement as HTMLElement | null;
        notice.value = null;
      }
      view.value = 'list';
      detail.value = null;
      ledger.value = null;
      loadError.value = null;
      await nextTick();
      titleEl.value?.focus();
    }
  },
);

// --- Fiş detayı ---
const detail = ref<EntryDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
let detailSeq = 0;

async function openEntry(id: string) {
  const seq = ++detailSeq;
  view.value = 'entry';
  detail.value = null;
  detailError.value = null;
  detailLoading.value = true;
  await nextTick();
  titleEl.value?.focus();
  try {
    const res = await store.fetchEntryDetail(id);
    if (seq === detailSeq) detail.value = res;
  } catch (err) {
    if (seq === detailSeq) detailError.value = errorMessage(err, 'Fiş yüklenemedi.');
  } finally {
    if (seq === detailSeq) detailLoading.value = false;
  }
}

function backToList() {
  view.value = 'list';
  void nextTick(() => titleEl.value?.focus());
}

function goAccount(code: string) {
  drawer.openAccount(code, {
    from: drawer.from,
    to: drawer.to,
    excludeSources: drawer.excludeSources,
  });
}

function sourceHref(link: string): string {
  try {
    return router.resolve(link).href;
  } catch {
    return link;
  }
}

const detailTotals = computed(() => {
  const lines = detail.value?.lines ?? [];
  return {
    debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
    credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
  };
});
const isCurrentAccount = (code: string) =>
  drawer.code
    ? code === drawer.code || code.startsWith(`${drawer.code}.`)
    : !!drawer.prefix && code.startsWith(drawer.prefix);

// --- Düzeltme fişi formu ---
interface FormLine {
  key: number;
  account_id: string;
  debit: number | string;
  credit: number | string;
  description: string;
}
let lineKey = 0;
const newLine = (account_id = ''): FormLine => ({
  key: ++lineKey,
  account_id,
  debit: '',
  credit: '',
  description: '',
});
const form = reactive({
  entry_date: '',
  entry_type: 'duzeltme' as 'duzeltme' | 'mahsup',
  description: '',
  lines: [] as FormLine[],
});
const formError = ref<string | null>(null);
const saving = ref(false);
let formBack: View = 'list';

const accountList = ref<AccountingAccount[]>([]);
const accountsLoading = ref(false);
const accountsError = ref<string | null>(null);
let accountsLoaded = false;
const accountOptions = computed(() =>
  accountList.value.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
);

/** Hesap planı sayfa sayfa çekilir (en çok 100/sayfa); FilterableSelect yerelde filtreler. */
async function loadAccountOptions() {
  if (accountsLoaded || accountsLoading.value) return;
  accountsLoading.value = true;
  accountsError.value = null;
  try {
    const all: AccountingAccount[] = [];
    for (let page = 1; page <= 30; page++) {
      const { items, totalPages } = await store.searchAccounts('', page);
      all.push(...items);
      if (items.length === 0 || page >= totalPages) break;
    }
    accountList.value = all;
    accountsLoaded = true;
    applyDefaultAccount();
  } catch (err) {
    accountsError.value = errorMessage(err, 'Hesap listesi yüklenemedi.');
  } finally {
    accountsLoading.value = false;
  }
}

/** İlk satır: panelde açık hesap (hesap modundaysa ve detay hesapsa). */
function applyDefaultAccount() {
  const first = form.lines[0];
  if (!first || first.account_id || !drawer.code) return;
  const acc = accountList.value.find((a) => a.code === drawer.code);
  if (acc) first.account_id = acc.id;
}

function resetForm() {
  form.entry_date = drawer.to;
  form.entry_type = 'duzeltme';
  form.description = '';
  form.lines = [newLine(), newLine()];
  formError.value = null;
  applyDefaultAccount();
}

function openForm() {
  formBack = view.value === 'entry' ? 'entry' : 'list';
  resetForm();
  view.value = 'form';
  void loadAccountOptions();
  void nextTick(() => titleEl.value?.focus());
}

function cancelForm() {
  view.value = formBack;
  void nextTick(() => titleEl.value?.focus());
}

function addFormLine() {
  form.lines.push(newLine());
}
function removeFormLine(i: number) {
  if (form.lines.length > 2) form.lines.splice(i, 1);
}

const toKurus = (v: number | string) => Math.round(Number(v || 0) * 100);
const filledLines = computed(() =>
  form.lines.filter((l) => l.account_id && (toKurus(l.debit) || toKurus(l.credit))),
);
const formTotals = computed(() => {
  const debit = form.lines.reduce((s, l) => s + toKurus(l.debit), 0);
  const credit = form.lines.reduce((s, l) => s + toKurus(l.credit), 0);
  return {
    debit: debit / 100,
    credit: credit / 100,
    diff: (debit - credit) / 100,
    balanced: debit === credit && debit > 0,
  };
});
const canPost = computed(
  () => formTotals.value.balanced && filledLines.value.length >= 2 && !saving.value,
);
const formDirty = computed(
  () =>
    view.value === 'form' &&
    (!!form.description.trim() ||
      form.lines.some((l) => l.debit !== '' || l.credit !== '' || !!l.description)),
);

function validateForm(): string | null {
  if (!form.entry_date) return 'Fiş tarihi gerekli.';
  if (!form.description.trim()) return 'Fiş açıklaması gerekli.';
  for (let i = 0; i < form.lines.length; i++) {
    const l = form.lines[i];
    const d = toKurus(l.debit);
    const c = toKurus(l.credit);
    if (d < 0 || c < 0) return `Satır ${i + 1}: negatif tutar girilemez.`;
    if (d > 0 && c > 0) return `Satır ${i + 1}: borç ve alacak aynı satırda girilemez.`;
    if ((d > 0 || c > 0) && !l.account_id) return `Satır ${i + 1}: hesap seçin.`;
  }
  if (filledLines.value.length === 0) return 'En az bir dolu satır gerekli.';
  return null;
}

async function submitForm(status: 'draft' | 'posted') {
  formError.value = validateForm();
  if (formError.value) return;
  if (status === 'posted' && !canPost.value) {
    formError.value = 'Onaylamak için en az iki satır ve eşit borç/alacak gerekli.';
    return;
  }
  saving.value = true;
  try {
    const res = await store.createEntry({
      entry_date: form.entry_date,
      entry_type: form.entry_type,
      description: form.description.trim(),
      status,
      lines: filledLines.value.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        ...(l.description.trim() ? { description: l.description.trim() } : {}),
      })),
    });
    const kind = form.entry_type === 'duzeltme' ? 'Düzeltme fişi' : 'Mahsup fişi';
    notice.value =
      status === 'posted'
        ? `${kind} onaylandı${res.entryNo ? ` (madde ${res.entryNo})` : ''}.`
        : `${kind} taslak olarak kaydedildi; onaylanana kadar muavinde görünmez.`;
    resetForm();
    view.value = 'list';
    drawer.markSaved();
    await loadLedger();
    void nextTick(() => titleEl.value?.focus());
  } catch (err) {
    formError.value = errorMessage(err, 'Fiş kaydedilemedi.');
  } finally {
    saving.value = false;
  }
}

// --- Kapatma, klavye, odak ---
function requestClose() {
  if (
    formDirty.value &&
    !window.confirm('Kaydedilmemiş düzeltme fişi var. Paneli kapatmak istiyor musunuz?')
  )
    return;
  drawer.close();
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function onKeydown(e: KeyboardEvent) {
  if (!drawer.open) return;
  if (e.key === 'Escape') {
    // Açık bir açılır liste (FilterableSelect) önce kendi Esc'sini işler.
    const t = e.target as HTMLElement | null;
    if (t?.getAttribute?.('aria-expanded') === 'true') return;
    e.preventDefault();
    requestClose();
  } else if (e.key === 'Tab' && panelEl.value) {
    const items = [...panelEl.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && panelEl.value.contains(active);
    if (!inside) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === titleEl.value)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

watch(
  () => drawer.open,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
      lastFocus?.focus?.();
      lastFocus = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
  drawer.close();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ld">
      <div v-if="drawer.open" class="ld-root">
        <div class="ld-overlay" @click="requestClose"></div>
        <aside
          ref="panelEl"
          class="ld-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ld-title"
        >
          <header class="ld-head">
            <div class="ld-titles">
              <h2 id="ld-title" ref="titleEl" class="ld-title" tabindex="-1">
                <template v-if="view === 'form'">Düzeltme fişi — {{ heading }}</template>
                <template v-else-if="view === 'entry'">
                  Fiş {{ detail ? entryNoLabel(detail) : '' }}
                </template>
                <template v-else>{{ heading }}</template>
              </h2>
              <p v-if="drawer.title && view === 'list'" class="ld-sub muted">
                {{ defaultTitle }}
              </p>
            </div>
            <button type="button" class="ld-close" aria-label="Paneli kapat" @click="requestClose">
              ×
            </button>
          </header>

          <div class="ld-body">
            <p v-if="notice && view === 'list'" class="alert alert-success" role="status">
              {{ notice }}
            </p>

            <!-- ============ Muavin listesi ============ -->
            <template v-if="view === 'list'">
              <div class="ld-filters">
                <label>
                  <span>Başlangıç</span>
                  <input v-model="drawer.from" type="date" class="input" />
                </label>
                <label>
                  <span>Bitiş</span>
                  <input v-model="drawer.to" type="date" class="input" />
                </label>
                <label class="ld-check">
                  <input v-model="includeClosing" type="checkbox" />
                  <span>Kapanış fişi dahil</span>
                </label>
                <span class="ld-spacer"></span>
                <button type="button" class="btn btn-secondary btn-sm" @click="openForm">
                  Düzeltme fişi gir
                </button>
              </div>

              <p v-if="loadError" class="alert alert-error" role="alert">{{ loadError }}</p>
              <p v-else-if="loading && !ledger" class="muted" role="status">Yükleniyor…</p>

              <template v-if="ledger">
                <div class="ld-summary" :aria-busy="loading">
                  <div>
                    <span>Devir bakiyesi</span>
                    <b>{{ formatBalance(ledger.opening.balance) }}</b>
                  </div>
                  <div>
                    <span>Dönem borç</span>
                    <b>{{ formatMoney(ledger.period.debit) }}</b>
                  </div>
                  <div>
                    <span>Dönem alacak</span>
                    <b>{{ formatMoney(ledger.period.credit) }}</b>
                  </div>
                  <div class="ld-sum-total">
                    <span>Kapanış bakiyesi</span>
                    <b>{{ formatBalance(ledger.closing.balance) }}</b>
                  </div>
                </div>

                <div class="table-wrap">
                  <table class="data-table ld-table">
                    <thead>
                      <tr>
                        <th scope="col">Tarih</th>
                        <th scope="col">Madde</th>
                        <th v-if="showAccountCol" scope="col">Hesap</th>
                        <th scope="col">Açıklama</th>
                        <th scope="col">Karşı hesap</th>
                        <th scope="col" class="num">Borç</th>
                        <th scope="col" class="num">Alacak</th>
                        <th scope="col" class="num">Bakiye</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr class="ld-open-row">
                        <td :colspan="lead"><b>Devir</b></td>
                        <td class="num">{{ money(ledger.opening.debit) }}</td>
                        <td class="num">{{ money(ledger.opening.credit) }}</td>
                        <td class="num">{{ formatBalance(ledger.opening.balance) }}</td>
                      </tr>
                      <tr
                        v-for="r in ledger.rows"
                        :key="r.line_id"
                        class="ld-row"
                        @click="openEntry(r.entry_id)"
                      >
                        <td class="nowrap">{{ fmtDate(r.entry_date) }}</td>
                        <td>
                          <button
                            type="button"
                            class="ld-link mono"
                            :aria-label="`Fiş ${entryNoLabel({ entry_no: r.entry_no, fiscal_year: r.fiscal_year })} ayrıntısı`"
                            @click.stop="openEntry(r.entry_id)"
                          >
                            {{
                              r.entry_no === null
                                ? '—'
                                : entryNoLabel({ entry_no: r.entry_no, fiscal_year: r.fiscal_year })
                            }}
                          </button>
                        </td>
                        <td v-if="showAccountCol" class="ld-acc">
                          <button
                            type="button"
                            class="ld-link mono"
                            :title="`Muavin: ${r.account_code} — ${r.account_name}`"
                            :aria-label="`Muavin: ${r.account_code}`"
                            @click.stop="goAccount(r.account_code)"
                          >
                            {{ r.account_code }}
                          </button>
                          <span class="muted"> {{ r.account_name }}</span>
                        </td>
                        <td class="ld-wrap">{{ r.description || r.entry_description || '—' }}</td>
                        <td class="mono ld-wrap">{{ r.counter_accounts || '—' }}</td>
                        <td class="num">{{ money(r.debit) }}</td>
                        <td class="num">{{ money(r.credit) }}</td>
                        <td class="num">{{ formatBalance(r.balance) }}</td>
                      </tr>
                      <tr v-if="ledger.rows.length === 0">
                        <td :colspan="lead + 3" class="empty-cell">Bu aralıkta hareket yok.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-if="ledger.truncated" class="muted ld-note" role="status">
                  İlk {{ ledger.rows.length }} satır gösteriliyor (toplam {{ ledger.total_rows }}).
                </p>
              </template>
            </template>

            <!-- ============ Fiş detayı ============ -->
            <template v-else-if="view === 'entry'">
              <div class="ld-filters">
                <button type="button" class="btn btn-secondary btn-sm" @click="backToList">
                  ← Muavine dön
                </button>
                <span class="ld-spacer"></span>
                <button type="button" class="btn btn-secondary btn-sm" @click="openForm">
                  Düzeltme fişi gir
                </button>
              </div>

              <p v-if="detailError" class="alert alert-error" role="alert">{{ detailError }}</p>
              <p v-else-if="detailLoading" class="muted" role="status">Yükleniyor…</p>

              <template v-if="detail">
                <dl class="ld-meta">
                  <div>
                    <dt>Madde</dt>
                    <dd class="mono">{{ entryNoLabel(detail) }}</dd>
                  </div>
                  <div>
                    <dt>Tarih</dt>
                    <dd>{{ fmtDate(detail.entry_date) }}</dd>
                  </div>
                  <div>
                    <dt>Tür</dt>
                    <dd>{{ entryTypeLabel(detail.entry_type) }}</dd>
                  </div>
                  <div>
                    <dt>Durum</dt>
                    <dd>{{ STATUS_LABELS[detail.status] ?? detail.status }}</dd>
                  </div>
                  <div class="ld-meta-wide">
                    <dt>Açıklama</dt>
                    <dd>{{ detail.description || '—' }}</dd>
                  </div>
                </dl>

                <h3 class="ld-h3">Fiş satırları</h3>
                <div class="table-wrap">
                  <table class="data-table ld-table">
                    <thead>
                      <tr>
                        <th scope="col">Kod</th>
                        <th scope="col">Hesap adı</th>
                        <th scope="col">Açıklama</th>
                        <th scope="col" class="num">Borç</th>
                        <th scope="col" class="num">Alacak</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(l, i) in detail.lines"
                        :key="l.id ?? i"
                        :class="{ 'ld-hl': isCurrentAccount(l.account_code) }"
                      >
                        <td>
                          <button
                            type="button"
                            class="ld-link mono"
                            :title="`Muavin: ${l.account_code}`"
                            :aria-label="`Muavin: ${l.account_code}`"
                            @click="goAccount(l.account_code)"
                          >
                            {{ l.account_code }}
                          </button>
                        </td>
                        <td class="ld-wrap">{{ l.account_name }}</td>
                        <td class="ld-wrap muted">{{ l.description || '' }}</td>
                        <td class="num">{{ money(l.debit) }}</td>
                        <td class="num">{{ money(l.credit) }}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colspan="3">Toplam</th>
                        <th class="num">{{ formatMoney(detailTotals.debit) }}</th>
                        <th class="num">{{ formatMoney(detailTotals.credit) }}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <section class="ld-source" aria-labelledby="ld-source-title">
                  <h3 id="ld-source-title" class="ld-h3">Kaynak belge</h3>
                  <template v-if="detail.source">
                    <dl class="ld-meta">
                      <div>
                        <dt>Belge</dt>
                        <dd>{{ detail.source.label }}</dd>
                      </div>
                      <div v-if="detail.source.number">
                        <dt>Numara</dt>
                        <dd class="mono">{{ detail.source.number }}</dd>
                      </div>
                      <div v-if="detail.source.date">
                        <dt>Tarih</dt>
                        <dd>{{ fmtDate(detail.source.date) }}</dd>
                      </div>
                      <div v-if="detail.source.contact_name">
                        <dt>Cari</dt>
                        <dd>{{ detail.source.contact_name }}</dd>
                      </div>
                      <div
                        v-if="detail.source.amount !== null && detail.source.amount !== undefined"
                      >
                        <dt>Tutar</dt>
                        <dd>{{ fmtSourceAmount(detail.source.amount, detail.source.currency) }}</dd>
                      </div>
                      <div v-if="detail.source.description" class="ld-meta-wide">
                        <dt>Açıklama</dt>
                        <dd>{{ detail.source.description }}</dd>
                      </div>
                    </dl>
                    <a
                      v-if="detail.source.link"
                      class="btn btn-secondary btn-sm ld-open-link"
                      :href="sourceHref(detail.source.link)"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Belgeyi yeni sekmede aç
                    </a>
                  </template>
                  <p v-else class="muted">
                    Bu fişin bağlı bir kaynak belgesi yok (elle girilmiş fiş).
                  </p>
                </section>
              </template>
            </template>

            <!-- ============ Düzeltme fişi formu ============ -->
            <form v-else class="ld-form" @submit.prevent>
              <p class="muted small">
                Fiş seçili aralıktaki bir tarihe işlenir. Onaylanan fiş yevmiyeye girer ve
                değiştirilemez.
              </p>
              <div class="ld-form-grid">
                <label>
                  <span>Tarih</span>
                  <input v-model="form.entry_date" type="date" class="input" />
                </label>
                <label>
                  <span>Fiş türü</span>
                  <select v-model="form.entry_type" class="select">
                    <option value="duzeltme">Düzeltme</option>
                    <option value="mahsup">Mahsup</option>
                  </select>
                </label>
                <label class="ld-full">
                  <span>Açıklama</span>
                  <input
                    v-model="form.description"
                    type="text"
                    class="input"
                    maxlength="200"
                    placeholder="Ör. 770 hesabından 770.01'e düzeltme"
                  />
                </label>
              </div>

              <p v-if="accountsLoading" class="muted" role="status">Hesap listesi yükleniyor…</p>
              <p v-if="accountsError" class="alert alert-error" role="alert">
                {{ accountsError }}
              </p>

              <div class="ld-lines">
                <div class="ld-line ld-line-head" aria-hidden="true">
                  <span>Hesap</span>
                  <span class="num">Borç</span>
                  <span class="num">Alacak</span>
                  <span>Satır açıklaması</span>
                  <span></span>
                </div>
                <div v-for="(line, i) in form.lines" :key="line.key" class="ld-line">
                  <FilterableSelect
                    :id="`ld-acc-${line.key}`"
                    v-model="line.account_id"
                    :options="accountOptions"
                    placeholder="Hesap ara (kod veya ad)…"
                    :aria-label="`Satır ${i + 1} hesap`"
                    :no-options-message="accountsLoading ? 'Yükleniyor…' : 'Hesap bulunamadı'"
                  />
                  <input
                    v-model="line.debit"
                    type="number"
                    min="0"
                    step="0.01"
                    class="input num"
                    :aria-label="`Satır ${i + 1} borç`"
                    placeholder="0,00"
                  />
                  <input
                    v-model="line.credit"
                    type="number"
                    min="0"
                    step="0.01"
                    class="input num"
                    :aria-label="`Satır ${i + 1} alacak`"
                    placeholder="0,00"
                  />
                  <input
                    v-model="line.description"
                    type="text"
                    class="input"
                    maxlength="200"
                    :aria-label="`Satır ${i + 1} açıklaması`"
                  />
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    :disabled="form.lines.length <= 2"
                    :aria-label="`Satır ${i + 1} sil`"
                    @click="removeFormLine(i)"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div class="ld-form-totals" :class="{ 'ld-bad': !formTotals.balanced }">
                <button type="button" class="btn btn-secondary btn-sm" @click="addFormLine">
                  ＋ Satır ekle
                </button>
                <span class="ld-spacer"></span>
                <span
                  >Borç <b>{{ formatMoney(formTotals.debit) }}</b></span
                >
                <span
                  >Alacak <b>{{ formatMoney(formTotals.credit) }}</b></span
                >
                <span role="status">
                  Fark <b>{{ formatMoney(Math.abs(formTotals.diff)) }}</b>
                  <template v-if="formTotals.balanced"> — dengeli</template>
                </span>
              </div>

              <p v-if="formError" class="alert alert-error" role="alert">{{ formError }}</p>

              <div class="ld-form-actions">
                <button type="button" class="btn btn-secondary btn-sm" @click="cancelForm">
                  Vazgeç
                </button>
                <span class="ld-spacer"></span>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="saving"
                  @click="submitForm('draft')"
                >
                  Taslak kaydet
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="!canPost"
                  :title="canPost ? '' : 'Onay için borç ve alacak eşit olmalı'"
                  @click="submitForm('posted')"
                >
                  Kaydet ve onayla
                </button>
              </div>
            </form>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ld-root {
  position: fixed;
  inset: 0;
  z-index: 1100;
}
.ld-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
}
.ld-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(860px, 95vw);
  display: flex;
  flex-direction: column;
  background: var(--c-surface, #fff);
  box-shadow: -12px 0 32px rgba(15, 23, 42, 0.18);
}
.ld-enter-active,
.ld-leave-active {
  transition: opacity 0.18s ease;
}
.ld-enter-active .ld-panel,
.ld-leave-active .ld-panel {
  transition: transform 0.22s ease;
}
.ld-enter-from,
.ld-leave-to {
  opacity: 0;
}
.ld-enter-from .ld-panel,
.ld-leave-to .ld-panel {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .ld-enter-active,
  .ld-leave-active,
  .ld-enter-active .ld-panel,
  .ld-leave-active .ld-panel {
    transition: none;
  }
}

.ld-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--c-border, #e2e8f0);
}
.ld-titles {
  min-width: 0;
}
.ld-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.ld-title:focus {
  outline: none;
}
.ld-title:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
  border-radius: 4px;
}
.ld-sub {
  margin: 2px 0 0;
  font-size: 0.8125rem;
}
.ld-close {
  border: 0;
  background: transparent;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  color: var(--c-muted, #64748b);
  padding: 0.15rem 0.55rem;
  border-radius: 0.375rem;
}
.ld-close:hover {
  background: var(--c-bg, #f8fafc);
  color: var(--c-text, #0f172a);
}
.ld-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
}

.ld-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 14px;
}
.ld-filters label,
.ld-form-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.ld-filters .ld-check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  padding-bottom: 0.5rem;
}
.ld-spacer {
  flex: 1;
}

.ld-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.ld-summary > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.5rem;
  background: var(--c-bg, #f8fafc);
}
.ld-summary span {
  font-size: 0.72rem;
  color: var(--c-muted, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.ld-summary b {
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
}
.ld-sum-total {
  background: var(--c-primary-soft, #eff6ff) !important;
  border-color: #bfdbfe !important;
}
@media (max-width: 640px) {
  .ld-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.ld-table th,
.ld-table td {
  padding: 0.5rem 0.625rem;
  font-size: 0.875rem;
}
.ld-table .ld-wrap {
  white-space: normal;
  min-width: 7rem;
  max-width: 16rem;
}
.ld-table .ld-acc {
  white-space: normal;
  min-width: 8rem;
}
.ld-open-row td {
  background: var(--c-bg, #f8fafc);
}
.ld-row {
  cursor: pointer;
}
.ld-hl td {
  background: #fffbeb;
}
.ld-link {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-primary, #1d4ed8);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}
.ld-link:hover {
  text-decoration-style: solid;
}
.ld-link:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
  border-radius: 2px;
}
.ld-note {
  margin: 8px 0 0;
  font-size: 0.8125rem;
}

.ld-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 0 0 16px;
}
.ld-meta > div {
  min-width: 0;
}
.ld-meta dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted, #64748b);
}
.ld-meta dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
.ld-meta .ld-meta-wide {
  grid-column: 1 / -1;
}
@media (max-width: 640px) {
  .ld-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ld-h3 {
  margin: 16px 0 8px;
  font-size: 0.95rem;
  font-weight: 700;
}
.ld-source {
  margin-top: 18px;
  padding: 4px 14px 14px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.75rem;
  background: var(--c-bg, #f8fafc);
}
.ld-source .ld-meta {
  margin-bottom: 10px;
}
.ld-open-link {
  text-decoration: none;
  display: inline-block;
}

.ld-form {
  padding-bottom: 10rem; /* açılır hesap listesine yer */
}
.ld-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0;
}
.ld-form-grid .ld-full {
  grid-column: 1 / -1;
}
.ld-lines {
  display: grid;
  gap: 8px;
}
.ld-line {
  display: grid;
  grid-template-columns: minmax(0, 2.4fr) 7.5rem 7.5rem minmax(0, 1.4fr) 2.25rem;
  gap: 8px;
  align-items: center;
}
.ld-line-head {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted, #64748b);
  font-weight: 600;
}
.ld-line-head .num {
  text-align: right;
}
.ld-line .input {
  width: 100%;
  box-sizing: border-box;
}
.ld-line input.num {
  text-align: right;
}
.ld-form-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin: 14px 0 10px;
  padding: 8px 10px;
  border-radius: 0.5rem;
  background: var(--c-success-soft, #ecfdf5);
  font-size: 0.9rem;
}
.ld-form-totals.ld-bad {
  background: var(--c-warning-soft, #fffbeb);
}
.ld-form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
@media (max-width: 640px) {
  .ld-line {
    grid-template-columns: 1fr 1fr 2.25rem;
  }
  .ld-line > :first-child,
  .ld-line > :nth-child(4) {
    grid-column: 1 / -1;
  }
  .ld-line-head {
    display: none;
  }
}
</style>
