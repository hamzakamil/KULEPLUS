<template>
  <div class="bank-module card-module">
    <header class="page-header">
      <div>
        <h1 class="page-title">Kredi Kartları</h1>
        <p class="page-sub">
          Kartları ayrı bir modül olarak yönetin; bir karta tıkladığınızda harcama, ödeme ve iade
          hareketlerini görürsünüz. Banka hesapları için
          <RouterLink to="/bank">Bankalar</RouterLink> ekranına geçin.
        </p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="openCardForm()">+ Yeni Kredi Kartı</button>
      </div>
    </header>

    <section class="kpi-grid" aria-label="Kredi kartı özeti">
      <div class="kpi">
        <span class="kpi-label">Kart Sayısı</span>
        <span class="kpi-value">{{ store.creditCards.length }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Toplam Limit</span>
        <span class="kpi-value">{{ formatMoney(totalLimit) }}</span>
      </div>
      <div class="kpi" :class="{ warn: totalDebt > 0 }">
        <span class="kpi-label">Güncel Borç</span>
        <span class="kpi-value">{{ formatMoney(totalDebt) }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Kullanılabilir Limit</span>
        <span class="kpi-value">{{ formatMoney(totalAvailable) }}</span>
      </div>
    </section>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <section class="panel" aria-labelledby="kart-listesi-baslik">
      <div class="panel-head">
        <h2 id="kart-listesi-baslik">Kartlar</h2>
        <div class="panel-tools">
          <input
            v-model="search"
            type="search"
            class="input"
            placeholder="Kart, banka veya son 4 hane ara…"
            aria-label="Kart ara"
          />
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Kart</th>
              <th scope="col">Banka</th>
              <th scope="col">Network</th>
              <th scope="col" class="num">Limit</th>
              <th scope="col" class="num">Güncel Borç</th>
              <th scope="col" class="num">Kullanılabilir</th>
              <th scope="col">Kesim / Son Ödeme</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in filteredCards"
              :key="c.id"
              class="clickable-row"
              tabindex="0"
              :aria-label="`${c.cardLabel} kart hareketlerini aç`"
              @click="openCard(c)"
              @keydown.enter="openCard(c)"
            >
              <td class="strong">
                {{ c.cardLabel }}
                <span v-if="c.cardNumberLast4" class="mono muted">
                  •••• {{ c.cardNumberLast4 }}
                </span>
              </td>
              <td>{{ c.bankAccountName || '—' }}</td>
              <td class="muted">{{ cardNetworkLabel(c.cardNetwork) }}</td>
              <td class="num">{{ formatMoney(c.creditLimit, c.currency) }}</td>
              <td class="num" :class="{ neg: Number(c.currentDebt) > 0 }">
                {{ formatMoney(c.currentDebt, c.currency) }}
              </td>
              <td class="num strong">{{ formatMoney(c.availableLimit, c.currency) }}</td>
              <td class="muted nowrap">
                {{ c.statementDay ? c.statementDay + '.' : '—' }} /
                {{ c.dueDay ? c.dueDay + '.' : '—' }}
              </td>
              <td>
                <span class="badge" :class="cardStatusClass(c.status)">
                  {{ cardStatusLabel(c.status) }}
                </span>
              </td>
              <td class="num actions" @click.stop>
                <button class="link" @click="openCard(c)">Hareketler</button>
                <button class="link" @click="openCardForm(c)">Düzenle</button>
                <button class="link danger" @click="removeCard(c)">Sil</button>
              </td>
            </tr>
            <tr v-if="!filteredCards.length">
              <td colspan="9" class="empty-cell">
                {{
                  search
                    ? 'Aramaya uygun kredi kartı yok.'
                    : 'Henüz kredi kartı yok. "+ Yeni Kredi Kartı" ile başlayın.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Seçili kartın hareketleri ── -->
    <section v-if="activeCard" class="panel" aria-labelledby="kart-hareket-baslik">
      <div class="panel-head">
        <h2 id="kart-hareket-baslik">
          Kart Hareketleri — {{ activeCard.cardLabel }}
          <span v-if="activeCard.cardNumberLast4" class="mono muted small">
            •••• {{ activeCard.cardNumberLast4 }}
          </span>
        </h2>
        <div class="summary-chips">
          <span class="badge badge-info">Limit {{ formatMoney(activeCard.creditLimit, activeCard.currency) }}</span>
          <span class="badge badge-warning">Borç {{ formatMoney(activeCard.currentDebt, activeCard.currency) }}</span>
          <span class="badge badge-success">
            Kullanılabilir {{ formatMoney(activeCard.availableLimit, activeCard.currency) }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="closeCard">Kapat</button>
        </div>
      </div>

      <div class="panel-tools" style="margin-bottom: 1rem">
        <button class="btn btn-primary btn-sm" @click="openTransactionForm('purchase')">
          + Harcama
        </button>
        <button class="btn btn-secondary btn-sm" @click="openTransactionForm('payment')">
          + Ödeme
        </button>
        <button class="btn btn-secondary btn-sm" @click="openTransactionForm('refund')">
          + İade
        </button>
        <select
          v-model="transactionTypeFilter"
          class="select"
          aria-label="Hareket türü filtresi"
          @change="reloadTransactions"
        >
          <option value="">Tüm hareketler</option>
          <option v-for="opt in TRANSACTION_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <span class="muted small">
          Borç toplamı {{ formatMoney(store.cardTransactionTotals.debit) }} · Ödeme/iade
          {{ formatMoney(store.cardTransactionTotals.credit) }}
        </span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col">Tür</th>
              <th scope="col">Açıklama</th>
              <th scope="col" class="num">Taksit</th>
              <th scope="col">Referans</th>
              <th scope="col" class="num">Tutar</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in store.cardTransactions" :key="t.id">
              <td class="nowrap">{{ formatDate(t.transactionDate) }}</td>
              <td>
                <span class="badge" :class="transactionBadge(t.transactionType)">
                  {{ transactionTypeLabel(t.transactionType) }}
                </span>
              </td>
              <td>{{ t.description }}</td>
              <td class="num">{{ t.installmentCount > 1 ? `${t.installmentCount} taksit` : '—' }}</td>
              <td class="mono muted">{{ t.reference || '—' }}</td>
              <td class="num" :class="isDebtType(t.transactionType) ? 'neg' : 'pos'">
                {{ isDebtType(t.transactionType) ? '+' : '−' }}{{ formatMoney(t.amount) }}
              </td>
              <td class="num actions">
                <button class="link danger" @click="removeTransaction(t.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!store.cardTransactions.length">
              <td colspan="7" class="empty-cell">Bu kartta hareket yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Kart formu ── -->
    <div v-if="showCardForm" class="modal-backdrop" @click.self="showCardForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>{{ editingCard ? 'Kredi Kartını Düzenle' : 'Yeni Kredi Kartı' }}</h2>
          <button class="modal-close" aria-label="Kapat" @click="showCardForm = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="saveCard">
          <div class="form-field-full">
            <label class="field-label" for="cc-bank">Banka Hesabı *</label>
            <FilterableSelect
              id="cc-bank"
              v-model="cardForm.bankAccountId"
              :options="bankAccountOptions"
              placeholder="Banka hesabı seçin"
            />
          </div>
          <div>
            <label class="field-label" for="cc-label">Kart Adı *</label>
            <input id="cc-label" v-model="cardForm.cardLabel" class="input" required />
          </div>
          <div>
            <label class="field-label" for="cc-last4">Son 4 Hane</label>
            <input
              id="cc-last4"
              v-model="cardForm.cardNumberLast4"
              class="input"
              maxlength="4"
              inputmode="numeric"
            />
          </div>
          <div>
            <label class="field-label" for="cc-network">Kart Network</label>
            <FilterableSelect
              id="cc-network"
              v-model="cardForm.cardNetwork"
              :options="CARD_NETWORK_OPTIONS"
              placeholder="Seçiniz…"
            />
          </div>
          <div>
            <label class="field-label" for="cc-currency">Para Birimi</label>
            <FilterableSelect
              id="cc-currency"
              v-model="cardForm.currency"
              :options="CURRENCY_OPTIONS"
              placeholder="Seçiniz…"
            />
          </div>
          <div>
            <label class="field-label" for="cc-limit">Kredi Limiti *</label>
            <input
              id="cc-limit"
              v-model.number="cardForm.creditLimit"
              type="number"
              step="0.01"
              min="0"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="cc-debt">Açılış / Güncel Borç</label>
            <input
              id="cc-debt"
              v-model.number="cardForm.currentDebt"
              type="number"
              step="0.01"
              min="0"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="cc-statement">Hesap Kesim Günü</label>
            <input
              id="cc-statement"
              v-model.number="cardForm.statementDay"
              type="number"
              min="1"
              max="31"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="cc-due">Son Ödeme Günü</label>
            <input
              id="cc-due"
              v-model.number="cardForm.dueDay"
              type="number"
              min="1"
              max="31"
              class="input"
            />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="cc-desc">Açıklama</label>
            <input id="cc-desc" v-model="cardForm.description" class="input" />
          </div>
          <p class="detail-note form-field-full">
            Güncel borç, kart hareketleriyle otomatik güncellenir. Bu alanı yalnızca kartın
            devralınan açılış borcu için kullanın.
          </p>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showCardForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Kart hareketi formu ── -->
    <div v-if="showTransactionForm" class="modal-backdrop" @click.self="showTransactionForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>
            {{ transactionTypeLabel(transactionForm.transactionType) }} Ekle
            <span v-if="activeCard" class="muted small">— {{ activeCard.cardLabel }}</span>
          </h2>
          <button class="modal-close" aria-label="Kapat" @click="showTransactionForm = false">
            ×
          </button>
        </div>
        <form class="form-grid" @submit.prevent="saveTransaction">
          <div>
            <label class="field-label" for="tx-type">Hareket Türü *</label>
            <select id="tx-type" v-model="transactionForm.transactionType" class="select">
              <option
                v-for="opt in TRANSACTION_TYPE_OPTIONS"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="field-label" for="tx-date">Tarih *</label>
            <input id="tx-date" v-model="transactionForm.transactionDate" type="date" class="input" required />
          </div>
          <div>
            <label class="field-label" for="tx-amount">Tutar *</label>
            <input
              id="tx-amount"
              v-model.number="transactionForm.amount"
              type="number"
              step="0.01"
              min="0.01"
              class="input"
              required
            />
          </div>
          <div v-if="transactionForm.transactionType === 'purchase'">
            <label class="field-label" for="tx-installments">Taksit Sayısı</label>
            <input
              id="tx-installments"
              v-model.number="transactionForm.installmentCount"
              type="number"
              min="1"
              max="36"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="tx-ref">Referans</label>
            <input id="tx-ref" v-model="transactionForm.reference" class="input" />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="tx-desc">Açıklama *</label>
            <input id="tx-desc" v-model="transactionForm.description" class="input" required />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showTransactionForm = false">
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
  type CardTransactionType,
  type CreditCard,
} from '@/stores/cash-bank';

const store = useCashBankStore();

const search = ref('');
const activeCardId = ref<string | null>(null);
const transactionTypeFilter = ref<'' | CardTransactionType>('');
const showCardForm = ref(false);
const showTransactionForm = ref(false);
const editingCard = ref<CreditCard | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const today = () => new Date().toISOString().split('T')[0];

const CARD_NETWORK_OPTIONS = [
  { value: '', label: 'Seçiniz…' },
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'troy', label: 'Troy' },
  { value: 'amex', label: 'Amex' },
  { value: 'other', label: 'Diğer' },
];
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];
const TRANSACTION_TYPE_OPTIONS: Array<{ value: CardTransactionType; label: string }> = [
  { value: 'purchase', label: 'Harcama' },
  { value: 'payment', label: 'Ödeme' },
  { value: 'refund', label: 'İade' },
  { value: 'fee', label: 'Ücret' },
  { value: 'interest', label: 'Faiz' },
];

const bankAccounts = computed(() => store.accounts.filter((a) => a.accountType === 'bank'));
const bankAccountOptions = computed(() => [
  { value: '', label: 'Banka hesabı seçin…' },
  ...bankAccounts.value.map((a) => ({ value: a.id, label: a.accountName })),
]);
const activeCard = computed(() =>
  store.creditCards.find((c) => c.id === activeCardId.value),
);

const filteredCards = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return store.creditCards;
  return store.creditCards.filter((c) =>
    [c.cardLabel, c.bankAccountName, c.cardNumberLast4, c.cardNetwork]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q)),
  );
});

