<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Şantiyeler</h1>
        <p class="page-sub">
          Saha kayıtları: şantiyenin bulunduğu il/ilçe, yönetici kokpitindeki hava durumu bölümünü
          besler (Meteoroloji Genel Müdürlüğü tahmini).
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="toggleForm">
          {{ showForm ? 'Formu Kapat' : '+ Yeni Şantiye' }}
        </button>
      </div>
    </header>

    <p v-if="store.weatherError" class="state-msg error">
      {{ store.weatherError }} — il/ilçe alanlarını elle yazabilirsiniz; MGM listesi geçici olarak
      erişilemiyor.
    </p>

    <form v-if="showForm" class="create-card" @submit.prevent="submitForm">
      <div class="field">
        <label for="site-name">Şantiye adı</label>
        <input
          id="site-name"
          v-model="form.name"
          class="input"
          required
          maxlength="160"
          placeholder="Örn. Vadi Rezidans"
        />
      </div>
      <div class="field">
        <label for="site-province">İl</label>
        <input
          id="site-province"
          v-model="form.province"
          class="input"
          list="mgm-provinces"
          required
          maxlength="80"
          placeholder="Örn. İstanbul"
          @change="onProvinceChange"
        />
        <datalist id="mgm-provinces">
          <option v-for="province in store.provinces" :key="province.il" :value="province.il" />
        </datalist>
        <span v-if="store.provincesLoading" class="muted small">MGM il listesi yükleniyor…</span>
      </div>
      <div class="field">
        <label for="site-district">İlçe</label>
        <input
          id="site-district"
          v-model="form.district"
          class="input"
          list="mgm-districts"
          maxlength="80"
          placeholder="Örn. Başakşehir"
        />
        <datalist id="mgm-districts">
          <option v-for="district in store.districts" :key="district" :value="district" />
        </datalist>
        <span v-if="store.districtsLoading" class="muted small">İlçe listesi yükleniyor…</span>
      </div>
      <div class="field">
        <label for="site-status">Durum</label>
        <select id="site-status" v-model="form.status" class="select">
          <option v-for="option in SITE_STATUS_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="site-code">Kod</label>
        <input
          id="site-code"
          v-model="form.code"
          class="input"
          maxlength="32"
          placeholder="Boş bırakılırsa otomatik (SA-0001)"
        />
      </div>
      <div class="field">
        <label for="site-order">Sıra</label>
        <input id="site-order" v-model.number="form.sort_order" class="input" type="number" min="0" />
      </div>
      <div class="field field-wide">
        <label for="site-address">Adres</label>
        <input id="site-address" v-model="form.address" class="input" maxlength="500" />
      </div>
      <div class="field field-wide">
        <label for="site-notes">Not</label>
        <textarea id="site-notes" v-model="form.notes" class="input" rows="2" maxlength="2000" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="store.saving">
          {{ store.saving ? 'Kaydediliyor…' : editingId ? 'Güncelle' : 'Kaydet' }}
        </button>
        <button v-if="editingId" type="button" class="btn btn-secondary" @click="closeForm">
          Vazgeç
        </button>
      </div>
    </form>

    <div class="toolbar" role="search">
      <select v-model="filters.status" class="select" aria-label="Durum filtresi" @change="applyFilters">
        <option value="">Tüm Durumlar</option>
        <option v-for="option in SITE_STATUS_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <input
        v-model="filters.q"
        type="search"
        class="input search"
        placeholder="Şantiye ara (ad, kod, il)…"
        aria-label="Şantiye ara"
        @change="applyFilters"
      />
    </div>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Kod</th>
            <th scope="col">Şantiye</th>
            <th scope="col">İl / İlçe</th>
            <th scope="col">Durum</th>
            <th scope="col">İşveren</th>
            <th scope="col" class="num">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="site in store.items" :key="site.id">
            <td class="nowrap">{{ site.code }}</td>
            <td>
              <span class="strong">{{ site.name }}</span>
              <span v-if="site.address" class="muted small block">{{ site.address }}</span>
            </td>
            <td>{{ locationLabel(site) }}</td>
            <td>
              <span class="badge" :class="statusBadge(site.status)">{{ site.statusLabel }}</span>
            </td>
            <td>{{ site.contactName || '—' }}</td>
            <td class="num actions">
              <button class="link" @click="startEdit(site)">Düzenle</button>
              <button class="link danger" @click="onDelete(site)">Sil</button>
            </td>
          </tr>
          <tr v-if="!store.items.length && !store.loading">
            <td colspan="6" class="empty-cell">
              Henüz şantiye tanımlı değil. Yukarıdan ekleyin; kokpitteki hava durumu bölümü bu
              kayıtların il/ilçesine göre dolacak.
            </td>
          </tr>
          <tr v-if="store.loading">
            <td colspan="6" class="empty-cell">Yükleniyor…</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  SITE_STATUS_OPTIONS,
  useSitesStore,
  type Site,
  type SiteInput,
  type SiteStatus,
} from '@/stores/sites';

