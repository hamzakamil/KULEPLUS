<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useAccountingStore, type JournalLine, type TrialBalance } from '@/stores/accounting';

const store = useAccountingStore();
const activeTab = ref<'accounts' | 'entries' | 'reports'>('accounts');
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

/** SPEC §22.1 hata sözleşmesinden (`{ error: { message } }`) mesaj çıkarır. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as {
    response?: { data?: { error?: { message?: string }; message?: string } };
  })?.response?.data;
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
const reportType = ref<'trial' | 'balance' | 'income'>('trial');
const rangeFrom = ref(yearStart);
const rangeTo = ref(today);
const asOf = ref(today);
const trial = ref<TrialBalance | null>(null);
const balance = ref<Awaited<ReturnType<typeof store.balanceSheet>> | null>(null);
const income = ref<Awaited<ReturnType<typeof store.incomeStatement>> | null>(null);
async function runReport() {
  info.value = null;
  try {
    if (reportType.value === 'trial')
      trial.value = await store.trialBalance(rangeFrom.value, rangeTo.value);
    else if (reportType.value === 'balance') balance.value = await store.balanceSheet(asOf.value);
    else income.value = await store.incomeStatement(rangeFrom.value, rangeTo.value);
  } catch {
    info.value = 'Rapor üretilemedi.';
  }
}

onMounted(async () => {
  await loadAccounts();
  await loadEntries();
});
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
              <td class="mono">{{ a.code }}</td>
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
            <tr v-for="e in store.entries" :key="e.id">
              <td class="mono">{{ e.entry_no ?? '—' }}</td>
              <td>{{ e.entry_date }}</td>
              <td>{{ e.entry_type }}</td>
              <td>{{ e.description }}</td>
              <td class="num">{{ formatMoney(e.totalDebit) }}</td>
              <td class="num">{{ formatMoney(e.totalCredit) }}</td>
              <td>
                <span v-if="e.entry_type === 'ters'" class="pill pill-rev">TERS KAYIT</span>
                <span class="pill">{{ STATUS_LABELS[e.status] ?? e.status }}</span>
              </td>
              <td class="num">
                <button
                  v-if="e.status === 'posted'"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  title="Onaylı fişi ters kayıtla düzeltir — silmez, yeni 'ters' fişi oluşturur"
                  @click="reverse(e.id)"
                >
                  Ters Kayıt
                </button>
              </td>
            </tr>
            <tr v-if="store.entries.length === 0">
              <td colspan="8" class="muted">Kayıt yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

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

      <div v-if="reportType === 'trial' && trial" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Kod</th>
              <th>Hesap</th>
              <th class="num">Borç</th>
              <th class="num">Alacak</th>
              <th class="num">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in trial.accounts" :key="r.code">
              <td class="mono">{{ r.code }}</td>
              <td>{{ r.name }}</td>
              <td class="num">{{ formatMoney(r.debit) }}</td>
              <td class="num">{{ formatMoney(r.credit) }}</td>
              <td class="num">{{ formatMoney(r.balance) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th colspan="2">Toplam</th>
              <th class="num">{{ formatMoney(trial.totalDebit) }}</th>
              <th class="num">{{ formatMoney(trial.totalCredit) }}</th>
              <th class="num">{{ trial.balanced ? 'Dengeli' : 'Dengesiz!' }}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-else-if="reportType === 'balance' && balance" class="bs-grid">
        <div class="bs-col">
          <h3>Aktif</h3>
          <p>
            <span>Dönen Varlıklar</span><b>{{ formatMoney(balance.aktif.donenVarliklar) }}</b>
          </p>
          <p>
            <span>Duran Varlıklar</span><b>{{ formatMoney(balance.aktif.duranVarliklar) }}</b>
          </p>
          <p class="total">
            <span>Aktif Toplam</span><b>{{ formatMoney(balance.aktif.toplam) }}</b>
          </p>
        </div>
        <div class="bs-col">
          <h3>Pasif</h3>
          <p>
            <span>Kısa Vadeli Yab. Kaynak</span
            ><b>{{ formatMoney(balance.pasif.kisaVadeliYabanciKaynaklar) }}</b>
          </p>
          <p>
            <span>Uzun Vadeli Yab. Kaynak</span
            ><b>{{ formatMoney(balance.pasif.uzunVadeliYabanciKaynaklar) }}</b>
          </p>
          <p>
            <span>Öz Kaynaklar</span><b>{{ formatMoney(balance.pasif.ozKaynaklar) }}</b>
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
          <span>Brüt Satışlar</span><b>{{ formatMoney(income.brutSatislar) }}</b>
        </p>
        <p>
          <span>Net Satışlar</span><b>{{ formatMoney(income.netSatislar) }}</b>
        </p>
        <p>
          <span>Satışların Maliyeti</span><b>{{ formatMoney(income.satislarinMaliyeti) }}</b>
        </p>
        <p>
          <span>Brüt Kâr</span><b>{{ formatMoney(income.brutKar) }}</b>
        </p>
        <p>
          <span>Faaliyet Giderleri</span><b>{{ formatMoney(income.faaliyetGiderleri) }}</b>
        </p>
        <p>
          <span>Faaliyet Kârı</span><b>{{ formatMoney(income.faaliyetKari) }}</b>
        </p>
        <p class="total">
          <span>Dönem Net Kârı</span><b>{{ formatMoney(income.donemNetKari) }}</b>
        </p>
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
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0;
  border-bottom: 1px solid #e5e7eb;
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
</style>