const sum = (values: number[]) => values.reduce((total, value) => total + Number(value ?? 0), 0);
const totalLimit = computed(() => sum(store.creditCards.map((c) => c.creditLimit)));
const totalDebt = computed(() => sum(store.creditCards.map((c) => c.currentDebt)));
const totalAvailable = computed(() => sum(store.creditCards.map((c) => c.availableLimit)));

const cardForm = ref({
  bankAccountId: '',
  cardLabel: '',
  cardNumberLast4: '',
  cardNetwork: '' as CreditCard['cardNetwork'] | '',
  creditLimit: 0,
  currentDebt: 0,
  statementDay: undefined as number | undefined,
  dueDay: undefined as number | undefined,
  currency: 'TRY',
  description: '',
});
const transactionForm = ref({
  transactionType: 'purchase' as CardTransactionType,
  transactionDate: today(),
  amount: 0,
  installmentCount: 1,
  reference: '',
  description: '',
});

const formatMoney = (value: number | string | undefined, currency = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(Number(value ?? 0));
const formatDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(value)) : '—';

const cardNetworkLabel = (network: string | null | undefined) =>
  ({ visa: 'Visa', mastercard: 'Mastercard', troy: 'Troy', amex: 'Amex', other: 'Diğer' })[
    network ?? ''
  ] ?? '—';
