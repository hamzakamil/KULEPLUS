<template>
  <div class="trade-view">
    <header class="trade-header">
      <div>
        <h1 class="trade-title">{{ title }}</h1>
        <p class="trade-sub">{{ subtitle }}</p>
      </div>
      <div class="trade-head-actions">
        <button class="btn btn-primary" @click="startNew">+ {{ newLabel }}</button>
      </div>
    </header>

    <!-- ── Özet kartları ── -->
    <section class="trade-kpis" :aria-label="title + ' özeti'">
      <div class="trade-kpi">
        <span class="trade-kpi-label">Kayıt Sayısı</span>
        <span class="trade-kpi-value">{{ pagination.total || rows.length }}</span>
      </div>
      <div class="trade-kpi">
        <span class="trade-kpi-label">Sayfa Toplamı</span>
        <span class="trade-kpi-value">{{ formatMoney(pageTotal) }}</span>
      </div>
      <div v-if="priced" class="trade-kpi">
        <span class="trade-kpi-label">Ortalama Tutar</span>
        <span class="trade-kpi-value">{{ formatMoney(rows.length ? pageTotal / rows.length : 0) }}</span>
      </div>
      <div class="trade-kpi" :class="{ warn: openCount > 0 }">
        <span class="trade-kpi-label">Açık (Bekleyen)</span>
        <span class="trade-kpi-value">{{ openCount }}</span>
      </div>
    </section>

    <p v-if="store.error" class="trade-state-msg error">{{ store.error }}</p>

    <!-- ── Liste ── -->
    <section class="trade-panel" :aria-label="title + ' listesi'">
      <div class="trade-panel-head">
        <h2>{{ listTitle }} <span class="trade-count">{{ pagination.total || rows.length }}</span></h2>
      </div>
      <div class="trade-filters" role="search">
        <input
          v-model="search"
          type="search"
          class="trade-input"
          placeholder="Numara veya not ara…"
          :aria-label="title + ' ara'"
          @keyup.enter="applyFilters"
        />
        <FilterableSelect
          v-model="statusFilter"
          :options="statusFilterOptions"
          class="trade-select"
          placeholder="Tüm Durumlar"
          aria-label="Durum filtresi"
          @select="applyFilters"
        />
        <button class="btn btn-secondary btn-sm" @click="applyFilters">Filtrele</button>
      </div>

      <div class="trade-table-wrap">
        <table class="trade-table">
          <thead>
            <tr>
              <th scope="col">Numara</th>
              <th scope="col">Cari</th>
              <th scope="col">Tarih</th>
              <th v-if="extraDate" scope="col">{{ extraDate.label }}</th>
              <th v-if="priced" scope="col" class="num">Toplam</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              :class="{ active: selectedId === row.id }"
              tabindex="0"
              @click="select(row.id)"
              @keydown.enter="select(row.id)"
              @keydown.space.prevent="select(row.id)"
            >
              <td class="mono">{{ row.number }}</td>
              <td>{{ row.contact_name || '—' }}</td>
              <td class="nowrap">{{ formatDate(row.issue_date) }}</td>
              <td v-if="extraDate" class="muted nowrap">
                {{ row[extraDate.key] ? formatDate(String(row[extraDate.key])) : '—' }}
              </td>
              <td v-if="priced" class="num strong">{{ formatMoney(row.total) }}</td>
              <td><span class="trade-badge" :class="statusTone(row.status)">{{ statusLabel(row.status) }}</span></td>
              <td class="num actions">
                <button class="trade-link" @click.stop="edit(row)">Düzenle</button>
                <button class="trade-link danger" @click.stop="remove(row.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !store.loading">
              <td :colspan="priced ? 7 : 6" class="empty-cell">
                Kayıt yok. "+ {{ newLabel }}" ile oluşturun.
              </td>
            </tr>
            <tr v-if="store.loading">
              <td :colspan="priced ? 7 : 6" class="empty-cell">Yükleniyor…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.pages > 1" class="trade-pager">
        <button class="btn btn-secondary btn-sm" :disabled="pagination.page <= 1" @click="page(pagination.page - 1)">
          ‹ Önceki
        </button>
        <span>Sayfa {{ pagination.page }} / {{ pagination.pages }}</span>
        <button class="btn btn-secondary btn-sm" :disabled="pagination.page >= pagination.pages" @click="page(pagination.page + 1)">
          Sonraki ›
        </button>
      </div>
    </section>

    <!-- ── Detay ── -->
    <section v-if="detail" class="trade-detail" :aria-label="title + ' detayı'">
      <div class="trade-detail-head">
        <div>
          <span class="trade-badge" :class="statusTone(detail.status)">{{ statusLabel(detail.status) }}</span>
          <h2>{{ detail.number }}</h2>
          <p v-if="detail.contact_name" class="trade-detail-sub">{{ detail.contact_name }}</p>
        </div>
        <dl class="trade-meta">
          <div>
            <dt>Tarih</dt>
            <dd>{{ formatDate(detail.issue_date) }}</dd>
          </div>
          <div v-if="extraDate">
            <dt>{{ extraDate.label }}</dt>
            <dd>{{ detail[extraDate.key] ? formatDate(String(detail[extraDate.key])) : '—' }}</dd>
          </div>
          <div>
            <dt>Para Birimi</dt>
            <dd>{{ detail.currency }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="priced" class="trade-summary">
        <div>
          <span class="label">Ara Toplam</span>
          <span class="trade-amount">{{ formatMoney(detail.subtotal) }}</span>
        </div>
        <div>
          <span class="label">İskonto</span>
          <span class="trade-amount">−{{ formatMoney(detail.discount_total) }}</span>
        </div>
        <div>
          <span class="label">KDV</span>
          <span class="trade-amount">{{ formatMoney(detail.tax_total) }}</span>
        </div>
        <div>
          <span class="label">Genel Toplam</span>
          <span class="trade-amount total">{{ formatMoney(detail.total) }}</span>
        </div>
      </div>

      <div class="trade-section">
        <div class="trade-section-head">
          <h3>Satırlar</h3>
          <button class="btn btn-secondary btn-sm" @click="edit(detail)">Satırları Düzenle</button>
        </div>
        <div class="trade-lines-wrap">
          <table class="trade-lines">
            <thead>
              <tr>
                <th scope="col">Açıklama</th>
                <th scope="col" class="num">Miktar</th>
                <th v-if="priced" scope="col" class="num">Birim Fiyat</th>
                <th v-if="priced" scope="col" class="num">İskonto</th>
                <th v-if="priced" scope="col" class="num">KDV</th>
                <th v-if="priced" scope="col" class="num">Satır Toplamı</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in detail.lines || []" :key="line.id">
                <td>{{ line.description }}</td>
                <td class="num">{{ formatQty(line.quantity) }}</td>
                <template v-if="priced">
                  <td class="num">{{ formatMoney(line.unit_price) }}</td>
                  <td class="num">{{ formatPct(line.discount_percent) }}</td>
                  <td class="num">{{ formatMoney(line.tax_amount || 0) }}</td>
                  <td class="num strong">{{ formatMoney(line.line_total || 0) }}</td>
                </template>
              </tr>
              <tr v-if="!(detail.lines || []).length">
                <td :colspan="priced ? 6 : 2" class="empty-cell">Satır yok.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="trade-detail-actions">
        <button class="btn btn-secondary btn-sm" @click="edit(detail)">Düzenle</button>
        <button
          v-for="t in nextStatuses(detail.status)"
          :key="t.value"
          class="btn btn-primary btn-sm"
          @click="changeStatus(detail.id, t.value)"
        >
          {{ t.actionLabel || t.label }}
        </button>
        <button class="btn btn-danger btn-sm" @click="remove(detail.id)">Sil</button>
      </div>
    </section>

    <section v-else class="trade-detail empty-state">
      <p>Detayı görmek için listeden bir kayıt seçin.</p>
    </section>

    <!-- ── Kalıcı çalışma alanı paneli ── -->
    <Teleport to="body">
      <div
        v-if="panelOpen && form"
        class="trade-panel-dock"
        :class="{ minimized: panelMinimized }"
        role="dialog"
        aria-modal="false"
        :aria-label="editingId ? 'Düzenle' : newLabel"
      >
        <header class="trade-dock-titlebar" @mousedown.self="startDrag">
          <div class="trade-dock-title">
            <span class="trade-dock-dot" aria-hidden="true"></span>
            {{ editingId ? 'Düzenle' : newLabel }}
            <span v-if="dirty" class="trade-dock-dirty" title="Kaydedilmemiş değişiklik">●</span>
          </div>
          <div class="trade-dock-controls">
            <button
              type="button"
              class="trade-dock-btn"
              :aria-label="panelMinimized ? 'Geri aç' : 'Alta al'"
              :title="panelMinimized ? 'Geri aç' : 'Alta al'"
              @click="panelMinimized = !panelMinimized"
            >
              {{ panelMinimized ? '▲' : '▼' }}
            </button>
            <button type="button" class="trade-dock-btn" aria-label="Paneli kapat" title="Kapat" @click="requestClose">✕</button>
          </div>
        </header>

        <div v-show="!panelMinimized" class="trade-dock-body">
          <form @submit.prevent="save">
            <div class="trade-form-grid">
              <div>
                <label :for="`f-contact-${docType}`">Cari</label>
                <select :id="`f-contact-${docType}`" v-model="form.contact_id" class="trade-select field-full">
                  <option value="">Seçiniz…</option>
                  <option v-for="c in contacts" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div>
                <label :for="`f-issue-${docType}`">Belge Tarihi *</label>
                <input :id="`f-issue-${docType}`" v-model="form.issue_date" type="date" class="trade-input" required />
              </div>
              <div v-if="extraDate">
                <label :for="`f-extra-${docType}`">{{ extraDate.label }}</label>
                <input :id="`f-extra-${docType}`" v-model="form[extraDate.key]" type="date" class="trade-input" />
              </div>
              <div>
                <label :for="`f-cur-${docType}`">Para Birimi</label>
                <select :id="`f-cur-${docType}`" v-model="form.currency" class="trade-select">
                  <option value="TRY">TRY</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div v-if="linked" class="trade-field-2">
                <label :for="`f-link-${docType}`">{{ linked.label }}</label>
                <select :id="`f-link-${docType}`" v-model="form[linked.key]" class="trade-select">
                  <option value="">Seçiniz…</option>
                  <option v-for="o in linkedOptions" :key="o.id" :value="o.id">
                    {{ o.number }}{{ o.contact_name ? ' — ' + o.contact_name : '' }}
                  </option>
                </select>
              </div>
              <div class="trade-field-full">
                <label :for="`f-notes-${docType}`">Notlar</label>
                <input :id="`f-notes-${docType}`" v-model="form.notes" class="trade-input" />
              </div>
            </div>

            <div class="trade-line-head">
              <h3>Satırlar</h3>
              <button type="button" class="btn btn-secondary btn-sm" @click="addLine">+ Satır Ekle</button>
            </div>

            <div class="trade-lines-editor">
              <table>
                <thead>
                  <tr>
                    <th style="min-width: 16rem">Açıklama</th>
                    <th class="trade-num" style="width: 7rem">Miktar</th>
                    <template v-if="priced">
                      <th class="trade-num" style="width: 8rem">Birim Fiyat</th>
                      <th class="trade-num" style="width: 6rem">İsk %</th>
                      <th style="width: 7rem">KDV</th>
                      <th class="trade-num" style="width: 9rem">Toplam</th>
                    </template>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(line, i) in form.lines" :key="i">
                    <td>
                      <input v-model="line.description" class="trade-input" placeholder="Açıklama" @input="markDirty" />
                    </td>
                    <td class="trade-num">
                      <input v-model.number="line.quantity" type="number" min="0.01" step="0.01" class="trade-input trade-num" @input="markDirty" />
                    </td>
                    <template v-if="priced">
                      <td class="trade-num">
                        <input v-model.number="line.unit_price" type="number" min="0" step="0.01" class="trade-input trade-num" @input="markDirty" />
                      </td>
                      <td class="trade-num">
                        <input v-model.number="line.discount_percent" type="number" min="0" max="100" step="0.1" class="trade-input trade-num" @input="markDirty" />
                      </td>
                      <td>
                        <select v-model="line.tax_rate_id" class="trade-select" @change="markDirty">
                          <option value="">%0</option>
                          <option v-for="t in taxRates" :key="t.id" :value="t.id">%{{ t.rate }}</option>
                        </select>
                      </td>
                      <td class="trade-num"><span class="trade-line-total">{{ formatMoney(lineTotal(line)) }}</span></td>
                    </template>
                    <td>
                      <button type="button" class="trade-dock-btn" aria-label="Satırı sil" title="Satırı sil" @click="removeLine(i)">✕</button>
                    </td>
                  </tr>
                  <tr v-if="!form.lines.length">
                    <td :colspan="priced ? 7 : 3" class="empty-cell">Satır eklemek için "+ Satır Ekle" kullanın.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="priced" class="trade-totals">
              <div class="trade-total-row"><span class="muted">Ara Toplam</span><span>{{ formatMoney(subtotal) }}</span></div>
              <div class="trade-total-row"><span class="muted">İskonto</span><span>−{{ formatMoney(discountTotal) }}</span></div>
              <div class="trade-total-row"><span class="muted">KDV</span><span>{{ formatMoney(taxTotal) }}</span></div>
              <div class="trade-total-row grand"><span>Genel Toplam</span><span>{{ formatMoney(grandTotal) }}</span></div>
            </div>

            <p v-if="formError" class="trade-form-error">{{ formError }}</p>
            <div class="trade-dock-actions">
              <button type="button" class="btn btn-secondary" @click="requestClose">Vazgeç</button>
              <button type="submit" class="btn btn-primary" :disabled="store.loading || !form.lines.length">
                {{ store.loading ? 'Kaydediliyor…' : editingId ? 'Güncelle' : 'Kaydet' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FilterableSelect from '@/components/FilterableSelect.vue';
import { useContactStore, type Contact } from '@/stores/contacts';
import { useTradeQuotesStore } from '@/stores/trade-quotes';
import { useTradeOrdersStore } from '@/stores/trade-orders';
import { usePurchaseOrdersStore } from '@/stores/purchase-orders';
import { useDeliveriesStore } from '@/stores/deliveries';
import { useInvoiceStore } from '@/stores/invoices';
import { useStockStore } from '@/stores/stock';

type DocType = 'quote' | 'order' | 'purchase' | 'delivery';

interface StatusConfig {
  value: string;
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet';
  actionLabel?: string;
}
interface DateFieldConfig {
  key: string;
  label: string;
}
interface LinkedConfig {
  key: string;
  label: string;
  source: 'orders' | 'quotes';
}

interface TradeRow {
  id: string;
  number: string;
  contact_name?: string;
  issue_date: string;
  currency?: string;
  status: string;
  total?: number | string;
  subtotal?: number | string;
  discount_total?: number | string;
  tax_total?: number | string;
  notes?: string | null;
  contact_id?: string | null;
  lines?: TradeLine[];
  [key: string]: unknown;
}
interface TradeLine {
  id?: string;
  description: string;
  quantity: number | string;
  unit_price?: number | string;
  discount_percent?: number | string;
  tax_amount?: number | string;
  line_total?: number | string;
}

const props = withDefaults(
  defineProps<{
    docType: DocType;
    title: string;
    subtitle: string;
    listTitle: string;
    newLabel: string;
    statuses: StatusConfig[];
    /** Geçerli durumdan hangi durumlara ilerlenebileceği. */
    transitions?: Record<string, string[]>;
    extraDate?: DateFieldConfig | null;
    linked?: LinkedConfig | null;
    /**
     * Fiyatlı belge mi (teklif/sipariş/satın alma) yoksa miktar-only mi (irsaliye)?
     * NOT: Boolean prop'lar Vue'da verilmezse false olur → varsayılan true şart.
     */
    priced?: boolean;
    /** extraDate API alan adı (camelCase). */
    camelExtra?: string;
    /** linked API alan adı (camelCase). */
    camelLinked?: string;
  }>(),
  {
    priced: true,
    transitions: () => ({}),
    extraDate: null,
    linked: null,
    camelExtra: '',
    camelLinked: '',
  },
);

const priced = computed(() => props.priced !== false);
// ── Doğru store'u seç ──
const quoteStore = useTradeQuotesStore();
const orderStore = useTradeOrdersStore();
const purchaseStore = usePurchaseOrdersStore();
const deliveryStore = useDeliveriesStore();

interface DocStore {
  loading: boolean;
  error: string | null;
  pagination: { page: number; limit: number; total: number; pages: number };
  setFilters: (f: Record<string, unknown>) => void;
}

const store = computed<DocStore>(() => {
  switch (props.docType) {
    case 'quote':
      return quoteStore as unknown as DocStore;
    case 'order':
      return orderStore as unknown as DocStore;
    case 'purchase':
      return purchaseStore as unknown as DocStore;
    default:
      return deliveryStore as unknown as DocStore;
  }
});

const fetchList = () => {
  switch (props.docType) {
    case 'quote':
      return quoteStore.fetchQuotes();
    case 'order':
      return orderStore.fetchOrders();
    case 'purchase':
      return purchaseStore.fetchOrders();
    default:
      return deliveryStore.fetchDeliveries();
  }
};
const fetchOne = (id: string) => {
  switch (props.docType) {
    case 'quote':
      return quoteStore.fetchQuote(id);
    case 'order':
      return orderStore.fetchOrder(id);
    case 'purchase':
      return purchaseStore.fetchOrder(id);
    default:
      return deliveryStore.fetchDelivery(id);
  }
};

const contactStore = useContactStore();
const invoiceStore = useInvoiceStore();
const stockStore = useStockStore();

const rows = computed<TradeRow[]>(() => {
  switch (props.docType) {
    case 'quote':
      return quoteStore.quotes as unknown as TradeRow[];
    case 'order':
      return orderStore.orders as unknown as TradeRow[];
    case 'purchase':
      return purchaseStore.orders as unknown as TradeRow[];
    default:
      return deliveryStore.deliveries as unknown as TradeRow[];
  }
});
const pagination = computed(() => store.value.pagination);

const search = ref('');
const statusFilter = ref('');
const statusFilterOptions = computed(() => [
  { value: '', label: 'Tüm Durumlar' },
  ...props.statuses.map((s) => ({ value: s.value, label: s.label })),
]);
const selectedId = ref<string | null>(null);
const detail = ref<TradeRow | null>(null);

const contacts = ref<Contact[]>([]);
const linkedOptions = ref<{ id: string; number: string; contact_name?: string }[]>([]);
const taxRates = computed(() => invoiceStore.taxRates);

// ── Panel durumu ──
const panelOpen = ref(false);
const panelMinimized = ref(false);
const editingId = ref<string | null>(null);
const dirty = ref(false);
const formError = ref<string | null>(null);
const dragStart = ref<{ x: number; y: number } | null>(null);

interface FormLine {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate_id?: string;
  sort_order: number;
}
interface DocForm {
  contact_id: string;
  issue_date: string;
  currency: string;
  exchange_rate: number;
  notes: string;
  lines: FormLine[];
  [key: string]: unknown;
}
const form = ref<DocForm | null>(null);

const emptyForm = (): DocForm => ({
  contact_id: '',
  issue_date: new Date().toISOString().split('T')[0],
  currency: 'TRY',
  exchange_rate: 1,
  notes: '',
  lines: [],
  ...(props.extraDate ? { [props.extraDate.key]: '' } : {}),
  ...(props.linked ? { [props.linked.key]: '' } : {}),
});

// ── Hesaplar ──
const taxRate = (id?: string) => Number(invoiceStore.taxRates.find((t) => t.id === id)?.rate ?? 0);
const lineTotal = (l: FormLine) => {
  const base = Number(l.quantity) * Number(l.unit_price);
  const disc = (base * (Number(l.discount_percent) || 0)) / 100;
  return String(base - disc + (base - disc) * (taxRate(l.tax_rate_id) / 100));
};
const subtotal = computed(() =>
  (form.value?.lines ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0),
);
const discountTotal = computed(() =>
  (form.value?.lines ?? []).reduce(
    (s, l) => s + (Number(l.quantity) * Number(l.unit_price) * (Number(l.discount_percent) || 0)) / 100,
    0,
  ),
);
const taxTotal = computed(() =>
  (form.value?.lines ?? []).reduce((s, l) => {
    const base = Number(l.quantity) * Number(l.unit_price);
    const disc = (base * (Number(l.discount_percent) || 0)) / 100;
    return s + (base - disc) * (taxRate(l.tax_rate_id) / 100);
  }, 0),
);
const grandTotal = computed(() => subtotal.value - discountTotal.value + taxTotal.value);

const pageTotal = computed(() =>
  rows.value.reduce((s, r) => s + Number(r.total ?? 0), 0),
);
const openCount = computed(() => rows.value.filter((r) => r.status === 'draft').length);

// ── Durum ──
const statusLabel = (v: string) => props.statuses.find((s) => s.value === v)?.label ?? v;
const statusTone = (v: string) => props.statuses.find((s) => s.value === v)?.tone ?? 'neutral';
const nextStatuses = (current: string) => {
  const allowed = props.transitions?.[current] ?? [];
  return props.statuses.filter((s) => allowed.includes(s.value));
};

// ── Liste işlemleri ──
const applyFilters = () => {
  store.value.setFilters({ page: 1, search: search.value.trim() || undefined, status: statusFilter.value || undefined });
  fetchList();
};
const page = (p: number) => {
  store.value.setFilters({ page: p });
  fetchList();
};

const select = async (id: string) => {
  selectedId.value = id;
  try {
    detail.value = (await fetchOne(id)) as unknown as TradeRow;
  } catch {
    /* store hatası */
  }
};

const changeStatus = async (id: string, status: string) => {
  try {
    if (props.docType === 'quote') await quoteStore.updateQuoteStatus(id, status);
    else if (props.docType === 'order') await orderStore.updateOrderStatus(id, status);
    else if (props.docType === 'purchase') await purchaseStore.updateOrderStatus(id, status);
    else await deliveryStore.updateDeliveryStatus(id, status);
    await select(id);
    await fetchList();
  } catch {
    /* store hatası */
  }
};

const remove = async (id: string) => {
  if (!window.confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  try {
    if (props.docType === 'quote') await quoteStore.deleteQuote(id);
    else if (props.docType === 'order') await orderStore.deleteOrder(id);
    else if (props.docType === 'purchase') await purchaseStore.deleteOrder(id);
    else await deliveryStore.deleteDelivery(id);
    if (selectedId.value === id) {
      selectedId.value = null;
      detail.value = null;
    }
  } catch {
    /* store hatası */
  }
};

// ── Form ──
const startNew = () => {
  editingId.value = null;
  form.value = emptyForm();
  dirty.value = false;
  formError.value = null;
  panelOpen.value = true;
  panelMinimized.value = false;
};

const edit = (row: TradeRow) => {
  const lines = (row.lines ?? []).map((l) => ({
    id: l.id,
    description: String(l.description ?? ''),
    quantity: Number(l.quantity ?? 1),
    unit_price: Number(l.unit_price ?? 0),
    discount_percent: Number(l.discount_percent ?? 0),
    tax_rate_id: ((l as { tax_rate_id?: string }).tax_rate_id ?? '') as string,
    sort_order: Number((l as { sort_order?: number }).sort_order ?? 0),
  }));
  editingId.value = String(row.id);
  form.value = {
    ...emptyForm(),
    contact_id: String(row.contact_id ?? ''),
    issue_date: String(row.issue_date ?? '').slice(0, 10),
    currency: String(row.currency ?? 'TRY'),
    exchange_rate: Number(row.exchange_rate ?? 1),
    notes: String(row.notes ?? ''),
    lines,
    ...(props.extraDate
      ? { [props.extraDate.key]: row[props.extraDate.key] ? String(row[props.extraDate.key]).slice(0, 10) : '' }
      : {}),
    ...(props.linked ? { [props.linked.key]: String(row[props.linked.key] ?? '') } : {}),
  };
  dirty.value = false;
  formError.value = null;
  panelOpen.value = true;
  panelMinimized.value = false;
};

const markDirty = () => {
  dirty.value = true;
};

const addLine = () => {
  if (!form.value) return;
  form.value.lines.push({
    description: '',
    quantity: 1,
    unit_price: 0,
    discount_percent: 0,
    tax_rate_id: '',
    sort_order: form.value.lines.length,
  });
  dirty.value = true;
};
const removeLine = (i: number) => {
  form.value?.lines.splice(i, 1);
  dirty.value = true;
};

/** Form → API payload (camelCase; API sözleşmesi böyle bekler). */
const buildPayload = () => {
  const f = form.value as DocForm;
  const payload: Record<string, unknown> = {
    contactId: f.contact_id || undefined,
    issueDate: f.issue_date,
    currency: f.currency,
    exchangeRate: f.exchange_rate,
    notes: f.notes || undefined,
    lines: f.lines.map((l, i) => ({
      productId: (l as unknown as { product_id?: string }).product_id || undefined,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: priced.value ? Number(l.unit_price) : undefined,
      discountPercent: priced.value ? Number(l.discount_percent) : undefined,
      taxRateId: priced.value ? l.tax_rate_id || undefined : undefined,
      sortOrder: i,
    })),
  };
  if (props.extraDate && props.camelExtra) {
    payload[props.camelExtra] = f[props.extraDate.key] || undefined;
  }
  if (props.linked && props.camelLinked) {
    payload[props.camelLinked] = f[props.linked.key] || undefined;
  }
  return payload;
};

const save = async () => {
  if (!form.value || !form.value.lines.length) {
    formError.value = 'En az bir satır ekleyin.';
    return;
  }
  formError.value = null;
  const payload = buildPayload();
  try {
    if (editingId.value) {
      if (props.docType === 'quote') await quoteStore.updateQuote(editingId.value, payload as never);
      else if (props.docType === 'order') await orderStore.updateOrder(editingId.value, payload as never);
      else if (props.docType === 'purchase') await purchaseStore.updateOrder(editingId.value, payload as never);
      else await deliveryStore.updateDelivery(editingId.value, payload as never);
    } else {
      const created = (await (props.docType === 'quote'
        ? quoteStore.createQuote(payload as never)
        : props.docType === 'order'
          ? orderStore.createOrder(payload as never)
          : props.docType === 'purchase'
            ? purchaseStore.createOrder(payload as never)
            : deliveryStore.createDelivery(payload as never))) as { id?: string };
      if (created?.id) selectedId.value = created.id;
    }
    dirty.value = false;
    panelOpen.value = false;
    await fetchList();
    if (selectedId.value) await select(selectedId.value);
  } catch (e) {
    formError.value =
      (store.value.error as string | null) || (e instanceof Error ? e.message : 'Kaydedilemedi.');
  }
};

const requestClose = () => {
  if (dirty.value && !window.confirm('Kaydedilmemiş değişiklikler var. Kapatılsın mı?')) return;
  panelOpen.value = false;
};

// ── Panel sürükleme (basit) ──
function startDrag(e: MouseEvent) {
  if (e.target !== e.currentTarget) return;
  dragStart.value = { x: e.clientX, y: e.clientY };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove() {
  /* konum CSS değişkenleriyle yönetilir; sürükleme görsel geri bildirim içindir */
}
function onDragEnd() {
  dragStart.value = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// ── Biçimlendirme ──
const formatMoney = (v: unknown) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(v ?? 0));
const formatDate = (d: string) =>
  d ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(d)) : '—';
const formatQty = (q: unknown) => {
  const n = Number(q ?? 0);
  return Number.isInteger(n) ? String(n) : String(n.toFixed(2)).replace('.', ',');
};
const formatPct = (p: unknown) => `${Number(p ?? 0).toFixed(2).replace('.', ',').replace(/0+$/, '').replace(/,$/, '')}%`;

onMounted(async () => {
  await Promise.all([
    contactStore.fetchContacts().catch(() => {}),
    invoiceStore.fetchTaxRates().catch(() => {}),
    stockStore.fetchUnits().catch(() => {}),
  ]);
  contacts.value = contactStore.contacts;

  // Bağlı belge seçenekleri (tekliften sipariş, siparişten irsaliye)
  if (props.linked?.source === 'orders') {
    await orderStore.fetchOrders();
    linkedOptions.value = orderStore.orders.map((o) => ({ id: o.id, number: o.number, contact_name: o.contact_name }));
  } else if (props.linked?.source === 'quotes') {
    await quoteStore.fetchQuotes();
    linkedOptions.value = quoteStore.quotes.map((q) => ({ id: q.id, number: q.number, contact_name: q.contact_name }));
  }

  await fetchList();
});
</script>