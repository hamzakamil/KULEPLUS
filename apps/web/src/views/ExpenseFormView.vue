<template>
  <div class="expense-form-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ isEdit ? 'Gider Düzenle' : 'Yeni Gider' }}</h1>
        <p v-if="selectedCategory" class="page-sub">
          <span class="badge" :class="`tone-${groupTone(selectedCategory.grup)}`">
            {{ selectedCategory.name }}
          </span>
          <span class="muted">{{ selectedCategory.description }}</span>
        </p>
      </div>
      <RouterLink to="/expenses" class="btn btn-secondary">Geri</RouterLink>
    </header>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <p v-if="isLocked" class="lock-note" role="status">
      {{
        isCancelled
          ? 'Bu gider iptal edilmiş; değiştirilemez.'
          : 'Kesinleşmiş gider değiştirilemez. Yalnızca not güncellenebilir veya gider iptal edilebilir.'
      }}
    </p>

    <div class="form-layout">
      <!-- ── Sol: form ── -->
      <div class="card">
        <form @submit.prevent="save" class="form-grid">
          <fieldset class="form-fields" :disabled="isLocked">
            <div>
              <label for="exp-date">Gider Tarihi *</label>
              <input id="exp-date" v-model="form.expense_date" type="date" required class="input" />
            </div>
            <div>
              <label for="exp-category">Kategori *</label>
              <FilterableSelect
                id="exp-category"
                v-model="form.category_id"
                :options="categoryOptions"
                placeholder="Kategori seçin"
              />
            </div>

            <div>
              <label for="exp-inv-no">Fatura No{{ isPesin ? ' *' : '' }}</label>
              <input id="exp-inv-no" v-model="form.invoice_number" type="text" class="input" />
            </div>
            <div>
              <label for="exp-inv-date">Fatura Tarihi</label>
              <input id="exp-inv-date" v-model="form.invoice_date" type="date" class="input" />
            </div>

            <div class="form-field-full">
              <label for="exp-contact">Cari (isteğe bağlı)</label>
              <FilterableSelect
                id="exp-contact"
                v-model="form.contact_id"
                :options="contactOptions"
                placeholder="Cari seçilmezse peşin gider"
                allow-clear
              />
            </div>

            <div class="form-field-full">
              <label for="exp-desc">Açıklama *</label>
              <input id="exp-desc" v-model="form.description" type="text" required class="input" />
            </div>

            <div>
              <label for="exp-net">Matrah (KDV hariç) *</label>
              <input
                id="exp-net"
                v-model.number="form.net_amount"
                type="number"
                min="0"
                step="0.01"
                required
                class="input"
              />
            </div>
            <div>
              <label for="exp-tax-rate">KDV oranı *</label>
              <FilterableSelect
                id="exp-tax-rate"
                v-model="form.tax_rate"
                :options="taxRateOptions"
                placeholder="KDV oranı seçin"
              />
            </div>

            <div>
              <label for="exp-tax">KDV (otomatik)</label>
              <input
                id="exp-tax"
                type="text"
                class="input"
                :value="formatAmount(taxAmount)"
                readonly
                tabindex="-1"
              />
            </div>
            <div>
              <label for="exp-total">Toplam (KDV dahil)</label>
              <input
                id="exp-total"
                type="text"
                class="input"
                :value="formatAmount(totalAmount)"
                readonly
                tabindex="-1"
              />
            </div>

            <div>
              <label for="exp-currency">Para Birimi *</label>
              <FilterableSelect
                id="exp-currency"
                v-model="form.currency"
                :options="CURRENCY_OPTIONS"
                placeholder="Para birimi seçin"
              />
            </div>
            <div>
              <label for="exp-payment">Ödeme Durumu</label>
              <FilterableSelect
                id="exp-payment"
                v-model="form.payment_status"
                :options="PAYMENT_STATUS_OPTIONS"
                placeholder="Ödeme durumu seçin"
              />
            </div>
            <div>
              <label for="exp-status">Durum</label>
              <FilterableSelect
                id="exp-status"
                v-model="form.status"
                :options="STATUS_OPTIONS"
                placeholder="Durum seçin"
              />
            </div>

            <!-- ── Peşin gider: cari seçilmediğinde ── -->
            <div v-if="isPesin" class="form-field-full pesin-box">
              <p class="pesin-title">Peşin gider bilgileri</p>
              <div>
                <label for="exp-seller">Satıcı unvanı *</label>
                <input
                  id="exp-seller"
                  v-model="form.counterparty_name"
                  type="text"
                  maxlength="255"
                  class="input"
                />
              </div>
              <div>
                <label for="exp-seller-tax">VKN/TCKN</label>
                <input
                  id="exp-seller-tax"
                  v-model="form.counterparty_tax_number"
                  type="text"
                  maxlength="20"
                  inputmode="numeric"
                  class="input"
                />
              </div>
              <div>
                <label for="exp-source-type">Ödeme kaynağı türü *</label>
                <FilterableSelect
                  id="exp-source-type"
                  :model-value="form.payment_source_type"
                  :options="PAYMENT_SOURCE_TYPE_OPTIONS"
                  placeholder="Tür seçin"
                  @update:model-value="setPaymentSourceType"
                />
              </div>
              <div>
                <label for="exp-source">Ödeme kaynağı *</label>
                <FilterableSelect
                  id="exp-source"
                  v-model="form.payment_source_id"
                  :options="paymentSourceOptions"
                  :disabled="!form.payment_source_type"
                  :placeholder="form.payment_source_type ? 'Seçin' : 'Önce tür seçin'"
                />
              </div>
            </div>
          </fieldset>

          <div class="form-field-full">
            <label for="exp-notes">Notlar</label>
            <textarea
              id="exp-notes"
              v-model="form.notes"
              class="textarea"
              rows="3"
              :disabled="isCancelled"
            ></textarea>
          </div>

          <div class="modal-actions">
            <RouterLink to="/expenses" class="btn btn-secondary">
              {{ isLocked ? 'Listeye dön' : 'İptal' }}
            </RouterLink>
            <button
              v-if="isPosted"
              type="button"
              class="btn btn-danger"
              :disabled="saving"
              @click="cancelExpense"
            >
              Gideri iptal et
            </button>
            <button v-if="!isCancelled" type="submit" class="btn btn-primary" :disabled="saving">
              {{
                saving
                  ? 'Kaydediliyor…'
                  : isPosted
                    ? 'Notu Güncelle'
                    : isEdit
                      ? 'Güncelle'
                      : 'Kaydet'
              }}
            </button>
          </div>
        </form>
      </div>

      <!-- ── Sağ: hızlı kategori seçimi ── -->
      <aside class="quick-aside" aria-label="Hızlı kategori seçimi">
        <h2 class="aside-title">Kategori Değiştir</h2>
        <div v-for="grp in categoriesByGroup" :key="grp.key" class="aside-group">
          <p class="aside-group-label">
            <span aria-hidden="true">{{ groupIcon(grp.key) }}</span> {{ grp.label }}
          </p>
          <div class="aside-chips">
            <button
              v-for="cat in grp.items"
              :key="cat.id"
              type="button"
              class="chip"
              :class="[{ active: form.category_id === cat.id }, `tone-${groupTone(grp.key)}`]"
              :disabled="isLocked"
              @click="form.category_id = cat.id"
            >
              {{ cat.name }}
            </button>
          </div>
        </div>
        <!-- Panel altı: satır içi yeni kategori (eklenince otomatik seçilir) -->
        <div v-if="!isLocked" class="aside-add">
          <CategoryQuickAdd
            trigger-label="＋ Yeni kategori ekle"
            @created="form.category_id = $event"
          />
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useExpenseStore, type Expense, type PaymentSourceType } from '@/stores/expense';
import { useInvoiceStore } from '@/stores/invoices';
import { useContactStore } from '@/stores/contacts';
import { useCashBankStore } from '@/stores/cash-bank';
import CategoryQuickAdd from '@/components/CategoryQuickAdd.vue';
import FilterableSelect from '@/components/FilterableSelect.vue';

