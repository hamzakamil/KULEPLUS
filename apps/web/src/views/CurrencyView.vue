<template>
  <div class="currency-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Döviz Kurları</h1>
        <p class="page-sub">
          TCMB'den günlük kurları içe aktarın; dövizli faturalarda kur farkı ve kasa/banka
          hesaplarının dönem sonu değerlemesi bu kurlara göre yapılır.
        </p>
      </div>
      <div class="head-actions">
        <button class="btn btn-secondary" :disabled="store.ratesLoading" @click="openImport">
          ⇅ TCMB'den Getir
        </button>
        <button class="btn btn-primary" :disabled="store.ratesLoading" @click="openRevalue">
          Dönem Sonu Değerle
        </button>
      </div>
    </header>

    <p v-if="store.ratesError" class="state-msg error">{{ store.ratesError }}</p>

    <!-- ── Özet kartları ── -->
    <section class="kpi-grid" aria-label="Özet">
      <div class="kpi">
        <span class="kpi-label">İzlenen Kur</span>
        <span class="kpi-value">{{ store.latestRates.length }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Son Kur Tarihi</span>
        <span class="kpi-value small">{{ store.latestAsOf || '—' }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Değerleme Farkı (Son)</span>
        <span class="kpi-value" :class="{ neg: store.revaluationTotalDiff < 0 }">
          {{ formatMoney(store.revaluationTotalDiff, 'TL') }}
        </span>
      </div>
    </section>

    <!-- ── Güncel kurlar ── -->
    <section class="panel" aria-labelledby="kur-baslik">
      <div class="panel-head">
        <h2 id="kur-baslik">Güncel Kurlar</h2>
        <div class="panel-tools">
          <button class="link" :disabled="store.ratesLoading" @click="loadAll">Yenile</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Para Birimi</th>
              <th scope="col" class="num">Kur (TL)</th>
              <th scope="col">Tarih</th>
              <th scope="col">Kaynak</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in store.latestRates" :key="r.currency">
              <td class="strong">{{ r.currency }}</td>
              <td class="num mono">{{ formatRate(r.rate) }}</td>
              <td class="muted">{{ r.rateDate }}</td>
              <td><span class="badge badge-info">{{ r.source }}</span></td>
            </tr>
            <tr v-if="!store.latestRates.length && !store.ratesLoading">
              <td colspan="4" class="empty-cell">
                Henüz kur yok — "TCMB'den Getir" ile başlayın.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Kur geçmişi ── -->
    <section class="panel" aria-labelledby="gecmis-baslik">
      <div class="panel-head">
        <h2 id="gecmis-baslik">Kur Geçmişi</h2>
        <div class="panel-tools">
          <span v-if="store.exchangeRates.length" class="muted small">
            {{ store.exchangeRatePagination.total }} kayıt
          </span>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="store.exchangeRatePagination.page <= 1 || store.ratesLoading"
            @click="prevRates"
          >
            ‹ Önceki
          </button>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="
              store.exchangeRatePagination.page >= store.exchangeRatePagination.pages ||
              store.ratesLoading
            "
            @click="nextRates"
          >
            Sonraki ›
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Para Birimi</th>
              <th scope="col" class="num">Kur (TL)</th>
              <th scope="col">Tarih</th>
              <th scope="col">Kaynak</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in store.exchangeRates" :key="r.id">
              <td class="strong">{{ r.targetCurrency }}</td>
              <td class="num mono">{{ formatRate(r.rate) }}</td>
              <td class="muted">{{ r.rateDate }}</td>
              <td><span class="badge badge-neutral">{{ r.source }}</span></td>
            </tr>
            <tr v-if="!store.exchangeRates.length && !store.ratesLoading">
              <td colspan="4" class="empty-cell">Kur geçmişi boş.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Dönem sonu değerleme ── -->
    <section class="panel" aria-labelledby="reval-baslik">
      <div class="panel-head">
        <h2 id="reval-baslik">Dönem Sonu Değerleme</h2>
        <div class="panel-tools">
          <input v-model="revalueDate" type="date" class="input" aria-label="Değerleme tarihi" />
          <button class="btn btn-primary btn-sm" :disabled="store.ratesLoading" @click="openRevalue">
            Değerle
          </button>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="store.ratesLoading || !store.revaluationEntries.length"
            @click="runBookRevalue"
          >
            {{ store.ratesLoading ? 'İşleniyor…' : 'Kapanış Fişi Oluştur' }}
          </button>
        </div>
      </div>
      <p v-if="!store.revaluationEntries.length" class="state-msg">
        Değerleme yapılmadı. "Dönem Sonu Değerle" ile dövizli kasa/banka hesaplarının TL
        karşılığını tarihteki son kura göre yeniden hesaplayın. Fark; kâr için 646, zarar için
        656 hesabına "kapanış fişi" olarak dengeli yevmiye kaydı üretir (aynı tarih için tek fiş).
      </p>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Hesap</th>
              <th scope="col">Döviz</th>
              <th scope="col" class="num">Döviz Pozisyonu</th>
              <th scope="col" class="num">Cari TL Karşılık</th>
              <th scope="col" class="num">Yeni TL Karşılık</th>
              <th scope="col" class="num">Fark</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in store.revaluationEntries" :key="e.accountId">
              <td class="strong">{{ e.accountName }}</td>
              <td>{{ e.currency }}</td>
              <td class="num mono">{{ formatMoney(e.foreignPosition, e.currency) }}</td>
              <td class="num mono">{{ formatMoney(e.currentBaseValue, 'TL') }}</td>
              <td class="num mono">{{ formatMoney(e.newBaseValue, 'TL') }}</td>
              <td class="num strong" :class="e.diff < 0 ? 'neg' : 'pos'">
                {{ formatMoney(e.diff, 'TL') }}
                <span
                  v-if="!e.rateAvailable"
                  class="badge badge-warning"
                  title="Kur yok — mevcut TL değeri korundu"
                >kur yok</span>
              </td>
            </tr>
            <tr>
              <td colspan="5" class="strong">Toplam Fark</td>
              <td class="num strong" :class="store.revaluationTotalDiff < 0 ? 'neg' : 'pos'">
                {{ formatMoney(store.revaluationTotalDiff, 'TL') }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="store.revaluationJournalNo" class="state-msg">
          ✓ Değerleme kaydı fişe bağlandı — Fiş No: {{ store.revaluationJournalNo }}
        </p>
      </div>
    </section>

    <!-- ── TCMB'den Getir modalı ── -->
    <div v-if="showImport" class="modal-backdrop" @click.self="showImport = false">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div class="modal-head">
          <h2 id="import-title">TCMB Kur İçe Aktar</h2>
          <button class="modal-close" aria-label="Kapat" @click="showImport = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="runImport">
          <label>
            <span class="field-label">Kur Tarihi</span>
            <input v-model="importDate" type="date" class="input" aria-label="Kur tarihi" />
            <small class="muted">Boş bırakılırsa bugünün kurları çekilir.</small>
          </label>
          <p v-if="importError" class="form-error">{{ importError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showImport = false">İptal</button>
            <button type="submit" class="btn btn-primary" :disabled="store.ratesLoading">
              {{ store.ratesLoading ? 'Çekiliyor…' : 'İçe Aktar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Değerleme modalı ── -->
    <div v-if="showRevalue" class="modal-backdrop" @click.self="showRevalue = false">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="reval-title">
        <div class="modal-head">
          <h2 id="reval-title">Dönem Sonu Değerleme</h2>
          <button class="modal-close" aria-label="Kapat" @click="showRevalue = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="runRevalue">
          <label>
            <span class="field-label">Değerleme Tarihi</span>
            <input v-model="revalueDate" type="date" class="input" aria-label="Değerleme tarihi" />
            <small class="muted">Dövizli kasa/banka hesapları bu tarihteki son kura göre yeniden
              değerlenir.</small>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showRevalue = false">İptal</button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="store.ratesLoading"
              @click="runBookRevalue"
            >
              {{ store.ratesLoading ? 'İşleniyor…' : 'Değerle & Kapanış Fişi Kaydet' }}
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.ratesLoading">
              {{ store.ratesLoading ? 'Değerleniyor…' : 'Değerle' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useCashBankStore } from '@/stores/cash-bank';

const store = useCashBankStore();

const showImport = ref(false);
const showRevalue = ref(false);
const importDate = ref('');
const revalueDate = ref('');
const importError = ref<string | null>(null);

const formatRate = (n: number) =>
  new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(n);

const formatMoney = (n: number, suffix = '') => {
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return suffix ? `${formatted} ${suffix}` : formatted;
};

function openImport() {
  importError.value = null;
  showImport.value = true;
}

async function runImport() {
  importError.value = null;
  try {
    await store.importExchangeRates(importDate.value || undefined);
    showImport.value = false;
  } catch {
    importError.value = store.ratesError ?? 'Kurlar içe aktarılamadı';
  }
}

function openRevalue() {
  showRevalue.value = true;
}

async function runRevalue() {
  await store.runRevaluation(revalueDate.value || undefined);
  showRevalue.value = false;
}

/** Değerleme yapar ve 646/656 hesabına kapanış fişi üretir (Faz 6.6). */
async function runBookRevalue() {
  try {
    await store.bookRevaluation(revalueDate.value || undefined);
    showRevalue.value = false;
  } catch {
    // Hata store.ratesError'da görünür.
  }
}

function loadAll() {
  store.fetchLatestRates();
  store.fetchExchangeRates({ page: store.exchangeRatePagination.page });
}

function prevRates() {
  if (store.exchangeRatePagination.page > 1) {
    store.fetchExchangeRates({ page: store.exchangeRatePagination.page - 1 });
  }
}

function nextRates() {
  if (store.exchangeRatePagination.page < store.exchangeRatePagination.pages) {
    store.fetchExchangeRates({ page: store.exchangeRatePagination.page + 1 });
  }
}

onMounted(loadAll);
</script>

<style scoped>
.currency-view {
  --c-primary: #1d4ed8;
  --c-border: #e2e8f0;
  --c-muted: #64748b;
  --c-bg: #f8fafc;
  max-width: 90rem;
  margin-inline: auto;
  padding: 1.5rem;
}
.page-sub {
  margin: 0.25rem 0 0;
  color: var(--c-muted);
  font-size: 0.9375rem;
  max-width: 60rem;
}
.head-actions {
  display: flex;
  gap: 0.5rem;
}

/* KPI */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.kpi {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kpi-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--c-muted);
  font-weight: 600;
}
.kpi-value {
  font-size: 1.375rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.kpi-value.small {
  font-size: 1rem;
}
.neg {
  color: #dc2626;
}
.pos {
  color: #047857;
}

/* Panel */
.panel {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.panel-head h2 {
  margin: 0;
  font-size: 1.125rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.panel-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.panel-tools .input {
  max-width: 12rem;
}
.small {
  font-size: 0.8125rem;
}
.muted {
  color: var(--c-muted);
}
</style>
