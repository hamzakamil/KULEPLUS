<template>
  <div class="stock-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Stok</h1>
        <p class="page-sub">Ürün kartları, stok seviyeleri ve değer özeti.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" :disabled="exporting" @click="downloadCsv">
          {{ exporting ? 'Hazırlanıyor…' : 'CSV indir' }}
        </button>
        <button class="btn btn-secondary" @click="categoriesOpen = true">Kategoriler</button>
        <button class="btn btn-secondary" @click="openImport('products')">Ürün İçe Aktar</button>
        <button class="btn btn-secondary" @click="openImport('opening-stock')">
          Açılış Stoğu Aktar
        </button>
        <button class="btn btn-secondary" @click="startNew('service')">+ Hizmet</button>
        <button class="btn btn-primary" @click="startNew('product')">+ Ürün Ekle</button>
      </div>
    </header>

    <!-- ── Özet kartları ── -->
    <section class="kpi-grid" aria-label="Stok özeti">
      <div class="kpi">
        <span class="kpi-label">Toplam Ürün</span>
        <span class="kpi-value">{{ summary.total }}</span>
      </div>
      <div class="kpi" :class="{ warn: summary.lowStock > 0 }">
        <span class="kpi-label">Stoğu Bitmiş / Kritik</span>
        <span class="kpi-value">{{ summary.lowStock }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Stok Takibi Açık</span>
        <span class="kpi-value">{{ summary.tracked }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Tahmini Stok Değeri</span>
        <span class="kpi-value">{{ formatMoney(summary.stockValue) }}</span>
      </div>
    </section>

    <!-- ── Araç çubuğu ── -->
    <div class="toolbar" role="search">
      <input
        v-model="search"
        type="search"
        class="input search"
        placeholder="Kod, ad veya barkod ara…"
        aria-label="Ürün ara"
        @input="onSearch"
      />
      <FilterableSelect
        id="st-category-filter"
        class="category-filter"
        aria-label="Kategoriye göre süz"
        :model-value="store.categoryFilter"
        :options="categoryFilterOptions"
        placeholder="Tüm kategoriler"
        @update:model-value="onCategoryFilter"
      />
      <label class="check">
        <input v-model="onlyCritical" type="checkbox" @change="onSearch" />
        Yalnızca kritik stok
      </label>
      <span class="muted small">{{ items.length }} kayıt</span>
    </div>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>
    <div v-else-if="store.loading && !items.length" class="state-msg">Yükleniyor…</div>
    <!-- Boş durum (Faz 2 — EmptyState ile ilk kullanım yönlendirmesi) -->
    <EmptyState
      v-else-if="!items.length"
      :title="search ? 'Aramaya uygun ürün bulunamadı' : 'Henüz ürün kartı yok'"
      :description="
        search
          ? 'Farklı bir kod, ad veya barkod ile tekrar deneyin.'
          : 'İlk ürününüzü ekleyin; stok hareketleri, bakiye ve değerleme otomatik hesaplanır.'
      "
    >
      <template #action>
        <button class="btn btn-primary" @click="startNew('product')">+ Ürün Ekle</button>
      </template>
    </EmptyState>
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Kod</th>
            <th scope="col">Ürün Adı</th>
            <th scope="col">Barkod</th>
            <th scope="col">Birim</th>
            <th scope="col" class="num">Stok</th>
            <th scope="col" class="num">Alış</th>
            <th scope="col" class="num">Satış</th>
            <th scope="col" class="num">Stok Değeri</th>
            <th scope="col" class="num">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :class="{ scarce: isCritical(item) }">
            <td class="mono">{{ item.code }}</td>
            <td class="strong">
              {{ item.name }}
              <small v-if="item.category || item.brand || item.shelf_location" class="item-meta">
                {{
                  [
                    item.category,
                    item.brand,
                    item.shelf_location ? `Raf ${item.shelf_location}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </small>
            </td>
            <td class="mono muted">{{ item.barcode || '—' }}</td>
            <td>{{ item.unit_name || item.unit || '—' }}</td>
            <td class="num">
              <span class="stock-pill" :class="stockTone(item)">
                {{ formatQty(item.quantity) }}
              </span>
            </td>
            <td class="num muted">{{ formatMoney(item.cost_price) }}</td>
            <td class="num strong">{{ formatMoney(item.sale_price ?? item.price) }}</td>
            <td class="num">{{ formatMoney(item.stock_value) }}</td>
            <td class="num actions">
              <button class="link" @click="startEdit(item)">Düzenle</button>
              <button class="link danger" @click="remove(item.id)">Sil</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pager">
      <button
        class="btn btn-secondary"
        :disabled="pagination.page <= 1"
        @click="pageTo(pagination.page - 1)"
      >
        ‹ Önceki
      </button>
      <span>Sayfa {{ pagination.page }} / {{ pagination.pages }}</span>
      <button
        class="btn btn-secondary"
        :disabled="pagination.page >= pagination.pages"
        @click="pageTo(pagination.page + 1)"
      >
        Sonraki ›
      </button>
    </div>

    <!-- ── Ürün kartı paneli (workspace) ── -->
    <Teleport to="body">
      <div
        v-if="panelOpen"
        class="stock-panel"
        :class="{ minimized: panelMinimized, maximized: panelMaximized }"
        role="dialog"
        aria-modal="false"
        aria-label="Ürün kartı"
      >
        <header class="wp-titlebar" @mousedown.self="startDrag">
          <div class="wp-title">
            <span class="wp-dot" aria-hidden="true"></span>
            {{
              editingId ? 'Ürünü Düzenle' : form.kind === 'service' ? 'Yeni Hizmet' : 'Yeni Ürün'
            }}
            <span v-if="dirty" class="wp-dirty" title="Kaydedilmemiş değişiklik">●</span>
          </div>
          <div class="wp-controls">
            <button
              type="button"
              class="wp-btn"
              :aria-label="panelMinimized ? 'Geri aç' : 'Alta al'"
              :title="panelMinimized ? 'Geri aç' : 'Alta al'"
              @click="panelMinimized = !panelMinimized"
            >
              {{ panelMinimized ? '▲' : '▼' }}
            </button>
            <button
              type="button"
              class="wp-btn"
              :aria-label="panelMaximized ? 'Normal boyut' : 'Büyüt'"
              :title="panelMaximized ? 'Normal boyut' : 'Büyüt'"
              @click="panelMaximized = !panelMaximized"
            >
              {{ panelMaximized ? '❐' : '□' }}
            </button>
            <button
              type="button"
              class="wp-btn"
              aria-label="Paneli kapat"
              title="Kapat"
              @click="requestClose"
            >
              ✕
            </button>
          </div>
        </header>

        <div v-show="!panelMinimized" class="wp-body">
          <form class="form-grid" @submit.prevent="save">
            <div>
              <label for="st-code">Ürün Kodu *</label>
              <input id="st-code" v-model="form.code" class="input" required />
            </div>
            <div class="form-field-wide">
              <label for="st-name">Ürün Adı *</label>
              <input id="st-name" v-model="form.name" class="input" required />
            </div>
            <div>
              <label for="st-category">Kategori</label>
              <FilterableSelect
                id="st-category"
                v-model="form.categoryId"
                :options="categoryOptions"
                placeholder="Seçin veya yazıp ekleyin"
                allow-clear
                creatable
                create-noun="kategori"
                @create="createCategoryInline"
              />
            </div>
            <div>
              <label for="st-brand">Marka</label>
              <input id="st-brand" v-model="form.brand" class="input" />
            </div>
            <div>
              <label for="st-barcode">Barkod</label>
              <input id="st-barcode" v-model="form.barcode" class="input" inputmode="numeric" />
            </div>
            <div>
              <label for="st-supplier-code">Tedarikçi / Üretici Kodu</label>
              <input id="st-supplier-code" v-model="form.supplierCode" class="input" />
            </div>
            <div>
              <label for="st-unit">Birim</label>
              <FilterableSelect
                id="st-unit"
                v-model="form.unit"
                :options="unitOptions"
                placeholder="Birim seçin veya yazıp ekleyin"
                creatable
                create-noun="birim"
                @create="createUnitInline"
              />
            </div>
            <div class="form-field-wide">
              <label for="st-desc">Açıklama</label>
              <textarea
                id="st-desc"
                v-model="form.description"
                class="textarea"
                rows="1"
              ></textarea>
            </div>

            <h3 class="form-section form-field-full">Fiyat ve KDV</h3>
            <div>
              <label for="st-cost">Alış Fiyatı (₺)</label>
              <input
                id="st-cost"
                v-model="form.costPrice"
                class="input"
                inputmode="decimal"
                placeholder="0,00"
              />
            </div>
            <div>
              <label for="st-price"
                >Satış Fiyatı (₺) *
                <span v-if="priceWithVat" class="muted">· KDV dahil {{ priceWithVat }}</span></label
              >
              <input
                id="st-price"
                v-model="form.price"
                class="input"
                inputmode="decimal"
                placeholder="0,00"
              />
            </div>
            <div>
              <label for="st-sale-vat">Satış KDV Oranı</label>
              <FilterableSelect
                id="st-sale-vat"
                v-model="form.saleTaxRateId"
                :options="taxRateOptions"
                placeholder="Seçiniz…"
              />
            </div>
            <div>
              <label for="st-purchase-vat">Alış KDV Oranı</label>
              <FilterableSelect
                id="st-purchase-vat"
                v-model="form.purchaseTaxRateId"
                :options="taxRateOptions"
                placeholder="Seçiniz…"
              />
            </div>

            <h3 class="form-section form-field-full">Stok</h3>
            <label class="check form-field-wide stock-track">
              <input v-model="form.trackInventory" type="checkbox" />
              Stok takibi yap (miktar izlenir)
            </label>
            <template v-if="form.trackInventory">
              <div>
                <label for="st-min-stock" title="Miktar bu değerin altına inince listede uyarılır."
                  >Kritik Stok Seviyesi</label
                >
                <input
                  id="st-min-stock"
                  v-model="form.minStock"
                  class="input"
                  inputmode="decimal"
                  placeholder="0"
                  title="Miktar bu değerin altına inince listede uyarılır."
                />
              </div>
              <div>
                <label for="st-shelf">Raf / Konum</label>
                <input
                  id="st-shelf"
                  v-model="form.shelfLocation"
                  class="input"
                  placeholder="Örn. A-3-2"
                />
              </div>
            </template>
            <div v-else class="form-field-wide">
              <label for="st-default-expense">Varsayılan gider kategorisi</label>
              <FilterableSelect
                id="st-default-expense"
                v-model="form.defaultExpenseCategoryId"
                :options="expenseCategoryOptions"
                placeholder="Seçiniz…"
              />
            </div>

            <p v-if="formError" class="form-error">{{ formError }}</p>
            <div class="panel-actions">
              <button type="button" class="btn btn-secondary" @click="requestClose">Vazgeç</button>
              <button type="submit" class="btn btn-primary" :disabled="store.loading">
                {{ store.loading ? 'Kaydediliyor…' : editingId ? 'Güncelle' : 'Kaydet' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <StockCategoriesDialog :open="categoriesOpen" @close="categoriesOpen = false" />

    <!-- CSV içe aktarma sihirbazı — ürün listesi ve açılış stoğu (SPEC §23.1) -->
    <StockImportWizard
      :open="importOpen"
      :mode="importMode"
      @close="importOpen = false"
      @imported="store.fetchStock()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { EmptyState, trackEvent } from '@kuleplus/ui';
import { api } from '@/lib/api';
import { useStockStore, type StockItem } from '@/stores/stock';
import { useExpenseStore } from '@/stores/expense';
import { useInvoiceStore } from '@/stores/invoices';
import FilterableSelect from '@/components/FilterableSelect.vue';
import StockImportWizard from '@/components/StockImportWizard.vue';
import StockCategoriesDialog from '@/components/StockCategoriesDialog.vue';

const store = useStockStore();
const expenseStore = useExpenseStore();
const invoiceStore = useInvoiceStore();

/** CSV içe aktarma sihirbazı durumu — 'products' | 'opening-stock' akışı. */
const importOpen = ref(false);
const importMode = ref<'products' | 'opening-stock'>('products');
const openImport = (mode: 'products' | 'opening-stock') => {
  importMode.value = mode;
  importOpen.value = true;
};

/** Ürün listesini CSV (UTF-8 BOM) olarak indir — SPEC §23.2 dışa aktarma. */
const exporting = ref(false);
async function downloadCsv() {
  exporting.value = true;
  try {
    const res = await api.get('/v1/stock/export', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `urun-listesi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    trackEvent('stock_export_csv');
  } finally {
    exporting.value = false;
  }
}

/** Birim seçenekleri (filtreli combobox). */
const unitOptions = computed(() => store.units.map((u) => ({ value: u.name, label: u.name })));

/** Varsayılan gider kategorisi seçenekleri (yalnızca stok takipsiz ürünlerde gösterilir). */
const expenseCategoryOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...expenseStore.categories
    .filter((c) => c.status === 'active')
    .map((c) => ({ value: c.id, label: c.name })),
]);

/** KDV oranı seçenekleri; boş seçim = ürün için varsayılan oran yok. */
const taxRateOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...invoiceStore.taxRates.map((t) => ({
    value: t.id,
    // Ad zaten oranı içeriyorsa ("KDV %20") tekrar etme.
    label: t.name.includes(`%${Number(t.rate)}`) ? t.name : `%${Number(t.rate)} — ${t.name}`,
  })),
]);

