<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  useChequeStore,
  type CreateChequeInput,
  type Cheque,
  type ChequeHolder,
} from '@/stores/cheque';
import { useCashBankStore } from '@/stores/cash-bank';

const store = useChequeStore();
const cashBank = useCashBankStore();
const activeTab = ref<'cheques' | 'portfolio' | 'calendar'>('cheques');
const info = ref<string | null>(null);
const today = new Date().toISOString().slice(0, 10);

const HOLDERS: ChequeHolder[] = ['own', 'bank', 'customer', 'supplier'];
const STATUS_LABELS: Record<string, string> = {
  portfolio: 'Portföy',
  endorsed: 'Ciro',
  collected: 'Tahsil',
  bounced: 'Karşılıksız',
  cancelled: 'İptal',
};
const HOLDER_LABELS: Record<string, string> = {
  own: 'Portföyde',
  bank: 'Tahsilde (Banka)',
  pledged: 'Teminatta',
  customer: 'Müşteride',
  supplier: 'Tedarikçide',
};
const TYPE_LABELS: Record<string, string> = {
  cheque: 'Çek',
  promissory: 'Senet',
};
const TRANSACTION_LABELS: Record<string, string> = {
  created: 'Oluşturuldu',
  endorsed: 'Ciro Edildi',
  collected: 'Tahsil Edildi',
  bounced: 'Karşılıksız',
  cancelled: 'İptal',
  note: 'Not',
  deposited: 'Tahsile verildi',
  pledged: 'Teminata verildi',
  released: 'Portföye geri alındı',
};

function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}

const activeCheques = computed(() =>
  store.cheques.filter((c) => c.status === 'portfolio' || c.status === 'endorsed'),
);

/** Tahsile verme yalnızca banka hesabına yapılır. */
const bankAccounts = computed(() => cashBank.accounts.filter((a) => a.accountType === 'bank'));

/** Alınan, portföydeki çek: tahsile ver / teminata ver / geri al için ön koşul. */
function isIncomingInPortfolio(c: Cheque): boolean {
  return c.direction === 'incoming' && c.status === 'portfolio';
}
function canDeposit(c: Cheque): boolean {
  return isIncomingInPortfolio(c) && c.portfolioHolder === 'own';
}
function canPledge(c: Cheque): boolean {
  return isIncomingInPortfolio(c) && c.portfolioHolder === 'own';
}
function canRelease(c: Cheque): boolean {
  return (
    isIncomingInPortfolio(c) && (c.portfolioHolder === 'bank' || c.portfolioHolder === 'pledged')
  );
}
/** Karşılıksız: alınan çek, yeri own / bank / pledged. */
function canBounce(c: Cheque): boolean {
  return c.direction === 'incoming' && ['own', 'bank', 'pledged'].includes(c.portfolioHolder);
}

async function loadCheques() {
  await store.fetchCheques({ limit: 50 });
}
async function loadPortfolio() {
  await store.fetchPortfolioSummary();
}

// --- Yeni çek ---
const showModal = ref(false);
const form = reactive<CreateChequeInput>({
  direction: 'incoming',
  cheque_type: 'cheque',
  cheque_no: '',
  drawer_name: '',
  issue_date: today,
  due_date: today,
  amount: 0,
  currency: 'TRY',
  portfolio_holder: 'own',
  description: '',
});
function resetForm() {
  Object.assign(form, {
    direction: 'incoming',
    cheque_type: 'cheque',
    cheque_no: '',
    drawer_name: '',
    issue_date: today,
    due_date: today,
    amount: 0,
    currency: 'TRY',
    portfolio_holder: 'own',
    description: '',
  });
}
async function submit() {
  info.value = null;
  try {
    await store.createCheque({ ...form, amount: Number(form.amount) });
    showModal.value = false;
    resetForm();
    await loadCheques();
    await loadPortfolio();
  } catch {
    info.value = 'Çek kaydedilemedi (alanları kontrol edin).';
  }
}

