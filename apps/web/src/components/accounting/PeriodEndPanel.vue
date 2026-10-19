<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AccountCodeLink from '@/components/accounting/AccountCodeLink.vue';
import AccountCodeText from '@/components/accounting/AccountCodeText.vue';
import {
  errorMessage,
  useAccountingStore,
  type TaxSettings,
  type VatOffsetPreview,
  type YearEndInput,
  type YearEndResult,
} from '@/stores/accounting';
import { useLedgerDrawerStore } from '@/stores/ledgerDrawer';

const store = useAccountingStore();
const drawer = useLedgerDrawerStore();

function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}

const now = new Date();
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
const ENTRY_TYPE_LABELS: Record<string, string> = {
  donem_sonu: 'Dönem sonu',
  kapanis: 'Kapanış',
  acilis: 'Açılış',
  mahsup: 'Mahsup',
};
const entryTypeLabel = (t: string) => ENTRY_TYPE_LABELS[t] ?? t;

// --- A) Aylık KDV mahsup fişi ---
const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const vatYear = ref(prevMonth.getFullYear());
const vatMonth = ref(prevMonth.getMonth() + 1);
const vatPreview = ref<VatOffsetPreview | null>(null);
const vatBusy = ref(false);
const vatError = ref<string | null>(null);
const vatSuccess = ref<string | null>(null);

async function loadVatPreview(keepMessage = false) {
  vatBusy.value = true;
  vatError.value = null;
  if (!keepMessage) vatSuccess.value = null;
  try {
    vatPreview.value = await store.vatOffsetPreview(vatYear.value, vatMonth.value);
  } catch (err) {
    vatPreview.value = null;
    vatError.value = errorMessage(err, 'KDV mahsup önizlemesi alınamadı.');
  } finally {
    vatBusy.value = false;
  }
}

/** KDV muavin aralığı: seçilen ayın 1'i – mahsup fişi tarihi. */
const vatRange = computed(() => {
  const mm = String(vatYear.value).padStart(4, '0') + '-' + String(vatMonth.value).padStart(2, '0');
  const lastDay = new Date(vatYear.value, vatMonth.value, 0).getDate();
  return {
    from: `${mm}-01`,
    to: vatPreview.value?.entry_date?.slice(0, 10) || `${mm}-${String(lastDay).padStart(2, '0')}`,
  };
});

const vatTotals = computed(() => {
  const lines = vatPreview.value?.lines ?? [];
  return {
    debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
    credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
  };
});

async function createVatEntry() {
  if (!vatPreview.value || vatPreview.value.existing_entry) return;
  const label = `${vatYear.value} ${MONTHS[vatMonth.value - 1]}`;
  if (!window.confirm(`${label} dönemi için KDV mahsup fişi kesilsin mi?`)) return;
  vatBusy.value = true;
  vatError.value = null;
  vatSuccess.value = null;
  try {
    const res = await store.createVatOffset(vatYear.value, vatMonth.value);
    vatSuccess.value = `Madde ${res.entry_no ?? '—'} ile kesildi.`;
    await loadVatPreview(true);
  } catch (err) {
    vatError.value = errorMessage(err, 'KDV mahsup fişi kesilemedi.');
  } finally {
    vatBusy.value = false;
  }
}

// --- B) Yıl sonu kapanış sihirbazı ---
const yeYear = ref(now.getFullYear() - 1);
const settings = reactive<TaxSettings>({ taxpayer_type: 'kurumlar', corporate_tax_rate: 25 });
const settingsBusy = ref(false);
const settingsMsg = ref<{ kind: 'ok' | 'error'; text: string } | null>(null);

// Sayı alanları: boş değer = gönderme.
const kkeg = ref<number | string>('');
const deductions = ref<number | string>('');
const taxRate = ref<number | string>('');
const taxAmount = ref<number | string>('');
const transferResult = ref(false);
/** Kullanıcının düzenlediği yansıtma hedefleri (source_code → target_code). */
const targets = reactive<Record<string, string>>({});

const result = ref<YearEndResult | null>(null);
const yeBusy = ref(false);
const yeError = ref<string | null>(null);
const yeSuccess = ref<string | null>(null);
const openEntries = reactive<Record<number, boolean>>({});