/** Kategori yönetim penceresi (ekle / yeniden adlandır / birleştir / sil). */
const categoriesOpen = ref(false);

/** Ürün kartındaki kategori seçenekleri; boş seçim = kategorisiz. */
const categoryOptions = computed(() =>
  store.categories.map((c) => ({ value: c.id, label: c.name })),
);

/** Liste süzgeci: tüm kategoriler / kategorisiz / tek kategori. */
const categoryFilterOptions = computed(() => [
  { value: '', label: 'Tüm kategoriler' },
  { value: 'none', label: 'Kategorisiz' },
  ...categoryOptions.value,
]);

const onCategoryFilter = (value: string) => {
  store.categoryFilter = value;
  void store.fetchStock({ page: 1 });
};

/** Ürün kartında yazılan yeni kategoriyi kaydedip seçer. */
const createCategoryInline = async (name: string) => {
  formError.value = null;
  try {
    const category = await store.createCategory(name);
    form.value.categoryId = category.id;
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kategori eklenemedi.';
  }
};

/** Ürün kartında yazılan yeni birimi kaydedip seçer. */
const createUnitInline = async (name: string) => {
  formError.value = null;
  try {
    const unit = await store.createUnit(name);
    form.value.unit = unit.name;
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Birim eklenemedi.';
  }
};

