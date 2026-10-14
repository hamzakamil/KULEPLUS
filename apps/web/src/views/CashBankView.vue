<template>
  <div class="cashbank-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ activeLedger === 'cash' ? 'Kasa' : 'Banka' }}</h1>
        <p class="page-sub">
          <template v-if="activeLedger === 'cash'">
            Nakit kasalar bu ekranda ayrı yönetilir. Banka hesapları, krediler, kredi kartları ve
            POS için <RouterLink class="inline-link" to="/bank">Banka</RouterLink> ekranına geçin.
          </template>
          <template v-else>
            Banka hesapları bu ekranda ayrı yönetilir; krediler, kredi kartları ve POS hesapları
            burada bulunur. Nakit için
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
        <div class="kpi" :class="{ warn: totalRemainingLoan > 0 }">
          <span class="kpi-label">Kalan Kredi Borcu</span>
          <span class="kpi-value">{{ formatMoney(totalRemainingLoan) }}</span>
        </div>
        <div class="kpi" :class="{ warn: totalCardDebt > 0 }">
          <span class="kpi-label">Kredi Kartı Borcu</span>
          <span class="kpi-value">{{ formatMoney(totalCardDebt) }}</span>
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

    <!-- ── Banka alt modülleri ── -->
    <section v-if="activeLedger === 'bank'" class="bank-modules">
      <div class="tabs sub-tabs" role="tablist" aria-label="Banka alt modülleri">
        <button
          v-for="m in bankModules"
          :key="m.key"
          class="tab"
          role="tab"
          :aria-selected="activeBankModule === m.key"
          :class="{ active: activeBankModule === m.key }"
          @click="switchBankModule(m.key)"
        >
          <span aria-hidden="true">{{ m.icon }}</span> {{ m.label }}
        </button>
      </div>

      <!-- Banka hesabı seçici (modüller hesaba bağlıdır) -->
      <div class="bank-picker">
        <label for="bank-acc">Banka Hesabı</label>
        <FilterableSelect
          id="bank-acc"
          v-model="selectedBankAccountId"
          :options="bankFilterOptions"
          placeholder="Tüm banka hesapları"
          @select="reloadBankModule"
        />
        <button
          class="btn btn-primary btn-sm"
          :disabled="!selectedBankAccountId"
          @click="openBankModuleForm()"
        >
          + {{ bankModuleLabel }}
        </button>
      </div>

      <!-- Krediler -->
      <div v-if="activeBankModule === 'loans'" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Banka</th>
              <th scope="col">Kredi No</th>
              <th scope="col">Tür</th>
              <th scope="col" class="num">Anapara</th>
              <th scope="col" class="num">Faiz %</th>
              <th scope="col" class="num">Taksit</th>
              <th scope="col" class="num">Kalan Borç</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in store.bankLoans" :key="l.id">
              <td>{{ l.bankAccountName || '—' }}</td>
              <td class="mono muted">{{ l.loanNumber || '—' }}</td>
              <td>
                <span class="badge badge-info">{{ loanTypeLabel(l.loanType) }}</span>
              </td>
              <td class="num">{{ formatMoney(l.principal) }}</td>
              <td class="num">{{ l.interestRate }}</td>
              <td class="num">{{ l.paidInstallments }} / {{ l.totalInstallments }}</td>
              <td class="num strong">{{ formatMoney(l.remainingBalance) }}</td>
              <td>
                <span
                  class="badge"
                  :class="l.status === 'active' ? 'badge-warning' : 'badge-success'"
                >
                  {{
                    l.status === 'active'
                      ? 'Aktif'
                      : l.status === 'overdue'
                        ? 'Gecikmiş'
                        : 'Kapandı'
                  }}
                </span>
              </td>
              <td class="num actions">
                <button class="link" @click="openBankModuleForm(l)">Düzenle</button>
                <button class="link danger" @click="removeBankRow('loans', l.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!store.bankLoans.length">
              <td colspan="9" class="empty-cell">Kredi kaydı yok.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Kredi Kartları -->
      <div v-else-if="activeBankModule === 'cards'" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Banka</th>
              <th scope="col">Kart</th>
              <th scope="col">Network</th>
              <th scope="col" class="num">Limit</th>
              <th scope="col" class="num">Borç</th>
              <th scope="col" class="num">Kullanılabilir</th>
              <th scope="col">Son Ödeme</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in store.creditCards" :key="c.id">
              <td>{{ c.bankAccountName || '—' }}</td>
              <td class="strong">
                {{ c.cardLabel }}
                <span v-if="c.cardNumberLast4" class="mono muted"
                  >•••• {{ c.cardNumberLast4 }}</span
                >
              </td>
              <td class="muted">{{ c.cardNetwork || '—' }}</td>
              <td class="num">{{ formatMoney(c.creditLimit) }}</td>
              <td class="num" :class="{ neg: Number(c.currentDebt) > 0 }">
                {{ formatMoney(c.currentDebt) }}
              </td>
              <td class="num strong">{{ formatMoney(c.availableLimit) }}</td>
              <td class="muted">{{ c.dueDay ? c.dueDay + '. gün' : '—' }}</td>
              <td class="num actions">
                <button class="link" @click="openBankModuleForm(c)">Düzenle</button>
                <button class="link danger" @click="removeBankRow('cards', c.id)">Sil</button>
              </td>
            </tr>
            <tr v-if="!store.creditCards.length">
              <td colspan="8" class="empty-cell">Kredi kartı kaydı yok.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- POS Hesapları -->
      <div v-else class="table-wrap">
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
                <button class="link" @click="openBankModuleForm(p)">Düzenle</button>
                <button class="link danger" @click="removeBankRow('pos', p.id)">Sil</button>
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

    <!-- ── Banka alt modül formu (kredi / kart / POS) ── -->
    <div v-if="showBankForm" class="modal-backdrop" @click.self="showBankForm = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>
            {{ editingBankRow ? 'Düzenle' : bankModuleLabel }}
            <span class="muted small">— {{ selectedBankName }}</span>
          </h2>
          <button class="modal-close" aria-label="Kapat" @click="showBankForm = false">×</button>
        </div>

        <!-- Kredi formu -->
        <form
          v-if="activeBankModule === 'loans'"
          class="form-grid"
          @submit.prevent="saveBankModule"
        >
          <div>
            <label class="field-label" for="ln-type">Kredi Türü</label>
            <FilterableSelect
              id="ln-type"
              v-model="loanForm.loanType"
              :options="LOAN_TYPE_OPTIONS"
              placeholder="Kredi türü seçin"
            />
          </div>
          <div>
            <label class="field-label" for="ln-no">Kredi No</label>
            <input id="ln-no" v-model="loanForm.loanNumber" class="input" />
          </div>
          <div>
            <label class="field-label" for="ln-principal">Anapara *</label>
            <input
              id="ln-principal"
              v-model.number="loanForm.principal"
              type="number"
              step="0.01"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="ln-rate">Faiz Oranı (%)</label>
            <input
              id="ln-rate"
              v-model.number="loanForm.interestRate"
              type="number"
              step="0.01"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="ln-count">Taksit Sayısı</label>
            <input
              id="ln-count"
              v-model.number="loanForm.totalInstallments"
              type="number"
              min="1"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="ln-inst">Taksit Tutarı</label>
            <input
              id="ln-inst"
              v-model.number="loanForm.installmentAmount"
              type="number"
              step="0.01"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="ln-start">Başlangıç *</label>
            <input id="ln-start" v-model="loanForm.startDate" type="date" class="input" required />
          </div>
          <div>
            <label class="field-label" for="ln-end">Bitiş</label>
            <input id="ln-end" v-model="loanForm.endDate" type="date" class="input" />
          </div>
          <div class="form-field-full">
            <label class="field-label" for="ln-desc">Açıklama</label>
            <input id="ln-desc" v-model="loanForm.description" class="input" />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showBankForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.loading">Kaydet</button>
          </div>
        </form>

        <!-- Kredi kartı formu -->
        <form
          v-else-if="activeBankModule === 'cards'"
          class="form-grid"
          @submit.prevent="saveBankModule"
        >
          <div>
            <label class="field-label" for="cc-label">Kart Adı *</label>
            <input id="cc-label" v-model="cardForm.cardLabel" class="input" required />
          </div>
          <div>
            <label class="field-label" for="cc-last4">Son 4 Hane</label>
            <input
              id="cc-last4"
              v-model="cardForm.cardNumberLast4"
              class="input"
              maxlength="4"
              inputmode="numeric"
            />
          </div>
          <div>
            <label class="field-label" for="cc-net">Kart Network</label>
            <FilterableSelect
              id="cc-net"
              v-model="cardForm.cardNetwork"
              :options="CARD_NETWORK_OPTIONS"
              placeholder="Seçiniz…"
            />
          </div>
          <div>
            <label class="field-label" for="cc-limit">Kredi Limiti *</label>
            <input
              id="cc-limit"
              v-model.number="cardForm.creditLimit"
              type="number"
              step="0.01"
              class="input"
              required
            />
          </div>
          <div>
            <label class="field-label" for="cc-debt">Güncel Borç</label>
            <input
              id="cc-debt"
              v-model.number="cardForm.currentDebt"
              type="number"
              step="0.01"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="cc-state">Hesap Kesim Günü</label>
            <input
              id="cc-state"
              v-model.number="cardForm.statementDay"
              type="number"
              min="1"
              max="31"
              class="input"
            />
          </div>
          <div>
            <label class="field-label" for="cc-due">Son Ödeme Günü</label>
            <input
              id="cc-due"
              v-model.number="cardForm.dueDay"
              type="number"
              min="1"
              max="31"
              class="input"
            />
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showBankForm = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="store.loading">Kaydet</button>
          </div>
        </form>

        <!-- POS formu -->
        <form v-else class="form-grid" @submit.prevent="saveBankModule">
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
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showBankForm = false">
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
  type BankLoan,
  type CreditCard,
  type PosAccount,
} from '@/stores/cash-bank';