const route = useRoute();
const router = useRouter();
const expenseStore = useExpenseStore();
const invoiceStore = useInvoiceStore();
const contactStore = useContactStore();
const cashBank = useCashBankStore();

const categoriesByGroup = computed(() => expenseStore.categoriesByGroup);

// ── Combobox (filtreli seçim) seçenekleri ──
const categoryOptions = computed(() =>
  categoriesByGroup.value.flatMap((grp) =>
    grp.items.map((cat) => ({ value: cat.id, label: cat.name })),
  ),
);
const contactOptions = computed(() =>
  contactStore.contacts.map((c) => ({ value: c.id, label: c.name })),
);
/** KDV oranları tax-rates listesinden; liste boşsa sabit 0/1/10/20. */
const taxRateOptions = computed(() => {
  const rates = invoiceStore.taxRates.length
    ? invoiceStore.taxRates.map((t) => Number(t.rate))
    : [0, 1, 10, 20];
  return [...new Set(rates)]
    .sort((a, b) => a - b)
    .map((rate) => ({ value: String(rate), label: `%${rate}` }));
});
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];
const PAYMENT_STATUS_OPTIONS = [
  { value: 'unpaid', label: 'Ödenmedi' },
  { value: 'partial', label: 'Kısmi' },
  { value: 'paid', label: 'Ödendi' },
];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Taslak' },
  { value: 'posted', label: 'Kaydedildi' },
  { value: 'cancelled', label: 'İptal' },
];
const PAYMENT_SOURCE_TYPE_OPTIONS = [
  { value: 'cash_bank', label: 'Kasa / Banka' },
  { value: 'credit_card', label: 'Kredi kartı' },
];

