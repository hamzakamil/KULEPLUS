<template>
  <div class="expenses-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Giderler</h1>
        <p class="page-sub">En sık kullandığınız gider türünden hızlıca başlayın.</p>
      </div>
      <div class="page-actions">
        <RouterLink to="/settings/expense-categories" class="btn btn-secondary"
          >⚙ Kategoriler</RouterLink
        >
        <RouterLink to="/expenses/new" class="btn btn-primary">+ Yeni Gider</RouterLink>
      </div>
    </header>

    <!-- ── Öne çıkan (sık kullanılan) gider kategorileri ── -->
    <section class="quick-pick" aria-labelledby="hizli-gider">
      <div class="quick-pick-head">
        <h2 id="hizli-gider" class="quick-pick-title">Hızlı Gider Girişi</h2>
        <span class="muted small">Bir kategori seçin → ilgili form açılır</span>
      </div>

      <div v-if="favoriteCategories.length" class="tile-grid">
        <button
          v-for="cat in favoriteCategories"
          :key="cat.id"
          type="button"
          class="tile"
          :class="`tone-${groupTone(cat.grup)}`"
          :title="cat.description || cat.name"
          @click="startExpense(cat.id)"
        >
          <span class="tile-icon" aria-hidden="true">{{ groupIcon(cat.grup) }}</span>
          <span class="tile-name">{{ cat.name }}</span>
          <span class="tile-hint">{{ cat.description }}</span>
        </button>
        <!-- Hızlı giriş kutucuklarının sonu: satır içi yeni kategori -->
        <div class="tile tile-add">
          <CategoryQuickAdd trigger-label="＋ Yeni kategori" @created="onCategoryCreated" />
        </div>
      </div>
      <p v-else class="state-msg">Kategoriler yükleniyor…</p>
    </section>

    <!-- ── Gruplu kategori tarayıcısı ── -->
    <section class="groups" aria-labelledby="kategori-gruplari">
      <h2 id="kategori-gruplari" class="section-title">Tüm Gider Kategorileri</h2>
      <div class="group-grid">
        <article v-for="grp in categoriesByGroup" :key="grp.key" class="group-card">
          <header class="group-head">
            <span class="group-icon" :class="`tone-${groupTone(grp.key)}`" aria-hidden="true">
              {{ groupIcon(grp.key) }}
            </span>
            <div>
              <h3>{{ grp.label }}</h3>
              <p class="muted small">{{ grp.hint }}</p>
            </div>
          </header>
          <ul class="group-items">
            <li v-for="cat in grp.items" :key="cat.id">
              <button type="button" class="group-link" @click="startExpense(cat.id)">
                {{ cat.name }}
              </button>
            </li>
            <li class="group-add">
              <CategoryQuickAdd
                :default-group="grp.key"
                trigger-label="＋ Yeni"
                @created="onCategoryCreated"
              />
            </li>
          </ul>
        </article>
      </div>
    </section>

    <!-- ── Kayıtlı giderler ── -->
    <section class="records" aria-labelledby="gider-kayitlari">
      <h2 id="gider-kayitlari" class="section-title">Kayıtlı Giderler</h2>

      <div class="toolbar" role="search">
        <FilterableSelect
          v-model="filters.category_id"
          :options="categoryFilterOptions"
          class="select"
          placeholder="Tüm Kategoriler"
          aria-label="Kategori filtresi"
          @select="fetchExpenses"
        />
        <FilterableSelect
          v-model="filters.status"
          :options="STATUS_FILTER_OPTIONS"
          class="select"
          placeholder="Tüm Durumlar"
          aria-label="Durum filtresi"
          @select="fetchExpenses"
        />
        <FilterableSelect
          v-model="filters.payment_status"
          :options="PAYMENT_STATUS_FILTER_OPTIONS"
          class="select"
          placeholder="Tüm Ödeme Durumları"
          aria-label="Ödeme durumu filtresi"
          @select="fetchExpenses"
        />
        <input
          v-model="filters.q"
          type="search"
          class="input search"
          placeholder="Açıklama, fatura no, kategori ara…"
          aria-label="Gider ara"
          @change="fetchExpenses"
        />
      </div>

      <p v-if="expenseStore.error" class="state-msg error">{{ expenseStore.error }}</p>

      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col">Kategori</th>
              <th scope="col">Açıklama</th>
              <th scope="col">Fatura No</th>
              <th scope="col">Cari</th>
              <th scope="col" class="num">Tutar</th>
              <th scope="col">Ödeme</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="expense in expenses" :key="expense.id">
              <td class="nowrap">{{ formatDate(expense.expense_date) }}</td>
              <td>
                <span class="badge" :class="categoryTone(expense)">
                  {{ expense.category_name || expense.category?.name || '—' }}
                </span>
              </td>
              <td>{{ expense.description }}</td>
              <td class="mono muted">{{ expense.invoice_number || '—' }}</td>
              <td>{{ expense.contact_name || '—' }}</td>
              <td class="num strong">{{ formatMoney(expense.amount, expense.currency) }}</td>
              <td>
                <span class="badge" :class="paymentBadge(expense.payment_status)">
                  {{ paymentLabel(expense.payment_status) }}
                </span>
              </td>
              <td>
                <span class="badge" :class="statusBadge(expense.status)">
                  {{ statusLabel(expense.status) }}
                </span>
              </td>
              <td class="num actions">
                <RouterLink :to="`/expenses/${expense.id}/edit`" class="link">Düzenle</RouterLink>
                <button class="link danger" @click="confirmDelete(expense.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!expenses.length && !loading">
              <td colspan="9" class="empty-cell">
                Henüz gider kaydı yok. Yukarıdan bir kategori seçerek başlayın.
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="9" class="empty-cell">Yükleniyor…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.pages > 1" class="pager">
        <button
          class="btn btn-secondary"
          :disabled="pagination.page <= 1"
          @click="changePage(pagination.page - 1)"
        >
          ‹ Önceki
        </button>
        <span>Sayfa {{ pagination.page }} / {{ pagination.pages }}</span>
        <button
          class="btn btn-secondary"
          :disabled="pagination.page >= pagination.pages"
          @click="changePage(pagination.page + 1)"
        >
          Sonraki ›
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useExpenseStore, type Expense } from '@/stores/expense';
import CategoryQuickAdd from '@/components/CategoryQuickAdd.vue';
import FilterableSelect from '@/components/FilterableSelect.vue';