/** Satış fiyatının KDV dahil karşılığı (satış KDV oranı seçiliyse) — bilgi amaçlı ipucu. */
const priceWithVat = computed(() => {
  const price = Number(form.value.price.replace(',', '.'));
  const rate = invoiceStore.taxRates.find((t) => t.id === form.value.saleTaxRateId)?.rate;
  if (!Number.isFinite(price) || price <= 0 || rate === undefined) return '';
  return formatMoney(price * (1 + Number(rate) / 100));
});

const search = ref('');
const onlyCritical = ref(false);
const panelOpen = ref(false);
const panelMinimized = ref(false);
const panelMaximized = ref(false);
const editingId = ref<string | null>(null);
const formError = ref<string | null>(null);
const dirty = ref(false);

const panelPos = ref({ left: 0, top: 0 });
const dragStart = ref<{ x: number; y: number; l: number; t: number } | null>(null);

const emptyForm = () => ({
  kind: 'product' as 'product' | 'service',
  code: '',
  name: '',
  barcode: '',
  unit: store.units[0]?.name ?? '',
  costPrice: '',
  price: '',
  description: '',
  trackInventory: true,
  defaultExpenseCategoryId: '',
  categoryId: '',
  brand: '',
  supplierCode: '',
  shelfLocation: '',
  minStock: '',
  saleTaxRateId: '',
  purchaseTaxRateId: '',
});
const form = ref(emptyForm());