const store = useSitesStore();

const showForm = ref(false);
const editingId = ref<string | null>(null);
const filters = reactive<{ q: string; status: SiteStatus | '' }>({ q: '', status: '' });

interface SiteForm {
  name: string;
  province: string;
  district: string;
  address: string;
  code: string;
  status: SiteStatus;
  sort_order: number;
  notes: string;
}

const emptyForm = (): SiteForm => ({
  name: '',
  province: '',
  district: '',
  address: '',
  code: '',
  status: 'active',
  sort_order: 0,
  notes: '',
});

const form = reactive<SiteForm>(emptyForm());

const applyFilters = () => store.fetchSites({ q: filters.q, status: filters.status });

const toggleForm = () => {
  if (showForm.value) closeForm();
  else {
    Object.assign(form, emptyForm());
    editingId.value = null;
    showForm.value = true;
  }
};

const closeForm = () => {
  showForm.value = false;
  editingId.value = null;
  Object.assign(form, emptyForm());
};

/** İl değişince MGM ilçe listesi tazelenir (il seçimi serbest metin de olabilir). */
const onProvinceChange = () => {
  void store.fetchDistricts(form.province.trim());
};

const startEdit = (site: Site) => {
  editingId.value = site.id;
  Object.assign(form, {
    name: site.name,
    province: site.province,
    district: site.district ?? '',
    address: site.address ?? '',
    code: site.code,
    status: site.status,
    sort_order: site.sortOrder,
    notes: site.notes ?? '',
  });
  showForm.value = true;
  void store.fetchDistricts(site.province);
};

const submitForm = async () => {
  const payload: SiteInput = {
    name: form.name.trim(),
    province: form.province.trim(),
    district: form.district.trim() || null,
    address: form.address.trim() || null,
    status: form.status,
    sort_order: Number.isFinite(form.sort_order) ? form.sort_order : 0,
    notes: form.notes.trim() || null,
  };
  const code = form.code.trim();
  if (code) payload.code = code;
  try {
    if (editingId.value) await store.updateSite(editingId.value, payload);
    else await store.createSite(payload);
    closeForm();
  } catch {
    /* hata store.error içinde gösterilir */
  }
};

const onDelete = async (site: Site) => {
  if (!window.confirm(`"${site.name}" şantiyesi silinsin mi?`)) return;
  try {
    await store.deleteSite(site.id);
  } catch {
    /* hata store.error içinde gösterilir */
  }
};

const locationLabel = (site: Site) =>
  site.district ? `${site.province} / ${site.district}` : site.province;

const statusBadge = (status: SiteStatus) =>
  status === 'active'
    ? 'badge-success'
    : status === 'paused'
      ? 'badge-warning'
      : status === 'completed'
        ? 'badge-info'
        : 'badge-neutral';

onMounted(async () => {
  await Promise.all([store.fetchSites(), store.fetchProvinces()]);
});
</script>