const expenseStore = useExpenseStore();
const router = useRouter();

const expenses = computed(() => expenseStore.expenses);
const loading = computed(() => expenseStore.loading);
const pagination = computed(() => expenseStore.pagination);
const favoriteCategories = computed(() => expenseStore.favoriteCategories);
const categoriesByGroup = computed(() => expenseStore.categoriesByGroup);
const filters = computed({
  get: () => expenseStore.filters,
  set: (v) => {
    expenseStore.filters = v;
  },
});

// ── Combobox (filtreli seçim) seçenekleri ──
const categoryFilterOptions = computed(() => [
  { value: '', label: 'Tüm Kategoriler' },
  ...categoriesByGroup.value.flatMap((grp) =>
    grp.items.map((cat) => ({ value: cat.id, label: cat.name })),
  ),
]);
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tüm Durumlar' },
  { value: 'draft', label: 'Taslak' },
  { value: 'posted', label: 'Kaydedildi' },
  { value: 'cancelled', label: 'İptal' },
];
const PAYMENT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tüm Ödeme Durumları' },
  { value: 'unpaid', label: 'Ödenmedi' },
  { value: 'partial', label: 'Kısmi' },
  { value: 'paid', label: 'Ödendi' },
];

onMounted(async () => {
  await expenseStore.fetchCategories();
  await fetchExpenses();
});

const fetchExpenses = async () => {
  await expenseStore.fetchExpenses();
};

const changePage = (page: number) => {
  expenseStore.filters.page = page;
  fetchExpenses();
};

/** Kategori seçilince o kategoriyle önceden doldurulmuş yeni gider formu aç. */
const startExpense = (categoryId: string) => {
  router.push({ path: '/expenses/new', query: { category: categoryId } });
};

/** Satır içi eklenen kategori listeye düşünce gruplar kendiliğinden güncellenir. */
const onCategoryCreated = () => {
  /* kategoriler store'da güncellendi; ek işlem gerekmez */
};

const confirmDelete = async (id: string) => {
  if (!window.confirm('Bu gideri silmek istediğinize emin misiniz?')) return;
  try {
    await expenseStore.deleteExpense(id);
    fetchExpenses();
  } catch {
    /* hata store'da tutulur */
  }
};

/** Grup → görsel ton (sabit palet; gider türünü hızlıca tanıtır). */
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

/** Satırdaki kategoriyi, kategorinin grubuna göre tonla. */
const categoryTone = (expense: Expense): string => {
  const cat = expenseStore.categoryById(expense.category_id ?? '');
  const grup = cat?.grup;
  return `tone-${groupTone(grup)}`;
};

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount);

const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(value));

const statusLabel = (status: string) =>
  ({ draft: 'Taslak', posted: 'Kaydedildi', cancelled: 'İptal' })[status] ?? status;

const paymentLabel = (status: string) =>
  ({ unpaid: 'Ödenmedi', partial: 'Kısmi', paid: 'Ödendi' })[status] ?? status;

const statusBadge = (status: string) =>
  ({
    draft: 'badge-neutral',
    posted: 'badge-success',
    cancelled: 'badge-danger',
  })[status] ?? 'badge-neutral';