// --- Aksiyonlar (ciro / tahsil / karşılıksız / iptal) ---
type ActionKind = 'endorse' | 'collect' | 'deposit' | 'pledge' | 'release' | 'bounce' | 'cancel';
const actionModal = ref<{ kind: ActionKind; cheque: Cheque } | null>(null);
const actionForm = reactive({
  party_name: '',
  to_holder: 'supplier' as ChequeHolder,
  cash_bank_account_id: '',
  transaction_date: today,
  reason: '',
});
const actionTitle = computed(() => {
  switch (actionModal.value?.kind) {
    case 'endorse':
      return 'Çeki Ciro Et';
    case 'collect':
      return 'Çeki Tahsil Et';
    case 'bounce':
      return 'Karşılıksız İşaretle';
    case 'cancel':
      return 'Çeki İptal Et';
    case 'deposit':
      return 'Çeki Tahsile Ver';
    case 'pledge':
      return 'Çeki Teminata Ver';
    case 'release':
      return 'Çeki Portföye Geri Al';
    default:
      return '';
  }
});
function openAction(kind: ActionKind, cheque: Cheque) {
  info.value = null;
  actionModal.value = { kind, cheque };
  const accounts = kind === 'deposit' ? bankAccounts.value : cashBank.accounts;
  Object.assign(actionForm, {
    party_name: '',
    to_holder: 'supplier',
    cash_bank_account_id: accounts[0]?.id ?? '',
    transaction_date: today,
    reason: '',
  });
}

/** Durum geçmişi modal'ı — Faz 6.6 (vade takvimi + durum geçmişi görünürlüğü). */
const historyModal = ref<Cheque | null>(null);
async function openHistory(cheque: Cheque) {
  info.value = null;
  historyModal.value = cheque;
  await store.fetchTransactions(cheque.id);
}
async function submitAction() {
  const modal = actionModal.value;
  if (!modal) return;
  info.value = null;
  try {
    const { kind, cheque } = modal;
    if (kind === 'endorse') {
      await store.endorseCheque(cheque.id, {
        to_holder: actionForm.to_holder,
        party_name: actionForm.party_name,
        transaction_date: actionForm.transaction_date,
      });
    } else if (kind === 'collect') {
      await store.collectCheque(cheque.id, {
        cash_bank_account_id: actionForm.cash_bank_account_id,
        transaction_date: actionForm.transaction_date,
      });
    } else if (kind === 'deposit') {
      await store.depositCheque(cheque.id, {
        cash_bank_account_id: actionForm.cash_bank_account_id,
        transaction_date: actionForm.transaction_date,
      });
    } else if (kind === 'pledge') {
      await store.pledgeCheque(cheque.id, {
        party_name: actionForm.party_name,
        transaction_date: actionForm.transaction_date,
      });
    } else if (kind === 'release') {
      await store.releaseCheque(cheque.id, {
        transaction_date: actionForm.transaction_date,
      });
    } else if (kind === 'bounce') {
      await store.bounceCheque(cheque.id, {
        transaction_date: actionForm.transaction_date,
        reason: actionForm.reason,
      });
    } else {
      await store.cancelCheque(cheque.id, { reason: actionForm.reason });
    }
    actionModal.value = null;
    await loadCheques();
    await loadPortfolio();
  } catch {
    info.value = 'İşlem tamamlanamadı.';
  }
}

onMounted(async () => {
  await Promise.all([
    loadCheques(),
    loadPortfolio(),
    cashBank.fetchAccounts(),
    store.fetchDueCalendar(30),
  ]);
});
</script>