const store = useCashBankStore();

// Route prop'u bu ekranın hangi türü gösterdiğini belirler: 'cash' → Kasa, 'bank' → Banka.
// Kasa ve banka ayrı ekranlardır (apps/web/src/router/index.ts → /cash ve /bank).
const props = defineProps<{ ledger?: 'cash' | 'bank' }>();

// ── Bu ekranın defter türü (kasa / banka) ──
const activeLedger = ref<'cash' | 'bank'>(props.ledger ?? 'cash');
const activeBankModule = ref<'loans' | 'cards' | 'pos'>('loans');
const search = ref('');

const bankModules = [
  { key: 'loans' as const, label: 'Banka Kredileri', icon: '🏦' },
  { key: 'cards' as const, label: 'Kredi Kartları', icon: '💳' },
  { key: 'pos' as const, label: 'POS Hesapları', icon: '🧾' },
];

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
const accountSelectOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...allAccounts.value.map((a) => ({ value: a.id, label: a.accountName })),
]);
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];
const LOAN_TYPE_OPTIONS = [
  { value: 'term', label: 'Vadeli (Taksitli)' },
  { value: 'revolving', label: 'Rotatif' },
  { value: 'overdraft', label: 'Açık Kredi (KMH)' },
  { value: 'mortgage', label: 'İpotekli' },
];
const CARD_NETWORK_OPTIONS = [
  { value: '', label: 'Seçiniz…' },
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'troy', label: 'Troy' },
  { value: 'amex', label: 'Amex' },
  { value: 'other', label: 'Diğer' },
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
const totalRemainingLoan = computed(() =>
  store.bankLoans.reduce((s, l) => s + Number(l.remainingBalance ?? 0), 0),
);
const totalCardDebt = computed(() =>
  store.creditCards.reduce((s, c) => s + Number(c.currentDebt ?? 0), 0),
);
const todayMovementCount = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return store.movements.filter((m) => String(m.transactionDate).slice(0, 10) === today).length;
});
const selectedBankName = computed(
  () => bankAccounts.value.find((b) => b.id === selectedBankAccountId.value)?.accountName ?? 'Tümü',
);
const bankModuleLabel = computed(
  () => ({ loans: 'Kredi Ekle', cards: 'Kart Ekle', pos: 'POS Ekle' })[activeBankModule.value],
);

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

