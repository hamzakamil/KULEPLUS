<template>
  <div class="cashbank-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ activeLedger === 'cash' ? 'Kasa' : 'Bankalar' }}</h1>
        <p class="page-sub">
          <template v-if="activeLedger === 'cash'">
            Nakit kasalar bu ekranda ayrı yönetilir. Banka hesapları, POS, kredi kartları ve
            krediler için <RouterLink class="inline-link" to="/bank">Bankalar</RouterLink> ekranına
            geçin.
          </template>
          <template v-else>
            Banka hesapları ve POS hesapları bu ekranda yönetilir. Kredi kartları
            <RouterLink class="inline-link" to="/bank/cards">Kredi Kartları</RouterLink>, krediler
            <RouterLink class="inline-link" to="/bank/loans">Banka Kredileri</RouterLink> kendi
            ekranlarında ayrı modül olarak çalışır. Nakit için
            <RouterLink class="inline-link" to="/cash">Kasa</RouterLink> ekranına geçin.
          </template>
        </p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="openAccountForm()">
          {{ activeLedger === 'cash' ? '+ Yeni Kasa' : '+ Yeni Banka Hesabı' }}
        </button>
      </div>
    </header>

    <!-- ── Özet kartları ── -->
    <section class="kpi-grid" aria-label="Özet">
      <div class="kpi">
        <span class="kpi-label">{{
          activeLedger === 'cash' ? 'Kasa Sayısı' : 'Banka Hesabı'
        }}</span>
        <span class="kpi-value">{{ activeAccounts.length }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Toplam Bakiye</span>
        <span class="kpi-value">{{ formatMoney(totalBalance) }}</span>
      </div>
      <template v-if="activeLedger === 'bank'">
        <div class="kpi">
          <span class="kpi-label">POS Hesabı</span>
          <span class="kpi-value">{{ store.posAccounts.length }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Aktif Hesap</span>
          <span class="kpi-value">{{ activeAccounts.filter((a) => a.status === 'active').length }}</span>
        </div>
      </template>
      <div v-else class="kpi">
        <span class="kpi-label">Bugünkü Hareket</span>
        <span class="kpi-value">{{ todayMovementCount }}</span>
      </div>
    </section>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <!-- ── Kasalar / Banka hesapları listesi ── -->
    <section class="panel" aria-labelledby="hesap-baslik">
      <div class="panel-head">
        <h2 id="hesap-baslik">
          {{ activeLedger === 'cash' ? 'Kasalar' : 'Banka Hesapları' }}
        </h2>
        <div class="panel-tools">
          <input
            v-model="search"
            type="search"
            class="input search"
            :placeholder="activeLedger === 'cash' ? 'Kasa ara…' : 'Hesap ara…'"
            aria-label="Hesap ara"
          />
          <button class="btn btn-secondary btn-sm" @click="openMovement('deposit')">
            Para Yatır
          </button>
          <button class="btn btn-secondary btn-sm" @click="openMovement('withdrawal')">
            Para Çek
          </button>
          <button class="btn btn-secondary btn-sm" @click="openMovement('transfer')">
            Transfer
          </button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Hesap Adı</th>
              <th scope="col">Hesap No</th>
              <th scope="col">Para Birimi</th>
              <th scope="col" class="num">Açılış</th>
              <th scope="col" class="num">Bakiye</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="acc in filteredAccounts" :key="acc.id">
              <td class="strong">{{ acc.accountName }}</td>
              <td class="mono muted">{{ acc.accountNumber || '—' }}</td>
              <td>{{ acc.currency }}</td>
              <td class="num muted">{{ formatMoney(acc.openingBalance) }}</td>
              <td class="num strong" :class="{ neg: Number(acc.balance) < 0 }">
                {{ formatMoney(acc.balance) }}
              </td>
              <td>
                <span
                  class="badge"
                  :class="acc.status === 'active' ? 'badge-success' : 'badge-neutral'"
                >
                  {{ acc.status === 'active' ? 'Aktif' : 'Pasif' }}
                </span>
              </td>
              <td class="num actions">
                <button class="link" @click="viewMovements(acc)">Hareketler</button>
                <button class="link" @click="openAccountForm(acc)">Düzenle</button>
                <button class="link danger" @click="removeAccount(acc.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!filteredAccounts.length">
              <td colspan="7" class="empty-cell">
                {{
                  search
                    ? 'Aramaya uygun hesap yok.'
                    : activeLedger === 'cash'
                      ? 'Henüz kasa yok. "+ Yeni Kasa" ile başlayın.'
                      : 'Henüz banka hesabı yok. "+ Yeni Banka Hesabı" ile başlayın.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── POS Hesapları (banka hesabına bağlı) ── -->
    <section v-if="activeLedger === 'bank'" class="bank-modules" aria-labelledby="pos-baslik">
      <div class="panel-head">
        <h2 id="pos-baslik">POS Hesapları</h2>
        <div class="panel-tools">
          <span class="muted small">Banka hesabına bağlı POS terminalleri</span>
        </div>
      </div>

      <div class="bank-picker">
        <label for="bank-acc">Banka Hesabı</label>
        <FilterableSelect
          id="bank-acc"
          v-model="selectedBankAccountId"
          :options="bankFilterOptions"
          placeholder="Tüm banka hesapları"
          @select="reloadPosAccounts"
        />
        <button class="btn btn-primary btn-sm" @click="openPosForm()">+ POS Ekle</button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Banka</th>
              <th scope="col">POS Adı</th>
              <th scope="col">Terminal</th>
              <th scope="col">Üye İşyeri No</th>
              <th scope="col" class="num">Komisyon %</th>
              <th scope="col">Taksit</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in store.posAccounts" :key="p.id">
              <td>{{ p.bankAccountName || '—' }}</td>
              <td class="strong">{{ p.posLabel }}</td>
              <td class="mono muted">{{ p.terminalId || '—' }}</td>
              <td class="mono muted">{{ p.merchantNumber || '—' }}</td>
              <td class="num">{{ p.commissionRate }}</td>
              <td>
                <span
                  class="badge"
                  :class="p.installmentSupported ? 'badge-success' : 'badge-neutral'"
                >
                  {{ p.installmentSupported ? 'Destekli' : 'Yok' }}
                </span>
              </td>
              <td class="num actions">
                <button class="link" @click="openPosForm(p)">Düzenle</button>
                <button class="link danger" @click="removePos(p.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!store.posAccounts.length">
              <td colspan="7" class="empty-cell">POS hesabı yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Hareketler (seçili hesap) ── -->
    <section v-if="movementAccount" class="panel" aria-labelledby="hareket-baslik">
      <div class="panel-head">
        <h2 id="hareket-baslik">
          Hareketler — {{ movementAccount.accountName }}
          <span class="badge badge-info">{{ formatMoney(movementAccount.balance) }}</span>
        </h2>
        <button class="btn btn-secondary btn-sm" @click="movementAccount = null">Kapat</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col">Tür</th>
              <th scope="col">Referans</th>
              <th scope="col">Açıklama</th>
              <th scope="col" class="num">Tutar</th>
              <th scope="col" class="num">Bakiye Sonrası</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in store.movements" :key="m.id">
              <td class="nowrap">{{ formatDate(m.transactionDate) }}</td>
              <td>
                <span class="badge" :class="movementBadge(m.movementType)">
                  {{ movementLabel(m.movementType) }}
                </span>
              </td>
              <td class="mono muted">{{ m.reference || '—' }}</td>
              <td>{{ m.description || '—' }}</td>
              <td class="num" :class="m.movementType === 'withdrawal' ? 'neg' : 'pos'">
                {{ m.movementType === 'withdrawal' ? '−' : '+' }}{{ formatMoney(m.amount) }}
              </td>
              <td class="num">{{ formatMoney(m.balanceAfter) }}</td>
            </tr>
            <tr v-if="!store.movements.length">
              <td colspan="6" class="empty-cell">Bu hesapta hareket yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Hesap formu ── -->
    <div v-if="showAccountForm" class="modal-backdrop" @click.self="showAccountForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>
            {{
              editingAccount
                ? 'Hesabı Düzenle'
                : activeLedger === 'cash'
                  ? 'Yeni Kasa'
                  : 'Yeni Banka Hesabı'
            }}
          </h2>
          <button class="modal-close" aria-label="Kapat" @click="showAccountForm = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="saveAccount">
          <div>
            <label class="field-label" for="acc-name">Hesap Adı *</label>
            <input id="acc-name" v-model="accountForm.accountName" class="input" required />
          </div>
          <div>
            <label class="field-label" for="acc-no">Hesap No</label>
            <input id="acc-no" v-model="accountForm.accountNumber" class="input" />
          </div>
          <div>
            <label class="field-label" for="acc-cur">Para Birimi</label>
            <FilterableSelect
              id="acc-cur"
              v-model="accountForm.currency"
              :options="CURRENCY_OPTIONS"
              placeholder="Para birimi seçin"
            />
          </div>
          <div>
            <label class="field-label" for="acc-open">Açılış Bakiyesi</label>
            <input
              id="acc-open"
              v-model.number="accountForm.openingBalance"
              type="number"
              step="0.01"
              class="input"
            />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="acc-desc">Açıklama</label>
            <input id="acc-desc" v-model="accountForm.description" class="input" />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showAccountForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.loading">
              {{ store.loading ? 'Kaydediliyor…' : 'Kaydet' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Hareket formu ── -->
    <div v-if="showMovementForm" class="modal-backdrop" @click.self="showMovementForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>{{ movementTitle }}</h2>
          <button class="modal-close" aria-label="Kapat" @click="showMovementForm = false">
            ×
          </button>
        </div>
        <form class="form-grid" @submit.prevent="saveMovement">
          <div>
            <label class="field-label" for="mov-acc">
              {{ movementType === 'transfer' ? 'Kaynak Hesap *' : 'Hesap *' }}
            </label>
            <FilterableSelect
              id="mov-acc"
              v-model="movementForm.accountId"
              :options="accountSelectOptions"
              placeholder="Seçiniz…"
            />
          </div>
          <div v-if="movementType === 'transfer'">
            <label class="field-label" for="mov-target">Hedef Hesap *</label>
            <FilterableSelect
              id="mov-target"
              v-model="movementForm.targetAccountId"
              :options="accountSelectOptions"
              placeholder="Seçiniz…"
            />
          </div>
          <div>
            <label class="field-label" for="mov-date">Tarih *</label>
            <input
              id="mov-date"
              v-model="movementForm.transactionDate"
              type="date"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="mov-amount">Tutar *</label>
            <input
              id="mov-amount"
              v-model.number="movementForm.amount"
              type="number"
              step="0.01"
              min="0.01"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="mov-ref">Referans</label>
            <input id="mov-ref" v-model="movementForm.reference" class="input" />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="mov-desc">Açıklama</label>
            <input id="mov-desc" v-model="movementForm.description" class="input" />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showMovementForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.loading">
              {{ store.loading ? 'Kaydediliyor…' : 'Kaydet' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── POS hesabı formu ── -->
    <div v-if="showPosForm" class="modal-backdrop" @click.self="showPosForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>{{ editingPos ? 'POS Hesabını Düzenle' : 'Yeni POS Hesabı' }}</h2>
          <button class="modal-close" aria-label="Kapat" @click="showPosForm = false">×</button>
        </div>
        <form class="form-grid" @submit.prevent="savePos">
          <div class="form-field-full">
            <label class="field-label" for="pos-bank">Banka Hesabı *</label>
            <FilterableSelect
              id="pos-bank"
              v-model="posForm.bankAccountId"
              :options="bankAccountOptions"
              placeholder="Banka hesabı seçin"
            />
          </div>
          <div>
            <label class="field-label" for="pos-label">POS Adı *</label>
            <input id="pos-label" v-model="posForm.posLabel" class="input" required />
          </div>
          <div>
            <label class="field-label" for="pos-term">Terminal ID</label>
            <input id="pos-term" v-model="posForm.terminalId" class="input" />
          </div>
          <div>
            <label class="field-label" for="pos-mid">Üye İşyeri No</label>
            <input id="pos-mid" v-model="posForm.merchantNumber" class="input" />
          </div>
          <div>
            <label class="field-label" for="pos-comm">Komisyon Oranı (%)</label>
            <input
              id="pos-comm"
              v-model.number="posForm.commissionRate"
              type="number"
              step="0.01"
              class="input"
            />
          </div>
          <label class="check form-field-full">
            <input v-model="posForm.installmentSupported" type="checkbox" />
            Taksitli satış desteklenir
          </label>
          <div class="form-field-full">
            <label class="field-label" for="pos-desc">Açıklama</label>
            <input id="pos-desc" v-model="posForm.description" class="input" />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showPosForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.loading">Kaydet</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import FilterableSelect from '@/components/FilterableSelect.vue';
import {
  useCashBankStore,
  type CashBankAccount,
  type PosAccount,
} from '@/stores/cash-bank';

const store = useCashBankStore();

// Route prop'u bu ekranın hangi türü gösterdiğini belirler: 'cash' → Kasa, 'bank' → Banka.
// Kasa ve banka ayrı ekranlardır (apps/web/src/router/index.ts → /cash ve /bank).
// Kredi kartları ve krediler kendi modüllerinde (/bank/cards, /bank/loans) yönetilir.
const props = defineProps<{ ledger?: 'cash' | 'bank' }>();

// ── Bu ekranın defter türü (kasa / banka) ──
const activeLedger = ref<'cash' | 'bank'>(props.ledger ?? 'cash');
const search = ref('');
const formError = ref<string | null>(null);

const cashAccounts = computed(() => store.accounts.filter((a) => a.accountType === 'cash'));
const bankAccounts = computed(() => store.accounts.filter((a) => a.accountType === 'bank'));
const activeAccounts = computed(() =>
  activeLedger.value === 'cash' ? cashAccounts.value : bankAccounts.value,
);
const allAccounts = computed(() => store.accounts);

// ── Combobox (filtreli seçim) seçenekleri ──
const bankFilterOptions = computed(() => [
  { value: '', label: 'Tüm banka hesapları' },
  ...bankAccounts.value.map((b) => ({ value: b.id, label: b.accountName })),
]);
const bankAccountOptions = computed(() => [
  { value: '', label: 'Banka hesabı seçin…' },
  ...bankAccounts.value.map((b) => ({ value: b.id, label: b.accountName })),
]);
const accountSelectOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...allAccounts.value.map((a) => ({ value: a.id, label: a.accountName })),
]);
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

const filteredAccounts = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return activeAccounts.value;
  return activeAccounts.value.filter(
    (a) =>
      a.accountName.toLowerCase().includes(q) || (a.accountNumber ?? '').toLowerCase().includes(q),
  );
});

const totalBalance = computed(() =>
  activeAccounts.value.reduce((s, a) => s + Number(a.balance ?? 0), 0),
);
const todayMovementCount = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return store.movements.filter((m) => String(m.transactionDate).slice(0, 10) === today).length;
});

// ── Hesap formu ──
const showAccountForm = ref(false);
const editingAccount = ref<CashBankAccount | null>(null);
const accountForm = ref({
  accountName: '',
  accountNumber: '',
  currency: 'TRY',
  openingBalance: 0,
  description: '',
});

const openAccountForm = (acc?: CashBankAccount) => {
  editingAccount.value = acc ?? null;
  accountForm.value = acc
    ? {
        accountName: acc.accountName,
        accountNumber: acc.accountNumber ?? '',
        currency: acc.currency,
        openingBalance: Number(acc.openingBalance ?? 0),
        description: acc.description ?? '',
      }
    : { accountName: '', accountNumber: '', currency: 'TRY', openingBalance: 0, description: '' };
  formError.value = null;
  showAccountForm.value = true;
};

const saveAccount = async () => {
  formError.value = null;
  try {
    const payload: Partial<CashBankAccount> = {
      accountType: activeLedger.value,
      accountName: accountForm.value.accountName.trim(),
      accountNumber: accountForm.value.accountNumber.trim() || undefined,
      currency: accountForm.value.currency,
      openingBalance: accountForm.value.openingBalance,
      description: accountForm.value.description.trim() || undefined,
    };
    if (editingAccount.value) await store.updateAccount(editingAccount.value.id, payload);
    else await store.createAccount(payload);
    showAccountForm.value = false;
    await store.fetchAccounts();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  }
};

const removeAccount = async (id: string) => {
  if (!window.confirm('Bu hesabı silmek istediğinize emin misiniz?')) return;
  try {
    await store.deleteAccount(id);
  } catch {
    /* store hatası */
  }
};

// ── Hareket formu ──
const showMovementForm = ref(false);
const movementType = ref<'deposit' | 'withdrawal' | 'transfer'>('deposit');
const movementAccount = ref<CashBankAccount | null>(null);
const movementForm = ref({
  accountId: '',
  targetAccountId: '',
  transactionDate: new Date().toISOString().split('T')[0],
  amount: 0,
  reference: '',
  description: '',
});
const movementTitle = computed(
  () =>
    ({ deposit: 'Para Yatır', withdrawal: 'Para Çek', transfer: 'Hesaplar Arası Transfer' })[
      movementType.value
    ],
);

const openMovement = (type: 'deposit' | 'withdrawal' | 'transfer') => {
  movementType.value = type;
  movementForm.value = {
    accountId: activeAccounts.value[0]?.id ?? '',
    targetAccountId: '',
    transactionDate: new Date().toISOString().split('T')[0],
    amount: 0,
    reference: '',
    description: '',
  };
  formError.value = null;
  showMovementForm.value = true;
};

const saveMovement = async () => {
  formError.value = null;
  try {
    const f = movementForm.value;
    if (movementType.value === 'deposit') {
      await store.deposit({
        accountId: f.accountId,
        transactionDate: f.transactionDate,
        amount: f.amount,
        reference: f.reference || undefined,
        description: f.description || undefined,
      });
    } else if (movementType.value === 'withdrawal') {
      await store.withdrawal({
        accountId: f.accountId,
        transactionDate: f.transactionDate,
        amount: f.amount,
        reference: f.reference || undefined,
        description: f.description || undefined,
      });
    } else {
      await store.transfer({
        sourceAccountId: f.accountId,
        targetAccountId: f.targetAccountId,
        transactionDate: f.transactionDate,
        amount: f.amount,
        reference: f.reference || undefined,
        description: f.description || undefined,
      });
    }
    showMovementForm.value = false;
    await store.fetchAccounts();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  }
};

const viewMovements = async (acc: CashBankAccount) => {
  movementAccount.value = acc;
  store.movementFilters.accountId = acc.id;
  await store.fetchMovements();
};

// ── POS hesapları (banka hesabına bağlı) ──
const selectedBankAccountId = ref('');
const showPosForm = ref(false);
const editingPos = ref<PosAccount | null>(null);
const posForm = ref({
  bankAccountId: '',
  posLabel: '',
  terminalId: '',
  merchantNumber: '',
  commissionRate: 0,
  installmentSupported: true,
  description: '',
});

// Ekran değişimi (Kasa ↔ Banka) menü/route üzerinden yapılır; route prop'u burada izlenir.
watch(
  () => props.ledger,
  (ledger) => {
    if (!ledger) return;
    activeLedger.value = ledger;
    search.value = '';
    movementAccount.value = null;
    selectedBankAccountId.value = '';
    if (ledger === 'bank') void reloadPosAccounts();
  },
);

const reloadPosAccounts = async () => {
  await store.fetchPosAccounts(selectedBankAccountId.value || undefined);
};

const openPosForm = (pos?: PosAccount) => {
  editingPos.value = pos ?? null;
  formError.value = null;
  posForm.value = pos
    ? {
        bankAccountId: pos.bankAccountId ?? '',
        posLabel: pos.posLabel,
        terminalId: pos.terminalId ?? '',
        merchantNumber: pos.merchantNumber ?? '',
        commissionRate: Number(pos.commissionRate ?? 0),
        installmentSupported: pos.installmentSupported,
        description: pos.description ?? '',
      }
    : {
        bankAccountId: selectedBankAccountId.value || bankAccounts.value[0]?.id || '',
        posLabel: '',
        terminalId: '',
        merchantNumber: '',
        commissionRate: 0,
        installmentSupported: true,
        description: '',
      };
  showPosForm.value = true;
};

const savePos = async () => {
  formError.value = null;
  if (!posForm.value.bankAccountId) {
    formError.value = 'Banka hesabı seçin.';
    return;
  }
  try {
    const payload = {
      bankAccountId: posForm.value.bankAccountId,
      posLabel: posForm.value.posLabel.trim(),
      terminalId: posForm.value.terminalId.trim() || undefined,
      merchantNumber: posForm.value.merchantNumber.trim() || undefined,
      commissionRate: posForm.value.commissionRate,
      installmentSupported: posForm.value.installmentSupported,
      description: posForm.value.description.trim() || undefined,
    };
    if (editingPos.value) await store.updatePosAccount(editingPos.value.id, payload);
    else await store.createPosAccount(payload);
    showPosForm.value = false;
    await reloadPosAccounts();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  }
};

const removePos = async (id: string) => {
  if (!window.confirm('Bu POS hesabını silmek istediğinize emin misiniz?')) return;
  try {
    await store.deletePosAccount(id);
  } catch {
    /* store hatası */
  }
};

// ── Biçimlendirme ──
const formatMoney = (v: number | string | undefined) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(v ?? 0));
const formatDate = (d: string) =>
  d ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(d)) : '—';
