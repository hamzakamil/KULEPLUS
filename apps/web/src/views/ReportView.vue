<template>
  <div class="reports-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Raporlar</h1>
        <p class="page-sub">
          Tüm modüllerin canlı verisi. Modüllerde değişiklik olduğunda rapor otomatik güncellenir.
        </p>
      </div>
      <div class="page-actions">
        <span v-if="autoRefresh" class="auto-pill" :class="{ live: lastAutoRefresh }">
          <span class="dot" aria-hidden="true"></span>
          {{
            lastAutoRefresh ? `Otomatik güncellendi ${lastAutoRefresh}` : 'Otomatik yenileme açık'
          }}
        </span>
        <button type="button" class="btn btn-secondary" :disabled="loading" @click="reloadAll">
          ⟳ Yenile
        </button>
        <button type="button" class="btn btn-secondary" @click="exportCsv">⬇ CSV</button>
      </div>
    </header>

    <!-- ── Dönem + rapor seçimi ── -->
    <section class="card filter-bar" aria-labelledby="rapor-filtre">
      <h2 id="rapor-filtre" class="sr-only">Rapor filtresi</h2>
      <label class="field">
        <span>Başlangıç</span>
        <input v-model="rangeFrom" type="date" class="input" @change="onRangeChange" />
      </label>
      <label class="field">
        <span>Bitiş</span>
        <input v-model="rangeTo" type="date" class="input" @change="onRangeChange" />
      </label>
      <div class="quick-range">
        <button type="button" class="btn btn-ghost btn-sm" @click="setPreset('month')">
          Bu Ay
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="setPreset('quarter')">
          Bu Çeyrek
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="setPreset('year')">
          Bu Yıl
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="setPreset('last30')">
          Son 30 Gün
        </button>
      </div>
      <label class="field check">
        <input v-model="autoRefresh" type="checkbox" />
        <span>Otomatik yenile (10 sn)</span>
      </label>
    </section>

    <p v-if="store.liveError" class="alert alert-error" role="alert">{{ store.liveError }}</p>

    <!-- ── Rapor sekmeleri ── -->
    <nav class="report-tabs" aria-label="Rapor türleri">
      <button
        v-for="tab in LIVE_REPORTS"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: active === tab.key }"
        :title="tab.hint"
        :aria-current="active === tab.key ? 'page' : undefined"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- ── Genel Özet ── -->
    <section v-if="active === 'overview' && overview" class="report-body">
      <div class="kpi-grid">
        <article class="kpi">
          <p class="kpi-label">Satış (brüt)</p>
          <p class="kpi-value">{{ money(overview.sales.total) }}</p>
          <p class="kpi-sub">
            {{ overview.sales.document_count }} fatura · KDV {{ money(overview.sales.tax) }}
          </p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Alış (brüt)</p>
          <p class="kpi-value">{{ money(overview.purchases.total) }}</p>
          <p class="kpi-sub">
            {{ overview.purchases.document_count }} fatura · KDV {{ money(overview.purchases.tax) }}
          </p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Giderler</p>
          <p class="kpi-value">{{ money(overview.expenses.base_total) }}</p>
          <p class="kpi-sub">
            {{ overview.expenses.document_count }} kayıt ·
            {{ overview.expenses.unpaid_count }} ödenmemiş
          </p>
        </article>
        <article class="kpi" :class="overview.profit.netProfit >= 0 ? 'pos' : 'neg'">
          <p class="kpi-label">Net Sonuç (Kâr/Zarar)</p>
          <p class="kpi-value">{{ money(overview.profit.netProfit) }}</p>
          <p class="kpi-sub">
            Gelir {{ money(overview.profit.revenue) }} · Maliyet {{ money(overview.profit.cost) }}
          </p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Kasa Bakiyesi</p>
          <p class="kpi-value">{{ money(overview.cashBank.cash.balance) }}</p>
          <p class="kpi-sub">{{ overview.cashBank.cash.accounts }} kasa hesabı</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Banka Bakiyesi</p>
          <p class="kpi-value">{{ money(overview.cashBank.bank.balance) }}</p>
          <p class="kpi-sub">{{ overview.cashBank.bank.accounts }} banka hesabı</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Stok Değeri</p>
          <p class="kpi-value">{{ money(overview.stock.total_value) }}</p>
          <p class="kpi-sub">
            {{ overview.stock.product_count }} ürün · {{ overview.stock.out_of_stock }} stokta yok
          </p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Açık Belgeler</p>
          <p class="kpi-value">{{ totalOpenDocs }}</p>
          <p class="kpi-sub">
            Teklif {{ overview.counts.quotes }} · Sipariş {{ overview.counts.orders }} · İrsaliye
            {{ overview.counts.deliveries }}
          </p>
        </article>
      </div>

      <div class="two-col">
        <article class="card">
          <h3 class="card-title">Alacak / Borç Durumu</h3>
          <table class="data-table">
            <tbody>
              <tr>
                <th scope="row">Satış faturaları açık bakiye</th>
                <td class="num strong">{{ money(overview.sales.balance) }}</td>
              </tr>
              <tr>
                <th scope="row">Alış faturaları açık bakiye</th>
                <td class="num strong">{{ money(overview.purchases.balance) }}</td>
              </tr>
              <tr>
                <th scope="row">Tahsil edilen (satış)</th>
                <td class="num">{{ money(overview.sales.paid) }}</td>
              </tr>
              <tr>
                <th scope="row">Ödenen (alış)</th>
                <td class="num">{{ money(overview.purchases.paid) }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="card">
          <h3 class="card-title">Modül Hareketleri</h3>
          <table class="data-table">
            <tbody>
              <tr>
                <th scope="row">Cari hesaplar</th>
                <td class="num">{{ overview.counts.contacts }}</td>
              </tr>
              <tr>
                <th scope="row">Teklifler</th>
                <td class="num">{{ overview.counts.quotes }}</td>
              </tr>
              <tr>
                <th scope="row">Siparişler</th>
                <td class="num">{{ overview.counts.orders }}</td>
              </tr>
              <tr>
                <th scope="row">Satın alma siparişleri</th>
                <td class="num">{{ overview.counts.purchase_orders }}</td>
              </tr>
              <tr>
                <th scope="row">İrsaliyeler</th>
                <td class="num">{{ overview.counts.deliveries }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </section>

    <!-- ── Satış / Satın Alma ── -->
    <section
      v-else-if="(active === 'sales' || active === 'purchases') && invoiceReport"
      class="report-body"
    >
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Toplam</p>
          <p class="kpi-value">{{ money(invoiceReport.summary.total) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Net</p>
          <p class="kpi-value">{{ money(invoiceReport.summary.net) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">KDV</p>
          <p class="kpi-value">{{ money(invoiceReport.summary.tax) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Tahsil/Ödeme</p>
          <p class="kpi-value">{{ money(invoiceReport.summary.paid) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Açık Bakiye</p>
          <p class="kpi-value">{{ money(invoiceReport.summary.balance) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Belge Sayısı</p>
          <p class="kpi-value">{{ invoiceReport.summary.document_count }}</p>
        </article>
      </div>

      <div class="two-col">
        <article class="card">
          <h3 class="card-title">{{ active === 'sales' ? 'Müşteri' : 'Tedarikçi' }} Dağılımı</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Cari</th>
                <th scope="col" class="num">Belge</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in invoiceReport.byContact" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.document_count }}</td>
                <td class="num strong">{{ money(row.total) }}</td>
              </tr>
              <tr v-if="!invoiceReport.byContact.length">
                <td colspan="3" class="empty-cell">Bu dönemde kayıt yok.</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="card">
          <h3 class="card-title">Aylık Seyir</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Dönem</th>
                <th scope="col" class="num">Belge</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in invoiceReport.byMonth" :key="row.period">
                <td class="mono">{{ row.period }}</td>
                <td class="num">{{ row.document_count }}</td>
                <td class="num strong">{{ money(row.total) }}</td>
              </tr>
              <tr v-if="!invoiceReport.byMonth.length">
                <td colspan="3" class="empty-cell">Bu dönemde kayıt yok.</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <article v-if="active === 'sales' && salesReport?.topProducts" class="card">
        <h3 class="card-title">En Çok Satan Ürünler</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Ürün / Açıklama</th>
              <th scope="col" class="num">Miktar</th>
              <th scope="col" class="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in salesReport.topProducts" :key="row.name">
              <td>{{ row.name }}</td>
              <td class="num">{{ number(row.quantity, 2) }}</td>
              <td class="num strong">{{ money(row.total) }}</td>
            </tr>
            <tr v-if="!salesReport.topProducts.length">
              <td colspan="3" class="empty-cell">Bu dönemde ürün satışı yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <!-- ── Giderler ── -->
    <section v-else-if="active === 'expenses' && expenseReport" class="report-body">
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Toplam Gider</p>
          <p class="kpi-value">{{ money(expenseReport.summary.total) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Kayıt</p>
          <p class="kpi-value">{{ expenseReport.summary.document_count }}</p>
        </article>
        <article class="kpi pos">
          <p class="kpi-label">Ödenen</p>
          <p class="kpi-value">{{ expenseReport.summary.paid_count }}</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">Ödenmemiş</p>
          <p class="kpi-value">{{ expenseReport.summary.unpaid_count }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Kısmi</p>
          <p class="kpi-value">{{ expenseReport.summary.partial_count }}</p>
        </article>
      </div>

      <div class="two-col">
        <article class="card">
          <h3 class="card-title">Kategori Bazlı</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Kategori</th>
                <th scope="col">Grup</th>
                <th scope="col" class="num">Kayıt</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in expenseReport.byCategory" :key="row.name + (row.grup ?? '')">
                <td class="strong">{{ row.name }}</td>
                <td>
                  <span class="badge" :class="`tone-${tone(row.grup)}`">{{
                    groupLabel(row.grup)
                  }}</span>
                </td>
                <td class="num">{{ row.document_count }}</td>
                <td class="num strong">{{ money(row.total) }}</td>
              </tr>
              <tr v-if="!expenseReport.byCategory.length">
                <td colspan="4" class="empty-cell">Bu dönemde gider yok.</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="card">
          <h3 class="card-title">Grup Bazlı</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Grup</th>
                <th scope="col" class="num">Kayıt</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in expenseReport.byGroup" :key="row.grup">
                <td>
                  <span class="badge" :class="`tone-${tone(row.grup)}`">{{
                    groupLabel(row.grup)
                  }}</span>
                </td>
                <td class="num">{{ row.document_count }}</td>
                <td class="num strong">{{ money(row.total) }}</td>
              </tr>
              <tr v-if="!expenseReport.byGroup.length">
                <td colspan="3" class="empty-cell">Bu dönemde gider yok.</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <article class="card">
        <h3 class="card-title">Aylık Gider Seyri</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Dönem</th>
              <th scope="col" class="num">Kayıt</th>
              <th scope="col" class="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in expenseReport.byMonth" :key="row.period">
              <td class="mono">{{ row.period }}</td>
              <td class="num">{{ row.document_count }}</td>
              <td class="num strong">{{ money(row.total) }}</td>
            </tr>
            <tr v-if="!expenseReport.byMonth.length">
              <td colspan="3" class="empty-cell">Bu dönemde gider yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <!-- ── Kâr / Zarar ── -->
    <section v-else-if="active === 'profit-loss' && profitLoss" class="report-body">
      <div class="pl-card card">
        <table class="data-table pl-table">
          <tbody>
            <tr>
              <th scope="row">Gelir (net satış)</th>
              <td class="num">{{ money(profitLoss.revenue) }}</td>
            </tr>
            <tr>
              <th scope="row">Satılan malın maliyeti (net alış)</th>
              <td class="num neg">−{{ money(profitLoss.cogs) }}</td>
            </tr>
            <tr class="total">
              <th scope="row">Brüt Kâr</th>
              <td class="num strong">{{ money(profitLoss.grossProfit) }}</td>
            </tr>
            <tr>
              <th scope="row">Faaliyet giderleri</th>
              <td class="num neg">−{{ money(profitLoss.operatingExpenses) }}</td>
            </tr>
            <tr class="grand" :class="profitLoss.netProfit >= 0 ? 'pos' : 'neg'">
              <th scope="row">Net Sonuç</th>
              <td class="num strong">{{ money(profitLoss.netProfit) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <article class="card">
        <h3 class="card-title">Gider Grupları</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Grup</th>
              <th scope="col" class="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in profitLoss.expenseByGroup" :key="row.grup">
              <td>
                <span
                  class="badge"
                  :class="`tone-${tone(row.grup === 'grupsuz' ? null : row.grup)}`"
                >
                  {{ groupLabel(row.grup) }}
                </span>
              </td>
              <td class="num strong">{{ money(row.total) }}</td>
            </tr>
            <tr v-if="!profitLoss.expenseByGroup.length">
              <td colspan="2" class="empty-cell">Bu dönemde gider yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <!-- ── Vergi Özeti ── -->
    <section v-else-if="active === 'tax-summary' && taxSummary" class="report-body">
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Hesaplanan KDV (satış)</p>
          <p class="kpi-value">{{ money(taxSummary.outputVat) }}</p>
          <p class="kpi-sub">Matrah {{ money(taxSummary.outputBase) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">İndirilecek KDV (alış)</p>
          <p class="kpi-value">{{ money(taxSummary.inputVat) }}</p>
          <p class="kpi-sub">Matrah {{ money(taxSummary.inputBase) }}</p>
        </article>
        <article class="kpi" :class="taxSummary.vatPayable >= 0 ? 'warn' : 'pos'">
          <p class="kpi-label">Ödenecek KDV</p>
          <p class="kpi-value">{{ money(taxSummary.vatPayable) }}</p>
          <p class="kpi-sub">{{ taxSummary.vatPayable >= 0 ? 'Ödenecek' : 'Devreden' }}</p>
        </article>
      </div>

      <article class="card">
        <h3 class="card-title">KDV Oranına Göre</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Oran</th>
              <th scope="col" class="num">Matrah</th>
              <th scope="col" class="num">KDV</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in taxSummary.byRate" :key="row.tax_rate">
              <td class="strong">%{{ number(row.tax_rate, 2) }}</td>
              <td class="num">{{ money(row.base) }}</td>
              <td class="num strong">{{ money(row.tax) }}</td>
            </tr>
            <tr v-if="!taxSummary.byRate.length">
              <td colspan="3" class="empty-cell">Bu dönemde satış satırı yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <!-- ── Stok ── -->
    <section v-else-if="active === 'stock' && stockReport" class="report-body">
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Ürün Sayısı</p>
          <p class="kpi-value">{{ stockReport.summary.product_count }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Toplam Miktar</p>
          <p class="kpi-value">{{ number(stockReport.summary.total_quantity, 2) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Stok Değeri</p>
          <p class="kpi-value">{{ money(stockReport.summary.total_value) }}</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">Stokta Olmayan</p>
          <p class="kpi-value">{{ stockReport.critical.length }}</p>
        </article>
      </div>

      <div class="two-col">
        <article class="card">
          <h3 class="card-title">Depo Bazlı</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Depo</th>
                <th scope="col" class="num">Ürün</th>
                <th scope="col" class="num">Miktar</th>
                <th scope="col" class="num">Değer</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in stockReport.byWarehouse" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.product_count }}</td>
                <td class="num">{{ number(row.quantity, 2) }}</td>
                <td class="num strong">{{ money(row.total_value) }}</td>
              </tr>
              <tr v-if="!stockReport.byWarehouse.length">
                <td colspan="4" class="empty-cell">Stok bakiyesi yok.</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="card">
          <h3 class="card-title">Hareket Türleri</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Tür</th>
                <th scope="col" class="num">Hareket</th>
                <th scope="col" class="num">Değer</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in stockReport.movements" :key="row.type">
                <td class="strong">{{ movementLabel(row.type) }}</td>
                <td class="num">{{ row.movement_count }}</td>
                <td class="num">{{ money(row.total_value) }}</td>
              </tr>
              <tr v-if="!stockReport.movements.length">
                <td colspan="3" class="empty-cell">Hareket yok.</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <article class="card">
        <h3 class="card-title">Kritik Seviye (stokta yok)</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Kod</th>
              <th scope="col">Ürün</th>
              <th scope="col" class="num">Miktar</th>
              <th scope="col" class="num">Maliyet</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stockReport.critical" :key="row.code">
              <td class="mono">{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td class="num danger">{{ number(row.quantity, 2) }}</td>
              <td class="num">{{ money(row.cost_price) }}</td>
            </tr>
            <tr v-if="!stockReport.critical.length">
              <td colspan="4" class="empty-cell">Kritik seviyede ürün yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <!-- ── Kasa & Banka ── -->
    <section v-else-if="active === 'cash-bank' && cashBankReport" class="report-body">
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Kasa Toplamı</p>
          <p class="kpi-value">{{ money(cashBankReport.totals.cash.balance) }}</p>
          <p class="kpi-sub">{{ cashBankReport.totals.cash.accounts }} hesap</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Banka Toplamı</p>
          <p class="kpi-value">{{ money(cashBankReport.totals.bank.balance) }}</p>
          <p class="kpi-sub">{{ cashBankReport.totals.bank.accounts }} hesap</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">Genel Toplam</p>
          <p class="kpi-value">{{ money(cashBankReport.totals.grand) }}</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">Kalan Kredi Borcu</p>
          <p class="kpi-value">{{ money(cashBankReport.loans.remaining) }}</p>
          <p class="kpi-sub">{{ cashBankReport.loans.loan_count }} kredi</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">Kart Borcu</p>
          <p class="kpi-value">{{ money(cashBankReport.cards.current_debt) }}</p>
          <p class="kpi-sub">{{ cashBankReport.cards.card_count }} kart</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">POS Hesabı</p>
          <p class="kpi-value">{{ cashBankReport.pos.pos_count }}</p>
        </article>
      </div>

      <div class="two-col">
        <article class="card">
          <h3 class="card-title">Hesaplar</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Tür</th>
                <th scope="col">Hesap</th>
                <th scope="col">Döviz</th>
                <th scope="col" class="num">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in cashBankReport.accounts" :key="row.account_name + row.account_type">
                <td>
                  <span
                    class="badge"
                    :class="row.account_type === 'cash' ? 'tone-cyan' : 'tone-blue'"
                  >
                    {{ row.account_type === 'cash' ? 'Kasa' : 'Banka' }}
                  </span>
                </td>
                <td>{{ row.account_name }}</td>
                <td class="mono">{{ row.currency }}</td>
                <td class="num strong">{{ money(row.balance) }}</td>
              </tr>
              <tr v-if="!cashBankReport.accounts.length">
                <td colspan="4" class="empty-cell">Hesap yok.</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="card">
          <h3 class="card-title">Dönem Hareketleri</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Tür</th>
                <th scope="col" class="num">Adet</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in cashBankReport.flows" :key="row.movement_type">
                <td class="strong">{{ movementTypeLabel(row.movement_type) }}</td>
                <td class="num">{{ row.movement_count }}</td>
                <td class="num strong">{{ money(row.total) }}</td>
              </tr>
              <tr v-if="!cashBankReport.flows.length">
                <td colspan="3" class="empty-cell">Bu dönemde hareket yok.</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </section>

    <!-- ── Yaşlandırma ── -->
    <section
      v-else-if="(active === 'aged-receivable' || active === 'aged-payable') && agedReport"
      class="report-body"
    >
      <div class="kpi-grid compact">
        <article class="kpi">
          <p class="kpi-label">Toplam Açık</p>
          <p class="kpi-value">{{ money(agedReport.total) }}</p>
        </article>
        <article class="kpi pos">
          <p class="kpi-label">Vadesi Gelmemiş</p>
          <p class="kpi-value">{{ money(agedReport.buckets.current) }}</p>
        </article>
        <article class="kpi">
          <p class="kpi-label">1–30 Gün</p>
          <p class="kpi-value">{{ money(agedReport.buckets.d1_30) }}</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">31–60 Gün</p>
          <p class="kpi-value">{{ money(agedReport.buckets.d31_60) }}</p>
        </article>
        <article class="kpi warn">
          <p class="kpi-label">61–90 Gün</p>
          <p class="kpi-value">{{ money(agedReport.buckets.d61_90) }}</p>
        </article>
        <article class="kpi neg">
          <p class="kpi-label">90+ Gün</p>
          <p class="kpi-value">{{ money(agedReport.buckets.d90_plus) }}</p>
        </article>
      </div>

      <article class="card">
        <h3 class="card-title">
          {{
            agedReport.type === 'payable'
              ? 'Ödenmemiş Alış Faturaları'
              : 'Tahsil Edilmemiş Satış Faturaları'
          }}
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Belge No</th>
              <th scope="col">Cari</th>
              <th scope="col">Tarih</th>
              <th scope="col">Vade</th>
              <th scope="col" class="num">Gecikme</th>
              <th scope="col" class="num">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in agedReport.items" :key="row.number">
              <td class="mono">{{ row.number }}</td>
              <td>{{ row.contact_name }}</td>
              <td class="nowrap">{{ date(row.issue_date) }}</td>
              <td class="nowrap">{{ row.due_date ? date(row.due_date) : '—' }}</td>
              <td class="num" :class="{ danger: row.days_overdue > 0 }">
                {{ row.days_overdue > 0 ? `${row.days_overdue} gün` : '—' }}
              </td>
              <td class="num strong">{{ money(row.balance) }}</td>
            </tr>
            <tr v-if="!agedReport.items.length">
              <td colspan="6" class="empty-cell">Açık bakiye yok.</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <p v-if="store.liveLoading" class="state-msg">Hesaplanıyor…</p>
    <p v-else-if="!currentData" class="state-msg">Bu rapor için henüz veri yok.</p>

    <!-- ── Arşiv ── -->
    <section class="archive" aria-labelledby="arsiv">
      <div class="archive-head">
        <h2 id="arsiv" class="section-title">Rapor Arşivi</h2>
        <button type="button" class="btn btn-secondary btn-sm" @click="snapshot">
          Bu raporu arşivle
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Rapor Tipi</th>
              <th scope="col">Dönem</th>
              <th scope="col">Durum</th>
              <th scope="col">Oluşturma</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rep in store.reports" :key="rep.id">
              <td class="strong">{{ reportTypeLabel(rep.report_type) }}</td>
              <td>{{ date(rep.date_from) }} – {{ date(rep.date_to) }}</td>
              <td>
                <span class="badge" :class="statusClass(rep.status)">{{
                  statusLabel(rep.status)
                }}</span>
              </td>
              <td class="muted">{{ rep.generated_at ? dateTime(rep.generated_at) : '—' }}</td>
            </tr>
            <tr v-if="!store.reports.length && !store.loading">
              <td colspan="4" class="empty-cell">Henüz arşivlenmiş rapor yok.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  LIVE_REPORTS,
  useReportStore,
  type LiveReportKey,
  type OverviewReport,
  type ReportStatus,
  type ReportType,
} from '@/stores/report';

interface InvoiceSummaryRow {
  total: number;
  net: number;
  tax: number;
  discount?: number;
  paid: number;
  balance: number;
  document_count: number;
}
interface NamedAmountRow {
  name: string;
  document_count: number;
  total: number;
}
interface PeriodRow {
  period: string;
  document_count: number;
  total: number;
}
interface InvoiceReportData {
  range: { from: string; to: string };
  summary: InvoiceSummaryRow;
  byContact: NamedAmountRow[];
  byMonth: PeriodRow[];
  topProducts?: TopProductRow[];
}
interface TopProductRow {
  name: string;
  quantity: number;
  total: number;
}
interface ExpenseReportData {
  summary: {
    total: number;
    document_count: number;
    paid_count: number;
    unpaid_count: number;
    partial_count: number;
  };
  byCategory: { name: string; grup: string | null; document_count: number; total: number }[];
  byGroup: { grup: string; document_count: number; total: number }[];
  byMonth: PeriodRow[];
}
interface ProfitLossData {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  expenseByGroup: { grup: string; total: number }[];
}
interface TaxSummaryData {
  outputVat: number;
  outputBase: number;
  inputVat: number;
  inputBase: number;
  vatPayable: number;
  byRate: { tax_rate: number; tax: number; base: number }[];
}
interface StockReportData {
  summary: { product_count: number; total_quantity: number; total_value: number };
  byWarehouse: { name: string; product_count: number; quantity: number; total_value: number }[];
  critical: {
    code: string;
    name: string;
    quantity: number;
    cost_price: number;
    total_value: number;
  }[];
  movements: { type: string; movement_count: number; total_value: number }[];
}
interface CashBankReportData {
  accounts: { account_type: string; account_name: string; currency: string; balance: number }[];
  totals: {
    cash: { accounts: number; balance: number };
    bank: { accounts: number; balance: number };
    grand: number;
  };
  flows: { movement_type: string; total: number; movement_count: number }[];
  loans: { loan_count: number; principal: number; remaining: number; paid_installments: number };
  cards: {
    card_count: number;
    credit_limit: number;
    current_debt: number;
    available_limit: number;
  };
  pos: { pos_count: number };
}
interface AgedReportData {
  type: 'receivable' | 'payable';
  total: number;
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  items: {
    number: string;
    contact_name: string;
    issue_date: string;
    due_date: string | null;
    days_overdue: number;
    balance: number;
  }[];
}

const store = useReportStore();
const active = ref<LiveReportKey>('overview');
const autoRefresh = ref(true);
const lastAutoRefresh = ref<string | null>(null);

const rangeFrom = ref(store.range.dateFrom);
const rangeTo = ref(store.range.dateTo);

const loading = computed(() => store.liveLoading);
const overview = computed(() => store.overview);
const salesReport = computed(() => store.liveData.sales as InvoiceReportData | undefined);
const purchaseReport = computed(() => store.liveData.purchases as InvoiceReportData | undefined);
const invoiceReport = computed(() =>
  active.value === 'purchases' ? purchaseReport.value : salesReport.value,
);
const expenseReport = computed(() => store.liveData.expenses as ExpenseReportData | undefined);
const profitLoss = computed(() => store.liveData['profit-loss'] as ProfitLossData | undefined);
const taxSummary = computed(() => store.liveData['tax-summary'] as TaxSummaryData | undefined);
const stockReport = computed(() => store.liveData.stock as StockReportData | undefined);
const cashBankReport = computed(
  () => store.liveData['cash-bank'] as CashBankReportData | undefined,
);
const agedReport = computed(() => {
  const key: LiveReportKey = active.value === 'aged-payable' ? 'aged-payable' : 'aged-receivable';
  return store.liveData[key] as AgedReportData | undefined;
});

/** Aktif sekmenin verisi yüklendi mi? */
const currentData = computed(() => {
  switch (active.value) {
    case 'overview':
      return overview.value;
    case 'sales':
      return salesReport.value;
    case 'purchases':
      return purchaseReport.value;
    case 'expenses':
      return expenseReport.value;
    case 'profit-loss':
      return profitLoss.value;
    case 'tax-summary':
      return taxSummary.value;
    case 'stock':
      return stockReport.value;
    case 'cash-bank':
      return cashBankReport.value;
    default:
      return agedReport.value;
  }
});

const totalOpenDocs = computed(() => {
  const c = overview.value?.counts;
  if (!c) return 0;
  return c.quotes + c.orders + c.purchase_orders + c.deliveries;
});

// ── Yükleme ──

/** Özet kartları için gerekli sekmeler (arşiv değil, canlı). */
const OVERVIEW_DEPS: LiveReportKey[] = ['overview'];

const loadActive = async () => {
  await store.fetchLive(active.value);
  if (active.value === 'overview') {
    // Özet sekmesi için de güncel hazırlık verisi
    await store.fetchLive('sales');
  }
};

const reloadAll = async () => {
  await store.fetchLiveMany([...new Set([active.value, ...OVERVIEW_DEPS])]);
  await store.fetchReports();
};

const selectTab = async (key: LiveReportKey) => {
  active.value = key;
  await store.fetchLive(key);
};

const onRangeChange = async () => {
  store.setRange(rangeFrom.value, rangeTo.value);
  await store.fetchLive(active.value);
  if (active.value !== 'overview') await store.fetchLive('overview');
};

const setPreset = async (preset: 'month' | 'quarter' | 'year' | 'last30') => {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  let from = iso(now);
  if (preset === 'month') from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  else if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3) * 3;
    from = iso(new Date(now.getFullYear(), q, 1));
  } else if (preset === 'year') from = `${now.getFullYear()}-01-01`;
  else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    from = iso(d);
  }
  rangeFrom.value = from;
  rangeTo.value = iso(now);
  await onRangeChange();
};

const snapshot = async () => {
  const map: Partial<Record<LiveReportKey, ReportType>> = {
    'profit-loss': 'profit_loss',
    'tax-summary': 'tax_summary',
    'cash-bank': 'cash_flow',
    'aged-receivable': 'aged_receivable',
    'aged-payable': 'aged_payable',
  };
  const reportType = map[active.value] ?? 'profit_loss';
  try {
    await store.generateReport({
      reportType,
      dateFrom: rangeFrom.value,
      dateTo: rangeTo.value,
    });
  } catch {
    /* hata store'da */
  }
};

// ── Otomatik yenileme: modüllerde değişiklik varsa rapor tazelenir ──
let timer: ReturnType<typeof setInterval> | null = null;

const tick = async () => {
  const changed = await store.refreshIfStale();
  if (!changed) return;
  await store.fetchLive(active.value);
  if (active.value !== 'overview') await store.fetchLive('overview');
  lastAutoRefresh.value = new Date().toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

watch(autoRefresh, (on) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (on) timer = setInterval(() => void tick(), 10_000);
});

onMounted(async () => {
  await reloadAll();
  if (autoRefresh.value) timer = setInterval(() => void tick(), 10_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// ── Biçimlendirme yardımcıları ──

const money = (value: number | undefined) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  }).format(value ?? 0);

const number = (value: number | undefined, digits = 2) =>
  new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value ?? 0);

const date = (value: string | Date | null | undefined) =>
  value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(value)) : '—';

const dateTime = (value: string | Date | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';

const GROUP_LABELS: Record<string, string> = {
  kira: 'Kira',
  'kamu-hizmetleri': 'Kamu Hizmetleri',
  isletme: 'İşletme',
  personel: 'Personel',
  mevzuat: 'Hukuk & Resmi',
  finansal: 'Vergi & Resmi',
  grupsuz: 'Grupsuz',
};

const groupLabel = (grup: string | null | undefined) =>
  GROUP_LABELS[grup ?? ''] ?? grup ?? 'Grupsuz';

const tone = (grup?: string | null): string => {
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

const movementLabel = (type: string) =>
  ({ in: 'Giriş', out: 'Çıkış', adjustment: 'Düzeltme', transfer: 'Transfer' })[type] ?? type;

const movementTypeLabel = (type: string) =>
  ({ deposit: 'Tahsilat / Giriş', withdrawal: 'Ödeme / Çıkış', transfer: 'Virman' })[type] ?? type;

const reportTypeLabel = (type: ReportType) =>
  ({
    profit_loss: 'Kâr / Zarar',
    balance_sheet: 'Bilanço',
    tax_summary: 'Vergi Özeti',
    cash_flow: 'Nakit Akışı',
    aged_payable: 'Vadesi Geçen Borç',
    aged_receivable: 'Vadesi Geçen Alacak',
  })[type] ?? type;

const statusLabel = (status: ReportStatus) =>
  ({ generating: 'Oluşturuluyor', completed: 'Tamamlandı', failed: 'Başarısız' })[status] ?? status;

const statusClass = (status: ReportStatus) =>
  ({ generating: 'badge-warning', completed: 'badge-success', failed: 'badge-danger' })[status] ??
  'badge-neutral';

/** Aktif sekmenin tablo verisini CSV olarak indirir. */
const exportCsv = () => {
  const data = currentData.value as OverviewReport | undefined;
  if (!data) return;
  const rows: string[][] = [];
  const flatten = (obj: unknown, prefix = '') => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`));
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        flatten(v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }
    rows.push([prefix, String(obj)]);
  };
  flatten(data);
  const csv = ['Alan;Değer', ...rows.map((r) => `${r[0]};${r[1]}`)].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rapor-${active.value}-${rangeFrom.value}_${rangeTo.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
</script>

<style scoped>
.reports-view {
  max-width: 96rem;
  margin-inline: auto;
  padding: 1.5rem;
  --c-border: #e2e8f0;
  --c-muted: #64748b;
}
.page-sub {
  margin: 0.25rem 0 0;
  color: var(--c-muted);
  font-size: 0.9375rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.auto-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: #475569;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 0.25rem 0.625rem;
}
.auto-pill .dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #22c55e;
}
.auto-pill.live {
  background: #dcfce7;
  color: #166534;
}

/* ── Filtre çubuğu ── */
.filter-bar {
  display: flex;
  align-items: flex-end;
  gap: 0.875rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
  padding: 0.875rem 1.125rem;
}
.filter-bar .field {
  display: grid;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
}
.filter-bar .field.check {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 500;
  padding-bottom: 0.25rem;
}
.quick-range {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
  padding-bottom: 0.125rem;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--c-border);
  color: #334155;
  border-radius: 0.5rem;
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.btn-ghost:hover {
  border-color: #1d4ed8;
  color: #1d4ed8;
  background: #eff6ff;
}

/* ── Sekmeler ── */
.report-tabs {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  border-bottom: 2px solid var(--c-border);
  margin-bottom: 1.25rem;
}
.report-tabs .tab {
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.5rem 0.875rem;
  border: none;
  background: transparent;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  color: #475569;
  border-radius: 0.375rem 0.375rem 0 0;
}
.report-tabs .tab:hover {
  background: #f1f5f9;
  color: #1d4ed8;
}
.report-tabs .tab.active {
  color: #1d4ed8;
  border-bottom-color: #1d4ed8;
  font-weight: 700;
  background: #eff6ff;
}

/* ── KPI kartları ── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.875rem;
  margin-bottom: 1.25rem;
}
.kpi-grid.compact {
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
}
.kpi {
  background: #fff;
  border: 1px solid var(--c-border);
  border-left: 4px solid #cbd5e1;
  border-radius: 0.625rem;
  padding: 0.875rem 1rem;
}
.kpi.pos {
  border-left-color: #16a34a;
}
.kpi.neg {
  border-left-color: #dc2626;
}
.kpi.warn {
  border-left-color: #d97706;
}
.kpi-label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.kpi-value {
  margin: 0.375rem 0 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
}
.kpi-sub {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--c-muted);
}

.report-body {
  display: grid;
  gap: 1.25rem;
}
.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: 1.25rem;
}
.card-title {
  font-size: 1rem;
  margin: 0 0 0.75rem;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.danger {
  color: #dc2626;
}
.neg {
  color: #dc2626;
}
.nowrap {
  white-space: nowrap;
}

/* ── Kâr/Zarar tablosu ── */
.pl-table th[scope='row'] {
  font-weight: 500;
  color: #334155;
  text-align: left;
}
.pl-table tr.total th,
.pl-table tr.total td {
  font-weight: 700;
  background: #f8fafc;
}
.pl-table tr.grand th,
.pl-table tr.grand td {
  font-weight: 800;
  background: #eff6ff;
}
.pl-table tr.grand.pos td {
  color: #15803d;
}
.pl-table tr.grand.neg td {
  color: #b91c1c;
}

/* ── Arşiv ── */
.archive {
  margin-top: 2rem;
}
.archive-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.section-title {
  font-size: 1.0625rem;
  margin: 0;
}
</style>