const summary = computed(() => store.summary);
const pagination = computed(() => store.pagination);

const items = computed(() => {
  let list = store.filteredStock;
  if (onlyCritical.value) list = list.filter(isCritical);
  return list;
});

let timer: ReturnType<typeof setTimeout>;
const onSearch = () => {
  clearTimeout(timer);
  timer = setTimeout(() => store.setSearchQuery(search.value.trim()), 300);
  dirty.value = dirty.value;
};

const pageTo = (page: number) => {
  if (page < 1 || page > pagination.value.pages) return;
  store.fetchStock({ page });
};

/** Yeni kartta genel KDV oranı (%20) hazır gelsin; yoksa boş kalır. Kullanıcı değiştirebilir. */
const defaultTaxRateId = () => invoiceStore.taxRates.find((t) => Number(t.rate) === 20)?.id ?? '';

const startNew = (kind: 'product' | 'service') => {
  editingId.value = null;
  form.value = {
    ...emptyForm(),
    kind,
    trackInventory: kind === 'product',
    saleTaxRateId: defaultTaxRateId(),
    purchaseTaxRateId: defaultTaxRateId(),
  };
  formError.value = null;
  dirty.value = false;
  panelOpen.value = true;
  panelMaximized.value = true;
};

const startEdit = (item: StockItem) => {
  editingId.value = item.id;
  form.value = {
    kind: 'product',
    code: item.code,
    name: item.name,
    barcode: item.barcode ?? '',
    unit: item.unit_name ?? item.unit ?? store.units[0]?.name ?? '',
    costPrice: item.cost_price != null ? String(Number(item.cost_price)) : '',
    price: item.sale_price != null ? String(Number(item.sale_price)) : (item.price ?? ''),
    description: item.description ?? '',
    trackInventory: item.track_inventory !== false,
    defaultExpenseCategoryId: item.default_expense_category_id ?? '',
    categoryId: item.category_id ?? '',
    brand: item.brand ?? '',
    supplierCode: item.supplier_code ?? '',
    shelfLocation: item.shelf_location ?? '',
    minStock:
      item.min_stock != null && Number(item.min_stock) > 0 ? String(Number(item.min_stock)) : '',
    saleTaxRateId: item.sale_tax_rate_id ?? '',
    purchaseTaxRateId: item.purchase_tax_rate_id ?? '',
  };
  formError.value = null;
  dirty.value = false;
  panelOpen.value = true;
  panelMaximized.value = true;
};