<template>
  <div class="cheque-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Çek / Senet</h1>
        <p class="page-sub">Portföy, ciro, tahsil, karşılıksız ve vade takibi.</p>
      </div>
    </header>

    <p v-if="info" class="alert" role="status">{{ info }}</p>
    <p v-if="store.error" class="alert alert-error" role="alert">{{ store.error }}</p>

    <nav class="tabs" aria-label="Çek sekmeleri">
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'cheques' }"
        @click="activeTab = 'cheques'"
      >
        Çekler
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'portfolio' }"
        @click="activeTab = 'portfolio'"
      >
        Portföy
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'calendar' }"
        @click="activeTab = 'calendar'"
      >
        Vade Takvimi
      </button>
    </nav>

    <section v-if="activeTab === 'cheques'" class="card">
      <div class="card-head">
        <h2 class="card-title">Çekler ({{ store.cheques.length }})</h2>
        <button type="button" class="btn btn-primary btn-sm" @click="showModal = true">
          ＋ Yeni Çek
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Çek No</th>
              <th>Yön</th>
              <th>Keşideci</th>
              <th>Vade</th>
              <th class="num">Tutar</th>
              <th>Portföy</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in store.cheques" :key="c.id">
              <td class="mono">{{ c.chequeNo }}</td>
              <td>{{ c.direction === 'incoming' ? 'Alınan' : 'Verilen' }}</td>
              <td>{{ c.drawerName }}</td>
              <td>{{ c.dueDate }}</td>
              <td class="num">{{ formatMoney(c.amount) }}</td>
              <td>{{ HOLDER_LABELS[c.portfolioHolder] ?? c.portfolioHolder }}</td>
              <td>
                <span class="pill">{{ STATUS_LABELS[c.status] ?? c.status }}</span>
              </td>
              <td class="num act">
                <template v-if="c.status === 'portfolio'">
                  <button
                    v-if="c.direction === 'incoming' && c.portfolioHolder === 'own'"
                    type="button"
                    class="btn btn-secondary btn-sm"
                    @click="openAction('endorse', c)"
                  >
                    Ciro
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    @click="openAction('collect', c)"
                  >
                    Tahsil
                  </button>
                  <button
                    v-if="canBounce(c)"
                    type="button"
                    class="btn btn-secondary btn-sm"
                    @click="openAction('bounce', c)"
                  >
                    Karşılıksız
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    @click="openAction('cancel', c)"
                  >
                    İptal
                  </button>
                </template>
                <button
                  v-if="canDeposit(c)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openAction('deposit', c)"
                >
                  Tahsile Ver
                </button>
                <button
                  v-if="canPledge(c)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openAction('pledge', c)"
                >
                  Teminata Ver
                </button>
                <button
                  v-if="canRelease(c)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openAction('release', c)"
                >
                  Portföye Geri Al
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openHistory(c)"
                >
                  Geçmiş
                </button>
              </td>
            </tr>
            <tr v-if="store.cheques.length === 0">
              <td colspan="8" class="muted">Kayıt yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="activeTab === 'portfolio'" class="card">
      <div class="card-head">
        <h2 class="card-title">Portföy Özeti</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Portföy</th>
              <th>Durum</th>
              <th class="num">Adet</th>
              <th class="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in store.portfolioSummary" :key="i">
              <td>{{ HOLDER_LABELS[s.holder] ?? s.holder }}</td>
              <td>{{ STATUS_LABELS[s.status] ?? s.status }}</td>
              <td class="num">{{ s.count }}</td>
              <td class="num">{{ formatMoney(s.totalAmount) }}</td>
            </tr>
            <tr v-if="store.portfolioSummary.length === 0">
              <td colspan="4" class="muted">Portföyde aktif çek yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">Aktif çek (portföy + ciro): {{ activeCheques.length }}</p>
    </section>

    <section v-else class="card">
      <div class="card-head">
        <h2 class="card-title">Vade Takvimi</h2>
        <span class="muted small">Portföydeki yaklaşan vadeler (önümüzdeki 30 gün)</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tür</th>
              <th>Vade</th>
              <th>Çek No</th>
              <th>Keşideci</th>
              <th>Yön</th>
              <th class="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in store.dueCalendar" :key="d.id">
              <td>{{ TYPE_LABELS[d.chequeType] ?? d.chequeType }}</td>
              <td class="mono">{{ d.dueDate }}</td>
              <td class="mono">{{ d.chequeNo }}</td>
              <td>{{ d.drawerName }}</td>
              <td>{{ d.direction === 'incoming' ? 'Alınan' : 'Verilen' }}</td>
              <td class="num">{{ formatMoney(d.amount) }}</td>
            </tr>
            <tr v-if="store.dueCalendar.length === 0">
              <td colspan="6" class="muted">Önümüzdeki 30 günde vadesi gelen aktif çek yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="showModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="chq-title">
      <div class="modal-card">
        <h2 id="chq-title" class="card-title">Yeni Çek / Senet</h2>
        <div class="grid-2">
          <label
            ><span>Yön</span
            ><select v-model="form.direction" class="select">
              <option value="incoming">Alınan</option>
              <option value="outgoing">Verilen</option>
            </select></label
          >
          <label
            ><span>Belge türü</span
            ><select v-model="form.cheque_type" class="select">
              <option value="cheque">Çek</option>
              <option value="promissory">Senet</option>
            </select></label
          >
          <label
            ><span>Çek No *</span><input v-model="form.cheque_no" class="input" maxlength="50"
          /></label>
          <label
            ><span>Keşideci *</span><input v-model="form.drawer_name" class="input" maxlength="255"
          /></label>
          <label
            ><span>Banka</span><input v-model="form.bank_name" class="input" maxlength="100"
          /></label>
          <label
            ><span>Portföy</span
            ><select v-model="form.portfolio_holder" class="select">
              <option v-for="h in HOLDERS" :key="h" :value="h">{{ HOLDER_LABELS[h] }}</option>
            </select></label
          >
          <label
            ><span>Düzenleme tarihi</span
            ><input v-model="form.issue_date" type="date" class="input"
          /></label>
          <label
            ><span>Vade tarihi</span><input v-model="form.due_date" type="date" class="input"
          /></label>
          <label
            ><span>Tutar *</span
            ><input
              v-model.number="form.amount"
              type="number"
              min="0"
              step="0.01"
              class="input num"
          /></label>
          <label
            ><span>Para birimi</span
            ><input v-model="form.currency" class="input mono" maxlength="3"
          /></label>
          <label class="full"
            ><span>Açıklama</span><input v-model="form.description" class="input" maxlength="200"
          /></label>
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm" @click="showModal = false">
            İptal
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!form.cheque_no || !form.drawer_name || !form.amount"
            @click="submit"
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="actionModal"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="act-title"
    >
      <div class="modal-card">
        <h2 id="act-title" class="card-title">
          {{ actionTitle }} — {{ actionModal.cheque.chequeNo }}
        </h2>
        <div class="grid-2">
          <template v-if="actionModal.kind === 'endorse'">
            <label
              ><span>Ciro edilen taraf *</span
              ><input v-model="actionForm.party_name" class="input" maxlength="255"
            /></label>
            <label
              ><span>Yeni portföy</span
              ><select v-model="actionForm.to_holder" class="select">
                <option v-for="h in HOLDERS" :key="h" :value="h">{{ HOLDER_LABELS[h] }}</option>
              </select></label
            >
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else-if="actionModal.kind === 'collect'">
            <label class="full"
              ><span>Tahsilat hesabı (kasa/banka) *</span>
              <select v-model="actionForm.cash_bank_account_id" class="select">
                <option value="" disabled>Seçin…</option>
                <option v-for="a in cashBank.accounts" :key="a.id" :value="a.id">
                  {{ a.accountName }} ({{ a.currency }})
                </option>
              </select>
            </label>
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else-if="actionModal.kind === 'deposit'">
            <label class="full"
              ><span>Tahsil hesabı (banka) *</span>
              <select v-model="actionForm.cash_bank_account_id" class="select">
                <option value="" disabled>Seçin…</option>
                <option v-for="a in bankAccounts" :key="a.id" :value="a.id">
                  {{ a.accountName }} ({{ a.currency }})
                </option>
              </select>
            </label>
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else-if="actionModal.kind === 'pledge'">
            <label class="full"
              ><span>Teminat alan taraf *</span
              ><input v-model="actionForm.party_name" class="input" maxlength="255"
            /></label>
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else-if="actionModal.kind === 'release'">
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else-if="actionModal.kind === 'bounce'">
            <label class="full"
              ><span>Karşılıksız nedeni *</span
              ><input v-model="actionForm.reason" class="input" maxlength="500"
            /></label>
            <label
              ><span>Tarih</span
              ><input v-model="actionForm.transaction_date" type="date" class="input"
            /></label>
          </template>
          <template v-else>
            <label class="full"
              ><span>İptal nedeni *</span
              ><input v-model="actionForm.reason" class="input" maxlength="500"
            /></label>
          </template>
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm" @click="actionModal = null">
            İptal
          </button>
          <button type="button" class="btn btn-primary btn-sm" @click="submitAction">Onayla</button>
        </div>
      </div>
    </div>

    <div
      v-if="historyModal"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chq-hist-title"
    >
      <div class="modal-card">
        <h2 id="chq-hist-title" class="card-title">Durum Geçmişi — {{ historyModal.chequeNo }}</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>İşlem</th>
                <th>Geçiş</th>
                <th class="num">Tutar</th>
                <th>Taraf</th>
                <th>Fiş</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in store.transactions" :key="t.id">
                <td class="mono">{{ t.transactionDate }}</td>
                <td>{{ TRANSACTION_LABELS[t.transactionType] ?? t.transactionType }}</td>
                <td>
                  <template v-if="t.fromStatus">{{ STATUS_LABELS[t.fromStatus] ?? t.fromStatus }} → </template
                  >{{ STATUS_LABELS[t.toStatus] ?? t.toStatus }}
                </td>
                <td class="num">{{ t.amount != null ? formatMoney(t.amount) : '—' }}</td>
                <td>{{ t.partyName ?? '—' }}</td>
                <td>{{ t.journalEntryId ? '✓' : '—' }}</td>
              </tr>
              <tr v-if="store.transactions.length === 0">
                <td colspan="6" class="muted">Durum geçmişi kaydı yok.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm" @click="historyModal = null">
            Kapat
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0;
  border-bottom: 1px solid #e5e7eb;
}
.tab {
  padding: 8px 14px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-weight: 600;
  color: #555;
}
.tab.active {
  color: var(--c-primary, #1d4ed8);
  border-bottom: 2px solid var(--c-primary, #1d4ed8);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.act {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(640px, 94vw);
  max-height: 90vh;
  overflow: auto;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0;
}
.grid-2 label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #555;
}
.grid-2 .full {
  grid-column: 1 / -1;
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.modal-actions .spacer {
  flex: 1;
}
</style>
