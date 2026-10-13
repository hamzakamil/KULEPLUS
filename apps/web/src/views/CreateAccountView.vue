<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div>
        <h1 class="page-title">Yeni Cari Kartı</h1>
        <p class="page-sub">Müşteri veya tedarikçi kartı oluşturun. İsim alanları büyük harfle kaydedilir.</p>
      </div>
      <RouterLink to="/contacts" class="btn btn-secondary">← Cari Hesaplar</RouterLink>
    </header>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <form @submit.prevent="handleSubmit" class="create-layout" novalidate>
      <!-- SOL KART: Cari bilgileri -->
      <section class="card create-card">
        <h2 class="card-title">Cari Bilgileri</h2>
        <div class="form-grid">
          <div>
            <label for="ca-type" class="field-label">Cari Türü *</label>
            <FilterableSelect
              id="ca-type"
              v-model="form.type"
              :options="CONTACT_TYPE_OPTIONS"
              placeholder="Müşteri / Tedarikçi seçin"
            />
          </div>
          <div>
            <label for="ca-code" class="field-label">Cari Kodu *</label>
            <div class="code-field">
              <input
                id="ca-code"
                v-model="form.code"
                type="text"
                class="input"
                placeholder="M-0001"
                aria-label="Cari kodu"
                @input="codeTouched = true"
              />
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="saving"
                title="Otomatik kod üret"
                aria-label="Otomatik kod üret"
                @click="regenerateCode"
              >
                ⟳
              </button>
            </div>
            <span class="field-hint">Otomatik üretilir; dilerseniz elle düzenleyebilirsiniz.</span>
          </div>
          <div class="form-field-full">
            <label for="ca-name" class="field-label">Ünvan / Ad Soyad *</label>
            <input
              id="ca-name"
              v-model="form.name"
              type="text"
              class="input uppercase"
              placeholder="ÖRN: ACME TEKNOLOJİ A.Ş."
              required
              @blur="uppercase('name')"
            />
          </div>
          <div class="form-field-full">
            <label for="ca-trade" class="field-label">Ticari Unvan</label>
            <input id="ca-trade" v-model="form.trade_name" type="text" class="input uppercase" @blur="uppercase('trade_name')" />
          </div>
          <div>
            <label for="ca-taxno" class="field-label">Vergi No / TCKN</label>
            <input id="ca-taxno" v-model="form.tax_number" type="text" class="input" inputmode="numeric" />
          </div>
          <div>
            <label for="ca-taxoffice" class="field-label">Vergi Dairesi</label>
            <FilterableSelect
              id="ca-taxoffice"
              v-model="form.tax_office"
              :options="taxOfficeOptions"
              placeholder="Vergi dairesi yazıp seçin"
              no-options-message="Bulunamadı"
            />
            <span class="field-hint">İl seçerseniz yalnızca o ilin vergi daireleri listelenir.</span>
          </div>
          <div>
            <label for="ca-currency" class="field-label">Para Birimi</label>
            <FilterableSelect
              id="ca-currency"
              v-model="form.currency"
              :options="CURRENCY_OPTIONS"
              placeholder="Para birimi seçin"
            />
          </div>
          <div>
            <label for="ca-risk" class="field-label">Risk Limiti (₺)</label>
            <input id="ca-risk" v-model="form.risk_limit" type="number" min="0" step="0.01" class="input" placeholder="0,00" />
          </div>
          <div class="form-field-full">
            <label class="checkbox">
              <input v-model="form.is_active" type="checkbox" />
              <span>Aktif kart (pasif cariler yeni işlemde seçilemez)</span>
            </label>
          </div>
        </div>
      </section>
      <!-- SAĞ KART: İletişim & Adres -->
      <section class="card create-card">
        <h2 class="card-title">İletişim & Adres</h2>
        <div class="form-grid">
          <div>
            <label for="ca-phone-type" class="field-label">Telefon Tipi</label>
            <FilterableSelect
              id="ca-phone-type"
              v-model="form.phone.type"
              :options="PHONE_TYPE_OPTIONS"
              placeholder="Tip seçin"
            />
          </div>
          <div>
            <label for="ca-phone" class="field-label">Telefon</label>
            <input id="ca-phone" v-model="form.phone.number" type="tel" class="input" placeholder="05XX XXX XX XX" />
          </div>
          <div>
            <label for="ca-email-type" class="field-label">E-posta Tipi</label>
            <FilterableSelect
              id="ca-email-type"
              v-model="form.email.type"
              :options="EMAIL_TYPE_OPTIONS"
              placeholder="Tip seçin"
            />
          </div>
          <div>
            <label for="ca-email" class="field-label">E-posta</label>
            <input id="ca-email" v-model="form.email.address" type="email" class="input" placeholder="ornek@firma.com" />
          </div>
          <div class="form-field-full">
            <label for="ca-addr-type" class="field-label">Adres Tipi</label>
            <FilterableSelect
              id="ca-addr-type"
              v-model="form.address.type"
              :options="ADDRESS_TYPE_OPTIONS"
              placeholder="Tip seçin"
            />
          </div>
          <div class="form-field-full">
            <label for="ca-neighborhood" class="field-label">Mahalle / Cadde</label>
            <input id="ca-neighborhood" v-model="form.address.neighborhood" type="text" class="input uppercase" @blur="uppercase('address.neighborhood')" />
          </div>
          <div>
            <label for="ca-street" class="field-label">Sokak</label>
            <input id="ca-street" v-model="form.address.street" type="text" class="input uppercase" @blur="uppercase('address.street')" />
          </div>
          <div>
            <label for="ca-building" class="field-label">Bina</label>
            <input id="ca-building" v-model="form.address.building" type="text" class="input uppercase" @blur="uppercase('address.building')" />
          </div>
          <div>
            <label for="ca-apartment" class="field-label">Daire</label>
            <input id="ca-apartment" v-model="form.address.apartment" type="text" class="input" />
          </div>
          <div>
            <label for="ca-province" class="field-label">İl</label>
            <FilterableSelect
              id="ca-province"
              v-model="form.address.province"
              :options="provinceOptions"
              placeholder="İl yazıp seçin"
            />
          </div>
          <div>
            <label for="ca-district" class="field-label">İlçe</label>
            <FilterableSelect
              id="ca-district"
              v-model="form.address.district"
              :options="districtOptions"
              :disabled="!form.address.province"
              placeholder="Önce il seçin"
            />
          </div>
          <div>
            <label for="ca-zip" class="field-label">Posta Kodu</label>
            <input id="ca-zip" v-model="form.address.zip_code" type="text" class="input" inputmode="numeric" />
          </div>
        </div>
      </section>

      <div class="create-actions">
        <RouterLink to="/contacts" class="btn btn-secondary">İptal</RouterLink>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Cari Kartı Kaydet' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useContactStore } from '@/stores/contacts';