const requestClose = () => {
  if (dirty.value && !window.confirm('Kaydedilmemiş değişiklikler var. Kapatılsın mı?')) return;
  panelOpen.value = false;
};

const save = async () => {
  formError.value = null;
  if (!form.value.code.trim() || !form.value.name.trim()) {
    formError.value = 'Ürün kodu ve adı zorunludur.';
    return;
  }
  if (!form.value.unit.trim()) {
    formError.value = 'Birim seçin ya da yazıp ekleyin.';
    return;
  }
  const price = form.value.price.trim();
  if (price === '' || !/^-?\d+([.,]\d+)?$/.test(price)) {
    formError.value = 'Satış fiyatı geçerli bir sayı olmalıdır.';
    return;
  }
  const norm = (v: string) => (v ? Number(v.replace(',', '.')) : undefined);
  const numberOk = (v: string) => v.trim() === '' || /^\d+([.,]\d+)?$/.test(v.trim());
  if (!numberOk(form.value.costPrice)) {
    formError.value = 'Alış fiyatı geçerli bir sayı olmalıdır.';
    return;
  }
  if (!numberOk(form.value.minStock)) {
    formError.value = 'Kritik stok seviyesi 0 veya daha büyük bir sayı olmalıdır.';
    return;
  }
  try {
    const payload: Partial<StockItem> = {
      code: form.value.code.trim(),
      name: form.value.name.trim(),
      barcode: form.value.barcode.trim(),
      unit: form.value.unit,
      price: String(norm(price) ?? 0),
      cost_price: norm(form.value.costPrice.trim()) ?? 0,
      description: form.value.description,
      category_id: form.value.categoryId || null,
      brand: form.value.brand.trim(),
      supplier_code: form.value.supplierCode.trim(),
      shelf_location: form.value.trackInventory ? form.value.shelfLocation.trim() : '',
      min_stock: form.value.trackInventory ? (norm(form.value.minStock.trim()) ?? 0) : 0,
      sale_tax_rate_id: form.value.saleTaxRateId || null,
      purchase_tax_rate_id: form.value.purchaseTaxRateId || null,
      track_inventory: form.value.trackInventory,
      // Stok takibi açıksa gider kategorisi anlamsız; kapalıyken seçilen değer gönderilir.
      default_expense_category_id: form.value.trackInventory
        ? null
        : form.value.defaultExpenseCategoryId || null,
    };
    if (editingId.value) await store.updateStockItem(editingId.value, payload);
    else await store.createStockItem(payload);
    dirty.value = false;
    panelOpen.value = false;
    await store.fetchStock();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  }
};