// ── Banka alt modülleri ──
const selectedBankAccountId = ref('');
const showBankForm = ref(false);
const editingBankRow = ref<{ id: string } | null>(null);
const formError = ref<string | null>(null);

const loanForm = ref({
  loanType: 'term' as BankLoan['loanType'],
  loanNumber: '',
  principal: 0,
  interestRate: 0,
  totalInstallments: 12,
  installmentAmount: 0,
  startDate: new Date().toISOString().split('T')[0],
  endDate: '',
  description: '',
});
const cardForm = ref({
  cardLabel: '',
  cardNumberLast4: '',
  cardNetwork: '' as CreditCard['cardNetwork'] | '',
  creditLimit: 0,
  currentDebt: 0,
  statementDay: undefined as number | undefined,
  dueDay: undefined as number | undefined,
});
const posForm = ref({
  posLabel: '',
  terminalId: '',
  merchantNumber: '',
  commissionRate: 0,
  installmentSupported: true,
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
    if (ledger === 'bank') reloadBankModule();
  },
);

const switchBankModule = (key: 'loans' | 'cards' | 'pos') => {
  activeBankModule.value = key;
  reloadBankModule();
};

const reloadBankModule = async () => {
  const accId = selectedBankAccountId.value || undefined;
  if (activeBankModule.value === 'loans') await store.fetchBankLoans(accId);
  else if (activeBankModule.value === 'cards') await store.fetchCreditCards(accId);
  else await store.fetchPosAccounts(accId);
};

