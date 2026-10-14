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

    <div class="form-layout">
      <!-- ── Sol: form ── -->
      <div class="card">
        <form @submit.prevent="save" class="form-grid">
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
            <label for="exp-inv-no">Fatura No</label>
            <input id="exp-inv-no" v-model="form.invoice_number" type="text" class="input" />
          </div>
          <div>
            <label for="exp-inv-date">Fatura Tarihi</label>
            <input id="exp-inv-date" v-model="form.invoice_date" type="date" class="input" />
          </div>

          <div class="form-field-full">
            <label for="exp-desc">Açıklama *</label>
            <input id="exp-desc" v-model="form.description" type="text" required class="input" />
          </div>

          <div>
            <label for="exp-amount">Tutar *</label>
            <input
              id="exp-amount"
              v-model.number="form.amount"
              type="number"
              min="0"
              step="0.01"
              required
              class="input"
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

          <div class="form-field-full">
            <label for="exp-notes">Notlar</label>
            <textarea id="exp-notes" v-model="form.notes" class="textarea" rows="3"></textarea>
          </div>

          <div class="modal-actions">
            <RouterLink to="/expenses" class="btn btn-secondary">İptal</RouterLink>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Kaydet' }}
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
              @click="form.category_id = cat.id"
            >
              {{ cat.name }}
            </button>
          </div>
        </div>
        <!-- Panel altı: satır içi yeni kategori (eklenince otomatik seçilir) -->
        <div class="aside-add">
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
import { useExpenseStore, type Expense } from '@/stores/expense';
import CategoryQuickAdd from '@/components/CategoryQuickAdd.vue';
import FilterableSelect from '@/components/FilterableSelect.vue';

const route = useRoute();
const router = useRouter();
const expenseStore = useExpenseStore();

const categoriesByGroup = computed(() => expenseStore.categoriesByGroup);

// ── Combobox (filtreli seçim) seçenekleri ──
const categoryOptions = computed(() =>
  categoriesByGroup.value.flatMap((grp) =>
    grp.items.map((cat) => ({ value: cat.id, label: cat.name })),
  ),
);
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
const error = computed(() => expenseStore.error);
const saving = ref(false);

const expenseId = computed(() => route.params.id as string | undefined);
const isEdit = computed(() => Boolean(expenseId.value));

const selectedCategory = computed(() => expenseStore.categoryById(form.value.category_id));

const form = ref({
  expense_date: new Date().toISOString().split('T')[0],
  invoice_number: '',
  invoice_date: '',
  category_id: '',
  description: '',
  amount: 0,
  currency: 'TRY',
  exchange_rate: 1,
  payment_status: 'unpaid' as Expense['payment_status'],
  status: 'draft' as Expense['status'],
  notes: '',
});

onMounted(async () => {
  await expenseStore.fetchCategories();
  if (isEdit.value && expenseId.value) {
    const existing = await expenseStore.getExpenseById(expenseId.value);
    if (existing) {
      form.value = {
        expense_date: String(existing.expense_date).split('T')[0],
        invoice_number: existing.invoice_number ?? '',
        invoice_date: existing.invoice_date ? String(existing.invoice_date).split('T')[0] : '',
        category_id: existing.category_id,
        description: existing.description,
        amount: existing.amount,
        currency: existing.currency,
        exchange_rate: existing.exchange_rate ?? 1,
        payment_status: existing.payment_status,
        status: existing.status,
        notes: existing.notes ?? '',
      };
      return;
    }
  }
  // Liste ekranından gelen kategori ön seçimi (?category=<id>)
  const preselect = route.query.category as string | undefined;
  if (preselect) form.value.category_id = preselect;
});

const save = async () => {
  saving.value = true;
  try {
    const payload = {
      ...form.value,
      invoice_number: form.value.invoice_number || undefined,
      invoice_date: form.value.invoice_date || undefined,
      notes: form.value.notes || undefined,
    };
    if (isEdit.value && expenseId.value) {
      await expenseStore.updateExpense(expenseId.value, payload);
    } else {
      await expenseStore.createExpense(payload);
    }
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
.form-field-full {
  grid-column: 1 / -1;
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
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