const remove = async (id: string) => {
  if (!window.confirm('Bu ürünü silmek istediğinize emin misiniz?')) return;
  try {
    await store.deleteStockItem(id);
  } catch {
    /* store hatayı tutar */
  }
};

/** Miktar gösterimi: büyük sayılar için binlik ayraç. */
const formatQty = (q: string | number | undefined) => {
  const n = Number(q ?? 0);
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(n);
};

const formatMoney = (v: string | number | undefined) => {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);
};

/** Kritik: stok takipli ürünün miktarı sıfır/negatif ya da kritik stok seviyesinin altında. */
const isCritical = (item: StockItem) =>
  item.track_inventory !== false && Number(item.quantity ?? 0) <= Number(item.min_stock ?? 0);

const stockTone = (item: StockItem) => {
  const q = Number(item.quantity ?? 0);
  const min = Number(item.min_stock ?? 0);
  if (q <= 0) return 'out';
  if (min > 0 && q <= min) return 'low';
  return 'ok';
};

// ── Panel sürükleme ──
function startDrag(e: MouseEvent) {
  if (e.target !== e.currentTarget || panelMaximized.value) return;
  dragStart.value = { x: e.clientX, y: e.clientY, l: panelPos.value.left, t: panelPos.value.top };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove(e: MouseEvent) {
  if (!dragStart.value) return;
  panelPos.value.left = Math.max(0, dragStart.value.l + (e.clientX - dragStart.value.x));
  panelPos.value.top = Math.max(0, dragStart.value.t + (e.clientY - dragStart.value.y));
}
function onDragEnd() {
  dragStart.value = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

onMounted(async () => {
  await Promise.all([store.fetchUnits(), store.fetchCategories()]);
  await store.fetchStock();
  // KDV oranları ve gider kategorileri formu doldurur; biri yüklenemese de liste çalışır.
  await Promise.all([invoiceStore.fetchTaxRates().catch(() => {}), expenseStore.fetchCategories()]);
});
</script>

<style scoped>
.stock-view {
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
.kpi.warn {
  border-color: #fca5a5;
  background: #fff7f7;
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
.input,
.select,
.textarea {
  width: 100%;
  font: inherit;
  font-size: 0.875rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  padding: 0.3125rem 0.5rem;
  background: #fff;
  color: #0f172a;
}
.toolbar .input {
  max-width: 24rem;
}
.toolbar .category-filter {
  width: 14rem;
}
.input:focus-visible,
.select:focus-visible,
.textarea:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
  border-color: var(--c-primary);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--c-muted);
}
.small {
  font-size: 0.8125rem;
}

.table-wrap {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
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
  white-space: nowrap;
}
.data-table th {
  background: var(--c-bg);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.data-table tbody tr:hover {
  background: var(--c-bg);
}
.data-table tbody tr.scarce {
  background: #fff7f7;
}
.data-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
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
.data-table .actions {
  white-space: nowrap;
}
.data-table .empty-cell {
  text-align: center;
  color: var(--c-muted);
  padding: 2rem 1rem;
  white-space: normal;
}
.stock-pill {
  display: inline-block;
  min-width: 3.5rem;
  text-align: right;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.8125rem;
}
.stock-pill.ok {
  background: #ecfdf5;
  color: #047857;
}
.stock-pill.low {
  background: #fffbeb;
  color: #b45309;
}
.stock-pill.out {
  background: #fef2f2;
  color: #b91c1c;
}
.state-msg {
  padding: 1.5rem 1rem;
  color: var(--c-muted);
  text-align: center;
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

/* ── Panel ── */
.stock-panel {
  position: fixed;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  box-shadow: 0 24px 48px -16px rgb(15 23 42 / 0.35);
  left: var(--erp-sidebar-width, 16rem);
  top: calc(var(--erp-header-height, 4rem) + 0.75rem);
  right: 1.5rem;
  /* Kompakt: çok geniş ekranda form tarlada kaybolmasın; içerik alanında ortalanır. */
  max-width: 66rem;
  margin-inline: auto;
  max-height: calc(100vh - var(--erp-header-height, 4rem) - 2.25rem);
  overflow: hidden;
}
.stock-panel.minimized {
  height: auto;
  right: 1.5rem;
  max-height: none;
}
.wp-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4375rem 0.75rem;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
  cursor: move;
  user-select: none;
  flex: none;
}
.wp-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.9375rem;
}
.wp-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--c-primary);
}
.wp-dirty {
  color: #f59e0b;
  font-size: 0.75rem;
}
.wp-controls {
  display: inline-flex;
  gap: 0.25rem;
}
.wp-btn {
  border: 0;
  background: transparent;
  color: var(--c-muted);
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
}
.wp-btn:hover {
  background: #fff;
  color: #0f172a;
}
.wp-body {
  overflow-y: auto;
  padding: 0.875rem 1rem;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.5rem 0.75rem;
}
.form-grid label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  margin-bottom: 0.125rem;
}
.form-field-full {
  grid-column: 1 / -1;
}
.form-field-wide {
  grid-column: span 2;
}
/* Onay kutusu, yanındaki alanların giriş kutusuyla aynı hizada dursun */
.form-grid .stock-track {
  align-self: end;
  margin-bottom: 0;
  padding-bottom: 0.4rem;
}
.form-section {
  margin: 0.25rem 0 0;
  padding-top: 0.5rem;
  border-top: 1px solid var(--c-border);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--c-muted);
}
.form-grid small.muted {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
}
.item-meta {
  display: block;
  margin-top: 0.125rem;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--c-muted);
}
.form-error {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.875rem;
}
.panel-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 34rem) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-field-wide {
    grid-column: 1 / -1;
  }
}
</style>