const cardStatusLabel = (status: string) =>
  ({ active: 'Aktif', blocked: 'Bloke', closed: 'Kapalı' })[status] ?? status;
const cardStatusClass = (status: string) =>
  ({ active: 'badge-success', blocked: 'badge-danger', closed: 'badge-neutral' })[status] ??
  'badge-neutral';

const transactionTypeLabel = (type: CardTransactionType) =>
  TRANSACTION_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? type;
const transactionBadge = (type: CardTransactionType) =>
  ({
    purchase: 'badge-danger',
    payment: 'badge-success',
    refund: 'badge-info',
    fee: 'badge-warning',
    interest: 'badge-warning',
  })[type] ?? 'badge-neutral';
const isDebtType = (type: CardTransactionType) =>
  type === 'purchase' || type === 'fee' || type === 'interest';

const openCard = async (card: CreditCard) => {
  activeCardId.value = card.id;
  transactionTypeFilter.value = '';
  await store.fetchCardTransactions(card.id);
};
const closeCard = () => {
  activeCardId.value = null;
  store.cardTransactions = [];
};
const reloadTransactions = async () => {
  if (!activeCardId.value) return;
  await store.fetchCardTransactions(activeCardId.value, {
    transactionType: transactionTypeFilter.value || undefined,
  });
};