/** Yerel doğrulama mesajı (kesinleştirme kuralları); API mesajı store `error`'dan gelir. */
const localError = ref('');
const error = computed(() => localError.value || expenseStore.error);
const saving = ref(false);

const expenseId = computed(() => route.params.id as string | undefined);
const isEdit = computed(() => Boolean(expenseId.value));

/** Düzenlenen giderin durumu: kesinleşmiş ya da iptal edilmiş gider salt okunur. */
const existingStatus = ref<Expense['status'] | null>(null);
const isPosted = computed(() => existingStatus.value === 'posted');
const isCancelled = computed(() => existingStatus.value === 'cancelled');
const isLocked = computed(() => isPosted.value || isCancelled.value);

const selectedCategory = computed(() => expenseStore.categoryById(form.value.category_id));

const form = ref({
  expense_date: new Date().toISOString().split('T')[0],
  invoice_number: '',
  invoice_date: '',
  contact_id: '',
  category_id: '',
  description: '',
  /** Matrah (KDV hariç). Gönderimde net_amount olarak gider; amount gönderilmez. */
  net_amount: 0,
  /** KDV oranı (seçici değeri metindir: '0' | '1' | '10' | '20'). */
  tax_rate: '20',
  currency: 'TRY',
  exchange_rate: 1,
  payment_status: 'unpaid' as Expense['payment_status'],
  status: 'draft' as Expense['status'],
  counterparty_name: '',
  counterparty_tax_number: '',
  payment_source_type: '' as '' | PaymentSourceType,
  payment_source_id: '',
  notes: '',
});

/** Cari seçilmemişse gider peşindir. */
const isPesin = computed(() => !form.value.contact_id);

// ── KDV hesabı (sunucu ile aynı kural: matrah × oran, kuruşa yuvarlanır) ──
const taxRate = computed(() => Number(form.value.tax_rate) || 0);
const taxAmount = computed(
  () => Math.round((Number(form.value.net_amount) || 0) * taxRate.value) / 100,
);
const totalAmount = computed(
  () => Math.round(((Number(form.value.net_amount) || 0) + taxAmount.value) * 100) / 100,
);
const formatAmount = (value: number) =>
  value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Peşin giderde ödeme kaynağı seçenekleri: seçilen türe göre kasa/banka ya da kredi kartı. */
const paymentSourceOptions = computed(() => {
  const selectedId = form.value.payment_source_id;
  if (form.value.payment_source_type === 'cash_bank') {
    return cashBank.accounts
      .filter((a) => a.status === 'active' || a.id === selectedId)
      .map((a) => ({
        value: a.id,
        label: `${a.accountName} (${a.accountType === 'cash' ? 'Kasa' : 'Banka'})`,
      }));
  }
  if (form.value.payment_source_type === 'credit_card') {
    return cashBank.creditCards
      .filter((c) => c.status === 'active' || c.id === selectedId)
      .map((c) => ({
        value: c.id,
        label: c.bankAccountName ? `${c.cardLabel} (${c.bankAccountName})` : c.cardLabel,
      }));
  }
  return [];
});

/** Ödeme kaynağı türü değişince önceki kaynak seçimi geçersiz olur. */
function setPaymentSourceType(value: string) {
  form.value.payment_source_type = value as '' | PaymentSourceType;
  form.value.payment_source_id = '';
}

/**
 * Kasa/banka ve kredi kartı listesi. CashBankView kendi tür filtresini (accountType) store'da
 * bıraktığı için listeyi o filtre olmadan ve geniş sayfa ile çekip, durumu geri yükler.
 */
