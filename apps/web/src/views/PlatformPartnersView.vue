<template>
  <div class="platform-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Ortaklar (SMMM) &amp; Komisyon</h1>
        <p class="page-sub">
          Müşteri getiren mali müşavirler. Atfedilen şirketin her başarılı ödemesinde, ortağın
          oranıyla "bekliyor" komisyonu oluşur; buradan onaylar, ödenince "ödendi" işaretlersiniz.
        </p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openCreate">Yeni ortak</button>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <!-- Özet -->
    <section class="kpis" aria-label="Komisyon özeti">
      <article class="card kpi">
        <span class="muted small">Onay bekleyen</span>
        <strong class="kpi-value">{{ fmtMoney(totals.pending) }}</strong>
      </article>
      <article class="card kpi">
        <span class="muted small">Ödenecek (onaylı)</span>
        <strong class="kpi-value tone-warn">{{ fmtMoney(totals.approved) }}</strong>
      </article>
      <article class="card kpi">
        <span class="muted small">Ödenen</span>
        <strong class="kpi-value tone-good">{{ fmtMoney(totals.paid) }}</strong>
      </article>
    </section>

    <!-- Ortak listesi -->
    <section class="card">
      <header class="card-head">
        <h2 class="section-title">Ortaklar</h2>
        <span class="muted small">{{ store.partners.length }} ortak</span>
      </header>
      <p v-if="store.loading && !store.partners.length" class="state-msg">Yükleniyor…</p>
      <div v-else-if="store.partners.length" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ortak</th>
              <th class="num">Oran</th>
              <th class="num">Müşteri</th>
              <th class="num">Bekleyen</th>
              <th class="num">Onaylı</th>
              <th class="num">Ödenen</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in store.partners" :key="p.id" :class="{ selected: p.id === selectedId }">
              <td>
                <button class="link strong" @click="select(p.id)">{{ p.name }}</button>
                <div class="muted small mono">{{ p.code }}</div>
              </td>
              <td class="num">%{{ Number(p.commissionRate) }}</td>
              <td class="num">{{ p.referralCount }}</td>
              <td class="num">{{ fmtMoney(p.pendingAmount) }}</td>
              <td class="num">{{ fmtMoney(p.approvedAmount) }}</td>
              <td class="num">{{ fmtMoney(p.paidAmount) }}</td>
              <td>
                <span class="badge" :class="p.isActive ? 'badge-success' : 'badge-neutral'">
                  {{ p.isActive ? 'Aktif' : 'Pasif' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted small">
        Henüz ortak yok. "Yeni ortak" ile bir SMMM ekleyin; oranı %0 ise komisyon üretilmez.
      </p>
    </section>

    <!-- Seçili ortak -->
    <section v-if="selected" class="card detail">
      <header class="card-head">
        <div>
          <h2 class="section-title">{{ selected.name }}</h2>
          <span class="muted small">
            %{{ Number(selected.commissionRate) }} komisyon · {{ selected.referralCount }} müşteri
          </span>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" @click="openEdit">Düzenle</button>
          <button class="btn btn-ghost btn-sm" @click="toggleActive">
            {{ selected.isActive ? 'Pasife al' : 'Aktifleştir' }}
          </button>
        </div>
      </header>

      <div class="tabs" role="tablist">
        <button
          class="tab"
          role="tab"
          :aria-selected="tab === 'commissions'"
          :class="{ active: tab === 'commissions' }"
          @click="tab = 'commissions'"
        >
          Komisyonlar
        </button>
        <button
          class="tab"
          role="tab"
          :aria-selected="tab === 'referrals'"
          :class="{ active: tab === 'referrals' }"
          @click="tab = 'referrals'"
        >
          Müşteriler
        </button>
      </div>

      <!-- Komisyonlar -->
      <div v-if="tab === 'commissions'">
        <div class="filter-row">
          <label class="muted small" for="pc-status">Durum</label>
          <select id="pc-status" v-model="statusFilter" class="input">
            <option value="">Tümü</option>
            <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </div>
        <div v-if="store.commissions.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Şirket</th>
                <th>Sipariş</th>
                <th class="num">Komisyon</th>
                <th>Durum</th>
                <th class="num">İşlem</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in store.commissions" :key="c.id">
                <td>{{ fmtDate(c.createdAt) }}</td>
                <td>{{ c.tenantName || '—' }}</td>
                <td class="mono">{{ c.orderNo || '—' }}</td>
                <td class="num">{{ fmtMoney(c.amount) }}</td>
                <td>
                  <span class="badge" :class="STATUS_CLASS[c.status]">
                    {{ STATUS_LABEL[c.status] }}
                  </span>
                </td>
                <td class="num actions">
                  <template v-if="c.status === 'pending'">
                    <button class="link" @click="move(c, 'approved')">Onayla</button>
                    <button class="link danger" @click="move(c, 'cancelled')">İptal</button>
                  </template>
                  <template v-else-if="c.status === 'approved'">
                    <button class="link" @click="move(c, 'paid')">Ödendi</button>
                    <button class="link danger" @click="move(c, 'cancelled')">İptal</button>
                  </template>
                  <span v-else class="muted small">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted small">
          Bu ortak için komisyon kaydı yok. Atfedilen şirketlerin başarılı ödemeleriyle oluşur.
        </p>
      </div>

      <!-- Müşteriler (atıflar) -->
      <div v-else>
        <div class="filter-row">
          <label class="muted small" for="pc-tenant">Şirket bağla</label>
          <select id="pc-tenant" v-model="newTenantId" class="input">
            <option value="">Şirket seçin…</option>
            <option v-for="t in store.tenantOptions" :key="t.id" :value="t.id">
              {{ t.name }} · {{ fmtDate(t.createdAt) }} · …{{ t.id.slice(-6) }}
            </option>
          </select>
          <button class="btn btn-primary btn-sm" :disabled="!newTenantId" @click="attach">
            Bağla
          </button>
        </div>
        <div v-if="store.referrals.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Şirket</th>
                <th>Bağlanma tarihi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in store.referrals" :key="r.id">
                <td>{{ r.tenantName || r.tenantId }}</td>
                <td>{{ fmtDate(r.referredAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted small">
          Bu ortağa bağlı şirket yok. Bir şirket yalnızca tek ortağa bağlanabilir; bağlandıktan
          sonraki ödemeler komisyon üretir (geçmiş ödemeler için geriye dönük hak doğmaz).
        </p>
      </div>
    </section>

    <!-- Ortak formu (oluştur / düzenle) -->
    <div v-if="form" class="modal-overlay" @click.self="form = null">
      <div class="modal modal-md" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2>{{ form.id ? 'Ortağı düzenle' : 'Yeni ortak' }}</h2>
          <button type="button" class="modal-close" aria-label="Kapat" @click="form = null">
            ×
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="pf-name">Ad / Unvan</label>
            <input id="pf-name" v-model="form.name" class="input" maxlength="255" />
          </div>
          <div v-if="!form.id" class="field">
            <label for="pf-code">Kod</label>
            <input
              id="pf-code"
              v-model="form.code"
              class="input"
              maxlength="60"
              placeholder="ör. smmm-ali"
            />
            <p class="muted small">Harf, rakam, "-" ve "_". Sonradan değiştirilemez.</p>
          </div>
          <div class="field">
            <label for="pf-rate">Komisyon oranı (%)</label>
            <input
              id="pf-rate"
              v-model.number="form.commissionRate"
              class="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
            />
            <p class="muted small">
              Yeni ödemelere uygulanır; oluşmuş komisyonlar değişmez. %0 = komisyon üretilmez.
            </p>
          </div>
          <p v-if="formError" class="state-msg error">{{ formError }}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="form = null">Vazgeç</button>
          <button type="button" class="btn btn-primary" :disabled="saving" @click="saveForm">
            {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { usePlatformStore, type Commission, type CommissionStatus } from '@/stores/platform';

const store = usePlatformStore();

const selectedId = ref<string | null>(null);
const tab = ref<'commissions' | 'referrals'>('commissions');
const statusFilter = ref<CommissionStatus | ''>('');
const newTenantId = ref('');

const selected = computed(() => store.partners.find((p) => p.id === selectedId.value) ?? null);

onMounted(async () => {
  await store.fetchPartners();
  if (store.partners.length && !selectedId.value) select(store.partners[0].id);
});

function select(id: string): void {
  selectedId.value = id;
  tab.value = 'commissions';
  statusFilter.value = '';
  newTenantId.value = '';
}

// Seçim veya filtre değişince komisyonlar, sekme/seçim değişince atıflar yüklenir.
watch([selectedId, statusFilter], ([id, status]) => {
  if (id) void store.fetchCommissions(id, status || undefined);
});
watch([selectedId, tab], ([id, current]) => {
  if (!id || current !== 'referrals') return;
  void store.fetchReferrals(id);
  if (!store.tenantOptions.length) void store.fetchTenantOptions();
});

async function move(c: Commission, to: 'approved' | 'paid' | 'cancelled'): Promise<void> {
  if (!selectedId.value) return;
  if (to === 'cancelled' && !window.confirm('Bu komisyon iptal edilsin mi? Geri alınamaz.')) return;
  await store.setCommissionStatus(selectedId.value, c.id, to, statusFilter.value || undefined);
}

async function attach(): Promise<void> {
  if (!selectedId.value || !newTenantId.value) return;
  if (await store.addReferral(selectedId.value, newTenantId.value)) newTenantId.value = '';
}

async function toggleActive(): Promise<void> {
  if (!selected.value) return;
  await store.updatePartner(selected.value.id, { isActive: !selected.value.isActive });
}

// ---- Ortak formu ----
interface PartnerForm {
  id: string | null;
  code: string;
  name: string;
  commissionRate: number;
}
const form = ref<PartnerForm | null>(null);
const formError = ref('');
const saving = ref(false);

function openCreate(): void {
  formError.value = '';
  form.value = { id: null, code: '', name: '', commissionRate: 20 };
}
function openEdit(): void {
  if (!selected.value) return;
  formError.value = '';
  form.value = {
    id: selected.value.id,
    code: selected.value.code,
    name: selected.value.name,
    commissionRate: Number(selected.value.commissionRate),
  };
}

async function saveForm(): Promise<void> {
  const f = form.value;
  if (!f) return;
  const rate = Number(f.commissionRate);
  if (f.name.trim().length < 2) return void (formError.value = 'Ad en az 2 karakter olmalı');
  if (!f.id && !/^[A-Za-z0-9_-]{2,60}$/.test(f.code.trim())) {
    return void (formError.value = 'Kod 2–60 karakter; yalnızca harf, rakam, "-" ve "_"');
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return void (formError.value = 'Oran 0 ile 100 arasında olmalı');
  }

  saving.value = true;
  formError.value = '';
  const ok = f.id
    ? await store.updatePartner(f.id, { name: f.name.trim(), commissionRate: rate })
    : await store.createPartner({ code: f.code.trim(), name: f.name.trim(), commissionRate: rate });
  saving.value = false;

  if (!ok) {
    // Hata mesajı (örn. yinelenen kod) formda görünsün; sayfa üstündekini tekrarlama.
    formError.value = store.error ?? 'Kaydedilemedi';
    store.error = null;
    return;
  }
  form.value = null;
  if (!f.id && store.partners.length) {
    const created = store.partners.find((p) => p.code === f.code.trim());
    if (created) select(created.id);
  }
}

// ---- Biçimleme ----
const STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylı',
  paid: 'Ödendi',
  cancelled: 'İptal',
};
const STATUS_CLASS: Record<CommissionStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-info',
  paid: 'badge-success',
  cancelled: 'badge-neutral',
};

/** NUMERIC string toplamı — kuruş (tamsayı) üzerinden, kayan nokta birikimi olmadan. */
const sumCents = (values: string[]): number =>
  values.reduce((sum, v) => sum + Math.round(Number(v) * 100), 0);

const totals = computed(() => ({
  pending: sumCents(store.partners.map((p) => p.pendingAmount)) / 100,
  approved: sumCents(store.partners.map((p) => p.approvedAmount)) / 100,
  paid: sumCents(store.partners.map((p) => p.paidAmount)) / 100,
}));

const fmtMoney = (value: string | number): string =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value));
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('tr-TR');
</script>

<style scoped>
.platform-view {
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
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kpi-value {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.tone-good {
  color: var(--c-success);
}
.tone-warn {
  color: #b45309;
}
section.card + section.card {
  margin-top: 1rem;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.section-title {
  font-size: 1.05rem;
  margin: 0;
}
.table-wrap {
  overflow-x: auto;
}
tr.selected td {
  background: var(--c-primary-soft);
}
.link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--c-primary);
  cursor: pointer;
  text-align: left;
}
.link:hover {
  text-decoration: underline;
}
.link.danger {
  color: var(--c-danger);
  margin-left: 0.75rem;
}
.actions {
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--c-border);
  margin-bottom: 0.75rem;
}
.tab {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 0.5rem 0.875rem;
  font: inherit;
  font-weight: 600;
  color: var(--c-muted);
  cursor: pointer;
}
.tab.active {
  color: var(--c-primary);
  border-bottom-color: var(--c-primary);
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
</style>