const openCardForm = (card?: CreditCard) => {
  editingCard.value = card ?? null;
  formError.value = null;
  cardForm.value = card
    ? {
        bankAccountId: card.bankAccountId ?? '',
        cardLabel: card.cardLabel,
        cardNumberLast4: card.cardNumberLast4 ?? '',
        cardNetwork: card.cardNetwork ?? '',
        creditLimit: Number(card.creditLimit ?? 0),
        currentDebt: Number(card.currentDebt ?? 0),
        statementDay: card.statementDay ?? undefined,
        dueDay: card.dueDay ?? undefined,
        currency: card.currency || 'TRY',
        description: card.description ?? '',
      }
    : {
        bankAccountId: bankAccounts.value[0]?.id ?? '',
        cardLabel: '',
        cardNumberLast4: '',
        cardNetwork: '',
        creditLimit: 0,
        currentDebt: 0,
        statementDay: undefined,
        dueDay: undefined,
        currency: 'TRY',
        description: '',
      };
  showCardForm.value = true;
};

const saveCard = async () => {
  formError.value = null;
  if (!cardForm.value.bankAccountId) {
    formError.value = 'Banka hesabı seçin.';
    return;
  }
  saving.value = true;
  try {
    const payload = {
      bankAccountId: cardForm.value.bankAccountId,
      cardLabel: cardForm.value.cardLabel.trim(),
      cardNumberLast4: cardForm.value.cardNumberLast4.trim() || undefined,
      cardNetwork: cardForm.value.cardNetwork || undefined,
      creditLimit: cardForm.value.creditLimit,
      currentDebt: cardForm.value.currentDebt,
      statementDay: cardForm.value.statementDay,
      dueDay: cardForm.value.dueDay,
      currency: cardForm.value.currency,
      description: cardForm.value.description.trim() || undefined,
    };
    const saved = editingCard.value
      ? await store.updateCreditCard(editingCard.value.id, payload)
      : await store.createCreditCard(payload);
    showCardForm.value = false;
    await store.fetchCreditCards();
    if (activeCardId.value && saved?.id === activeCardId.value) {
      await reloadTransactions();
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  } finally {
    saving.value = false;
  }
};

const removeCard = async (card: CreditCard) => {
  if (!window.confirm(`"${card.cardLabel}" kartını silmek istediğinize emin misiniz?`)) return;
  try {
    await store.deleteCreditCard(card.id);
    if (activeCardId.value === card.id) closeCard();
  } catch {
    /* store hatası */
  }
};

const openTransactionForm = (type: CardTransactionType) => {
  formError.value = null;
  transactionForm.value = {
    transactionType: type,
    transactionDate: today(),
    amount: 0,
    installmentCount: 1,
    reference: '',
    description: '',
  };
  showTransactionForm.value = true;
};

const saveTransaction = async () => {
  if (!activeCardId.value) return;
  formError.value = null;
  saving.value = true;
  try {
    await store.createCardTransaction(activeCardId.value, {
      transactionDate: transactionForm.value.transactionDate,
      transactionType: transactionForm.value.transactionType,
      description: transactionForm.value.description.trim(),
      amount: transactionForm.value.amount,
      installmentCount:
        transactionForm.value.transactionType === 'purchase'
          ? transactionForm.value.installmentCount
          : 1,
      reference: transactionForm.value.reference.trim() || undefined,
    });
    showTransactionForm.value = false;
    await reloadTransactions();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Hareket kaydedilemedi.';
  } finally {
    saving.value = false;
  }
};

const removeTransaction = async (transactionId: string) => {
  if (!activeCardId.value) return;
  if (!window.confirm('Bu kart hareketini silmek istediğinize emin misiniz?')) return;
  try {
    await store.deleteCardTransaction(activeCardId.value, transactionId);
  } catch {
    /* store hatası */
  }
};

onMounted(async () => {
  store.filters.accountType = 'bank';
  await store.fetchAccounts();
  await store.fetchCreditCards();
});
</script>