async function loadPaymentSources() {
  const saved = cashBank.filters;
  cashBank.filters = { ...saved, accountType: undefined, page: 1, limit: 100 };
  try {
    await Promise.all([cashBank.fetchAccounts(), cashBank.fetchCreditCards()]);
  } finally {
    cashBank.filters = saved;
  }
}

onMounted(async () => {
  await Promise.all([
    expenseStore.fetchCategories(),
    invoiceStore.fetchTaxRates(),
    contactStore.fetchContacts({ limit: 100 }),
    loadPaymentSources(),
  ]);
  if (isEdit.value && expenseId.value) {
    const existing = await expenseStore.getExpenseById(expenseId.value);
    if (existing) {
      existingStatus.value = existing.status;
      // Sayısal alanlar API'de (NUMERIC) metin gelebilir; burada sayıya çevrilir.
      form.value = {
        expense_date: String(existing.expense_date).split('T')[0],
        invoice_number: existing.invoice_number ?? '',
        invoice_date: existing.invoice_date ? String(existing.invoice_date).split('T')[0] : '',
        contact_id: existing.contact_id ?? '',
        category_id: existing.category_id,
        description: existing.description,
        net_amount: Number(existing.net_amount ?? existing.amount),
        tax_rate: String(Number(existing.tax_rate ?? 0)),
        currency: existing.currency,
        exchange_rate: existing.exchange_rate ?? 1,
        payment_status: existing.payment_status,
        status: existing.status,
        counterparty_name: existing.counterparty_name ?? '',
        counterparty_tax_number: existing.counterparty_tax_number ?? '',
        payment_source_type: existing.payment_source_type ?? '',
        payment_source_id: existing.payment_source_id ?? '',
        notes: existing.notes ?? '',
      };
      return;
    }
  }
  // Liste ekranından gelen kategori ön seçimi (?category=<id>)
  const preselect = route.query.category as string | undefined;
  if (preselect) form.value.category_id = preselect;
});

/** Peşin gider kesinleşirken dolu olması gereken alanlar (sunucu da aynı kuralı uygular). */
function pesinMissingFields(): string[] {
  const f = form.value;
  const missing: string[] = [];
  if (!f.invoice_number.trim()) missing.push('Fatura No');
  if (!f.counterparty_name.trim()) missing.push('Satıcı unvanı');
  if (!f.payment_source_type || !f.payment_source_id) missing.push('Ödeme kaynağı');
  return missing;
}

/** Gider gövdesi. amount gönderilmez: sunucu net_amount + tax_rate'ten KDV dahil tutarı hesaplar. */
function buildPayload(): Partial<Expense> {
  const f = form.value;
  const pesin = isPesin.value;
  return {
    expense_date: f.expense_date,
    invoice_number: f.invoice_number || undefined,
    invoice_date: f.invoice_date || undefined,
    category_id: f.category_id,
    contact_id: f.contact_id || undefined,
    description: f.description,
    net_amount: Number(f.net_amount),
    tax_rate: taxRate.value,
    counterparty_name: pesin ? f.counterparty_name.trim() || undefined : undefined,
    counterparty_tax_number: pesin ? f.counterparty_tax_number.trim() || undefined : undefined,
    payment_source_type: pesin ? f.payment_source_type || undefined : undefined,
    payment_source_id: pesin ? f.payment_source_id || undefined : undefined,
    currency: f.currency,
    exchange_rate: f.exchange_rate,
    payment_status: f.payment_status,
    status: f.status,
    notes: f.notes || undefined,
  };
}