async function loadSettings() {
  try {
    const s = await store.getTaxSettings();
    settings.taxpayer_type = s.taxpayer_type;
    settings.corporate_tax_rate = Number(s.corporate_tax_rate);
  } catch (err) {
    settingsMsg.value = { kind: 'error', text: errorMessage(err, 'Vergi ayarları yüklenemedi.') };
  }
}

async function saveSettings() {
  settingsBusy.value = true;
  settingsMsg.value = null;
  try {
    const s = await store.saveTaxSettings({
      taxpayer_type: settings.taxpayer_type,
      corporate_tax_rate: Number(settings.corporate_tax_rate),
    });
    settings.taxpayer_type = s.taxpayer_type;
    settings.corporate_tax_rate = Number(s.corporate_tax_rate);
    settingsMsg.value = { kind: 'ok', text: 'Vergi ayarı kaydedildi.' };
  } catch (err) {
    settingsMsg.value = { kind: 'error', text: errorMessage(err, 'Vergi ayarı kaydedilemedi.') };
  } finally {
    settingsBusy.value = false;
  }
}

function numOrUndef(v: string | number | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildInput(): YearEndInput {
  const input: YearEndInput = { fiscal_year: Number(yeYear.value) };
  const reflections = (result.value?.reflections ?? []).map((r) => ({
    source_code: r.source_code,
    target_code: (targets[r.source_code] ?? r.target_code).trim(),
  }));
  if (reflections.length > 0) input.reflections = reflections;
  const tax: NonNullable<YearEndInput['tax']> = {};
  const k = numOrUndef(kkeg.value);
  const d = numOrUndef(deductions.value);
  const r = numOrUndef(taxRate.value);
  const a = numOrUndef(taxAmount.value);
  if (k !== undefined) tax.kkeg = k;
  if (d !== undefined) tax.deductions = d;
  if (r !== undefined) tax.rate = r;
  if (a !== undefined) tax.amount = a;
  if (Object.keys(tax).length > 0) input.tax = tax;
  if (transferResult.value) input.transfer_result = true;
  return input;
}

function applyResult(res: YearEndResult) {
  result.value = res;
  for (const r of res.reflections) {
    if (!(r.source_code in targets)) targets[r.source_code] = r.target_code;
  }
  for (const key of Object.keys(openEntries)) delete openEntries[Number(key)];
}

async function previewYearEnd() {
  yeBusy.value = true;
  yeError.value = null;
  yeSuccess.value = null;
  try {
    applyResult(await store.yearEndPreview(buildInput()));
  } catch (err) {
    yeError.value = errorMessage(err, 'Kapanış önizlemesi alınamadı.');
  } finally {
    yeBusy.value = false;
  }
}

async function closeYear() {
  if (
    !window.confirm(
      `${yeYear.value} yılı kapatılacak; kapanış ve açılış fişleri kesilecek, dönem kapanacak. Devam?`,
    )
  )
    return;
  yeBusy.value = true;
  yeError.value = null;
  yeSuccess.value = null;
  try {
    const res = await store.yearEndClose(buildInput());
    applyResult(res);
    yeSuccess.value = `${res.fiscal_year} yılı kapatıldı; ${res.entries.length} fiş kesildi.`;
  } catch (err) {
    yeError.value = errorMessage(err, 'Yıl sonu kapanışı yapılamadı.');
  } finally {
    yeBusy.value = false;
  }
}

async function undoClose() {
  if (
    !window.confirm(
      `${yeYear.value} yılı kapanışı geri alınacak; kapanış ve açılış fişleri kaldırılacak. Devam?`,
    )
  )
    return;
  yeBusy.value = true;
  yeError.value = null;
  yeSuccess.value = null;
  try {
    const res = await store.yearEndUndo(Number(yeYear.value));
    result.value = null;
    yeSuccess.value = `${res.removed_entries} fiş kaldırıldı, dönem yeniden açıldı.`;
  } catch (err) {
    yeError.value = errorMessage(err, 'Kapanış geri alınamadı.');
  } finally {
    yeBusy.value = false;
  }
}

// Girdi değişince eski önizleme geçersiz: "Kapanışı Yap" yeniden önizleme ister (ekranda görülen
// fişler kesilir). Hedef hesap düzenlemeleri tabloyu gizlememek için burada izlenmez.
watch([yeYear, kkeg, deductions, taxRate, taxAmount, transferResult], () => {
  if (result.value && !result.value.closed) result.value = null;
});
watch(yeYear, () => {
  for (const key of Object.keys(targets)) delete targets[key];
});

/** Yıl sonu muavin aralığı: yılın 1 Ocak'ı – kapanış tarihi. */
const yeRange = computed(() => ({
  from: `${result.value ? result.value.fiscal_year : yeYear.value}-01-01`,
  to: result.value?.year_end?.slice(0, 10) || `${yeYear.value}-12-31`,
}));
/** Yansıtma hedef hesabının muavinini açar (kullanıcının düzenlediği değer geçerlidir). */
function openTargetLedger(sourceCode: string, fallback: string) {
  const code = (targets[sourceCode] ?? fallback).trim();
  if (code) drawer.openAccount(code, yeRange.value);
}

// Muavin panelinden düzeltme fişi kaydedilince açık önizlemeler yenilenir.
watch(
  () => drawer.lastSavedAt,
  async () => {
    if (vatPreview.value) void loadVatPreview(true);
    if (result.value && !result.value.closed) {
      const opened = { ...openEntries };
      await previewYearEnd();
      Object.assign(openEntries, opened);
    }
  },
);

const hasErrors = computed(() => (result.value?.errors.length ?? 0) > 0);
const netLabel = computed(() =>
  (result.value?.net_result ?? 0) < 0 ? 'Dönem net zararı' : 'Dönem net kârı',
);

function entryTotals(lines: { debit: number; credit: number }[]) {
  return {
    debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
    credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
  };
}

onMounted(async () => {
  await loadSettings();
});
</script>

<template>
  <div class="pe-panel">
    <!-- A) Aylık KDV mahsup fişi -->
    <section class="card" aria-labelledby="pe-vat-title">
      <div class="card-head">
        <h2 id="pe-vat-title" class="card-title">Aylık KDV Mahsup Fişi</h2>
      </div>
      <p class="muted small">
        Hesaplanan (391) ve indirilecek (191) KDV mahsup edilir; ödenecek KDV 360.02'ye, fazlası
        sonraki aya devreden KDV olarak aktarılır.
      </p>

      <div class="pe-controls">
        <label>
          <span>Yıl</span>
          <input v-model.number="vatYear" type="number" min="2000" max="2100" class="input" />
        </label>
        <label>
          <span>Ay</span>
          <select v-model.number="vatMonth" class="select">
            <option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option>
          </select>
        </label>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="vatBusy"
          @click="loadVatPreview()"
        >
          Önizle
        </button>
      </div>

      <p v-if="vatError" class="alert alert-error" role="alert">
        <AccountCodeText :text="vatError" :from="vatRange.from" :to="vatRange.to" />
      </p>
      <p v-if="vatSuccess" class="alert alert-success" role="status">{{ vatSuccess }}</p>

      <template v-if="vatPreview">
        <div v-if="vatPreview.warnings.length > 0" class="pe-warn" role="status">
          <ul>
            <li v-for="(w, i) in vatPreview.warnings" :key="i">
              <AccountCodeText :text="w" :from="vatRange.from" :to="vatRange.to" />
            </li>
          </ul>
        </div>

        <div class="pe-summary">
          <p>
            <span
              >Hesaplanan KDV (<AccountCodeLink
                code="391"
                :from="vatRange.from"
                :to="vatRange.to"
              />)</span
            ><b>{{ formatMoney(vatPreview.hesaplanan_kdv) }}</b>
          </p>
          <p>
            <span
              >İndirilecek KDV (<AccountCodeLink
                code="191"
                :from="vatRange.from"
                :to="vatRange.to"
              />)</span
            ><b>{{ formatMoney(vatPreview.indirilecek_kdv) }}</b>
          </p>
          <p>
            <span
              >Önceki aydan devreden (<AccountCodeLink
                code="190"
                :from="vatRange.from"
                :to="vatRange.to"
              />)</span
            ><b>{{ formatMoney(vatPreview.devreden_onceki) }}</b>
          </p>
          <p class="total">
            <span
              >Ödenecek KDV (<AccountCodeLink
                code="360.02"
                :from="vatRange.from"
                :to="vatRange.to"
              />)</span
            ><b>{{ formatMoney(vatPreview.odenecek_kdv) }}</b>
          </p>
          <p>
            <span>Sonraki aya devreden KDV</span
            ><b>{{ formatMoney(vatPreview.devreden_sonraki) }}</b>
          </p>
          <p class="info">
            <span
              >Sorumlu sıfatıyla KDV (KDV-2,
              <AccountCodeLink code="360.01" :from="vatRange.from" :to="vatRange.to" />)</span
            ><b>{{ formatMoney(vatPreview.sorumlu_kdv) }}</b>
          </p>
        </div>

        <h3 class="pe-sub">Kesilecek fiş satırları ({{ vatPreview.entry_date }})</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Hesap Kodu</th>
                <th scope="col">Hesap Adı</th>
                <th scope="col" class="num">Borç</th>
                <th scope="col" class="num">Alacak</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in vatPreview.lines" :key="i">
                <td class="mono">
                  <AccountCodeLink :code="l.account_code" :from="vatRange.from" :to="vatRange.to" />
                </td>
                <td>{{ l.account_name }}</td>
                <td class="num">{{ l.debit ? formatMoney(l.debit) : '—' }}</td>
                <td class="num">{{ l.credit ? formatMoney(l.credit) : '—' }}</td>
              </tr>
              <tr v-if="vatPreview.lines.length === 0">
                <td colspan="4" class="muted">Bu ay için kesilecek satır yok.</td>
              </tr>
            </tbody>
            <tfoot v-if="vatPreview.lines.length > 0">
              <tr>
                <th colspan="2">Alt toplam</th>
                <th class="num">{{ formatMoney(vatTotals.debit) }}</th>
                <th class="num">{{ formatMoney(vatTotals.credit) }}</th>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="pe-actions">
          <p v-if="vatPreview.existing_entry" class="pe-note" role="status">
            Bu ay için fiş kesilmiş (madde {{ vatPreview.existing_entry.entry_no ?? '—' }}).
          </p>
          <span class="spacer"></span>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="vatBusy || !!vatPreview.existing_entry || vatPreview.lines.length < 2"
            @click="createVatEntry"
          >
            Fişi Kes
          </button>
        </div>
      </template>
    </section>

    <!-- B) Yıl sonu kapanış sihirbazı -->
    <section class="card" aria-labelledby="pe-ye-title">
      <div class="card-head">
        <h2 id="pe-ye-title" class="card-title">Yıl Sonu Kapanış Sihirbazı</h2>
      </div>

      <div class="pe-controls">
        <label>
          <span>Kapanış yılı</span>
          <input v-model.number="yeYear" type="number" min="2000" max="2100" class="input" />
        </label>
      </div>

      <fieldset class="pe-fieldset">
        <legend>Vergi ayarları</legend>
        <div class="pe-controls">
          <label>
            <span>Mükellef türü</span>
            <select v-model="settings.taxpayer_type" class="select">
              <option value="kurumlar">Kurumlar vergisi mükellefi</option>
              <option value="gelir">Gelir vergisi mükellefi (şahıs)</option>
            </select>
          </label>
          <label>
            <span>Kurumlar vergisi oranı (%)</span>
            <input
              v-model.number="settings.corporate_tax_rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              class="input"
            />
          </label>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="settingsBusy"
            @click="saveSettings"
          >
            Ayarı kaydet
          </button>
        </div>
        <p
          v-if="settingsMsg"
          class="alert"
          :class="settingsMsg.kind === 'ok' ? 'alert-success' : 'alert-error'"
          :role="settingsMsg.kind === 'ok' ? 'status' : 'alert'"
        >
          {{ settingsMsg.text }}
        </p>
      </fieldset>

      <fieldset class="pe-fieldset">
        <legend>Vergi girdileri</legend>
        <div class="pe-controls">
          <label>
            <span>KKEG (TL)</span>
            <input v-model.number="kkeg" type="number" min="0" step="0.01" class="input num" />
          </label>
          <label>
            <span>İndirim/istisna ve geçmiş yıl zararları (TL)</span>
            <input
              v-model.number="deductions"
              type="number"
              min="0"
              step="0.01"
              class="input num"
            />
          </label>
          <label>
            <span>Bu kapanış için oran (%) — boş = ayar</span>
            <input
              v-model.number="taxRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              class="input"
            />
          </label>
          <label>
            <span>Elle vergi tutarı — boş = hesaplanan</span>
            <input v-model.number="taxAmount" type="number" min="0" step="0.01" class="input num" />
          </label>
        </div>
        <label class="pe-check">
          <input v-model="transferResult" type="checkbox" />
          <span>Dönem net kârını 570/580'e virmanla (açılış günü)</span>
        </label>
        <p class="muted small">Genel kurul kâr dağıtım kararından sonra önerilir.</p>
      </fieldset>

      <fieldset v-if="result && result.reflections.length > 0" class="pe-fieldset">
        <legend>Yansıtma hedefleri</legend>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Maliyet hesabı</th>
                <th scope="col">Yansıtma hesabı</th>
                <th scope="col">Hedef hesap</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in result.reflections" :key="r.source_code">
                <td class="mono">
                  <AccountCodeLink :code="r.source_code" :from="yeRange.from" :to="yeRange.to" />
                </td>
                <td class="mono">
                  <AccountCodeLink :code="r.reflect_code" :from="yeRange.from" :to="yeRange.to" />
                </td>
                <td>
                  <div class="pe-target-cell">
                    <input
                      v-model="targets[r.source_code]"
                      type="text"
                      class="input pe-target mono"
                      maxlength="20"
                      :aria-label="`${r.source_code} için hedef hesap`"
                    />
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      :title="`Muavin: ${targets[r.source_code] ?? r.target_code}`"
                      :aria-label="`${r.source_code} hedef hesabının muavinini aç`"
                      @click="openTargetLedger(r.source_code, r.target_code)"
                    >
                      Muavin
                    </button>
                  </div>
                </td>
                <td class="num">{{ formatMoney(r.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">Hedefi değiştirdiyseniz yeniden önizleyin.</p>
      </fieldset>

      <div class="pe-actions">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="yeBusy"
          @click="previewYearEnd"
        >
          Önizle
        </button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-danger btn-sm" :disabled="yeBusy" @click="undoClose">
          Kapanışı Geri Al
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="yeBusy || !result || hasErrors || result.closed"
          @click="closeYear"
        >
          Kapanışı Yap
        </button>
      </div>

      <p v-if="yeError" class="alert alert-error" role="alert">
        <AccountCodeText :text="yeError" :from="yeRange.from" :to="yeRange.to" />
      </p>
      <p v-if="yeSuccess" class="alert alert-success" role="status">{{ yeSuccess }}</p>

      <template v-if="result">
        <div v-if="result.errors.length > 0" class="alert alert-error" role="alert">
          <ul class="pe-list">
            <li v-for="(e, i) in result.errors" :key="i">
              <AccountCodeText :text="e" :from="yeRange.from" :to="yeRange.to" />
            </li>
          </ul>
        </div>
        <div v-if="result.warnings.length > 0" class="pe-warn" role="status">
          <ul>
            <li v-for="(w, i) in result.warnings" :key="i">
              <AccountCodeText :text="w" :from="yeRange.from" :to="yeRange.to" />
            </li>
          </ul>
        </div>

        <div v-if="result.tax || !hasErrors" class="pe-summary">
          <template v-if="result.tax">
            <p>
              <span
                ><AccountCodeLink
                  plain
                  prefix="6"
                  label="Ticari kâr"
                  title="Ticari kâr — 6 ile başlayan gelir tablosu hesapları"
                  :from="yeRange.from"
                  :to="yeRange.to"
                  :exclude-sources="['year_end_result']" /></span
              ><b>{{ formatMoney(result.tax.ticari_kar) }}</b>
            </p>
            <p>
              <span>+ KKEG</span><b>{{ formatMoney(result.tax.kkeg) }}</b>
            </p>
            <p>
              <span>− İndirimler</span><b>{{ formatMoney(result.tax.deductions) }}</b>
            </p>
            <p>
              <span>Matrah</span><b>{{ formatMoney(result.tax.matrah) }}</b>
            </p>
            <p>
              <span>Oran</span><b>%{{ new Intl.NumberFormat('tr-TR').format(result.tax.rate) }}</b>
            </p>
            <p>
              <span>Hesaplanan vergi</span><b>{{ formatMoney(result.tax.computed) }}</b>
            </p>
            <p>
              <span>Uygulanan vergi</span><b>{{ formatMoney(result.tax.amount) }}</b>
            </p>
            <p>
              <span
                ><AccountCodeLink code="193" :from="yeRange.from" :to="yeRange.to" /> mahsubu</span
              ><b>{{ formatMoney(result.tax.prepaid_offset) }}</b>
            </p>
            <p class="total">
              <span>Ödenecek</span><b>{{ formatMoney(result.tax.payable) }}</b>
            </p>
          </template>
          <p class="total">
            <span>{{ netLabel }}</span
            ><b>{{ formatMoney(Math.abs(result.net_result)) }}</b>
          </p>
        </div>

        <h3 v-if="result.entries.length > 0" class="pe-sub">
          Fişler ({{ result.entries.length }})
          <span class="muted small"
            >— kapanış tarihi {{ result.year_end }}, açılış {{ result.opening_date }}</span
          >
        </h3>
        <div v-for="(en, i) in result.entries" :key="i" class="pe-entry">
          <button
            type="button"
            class="pe-entry-head"
            :aria-expanded="!!openEntries[i]"
            @click="openEntries[i] = !openEntries[i]"
          >
            <span class="pe-caret" aria-hidden="true">{{ openEntries[i] ? '▾' : '▸' }}</span>
            <span class="mono">{{ en.entry_date }}</span>
            <span class="pill">{{ entryTypeLabel(en.entry_type) }}</span>
            <span v-if="en.entry_no != null" class="mono pe-no">Madde {{ en.entry_no }}</span>
            <span class="pe-desc">{{ en.description }}</span>
          </button>
          <div v-if="openEntries[i]" class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Kod</th>
                  <th scope="col">Hesap Adı</th>
                  <th scope="col" class="num">Borç</th>
                  <th scope="col" class="num">Alacak</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(l, j) in en.lines" :key="j">
                  <td class="mono">
                    <AccountCodeLink :code="l.account_code" :from="yeRange.from" :to="yeRange.to" />
                  </td>
                  <td>{{ l.account_name }}</td>
                  <td class="num">{{ l.debit ? formatMoney(l.debit) : '—' }}</td>
                  <td class="num">{{ l.credit ? formatMoney(l.credit) : '—' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th colspan="2">Toplam</th>
                  <th class="num">{{ formatMoney(entryTotals(en.lines).debit) }}</th>
                  <th class="num">{{ formatMoney(entryTotals(en.lines).credit) }}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pe-panel {
  display: grid;
  gap: 16px;
}
.pe-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin: 12px 0;
}
.pe-controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.pe-fieldset {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 12px 0;
  padding: 4px 12px 12px;
}
.pe-fieldset legend {
  padding: 0 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}
.pe-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  cursor: pointer;
}
.pe-sub {
  margin: 16px 0 8px;
  font-size: 0.95rem;
}
.pe-summary {
  max-width: 520px;
  margin: 12px 0;
}
.pe-summary p {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  margin: 0;
  border-bottom: 1px solid #f1f5f9;
}
.pe-summary p.total {
  font-weight: 700;
  border-top: 2px solid #cbd5e1;
}
.pe-summary p.info {
  color: #555;
  font-size: 0.875rem;
}
.pe-warn {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.pe-warn ul,
.pe-list {
  margin: 0;
  padding-left: 1.1rem;
}
.pe-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.pe-actions .spacer {
  flex: 1;
}
.pe-note {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #92400e;
}
.pe-target {
  width: 8rem;
}
.pe-target-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pe-entry {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}
.pe-entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: #f8fafc;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.pe-entry-head:hover {
  background: #f1f5f9;
}
.pe-no {
  font-weight: 600;
}
.pe-desc {
  flex: 1;
  min-width: 0;
  color: #374151;
}
</style>