const paymentBadge = (status: string) =>
  ({
    unpaid: 'badge-danger',
    partial: 'badge-warning',
    paid: 'badge-success',
  })[status] ?? 'badge-neutral';
</script>

<style scoped>
.expenses-view {
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
}

.section-title {
  font-size: 1.0625rem;
  margin: 0 0 0.875rem;
}

/* ── Öne çıkan kategoriler ── */
.quick-pick {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.quick-pick-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.quick-pick-title {
  margin: 0;
  font-size: 1.125rem;
}
.small {
  font-size: 0.8125rem;
}
.tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.75rem;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
  text-align: left;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid var(--c-border);
  background: #fff;
  cursor: pointer;
  font: inherit;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    border-color 0.12s ease;
}
.tile:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -16px rgb(15 23 42 / 0.4);
}
.tile:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.tile-icon {
  font-size: 1.25rem;
  line-height: 1;
}
.tile-name {
  font-weight: 700;
  font-size: 0.9375rem;
  color: var(--c-text, #0f172a);
}
.tile-hint {
  font-size: 0.75rem;
  color: var(--c-muted);
}
/* Ton şeridi */
.tile::before {
  content: '';
  position: absolute;
}
.tile.tone-blue {
  border-top: 3px solid #2563eb;
}
.tile.tone-cyan {
  border-top: 3px solid #0891b2;
}
.tile.tone-amber {
  border-top: 3px solid #d97706;
}
.tile.tone-violet {
  border-top: 3px solid #7c3aed;
}
.tile.tone-slate {
  border-top: 3px solid #475569;
}
.tile.tone-rose {
  border-top: 3px solid #e11d48;
}
/* Satır içi kategori ekleme kutucuğu — kutucuk ızgarasının sonuna oturur */
.tile-add {
  border-style: dashed;
  justify-content: center;
  min-height: 6.5rem;
}
.tile-add .cat-add,
.tile-add .cat-add-form {
  width: 100%;
}
.group-add {
  list-style: none;
  margin-top: 0.375rem;
}

/* ── Gruplu tarayıcı ── */
.groups {
  margin-bottom: 1.5rem;
}
.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: 1rem;
}
.group-card {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1rem 1.125rem;
}
.group-head {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding-bottom: 0.75rem;
  margin-bottom: 0.625rem;
  border-bottom: 1px solid var(--c-border);
}
.group-head h3 {
  margin: 0;
  font-size: 0.9375rem;
}
.group-head p {
  margin: 0.125rem 0 0;
}
.group-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  font-size: 1rem;
}
.group-icon.tone-blue,
.badge.tone-blue {
  background: #dbeafe;
  color: #1e40af;
}
.group-icon.tone-cyan,
.badge.tone-cyan {
  background: #cffafe;
  color: #155e75;
}
.group-icon.tone-amber,
.badge.tone-amber {
  background: #fef3c7;
  color: #92400e;
}
.group-icon.tone-violet,
.badge.tone-violet {
  background: #ede9fe;
  color: #5b21b6;
}
.group-icon.tone-slate,
.badge.tone-slate {
  background: #e2e8f0;
  color: #334155;
}
.group-icon.tone-rose,
.badge.tone-rose {
  background: #ffe4e6;
  color: #9f1239;
}
.group-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.125rem;
}
.group-link {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.375rem 0.5rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--c-text, #0f172a);
  font: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}
.group-link:hover {
  background: var(--c-bg);
  color: var(--c-primary);
}
.group-link:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}

/* ── Kayıtlı giderler ── */
.records {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}
.records .toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 1rem;
}
.records .select,
.records .input {
  font: inherit;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: #fff;
}
.records .search {
  flex: 1;
  min-width: 12rem;
  max-width: 24rem;
}
.records .select:focus-visible,
.records .input:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
  border-color: var(--c-primary);
}
.table-wrap {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.data-table th,
.data-table td {
  text-align: left;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--c-border);
}
.data-table th {
  background: var(--c-bg);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
  white-space: nowrap;
}
.data-table tbody tr:hover {
  background: var(--c-bg);
}
.data-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.data-table .strong {
  font-weight: 600;
}
.data-table .mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 0.8125rem;
}
.data-table .muted {
  color: var(--c-muted);
}
.data-table .nowrap {
  white-space: nowrap;
}
.data-table .actions {
  white-space: nowrap;
}
.data-table .empty-cell {
  text-align: center;
  color: var(--c-muted);
  padding: 2rem 1rem;
}
.state-msg {
  padding: 1.5rem 1rem;
  color: var(--c-muted);
  text-align: center;
  margin: 0;
}
.state-msg.error {
  color: #dc2626;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding-top: 1rem;
  font-size: 0.875rem;
  color: var(--c-muted);
}

@media (max-width: 56rem) {
  .expenses-view {
    padding: 1rem;
  }
}
</style>