const openBankModuleForm = (row?: BankLoan | CreditCard | PosAccount) => {
  editingBankRow.value = row ? { id: row.id } : null;
  formError.value = null;
  if (activeBankModule.value === 'loans') {
    const l = row as BankLoan | undefined;
    loanForm.value = l
      ? {
          loanType: l.loanType,
          loanNumber: l.loanNumber ?? '',
          principal: l.principal,
          interestRate: l.interestRate,
          totalInstallments: l.totalInstallments,
          installmentAmount: l.installmentAmount,
          startDate: String(l.startDate).slice(0, 10),
          endDate: l.endDate ? String(l.endDate).slice(0, 10) : '',
          description: l.description ?? '',
        }
      : {
          loanType: 'term',
          loanNumber: '',
          principal: 0,
          interestRate: 0,
          totalInstallments: 12,
          installmentAmount: 0,
          startDate: new Date().toISOString().split('T')[0],
          endDate: '',
          description: '',
        };
  } else if (activeBankModule.value === 'cards') {
    const c = row as CreditCard | undefined;
    cardForm.value = c
      ? {
          cardLabel: c.cardLabel,
          cardNumberLast4: c.cardNumberLast4 ?? '',
          cardNetwork: c.cardNetwork ?? '',
          creditLimit: c.creditLimit,
          currentDebt: c.currentDebt,
          statementDay: c.statementDay ?? undefined,
          dueDay: c.dueDay ?? undefined,
        }
      : {
          cardLabel: '',
          cardNumberLast4: '',
          cardNetwork: '',
          creditLimit: 0,
          currentDebt: 0,
          statementDay: undefined,
          dueDay: undefined,
        };
  } else {
    const p = row as PosAccount | undefined;
    posForm.value = p
      ? {
          posLabel: p.posLabel,
          terminalId: p.terminalId ?? '',
          merchantNumber: p.merchantNumber ?? '',
          commissionRate: p.commissionRate,
          installmentSupported: p.installmentSupported,
        }
      : {
          posLabel: '',
          terminalId: '',
          merchantNumber: '',
          commissionRate: 0,
          installmentSupported: true,
        };
  }
  showBankForm.value = true;
};

const saveBankModule = async () => {
  formError.value = null;
  const bankAccountId = selectedBankAccountId.value;
  if (!bankAccountId) {
    formError.value = 'Önce bir banka hesabı seçin.';
    return;
  }
  try {
    if (activeBankModule.value === 'loans') {
      const payload = { bankAccountId, ...loanForm.value };
      if (editingBankRow.value) await store.updateBankLoan(editingBankRow.value.id, payload);
      else await store.createBankLoan(payload);
    } else if (activeBankModule.value === 'cards') {
      const payload = {
        bankAccountId,
        ...cardForm.value,
        cardNetwork: cardForm.value.cardNetwork || undefined,
      };
      if (editingBankRow.value) await store.updateCreditCard(editingBankRow.value.id, payload);
      else await store.createCreditCard(payload);
    } else {
      const payload = { bankAccountId, ...posForm.value };
      if (editingBankRow.value) await store.updatePosAccount(editingBankRow.value.id, payload);
      else await store.createPosAccount(payload);
    }
    showBankForm.value = false;
    await reloadBankModule();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.';
  }
};

const removeBankRow = async (kind: 'loans' | 'cards' | 'pos', id: string) => {
  if (!window.confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  try {
    if (kind === 'loans') await store.deleteBankLoan(id);
    else if (kind === 'cards') await store.deleteCreditCard(id);
    else await store.deletePosAccount(id);
  } catch {
    /* store hatası */
  }
};

// ── Biçimlendirme ──
const formatMoney = (v: number | string | undefined) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(v ?? 0));
const formatDate = (d: string) =>
  d ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(d)) : '—';
const loanTypeLabel = (t: string) =>
  ({ term: 'Vadeli', revolving: 'Rotatif', overdraft: 'KMH', mortgage: 'İpotekli' })[t] ?? t;
const movementLabel = (t: string) =>
  ({ deposit: 'Yatırma', withdrawal: 'Çekme', transfer: 'Transfer' })[t] ?? t;
const movementBadge = (t: string) =>
  ({ deposit: 'badge-success', withdrawal: 'badge-danger', transfer: 'badge-info' })[t] ??
  'badge-neutral';

onMounted(async () => {
  // Bu ekran yalnızca kendi defter türünü listeler (sunucu tarafında filtreli).
  store.filters.accountType = activeLedger.value;
  await store.fetchAccounts();
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