import FilterableSelect from '@/components/FilterableSelect.vue';
import { districtsOf, taxOfficesOf, TR_PROVINCES } from '@/data/tr-locations';
import type { AxiosError } from 'axios';

const router = useRouter();
const store = useContactStore();

const saving = ref(false);
const error = ref<string | null>(null);
const codeTouched = ref(false);

const form = ref({
  code: '',
  name: '',
  trade_name: '',
  type: 'customer' as 'customer' | 'supplier',
  tax_number: '',
  tax_office: '',
  is_active: true,
  currency: 'TRY',
  risk_limit: '',
  phone: { type: 'mobile', number: '' },
  email: { type: 'default', address: '' },
  address: {
    type: 'default',
    neighborhood: '',
    street: '',
    building: '',
    apartment: '',
    district: '',
    province: '',
    zip_code: '',
  },
});

/** İl / ilçe / vergi dairesi seçenekleri — açık veri kaynağı (81 il, 973 ilçe, 1042 v.d.). */
const provinceOptions = TR_PROVINCES.map((p) => ({ value: p.name, label: `${p.name} (${p.plate})` }));
const districtOptions = computed(() => districtsOf(form.value.address.province).map((d) => ({ value: d, label: d })));
const taxOfficeOptions = computed(() => taxOfficesOf(form.value.address.province).map((t) => ({ value: t, label: t })));

const CONTACT_TYPE_OPTIONS = [
  { value: 'customer', label: 'Müşteri' },
  { value: 'supplier', label: 'Tedarikçi' },
];
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY — Türk Lirası' },
  { value: 'USD', label: 'USD — Dolar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — Sterlin' },
];
const PHONE_TYPE_OPTIONS = [
  { value: 'mobile', label: 'Cep' },
  { value: 'work', label: 'İş' },
  { value: 'home', label: 'Ev' },
  { value: 'fax', label: 'Faks' },
];
const EMAIL_TYPE_OPTIONS = [
  { value: 'default', label: 'Varsayılan' },
  { value: 'notifications', label: 'Bildirim' },
  { value: 'marketing', label: 'Pazarlama' },
];
const ADDRESS_TYPE_OPTIONS = [
  { value: 'default', label: 'Varsayılan' },
  { value: 'billing', label: 'Fatura' },
  { value: 'shipping', label: 'Teslimat' },
  { value: 'other', label: 'Diğer' },
];

/** İl değişince ilçe ve vergi dairesi seçimlerini il bazında tazeler. */
watch(
  () => form.value.address.province,
  (province) => {
    const ilces = districtsOf(province);
    if (province && ilces.length && !ilces.includes(form.value.address.district)) {
      form.value.address.district = '';
    }
    const vd = taxOfficesOf(province);
    if (province && vd.length && !vd.includes(form.value.tax_office)) {
      form.value.tax_office = '';
    }
  },
);