const movementLabel = (t: string) =>
  ({ deposit: 'Yatırma', withdrawal: 'Çekme', transfer: 'Transfer' })[t] ?? t;
const movementBadge = (t: string) =>
  ({ deposit: 'badge-success', withdrawal: 'badge-danger', transfer: 'badge-info' })[t] ??
  'badge-neutral';

onMounted(async () => {
  // Bu ekran yalnızca kendi defter türünü listeler (sunucu tarafında filtreli).
  store.filters.accountType = activeLedger.value;
  await store.fetchAccounts();
  // Banka ekranında POS hesapları da ilk açılışta dolar.
  if (activeLedger.value === 'bank') await reloadPosAccounts();
});
</script>

<style scoped>
.inline-link {
  color: var(--c-primary, #1d4ed8);
  text-decoration: underline;
  font-weight: 600;
}

.cashbank-view {
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
  max-width: 60rem;
}
.head-actions {
  display: flex;
  gap: 0.5rem;
}

/* Sekmeler */
.tabs {
  display: flex;
  gap: 0.375rem;
  border-bottom: 2px solid var(--c-border);
  margin-bottom: 1.25rem;
}
.tabs.sub-tabs {
  border-bottom: 1px solid var(--c-border);
  margin-bottom: 1rem;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font: inherit;
  font-weight: 600;
  font-size: 0.9375rem;
  padding: 0.625rem 1rem;
  border: 0;
  background: transparent;
  color: var(--c-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.tab:hover {
  color: var(--c-primary);
}
.tab.active {
  color: var(--c-primary);
  border-bottom-color: var(--c-primary);
}
.tab:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: -2px;
}
.tab-count {
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--c-bg);
  color: var(--c-muted);
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
}
.tab.active .tab-count {
  background: #dbeafe;
  color: #1e40af;
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
  border-color: #fcd34d;
  background: #fffbeb;
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

/* Panel */
.panel {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.panel-head h2 {
  margin: 0;
  font-size: 1.125rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.panel-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.input,
.select,
.textarea {
  width: 100%;
  font: inherit;
  font-size: 0.9375rem;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: #fff;
  color: #0f172a;
}
.panel-tools .input {
  max-width: 18rem;
}
.input:focus-visible,
.select:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
  border-color: var(--c-primary);
}

/* Banka alt modülleri */
.bank-modules {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.bank-picker {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--c-border);
}
.bank-picker label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
  margin-bottom: 0.25rem;
}
.bank-picker .select {
  max-width: 22rem;
}

/* Tablo */
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
  white-space: normal;
}
.data-table .neg {
  color: #dc2626;
}
.data-table .pos {
  color: #047857;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-success {
  background: #ecfdf5;
  color: #047857;
}
.badge-warning {
  background: #fffbeb;
  color: #b45309;
}
.badge-danger {
  background: #fef2f2;
  color: #b91c1c;
}
.badge-info {
  background: #f0f9ff;
  color: #0369a1;
}
.badge-neutral {
  background: var(--c-bg);
  color: var(--c-muted);
}
.link {
  background: none;
  border: 0;
  padding: 0.25rem 0.375rem;
  font: inherit;
  font-weight: 600;
  color: var(--c-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
.link.danger {
  color: #dc2626;
}
.state-msg {
  padding: 1.5rem 1rem;
  color: var(--c-muted);
  text-align: center;
}
.state-msg.error {
  color: #dc2626;
}
.small {
  font-size: 0.8125rem;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: rgb(15 23 42 / 0.55);
  overflow-y: auto;
}
.modal-content {
  width: 100%;
  max-width: 40rem;
  background: #fff;
  border-radius: 0.875rem;
  padding: 1.5rem;
  box-shadow: 0 20px 40px -12px rgb(15 23 42 / 0.35);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.modal-head h2 {
  margin: 0;
  font-size: 1.25rem;
}
.modal-close {
  border: none;
  background: transparent;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: var(--c-muted);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
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
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
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
.modal-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 34rem) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