const save = async () => {
  if (isCancelled.value) return;
  localError.value = '';
  expenseStore.error = null;

  // Kesinleştirme kontrolü (kesinleşmiş gider yalnız not güncelleyebilir; burada atlanır).
  if (!isPosted.value && form.value.status === 'posted' && isPesin.value) {
    const missing = pesinMissingFields();
    if (missing.length) {
      localError.value = `Peşin gider kesinleştirilmeden önce doldurulmalı: ${missing.join(', ')}.`;
      return;
    }
  }

  saving.value = true;
  try {
    if (isEdit.value && expenseId.value) {
      // Kesinleşmiş giderde yalnız not değiştirilebilir.
      const payload: Partial<Expense> = isPosted.value
        ? { notes: form.value.notes }
        : buildPayload();
      await expenseStore.updateExpense(expenseId.value, payload);
    } else {
      await expenseStore.createExpense(buildPayload());
    }
    router.push('/expenses');
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
};

/** Kesinleşmiş gideri iptal eder (sunucu ters kayıt ile iptal eder). */
const cancelExpense = async () => {
  if (!expenseId.value) return;
  if (!window.confirm('Bu gider iptal edilsin mi?')) return;
  localError.value = '';
  expenseStore.error = null;
  saving.value = true;
  try {
    await expenseStore.updateExpense(expenseId.value, { status: 'cancelled' });
    router.push('/expenses');
  } catch {
    /* hata store'da tutulur */
  } finally {
    saving.value = false;
  }
};

const groupTone = (grup?: string | null): string => {
  const map: Record<string, string> = {
    kira: 'blue',
    'kamu-hizmetleri': 'cyan',
    isletme: 'amber',
    personel: 'violet',
    mevzuat: 'slate',
    finansal: 'rose',
  };
  return map[grup ?? ''] ?? 'slate';
};

const groupIcon = (grup?: string | null): string => {
  const map: Record<string, string> = {
    kira: '🏢',
    'kamu-hizmetleri': '💡',
    isletme: '🔧',
    personel: '👥',
    mevzuat: '⚖️',
    finansal: '🧾',
  };
  return map[grup ?? ''] ?? '•';
};
</script>

<style scoped>
.expense-form-view {
  --c-primary: #1d4ed8;
  --c-border: #e2e8f0;
  --c-muted: #64748b;
  --c-bg: #f8fafc;
  max-width: 90rem;
  margin-inline: auto;
  padding: 1.5rem;
}

.page-sub {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
}

.lock-note {
  margin: 0 0 1rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.875rem;
}

.form-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20rem;
  gap: 1.25rem;
  align-items: start;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.875rem;
}
.form-grid label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}
.form-grid .input[readonly] {
  background: var(--c-bg);
  color: var(--c-muted);
}
.form-field-full {
  grid-column: 1 / -1;
}
/* Kilitli (kesinleşmiş/iptal) giderde alanlar: fieldset kutusu yerine doğrudan ızgaraya yerleşir. */
.form-fields {
  display: contents;
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}

/* Peşin gider kutusu */
.pesin-box {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.875rem;
  padding: 0.875rem;
  border: 1px dashed var(--c-border);
  border-radius: 0.625rem;
  background: var(--c-bg);
}
.pesin-title {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--c-muted);
}

/* ── Sağ: hızlı kategori paneli ── */
.quick-aside {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1rem 1.125rem;
  position: sticky;
  top: 1.5rem;
}
.aside-title {
  font-size: 1rem;
  margin: 0 0 0.75rem;
}
.aside-group {
  margin-bottom: 0.875rem;
}
.aside-group-label {
  margin: 0 0 0.375rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--c-muted);
}
.aside-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.chip {
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  border: 1px solid var(--c-border);
  background: #fff;
  color: #0f172a;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.chip:disabled,
.chip:disabled:hover {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: var(--c-border);
  color: #0f172a;
}
.chip.active {
  border-color: var(--c-primary);
  box-shadow: inset 0 0 0 1px var(--c-primary);
  font-weight: 600;
}
.chip:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}
.chip.tone-blue.active {
  background: #dbeafe;
  color: #1e40af;
}
.chip.tone-cyan.active {
  background: #cffafe;
  color: #155e75;
}
.chip.tone-amber.active {
  background: #fef3c7;
  color: #92400e;
}
.chip.tone-violet.active {
  background: #ede9fe;
  color: #5b21b6;
}
.chip.tone-slate.active {
  background: #e2e8f0;
  color: #334155;
}
.chip.tone-rose.active {
  background: #ffe4e6;
  color: #9f1239;
}
/* Panel altı satır içi kategori ekleme */
.aside-add {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--c-border);
}
.aside-add .cat-add-trigger {
  width: 100%;
  justify-content: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge.tone-blue {
  background: #dbeafe;
  color: #1e40af;
}
.badge.tone-cyan {
  background: #cffafe;
  color: #155e75;
}
.badge.tone-amber {
  background: #fef3c7;
  color: #92400e;
}
.badge.tone-violet {
  background: #ede9fe;
  color: #5b21b6;
}
.badge.tone-slate {
  background: #e2e8f0;
  color: #334155;
}
.badge.tone-rose {
  background: #ffe4e6;
  color: #9f1239;
}

.modal-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

@media (max-width: 64rem) {
  .form-layout {
    grid-template-columns: 1fr;
  }
  .quick-aside {
    position: static;
  }
}
@media (max-width: 34rem) {
  .form-grid,
  .pesin-box {
    grid-template-columns: 1fr;
  }
}
</style>