/** Tür değişince (kod elle düzenlenmediyse) yeni önekle kod üret. */
watch(
  () => form.value.type,
  () => {
    if (!codeTouched.value) form.value.code = generateCode(form.value.type);
  },
);

/** Mevcut kayıtlardan en yüksek M-xxxx / T-xxxx sırasını bulup sonrakini üretir. */
function generateCode(type: 'customer' | 'supplier'): string {
  const prefix = type === 'customer' ? 'M' : 'T';
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const c of store.contacts) {
    const m = re.exec(c.code.trim().toLocaleUpperCase('tr-TR'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function regenerateCode(): void {
  codeTouched.value = false;
  form.value.code = generateCode(form.value.type);
}

/** Noktalı yol ile form alanını TR kuralına göre büyük harfe çevirir (örn. 'address.street'). */
function uppercase(path: string): void {
  const parts = path.split('.');
  let target: Record<string, unknown> = form.value;
  if (parts.length === 2) {
    target = form.value[parts[0] as keyof typeof form.value] as unknown as Record<string, unknown>;
  }
  const key = parts[parts.length - 1];
  const raw = String(target[key] ?? '');
  target[key] = raw.trim().toLocaleUpperCase('tr-TR');
}

/** Adresten en az bir alan dolu mu? (tip varsayılanı hariç) */
function hasAddress(): boolean {
  return Object.entries(form.value.address).some(
    ([key, value]) => key !== 'type' && typeof value === 'string' && value.trim().length > 0,
  );
}

const handleSubmit = async () => {
  const name = form.value.name.trim();
  if (!name) {
    error.value = 'Ünvan / Ad Soyad alanı zorunludur.';
    return;
  }
  const code = form.value.code.trim().toLocaleUpperCase('tr-TR');
  if (!code) {
    error.value = 'Cari kodu zorunludur.';
    return;
  }
  const email = form.value.email.address.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    error.value = 'Geçerli bir e-posta adresi girin.';
    return;
  }

  saving.value = true;
  error.value = null;
  try {
    await store.createContact({
      code,
      name: name.toLocaleUpperCase('tr-TR'),
      type: form.value.type,
      trade_name: form.value.trade_name.trim().toLocaleUpperCase('tr-TR') || null,
      tax_number: form.value.tax_number.trim() || null,
      tax_office: form.value.tax_office.trim() || null,
      is_active: form.value.is_active,
      settings: {
        currency: form.value.currency,
        risk_limit: form.value.risk_limit ? Number(form.value.risk_limit) : null,
      },
      phones: form.value.phone.number.trim()
        ? [{ type: form.value.phone.type, number: form.value.phone.number.trim(), is_primary: true }]
        : [],
      emails: email ? [{ type: form.value.email.type, email, is_primary: true }] : [],
      addresses: hasAddress()
        ? [
            {
              type: form.value.address.type,
              is_primary: true,
              neighborhood: form.value.address.neighborhood.trim().toLocaleUpperCase('tr-TR') || undefined,
              street: form.value.address.street.trim().toLocaleUpperCase('tr-TR') || undefined,
              building: form.value.address.building.trim().toLocaleUpperCase('tr-TR') || undefined,
              apartment: form.value.address.apartment.trim() || undefined,
              district: form.value.address.district.trim().toLocaleUpperCase('tr-TR') || undefined,
              province: form.value.address.province.trim().toLocaleUpperCase('tr-TR') || undefined,
              zip_code: form.value.address.zip_code.trim() || undefined,
            },
          ]
        : [],
    });
    router.push('/contacts');
  } catch (e) {
    const axiosError = e as AxiosError<{ message?: string }>;
    error.value = axiosError.response?.data?.message || 'Cari kaydedilemedi.';
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  await store.fetchContacts({ limit: 100 });
  if (!codeTouched.value) form.value.code = generateCode(form.value.type);
});
</script>

<style scoped>
.page {
  max-width: 48rem;
  margin-inline: auto;
  padding: 1.5rem;
}
.page-sub {
  margin: 0.25rem 0 0;
  color: #64748b;
  font-size: 0.9375rem;
}
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1.5rem;
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
.input,
.select {
  width: 100%;
  font: inherit;
  font-size: 0.9375rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #fff;
}
.input:focus-visible,
.select:focus-visible {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 3px #eff6ff;
}
.modal-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.alert-error {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}
@media (max-width: 34rem) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.create-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}
.create-card {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.code-field {
  display: flex;
  gap: 0.375rem;
}
.code-field .input {
  flex: 1;
}
.code-field .btn {
  flex-shrink: 0;
}
.field-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: #64748b;
}
.uppercase {
  text-transform: uppercase;
}
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.checkbox input {
  width: 1rem;
  height: 1rem;
  accent-color: #1d4ed8;
}
.create-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.25rem;
}
@media (max-width: 56rem) {
  .create-layout {
    grid-template-columns: 1fr;
  }
  .create-actions {
    grid-column: 1;
  }
}

</style>