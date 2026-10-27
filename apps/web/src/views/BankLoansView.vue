<template>
  <div class="bank-module loan-module">
    <header class="page-header">
      <div>
        <h1 class="page-title">Banka Kredileri</h1>
        <p class="page-sub">
          Kredi hesaplarını ayrı bir modül olarak yönetin; bir krediye tıkladığınızda taksit
          planını ve taksitlerin ödenip ödenmediğini görürsünüz. Banka hesapları için
          <RouterLink to="/bank">Bankalar</RouterLink> ekranına geçin.
        </p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="openLoanForm()">+ Yeni Kredi</button>
      </div>
    </header>

    <section class="kpi-grid" aria-label="Banka kredisi özeti">
      <div class="kpi">
        <span class="kpi-label">Kredi Sayısı</span>
        <span class="kpi-value">{{ store.bankLoans.length }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Toplam Anapara</span>
        <span class="kpi-value">{{ formatMoney(totalPrincipal) }}</span>
      </div>
      <div class="kpi" :class="{ warn: totalRemaining > 0 }">
        <span class="kpi-label">Kalan Taksit Toplamı</span>
        <span class="kpi-value">{{ formatMoney(totalRemaining) }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Aylık Taksit Toplamı</span>
        <span class="kpi-value">{{ formatMoney(totalMonthly) }}</span>
      </div>
    </section>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <section class="panel" aria-labelledby="kredi-listesi-baslik">
      <div class="panel-head">
        <h2 id="kredi-listesi-baslik">Kredi Hesapları</h2>
        <div class="panel-tools">
          <input
            v-model="search"
            type="search"
            class="input"
            placeholder="Kredi no, banka veya tür ara…"
            aria-label="Kredi ara"
          />
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Banka</th>
              <th scope="col">Kredi No</th>
              <th scope="col">Tür</th>
              <th scope="col" class="num">Anapara</th>
              <th scope="col" class="num">Faiz %</th>
              <th scope="col" class="num">Taksit</th>
              <th scope="col" class="num">Aylık Taksit</th>
              <th scope="col" class="num">Kalan Borç</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="loan in filteredLoans"
              :key="loan.id"
              class="clickable-row"
              tabindex="0"
              :aria-label="`${loan.loanNumber || loan.bankAccountName || 'Kredi'} ödeme planını aç`"
              @click="openLoan(loan)"
              @keydown.enter="openLoan(loan)"
            >
              <td>{{ loan.bankAccountName || '—' }}</td>
              <td class="mono muted">{{ loan.loanNumber || '—' }}</td>
              <td>
                <span class="badge badge-info">{{ loanTypeLabel(loan.loanType) }}</span>
              </td>
              <td class="num">{{ formatMoney(loan.principal, loan.currency) }}</td>
              <td class="num">{{ loan.interestRate }}</td>
              <td class="num">{{ loan.paidInstallments }} / {{ loan.totalInstallments }}</td>
              <td class="num">{{ formatMoney(loan.installmentAmount, loan.currency) }}</td>
              <td class="num strong">{{ formatMoney(loan.remainingBalance, loan.currency) }}</td>
              <td>
                <span class="badge" :class="loanStatusClass(loan.status)">
                  {{ loanStatusLabel(loan.status) }}
                </span>
              </td>
              <td class="num actions" @click.stop>
                <button class="link" @click="openLoan(loan)">Ödeme Planı</button>
                <button class="link" @click="openLoanForm(loan)">Düzenle</button>
                <button class="link danger" @click="removeLoan(loan)">Sil</button>
              </td>
            </tr>
            <tr v-if="!filteredLoans.length">
              <td colspan="10" class="empty-cell">
                {{
                  search
                    ? 'Aramaya uygun kredi yok.'
                    : 'Henüz banka kredisi yok. "+ Yeni Kredi" ile başlayın.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Seçili kredinin ödeme planı ── -->
    <section v-if="activeLoan" class="panel" aria-labelledby="odeme-plani-baslik">
      <div class="panel-head">
        <h2 id="odeme-plani-baslik">
          Ödeme Planı — {{ activeLoan.loanNumber || 'Kredi' }}
          <span class="muted small">{{ activeLoan.bankAccountName || '' }}</span>
        </h2>
        <div class="summary-chips">
          <span class="badge badge-info">
            {{ activeLoan.paidInstallments }} / {{ activeLoan.totalInstallments }} taksit ödendi
          </span>
          <span class="badge badge-warning">
            Kalan {{ formatMoney(store.loanInstallmentSummary.remainingAmount, activeLoan.currency) }}
          </span>
          <span
            v-if="store.loanInstallmentSummary.overdueCount > 0"
            class="badge badge-danger"
          >
            {{ store.loanInstallmentSummary.overdueCount }} gecikmiş
          </span>
          <button class="btn btn-secondary btn-sm" @click="closeLoan">Kapat</button>
        </div>
      </div>

      <div class="panel-tools" style="margin-bottom: 1rem">
        <span class="muted small">
          Anapara {{ formatMoney(activeLoan.principal, activeLoan.currency) }} · Faiz
          {{ activeLoan.interestRate }}%/ay · Aylık taksit
          {{ formatMoney(activeLoan.installmentAmount, activeLoan.currency) }}
        </span>
        <button
          v-if="!store.loanInstallments.length"
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="createPlan"
        >
          Taksit Planı Oluştur
        </button>
        <button
          v-else-if="store.loanInstallmentSummary.paidCount === 0"
          class="btn btn-secondary btn-sm"
          :disabled="saving"
          @click="createPlan"
        >
          Planı Yenile
        </button>
      </div>

      <p v-if="!store.loanInstallments.length" class="detail-note">
        Bu kredi için henüz taksit planı yok. "Taksit Planı Oluştur" ile kredi bilgilerinden plan
        üretilir.
      </p>

      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col" class="num">#</th>
              <th scope="col">Vade</th>
              <th scope="col" class="num">Taksit</th>
              <th scope="col" class="num">Anapara</th>
              <th scope="col" class="num">Faiz</th>
              <th scope="col">Durum</th>
              <th scope="col">Ödeme Tarihi</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in store.loanInstallments" :key="i.id">
              <td class="num muted">{{ i.installmentNo }}</td>
              <td class="nowrap">{{ formatDate(i.dueDate) }}</td>
              <td class="num strong">{{ formatMoney(i.amount, activeLoan.currency) }}</td>
              <td class="num">{{ formatMoney(i.principalAmount, activeLoan.currency) }}</td>
              <td class="num">{{ formatMoney(i.interestAmount, activeLoan.currency) }}</td>
              <td>
                <span class="badge" :class="installmentBadge(i.status)">
                  {{ installmentLabel(i.status) }}
                </span>
              </td>
              <td class="muted nowrap">{{ i.paidAt ? formatDate(i.paidAt) : '—' }}</td>
              <td class="num actions">
                <button
                  v-if="i.status !== 'paid'"
                  class="link"
                  :disabled="saving"
                  @click="payInstallment(i)"
                >
                  Öde
                </button>
                <button v-else class="link danger" :disabled="saving" @click="unpayInstallment(i)">
                  Geri Al
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Kredi formu ── -->
    <div v-if="showLoanForm" class="modal-backdrop" @click.self="showLoanForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>{{ editingLoan ? 'Banka Kredisini Düzenle' : 'Yeni Banka Kredisi' }}</h2>
          <button class="modal-close" aria-label="Kapat" @click="showLoanForm = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="saveLoan">
          <div class="form-field-full">
            <label class="field-label" for="loan-bank">Banka Hesabı *</label>
            <FilterableSelect
              id="loan-bank"
              v-model="loanForm.bankAccountId"
              :options="bankAccountOptions"
              placeholder="Banka hesabı seçin"
            />
          </div>
          <div>
            <label class="field-label" for="loan-type">Kredi Türü</label>
            <FilterableSelect
              id="loan-type"
              v-model="loanForm.loanType"
              :options="LOAN_TYPE_OPTIONS"
              placeholder="Kredi türü seçin"
            />
          </div>
          <div>
            <label class="field-label" for="loan-no">Kredi No</label>
            <input id="loan-no" v-model="loanForm.loanNumber" class="input" />
          </div>
          <div>
            <label class="field-label" for="loan-principal">Anapara *</label>
            <input
              id="loan-principal"
              v-model.number="loanForm.principal"
              type="number"
              step="0.01"
              min="0.01"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="loan-rate">Aylık Faiz Oranı (%)</label>
            <input
              id="loan-rate"
              v-model.number="loanForm.interestRate"
              type="number"
              step="0.01"
              min="0"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="loan-count">Taksit Sayısı *</label>
            <input
              id="loan-count"
              v-model.number="loanForm.totalInstallments"
              type="number"
              min="1"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="loan-inst">Aylık Taksit Tutarı</label>
            <input
              id="loan-inst"
              v-model.number="loanForm.installmentAmount"
              type="number"
              step="0.01"
              min="0"
              class="input"
              placeholder="0 = otomatik hesapla"
            />
          </div>
          <div>
            <label class="field-label" for="loan-currency">Para Birimi</label>
            <FilterableSelect
              id="loan-currency"
              v-model="loanForm.currency"
              :options="CURRENCY_OPTIONS"
              placeholder="Seçiniz…"
            />
          </div>
          <div>
            <label class="field-label" for="loan-start">Başlangıç Tarihi *</label>
            <input id="loan-start" v-model="loanForm.startDate" type="date" class="input" required />
          </div>
          <div>
            <label class="field-label" for="loan-end">Bitiş Tarihi</label>
            <input id="loan-end" v-model="loanForm.endDate" type="date" class="input" />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="loan-desc">Açıklama</label>
            <input id="loan-desc" v-model="loanForm.description" class="input" />
          </div>
          <p class="detail-note form-field-full">
            İlk taksit vadesi başlangıç tarihinden bir ay sonradır. Taksit tutarı 0 bırakılırsa
            eşit taksitli (anüite) plan otomatik hesaplanır.
          </p>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showLoanForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FilterableSelect from '@/components/FilterableSelect.vue';
import {
  useCashBankStore,
  type BankLoan,
  type BankLoanInstallment,
} from '@/stores/cash-bank';

const store = useCashBankStore();

const search = ref('');
const activeLoanId = ref<string | null>(null);
const showLoanForm = ref(false);
const editingLoan = ref<BankLoan | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const today = () => new Date().toISOString().split('T')[0];

const LOAN_TYPE_OPTIONS = [
  { value: 'term', label: 'Vadeli (Taksitli)' },
  { value: 'revolving', label: 'Rotatif' },
  { value: 'overdraft', label: 'Açık Kredi (KMH)' },
  { value: 'mortgage', label: 'İpotekli' },
];
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

const bankAccounts = computed(() => store.accounts.filter((a) => a.accountType === 'bank'));
const bankAccountOptions = computed(() => [
  { value: '', label: 'Banka hesabı seçin…' },
  ...bankAccounts.value.map((a) => ({ value: a.id, label: a.accountName })),
]);
const activeLoan = computed(() => store.bankLoans.find((l) => l.id === activeLoanId.value));

const filteredLoans = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return store.bankLoans;
  return store.bankLoans.filter((loan) =>
    [loan.bankAccountName, loan.loanNumber, loanTypeLabel(loan.loanType), loan.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q)),
  );
});

const sum = (values: number[]) => values.reduce((total, value) => total + Number(value ?? 0), 0);
const totalPrincipal = computed(() => sum(store.bankLoans.map((l) => l.principal)));
const totalRemaining = computed(() => sum(store.bankLoans.map((l) => l.remainingBalance)));
const totalMonthly = computed(() =>
  sum(
    store.bankLoans
      .filter((l) => l.status !== 'closed')
      .map((l) => l.installmentAmount),
  ),
);

const loanForm = ref({
  bankAccountId: '',
  loanType: 'term' as BankLoan['loanType'],
  loanNumber: '',
  principal: 0,
  interestRate: 0,
  totalInstallments: 12,
  installmentAmount: 0,
  startDate: today(),
  endDate: '',
  currency: 'TRY',
  description: '',
});

const formatMoney = (value: number | string | undefined, currency = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(Number(value ?? 0));
const formatDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(value)) : '—';

const loanTypeLabel = (type: string) =>
  ({ term: 'Vadeli', revolving: 'Rotatif', overdraft: 'KMH', mortgage: 'İpotekli' })[type] ?? type;
const loanStatusLabel = (status: string) =>
  ({ active: 'Aktif', overdue: 'Gecikmiş', closed: 'Kapandı' })[status] ?? status;
const loanStatusClass = (status: string) =>
  ({
    active: 'badge-warning',
    overdue: 'badge-danger',
    closed: 'badge-success',
  })[status] ?? 'badge-neutral';
const installmentLabel = (status: string) =>
  ({ paid: 'Ödendi', overdue: 'Gecikmiş', pending: 'Bekliyor' })[status] ?? status;
const installmentBadge = (status: string) =>
  ({
    paid: 'badge-success',
    overdue: 'badge-danger',
    pending: 'badge-neutral',
  })[status] ?? 'badge-neutral';

const openLoan = async (loan: BankLoan) => {
  activeLoanId.value = loan.id;
  await store.fetchLoanInstallments(loan.id);
};
const closeLoan = () => {
  activeLoanId.value = null;
  store.loanInstallments = [];
};

const openLoanForm = (loan?: BankLoan) => {
  editingLoan.value = loan ?? null;
  formError.value = null;
  loanForm.value = loan
    ? {
        bankAccountId: loan.bankAccountId ?? '',
        loanType: loan.loanType,
        loanNumber: loan.loanNumber ?? '',
        principal: Number(loan.principal ?? 0),
        interestRate: Number(loan.interestRate ?? 0),
        totalInstallments: Number(loan.totalInstallments ?? 1),
        installmentAmount: Number(loan.installmentAmount ?? 0),
        startDate: String(loan.startDate).slice(0, 10) || today(),
        endDate: loan.endDate ? String(loan.endDate).slice(0, 10) : '',
        currency: loan.currency || 'TRY',
        description: loan.description ?? '',
      }
    : {
        bankAccountId: bankAccounts.value[0]?.id ?? '',
        loanType: 'term',
        loanNumber: '',
        principal: 0,
        interestRate: 0,
        totalInstallments: 12,
        installmentAmount: 0,
        startDate: today(),
        endDate: '',
        currency: 'TRY',
        description: '',
      };
  showLoanForm.value = true;
};

const saveLoan = async () => {
  formError.value = null;
  if (!loanForm.value.bankAccountId) {
    formError.value = 'Banka hesabı seçin.';
    return;
  }
  saving.value = true;
  try {
    const payload = {
      bankAccountId: loanForm.value.bankAccountId,
      loanType: loanForm.value.loanType,
      loanNumber: loanForm.value.loanNumber.trim() || undefined,
      principal: loanForm.value.principal,
      interestRate: loanForm.value.interestRate,
      totalInstallments: loanForm.value.totalInstallments,
      installmentAmount: loanForm.value.installmentAmount || 0,
      startDate: loanForm.value.startDate,
      endDate: loanForm.value.endDate || undefined,
      currency: loanForm.value.currency,
      description: loanForm.value.description.trim() || undefined,
    };
    const saved = editingLoan.value
      ? await store.updateBankLoan(editingLoan.value.id, payload)
      : await store.createBankLoan(payload);
    showLoanForm.value = false;
    await store.fetchBankLoans();
    if (activeLoanId.value && saved?.id === activeLoanId.value) {
      await store.fetchLoanInstallments(activeLoanId.value);
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  } finally {
    saving.value = false;
  }
};

const removeLoan = async (loan: BankLoan) => {
  if (!window.confirm('Bu kredi kaydını silmek istediğinize emin misiniz?')) return;
  try {
    await store.deleteBankLoan(loan.id);
    if (activeLoanId.value === loan.id) closeLoan();
  } catch {
    /* store hatası */
  }
};

const createPlan = async () => {
  if (!activeLoanId.value) return;
  saving.value = true;
  try {
    await store.generateLoanInstallments(activeLoanId.value);
  } catch {
    /* store hatası */
  } finally {
    saving.value = false;
  }
};

const payInstallment = async (installment: BankLoanInstallment) => {
  if (!activeLoanId.value) return;
  const label = `${installment.installmentNo}. taksiti (${formatMoney(
    installment.amount,
    activeLoan.value?.currency,
  )}) ödendi olarak işaretlemek istiyor musunuz?`;
  if (!window.confirm(label)) return;
  saving.value = true;
  try {
    await store.payLoanInstallment(activeLoanId.value, installment.id);
  } catch {
    /* store hatası */
  } finally {
    saving.value = false;
  }
};

const unpayInstallment = async (installment: BankLoanInstallment) => {
  if (!activeLoanId.value) return;
  if (!window.confirm(`${installment.installmentNo}. taksitin ödeme kaydını geri almak istiyor musunuz?`)) {
    return;
  }
  saving.value = true;
  try {
    await store.unpayLoanInstallment(activeLoanId.value, installment.id);
  } catch {
    /* store hatası */
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  store.filters.accountType = 'bank';
  await store.fetchAccounts();
  await store.fetchBankLoans();
});
</script>
