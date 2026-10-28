<template>
  <div class="invoices-workspace">
    <!-- ── Bildirim (kesinleştirme / iptal sonucu) ── -->
    <div
      v-if="notice"
      class="alert"
      :class="notice.kind === 'error' ? 'alert-error' : 'alert-success'"
      role="alert"
    >
      {{ notice.text }}
    </div>

    <!-- ── ÜST: Master liste ── -->
    <section class="master-panel" aria-label="Fatura listesi">
      <header class="master-header">
        <div class="master-title">
          <h2>Faturalar</h2>
          <span v-if="pagination.total" class="count">{{ pagination.total }}</span>
        </div>
        <div class="master-actions">
          <button class="btn btn-primary btn-sm" @click="startNew('sales')">
            + Satış Faturası
          </button>
          <button class="btn btn-secondary btn-sm" @click="startNew('purchase')">
            + Alış Faturası
          </button>
        </div>
      </header>

      <div class="filters">
        <input
          v-model="searchQuery"
          type="search"
          class="search-input"
          placeholder="Fatura no, not ara…"
          aria-label="Fatura ara"
          @keyup.enter="applyFilters"
        />
        <FilterableSelect
          v-model="typeFilter"
          :options="INVOICE_TYPE_FILTER_OPTIONS"
          class="type-select"
          placeholder="Tümü"
          aria-label="Tip filtresi"
          @select="applyFilters"
        />
        <FilterableSelect
          v-model="statusFilter"
          :options="INVOICE_STATUS_FILTER_OPTIONS"
          class="type-select"
          placeholder="Tüm Durumlar"
          aria-label="Durum filtresi"
          @select="applyFilters"
        />
        <input
          v-model="dateFrom"
          type="date"
          class="search-input date"
          aria-label="Başlangıç tarihi"
          @change="applyFilters"
        />
        <input
          v-model="dateTo"
          type="date"
          class="search-input date"
          aria-label="Bitiş tarihi"
          @change="applyFilters"
        />
      </div>

      <div class="list-wrap">
        <table class="data-table master-table">
          <thead>
            <tr>
              <th scope="col">Fatura No</th>
              <th scope="col">Tip</th>
              <th scope="col">Tarih</th>
              <th scope="col">Vade</th>
              <th scope="col">Cari</th>
              <th scope="col" class="num">Toplam</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="invoice in invoices"
              :key="invoice.id"
              :class="{ active: selectedId === invoice.id }"
              tabindex="0"
              @click="selectInvoice(invoice.id)"
              @keydown.enter="selectInvoice(invoice.id)"
              @keydown.space.prevent="selectInvoice(invoice.id)"
            >
              <td class="mono">{{ invoice.number }}</td>
              <td>
                <span :class="typeBadgeClass(invoice.type)">{{ typeLabel(invoice.type) }}</span>
              </td>
              <td class="nowrap">{{ formatDate(invoice.issue_date) }}</td>
              <td class="muted nowrap">
                {{ invoice.due_date ? formatDate(invoice.due_date) : '-' }}
              </td>
              <td>{{ invoice.contact_name || '—' }}</td>
              <td class="num strong">
                {{ formatCurrency(invoice.total) }}
                <div v-if="invoice.currency && invoice.currency !== 'TRY'" class="muted small">
                  {{ invoice.currency }} ≈ {{ formatCurrency(invoice.base_total) }} TL
                </div>
              </td>
              <td>
                <span :class="invoiceState(invoice).badge">{{ invoiceState(invoice).label }}</span>
                <div v-if="canPost(invoice)">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="actionBusy"
                    @click.stop="postInvoiceAction(invoice)"
                    @keydown.stop
                  >
                    Kesinleştir
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!invoices.length && !loading">
              <td colspan="7" class="empty-cell">
                Henüz fatura bulunmuyor. Yeni fatura oluşturmak için yukarıdaki butonları kullanın.
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="7" class="empty-cell">Yükleniyor…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.total > 0" class="pager">
        <span class="pager-info">
          {{ pagination.page * pagination.limit - pagination.limit + 1 }} –
          {{ Math.min(pagination.page * pagination.limit, pagination.total) }} /
          {{ pagination.total }}
        </span>
        <button
          class="btn btn-secondary btn-sm"
          :disabled="pagination.page === 1"
          @click="prevPage"
        >
          ‹ Önceki
        </button>
        <button
          class="btn btn-secondary btn-sm"
          :disabled="pagination.page >= pagination.pages"
          @click="nextPage"
        >
          Sonraki ›
        </button>
      </div>
    </section>

    <!-- ── ALT: Seçili fatura detayı ── -->
    <section v-if="selectedInvoice" class="detail-panel" aria-label="Fatura detayı">
      <div class="detail-header">
        <div>
          <span :class="typeBadgeClass(selectedInvoice.type)">{{
            typeLabel(selectedInvoice.type)
          }}</span>
          <h2>{{ selectedInvoice.number }}</h2>
          <p v-if="selectedInvoice.contact_name" class="detail-sub">
            {{ selectedInvoice.contact_name }}
          </p>
        </div>
        <div class="detail-meta">
          <div>
            <dt>Durum</dt>
            <dd>
              <span :class="invoiceState(selectedInvoice).badge">{{
                invoiceState(selectedInvoice).label
              }}</span>
            </dd>
          </div>
          <div>
            <dt>Tarih</dt>
            <dd>{{ formatDate(selectedInvoice.issue_date) }}</dd>
          </div>
          <div>
            <dt>Vade</dt>
            <dd>{{ selectedInvoice.due_date ? formatDate(selectedInvoice.due_date) : '—' }}</dd>
          </div>
        </div>
      </div>

      <div class="detail-summary">
        <div>
          <span class="label">Ara Toplam</span>
          <span class="amount">{{ formatCurrency(selectedInvoice.subtotal) }}</span>
        </div>
        <div>
          <span class="label">İskonto</span>
          <span class="amount">−{{ formatCurrency(selectedInvoice.discount_total) }}</span>
        </div>
        <div>
          <span class="label">KDV</span>
          <span class="amount">{{ formatCurrency(selectedInvoice.tax_total) }}</span>
        </div>
        <div v-if="(selectedInvoice.withholding_total ?? 0) > 0">
          <span class="label">Tevkifat</span>
          <span class="amount">−{{ formatCurrency(selectedInvoice.withholding_total) }}</span>
        </div>
        <div>
          <span class="label">Genel Toplam</span>
          <span class="amount total">{{ formatCurrency(selectedInvoice.total) }}</span>
          <span
            v-if="selectedInvoice.currency && selectedInvoice.currency !== 'TRY'"
            class="amount muted small"
            :title="'Kur: ' + selectedInvoice.exchange_rate"
          >
            ≈ {{ formatCurrency(selectedInvoice.base_total) }} TL @
            {{ selectedInvoice.exchange_rate }}
            <span v-if="selectedInvoice.rate_date" class="nowrap">
              ({{ formatDate(selectedInvoice.rate_date) }})
            </span>
          </span>
        </div>
        <div>
          <span class="label">Ödenen</span>
          <span class="amount paid">{{ formatCurrency(selectedInvoice.paid_amount) }}</span>
        </div>
        <div v-if="(selectedInvoice.returned_amount ?? 0) > 0">
          <span class="label">İade Edilen</span>
          <span class="amount">{{ formatCurrency(selectedInvoice.returned_amount) }}</span>
        </div>
        <div>
          <span class="label">Bakiye</span>
          <span class="amount balance">{{ formatCurrency(selectedInvoice.balance) }}</span>
        </div>
      </div>

      <div class="detail-section">
        <div class="section-head">
          <h3>Satırlar</h3>
          <button
            v-if="canEditLines(selectedInvoice)"
            class="btn btn-secondary btn-sm"
            @click="editInvoice(selectedInvoice)"
          >
            Satırları Düzenle
          </button>
        </div>
        <div class="lines-wrap">
          <table class="lines-table">
            <thead>
              <tr>
                <th scope="col">Açıklama</th>
                <th scope="col" class="num">Miktar</th>
                <th scope="col" class="num">Birim Fiyat</th>
                <th scope="col" class="num">İskonto</th>
                <th scope="col" class="num">KDV</th>
                <th scope="col" class="num">Satır Toplamı</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in selectedInvoice.lines || []" :key="line.id">
                <td>{{ line.description }}</td>
                <td class="num">{{ formatQty(line.quantity) }}</td>
                <td class="num">{{ formatCurrency(line.unit_price) }}</td>
                <td class="num">{{ formatPct(line.discount_percent) }}</td>
                <td class="num">{{ formatCurrency(line.tax_amount || 0) }}</td>
                <td class="num strong">{{ formatCurrency(line.line_total || 0) }}</td>
              </tr>
              <tr v-if="!(selectedInvoice.lines || []).length">
                <td colspan="6" class="empty-cell">Satır yok.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="detail-section">
        <div class="section-head">
          <h3>Ödemeler</h3>
          <button
            v-if="selectedInvoice.balance > 0"
            class="btn btn-primary btn-sm"
            @click="openPayment"
          >
            + Ödeme Al
          </button>
        </div>
        <div v-if="selectedInvoice.payments?.length" class="lines-wrap">
          <table class="lines-table">
            <thead>
              <tr>
                <th scope="col">Tarih</th>
                <th scope="col">Yöntem</th>
                <th scope="col">Referans</th>
                <th scope="col" class="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in selectedInvoice.payments" :key="p.id">
                <td class="nowrap">{{ formatDate(p.payment_date) }}</td>
                <td>{{ paymentMethodLabel(p.payment_method) }}</td>
                <td class="muted">{{ p.reference || '—' }}</td>
                <td class="num">{{ formatCurrency(p.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="state-msg">Henüz ödeme yok.</p>
      </div>

      <div class="detail-actions">
        <button
          v-if="canPost(selectedInvoice)"
          class="btn btn-primary btn-sm"
          :disabled="actionBusy"
          @click="postInvoiceAction(selectedInvoice)"
        >
          Kesinleştir
        </button>
        <button
          v-if="!isCancelledInvoice(selectedInvoice)"
          class="btn btn-secondary btn-sm"
          @click="editInvoice(selectedInvoice)"
        >
          Düzenle
        </button>
        <button class="btn btn-secondary btn-sm" @click="printInvoice">Yazdır / PDF</button>
        <button
          v-if="isPostedInvoice(selectedInvoice)"
          class="btn btn-danger btn-sm"
          :disabled="actionBusy"
          @click="cancelInvoiceAction(selectedInvoice)"
        >
          İptal Et
        </button>
        <button
          v-if="!isPostedInvoice(selectedInvoice)"
          class="btn btn-danger btn-sm"
          @click="deleteInvoice(selectedInvoice.id)"
        >
          Sil
        </button>
      </div>
    </section>

    <!-- Seçim yoksa boş durum -->
    <section v-else class="detail-panel empty-state">
      <p>Detayları burada görünür. Listeden bir fatura seçin.</p>
    </section>

    <!-- Ödeme modalı -->
    <div v-if="showPaymentModal" class="modal-backdrop" @click.self="showPaymentModal = false">
      <div class="modal-content">
        <div class="modal-head">
          <h2>Ödeme Al</h2>
          <button class="modal-close" aria-label="Kapat" @click="showPaymentModal = false">
            &times;
          </button>
        </div>
        <form @submit.prevent="submitPayment">
          <div class="form-grid">
            <div>
              <label class="field-label" for="pay-amount">Tutar *</label>
              <input
                id="pay-amount"
                v-model.number="paymentForm.amount"
                type="number"
                min="0.01"
                step="0.01"
                class="input"
                required
              />
            </div>
            <div>
              <label class="field-label" for="pay-date">Tarih</label>
              <input id="pay-date" v-model="paymentForm.payment_date" type="date" class="input" />
            </div>
            <div>
              <label class="field-label" for="pay-method">Yöntem *</label>
              <FilterableSelect
                id="pay-method"
                v-model="paymentForm.payment_method"
                :options="PAYMENT_METHOD_OPTIONS"
                placeholder="Yöntem seçin"
              />
            </div>
            <div>
              <label class="field-label" for="pay-ref">Referans</label>
              <input id="pay-ref" v-model="paymentForm.reference" type="text" class="input" />
            </div>
          </div>
          <p v-if="storeError" class="form-error">{{ storeError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="showPaymentModal = false">
              Vazgeç
            </button>
            <button type="submit" class="btn btn-primary" :disabled="paymentSaving">Kaydet</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- ── KALICI YENİ FATURA PANELİ (erp-workspace-panels) ── -->
  <Teleport to="body">
    <div
      v-if="invoiceStore.workspaceOpen && draftForm"
      class="invoice-workspace-panel"
      :class="{ minimized: panelMinimized, maximized: panelMaximized }"
      ref="panelEl"
      role="dialog"
      aria-modal="false"
      aria-label="Fatura oluştur / düzenle"
    >
      <header class="wp-titlebar" @mousedown.self="startDrag">
        <div class="wp-title">
          <span class="wp-status-dot" aria-hidden="true"></span>
          {{ invoiceStore.workspaceMode === 'edit' ? 'Fatura Düzenle' : 'Yeni Fatura' }}
          <span v-if="isDirty" class="wp-dirty" title="Kaydedilmemiş değişiklikler var">●</span>
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
            @click="toggleMaximize"
          >
            {{ panelMaximized ? '❐' : '□' }}
          </button>
          <button
            type="button"
            class="wp-btn wp-close"
            aria-label="Paneli kapat"
            title="Kapat"
            @click="requestClose"
          >
            ✕
          </button>
        </div>
      </header>

      <div v-show="!panelMinimized" class="wp-body">
        <form @submit.prevent="saveInvoice" class="invoice-form">
          <p v-if="formPosted" class="muted small">
            Kesinleşmiş fatura: yalnız not ve vade tarihi değiştirilebilir. Düzeltme için faturayı
            iptal edin veya iade faturası oluşturun.
          </p>
          <div class="form-grid">
            <div>
              <label class="field-label" for="f-type">Fatura Tipi *</label>
              <FilterableSelect
                id="f-type"
                v-model="draftForm.type"
                :options="INVOICE_TYPE_OPTIONS"
                placeholder="Fatura tipi seçin"
                :disabled="formPosted"
                @select="onTypeChange"
              />
            </div>
            <div>
              <label class="field-label" for="f-number">Fatura No</label>
              <input
                id="f-number"
                class="input"
                :value="draftForm.id ? currentNumber() : 'Otomatik'"
                disabled
              />
            </div>
            <div v-if="draftForm.type === 'purchase'">
              <label class="field-label" for="f-supplier-no">Tedarikçi belge no</label>
              <input
                id="f-supplier-no"
                v-model="draftForm.supplier_document_no"
                type="text"
                maxlength="100"
                class="input"
                :disabled="formPosted"
                placeholder="Tedarikçinin fatura numarası"
              />
              <span class="muted small">Aynı cari için tekrar edemez.</span>
            </div>
            <div>
              <label class="field-label" for="f-issue">Fatura Tarihi *</label>
              <input
                id="f-issue"
                v-model="draftForm.issue_date"
                type="date"
                class="input"
                :disabled="formPosted"
                required
              />
            </div>
            <div>
              <label class="field-label" for="f-due">Vade Tarihi</label>
              <input id="f-due" v-model="draftForm.due_date" type="date" class="input" />
            </div>
            <div>
              <label class="field-label" for="f-contact">Cari *</label>
              <FilterableSelect
                id="f-contact"
                v-model="draftForm.contact_id"
                :options="contactOptions"
                placeholder="Seçiniz…"
                :disabled="formPosted"
              />
            </div>
            <div v-if="isReturnType && draftForm.contact_id">
              <label class="field-label" for="f-ref-invoice">Orijinal fatura (isteğe bağlı)</label>
              <FilterableSelect
                id="f-ref-invoice"
                :model-value="draftForm.reference_id ?? ''"
                :options="referenceOptions"
                placeholder="Bağlı fatura yok"
                allow-clear
                :disabled="invoiceStore.workspaceMode === 'edit'"
                @update:model-value="(v) => setReferenceInvoice(v)"
              />
              <span v-if="invoiceStore.workspaceMode === 'edit'" class="muted small"
                >Mevcut bağ düzenlemede değiştirilemez.</span
              >
            </div>
            <div>
              <label class="field-label" for="f-warehouse">Depo</label>
              <FilterableSelect
                id="f-warehouse"
                v-model="draftForm.warehouse_id"
                :options="warehouseOptions"
                placeholder="Seçiniz…"
                :disabled="formPosted"
              />
            </div>
            <div>
              <label class="field-label" for="f-currency">Para Birimi</label>
              <FilterableSelect
                id="f-currency"
                v-model="draftForm.currency"
                :options="CURRENCY_OPTIONS"
                placeholder="Para birimi seçin"
                :disabled="formPosted"
              />
            </div>
            <div>
              <label class="field-label" for="f-rate">Kur</label>
              <input
                id="f-rate"
                v-model.number="draftForm.exchange_rate"
                type="number"
                min="0.0001"
                step="0.0001"
                class="input"
                :disabled="formPosted"
                :placeholder="draftForm.currency !== 'TRY' ? 'Otomatik' : '1'"
              />
              <span v-if="draftForm.currency !== 'TRY'" class="muted small"
                >Boşsa tarih bazlı TCMB kuru</span
              >
            </div>
            <div>
              <label class="field-label" for="f-rate-date">Kur Tarihi</label>
              <input
                id="f-rate-date"
                v-model="draftForm.rate_date"
                type="date"
                class="input"
                :disabled="draftForm.currency === 'TRY' || formPosted"
              />
            </div>
          </div>

          <div class="line-items-head">
            <h3>Satırlar</h3>
            <div class="line-items-tools">
              <span class="muted small">Sütunları sürükleyerek genişletebilirsiniz</span>
              <button
                v-if="!formPosted"
                type="button"
                class="btn btn-secondary btn-sm"
                @click="addLine"
              >
                + Satır Ekle
              </button>
            </div>
          </div>

          <div class="lines-editor">
            <table class="lines-edit-table">
              <thead>
                <tr>
                  <th class="col-product" :style="{ width: colW.product }">Ürün / Açıklama</th>
                  <th class="col-miktar" :style="{ width: colW.qty }">Miktar</th>
                  <th class="col-birim" :style="{ width: colW.price }">Birim Fiyat</th>
                  <th class="col-iskonto" :style="{ width: colW.discount }">İskonto %</th>
                  <th class="col-kdv" :style="{ width: colW.tax }">KDV</th>
                  <th class="col-toplam" :style="{ width: colW.total }">Satır Toplamı</th>
                  <th class="col-aksiyon"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in draftForm.lines" :key="index">
                  <td class="col-product">
                    <template v-if="draftForm.type === 'purchase'">
                      <FilterableSelect
                        :id="`line-kind-${index}`"
                        :model-value="lineKind(line)"
                        :options="LINE_KIND_OPTIONS"
                        placeholder="Cinsi seçin"
                        aria-label="Cinsi"
                        class="select"
                        :disabled="formPosted"
                        @update:model-value="(v) => setLineKind(line, v)"
                      />
                      <FilterableSelect
                        v-if="lineKind(line) === 'product'"
                        :id="`line-product-${index}`"
                        :model-value="line.product_id ?? ''"
                        :options="productOptions"
                        placeholder="Stok ürünü seçin"
                        aria-label="Stok ürünü"
                        class="select"
                        :disabled="formPosted"
                        @update:model-value="(v) => onProductPick(line, v)"
                      />
                      <FilterableSelect
                        v-else-if="lineKind(line) === 'expense'"
                        :id="`line-expense-${index}`"
                        :model-value="line.expense_category_id ?? ''"
                        :options="expenseCategoryOptions"
                        placeholder="Gider kategorisi seçin"
                        aria-label="Gider kategorisi"
                        class="select"
                        :disabled="formPosted"
                        @update:model-value="(v) => onExpenseCategoryPick(line, v)"
                      />
                    </template>
                    <input
                      v-model="line.description"
                      type="text"
                      class="input"
                      :disabled="formPosted"
                      placeholder="Açıklama veya ürün ara…"
                      @input="onLineChange"
                    />
                  </td>
                  <td class="col-miktar">
                    <input
                      v-model.number="line.quantity"
                      type="number"
                      min="0.01"
                      step="0.01"
                      class="input num-input"
                      :disabled="formPosted"
                      @input="onLineChange"
                    />
                  </td>
                  <td class="col-birim">
                    <input
                      v-model.number="line.unit_price"
                      type="number"
                      min="0"
                      step="0.01"
                      class="input num-input"
                      :disabled="formPosted"
                      @input="onLineChange"
                    />
                  </td>
                  <td class="col-iskonto">
                    <input
                      v-model.number="line.discount_percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      class="input num-input"
                      :disabled="formPosted"
                      @input="onLineChange"
                    />
                  </td>
                  <td class="col-kdv">
                    <FilterableSelect
                      v-model="line.tax_rate_id"
                      :options="taxRateOptions"
                      placeholder="%0"
                      class="select"
                      :disabled="formPosted"
                      @select="onTaxPick(line)"
                    />
                    <FilterableSelect
                      v-if="supportsWithholding"
                      :id="`line-withholding-${index}`"
                      :model-value="line.withholding_type_id ?? ''"
                      :options="withholdingOptionsFor(line)"
                      placeholder="Tevkifat yok"
                      aria-label="Tevkifat"
                      class="select"
                      :disabled="formPosted || taxRateFor(line.tax_rate_id) <= 0"
                      @update:model-value="(v) => setLineWithholding(line, v)"
                    />
                  </td>
                  <td class="col-toplam">
                    <span class="line-total">{{ formatCurrency(lineTotal(line)) }}</span>
                  </td>
                  <td class="col-aksiyon">
                    <button
                      v-if="!formPosted"
                      type="button"
                      class="wp-btn danger"
                      aria-label="Satırı sil"
                      title="Satırı sil"
                      @click="removeLine(index)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                <tr v-if="!draftForm.lines.length">
                  <td colspan="7" class="empty-cell">
                    Satır eklemek için "+ Satır Ekle" kullanın.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="totals">
            <div class="totals-row">
              <span class="muted">Ara Toplam</span><span>{{ formatCurrency(subtotal) }}</span>
            </div>
            <div class="totals-row">
              <span class="muted">İskonto</span><span>−{{ formatCurrency(discountTotal) }}</span>
            </div>
            <div class="totals-row">
              <span class="muted">KDV</span><span>{{ formatCurrency(taxTotal) }}</span>
            </div>
            <div class="totals-row grand">
              <span>Genel Toplam</span><span>{{ formatCurrency(grandTotal) }}</span>
            </div>
            <div v-if="withholdingTotal > 0" class="totals-row">
              <span class="muted">Tevkif Edilen KDV</span
              ><span>−{{ formatCurrency(withholdingTotal) }}</span>
            </div>
            <div v-if="withholdingTotal > 0" class="totals-row grand">
              <span>Ödenecek Tutar</span><span>{{ formatCurrency(payableTotal) }}</span>
            </div>
          </div>

          <div>
            <label class="field-label" for="f-notes">Notlar</label>
            <textarea id="f-notes" v-model="draftForm.notes" rows="2" class="textarea"></textarea>
          </div>

          <!-- Peşin ödeme / tahsilat: yalnız yeni fatura; üçüncü eylemle satır içi açılır. -->
          <section
            v-if="isNewWorkspace && canQuickPay && quickPaymentOpen"
            class="quick-pay"
            aria-label="Peşin ödeme veya tahsilat"
          >
            <div class="line-items-head">
              <h3>{{ draftForm.type === 'purchase' ? 'Peşin ödeme' : 'Peşin tahsilat' }}</h3>
              <button
                type="button"
                class="wp-btn"
                aria-label="Ödeme bölümünü kapat"
                title="Ödeme bölümünü kapat"
                @click="quickPaymentOpen = false"
              >
                ✕
              </button>
            </div>
            <div class="form-grid">
              <div>
                <label class="field-label" for="qp-method">Ödeme yöntemi *</label>
                <FilterableSelect
                  id="qp-method"
                  :model-value="quickPayment.method"
                  :options="quickMethodOptions"
                  placeholder="Yöntem seçin"
                  :disabled="saving"
                  @update:model-value="(v) => setQuickMethod(v)"
                />
              </div>
              <div>
                <label class="field-label" for="qp-account"
                  >{{ QUICK_ACCOUNT_LABEL[quickPayment.method] }} *</label
                >
                <FilterableSelect
                  id="qp-account"
                  :model-value="quickPayment.accountId"
                  :options="quickAccountOptions"
                  placeholder="Seçiniz…"
                  :disabled="saving"
                  @update:model-value="(v) => setQuickAccount(v)"
                />
                <span v-if="!quickAccountOptions.length" class="muted small">{{
                  quickAccountEmptyText
                }}</span>
              </div>
              <div>
                <label class="field-label" for="qp-amount">Tutar *</label>
                <input
                  id="qp-amount"
                  v-model.number="quickPayment.amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  class="input"
                  :disabled="saving"
                  @input="quickAmountTouched = true"
                />
              </div>
              <div>
                <label class="field-label" for="qp-date">Ödeme tarihi *</label>
                <input
                  id="qp-date"
                  v-model="quickPayment.date"
                  type="date"
                  class="input"
                  :disabled="saving"
                  @input="quickDateTouched = true"
                />
              </div>
            </div>
          </section>

          <p v-if="storeError" class="form-error">{{ storeError }}</p>
          <div class="panel-actions">
            <button type="button" class="btn btn-secondary" @click="requestClose">Vazgeç</button>
            <div v-if="isNewWorkspace" class="panel-actions-group">
              <button
                type="submit"
                class="btn btn-secondary"
                :disabled="saving || draftForm.lines.length === 0"
              >
                {{ savingKind === 'draft' ? 'Kaydediliyor…' : 'Taslak Kaydet' }}
              </button>
              <button
                v-if="canQuickFinalize"
                type="button"
                class="btn btn-primary"
                :disabled="saving || draftForm.lines.length === 0"
                @click="submitQuick('finalize')"
              >
                {{ savingKind === 'finalize' ? 'Kaydediliyor…' : 'Kaydet ve Kesinleştir' }}
              </button>
              <button
                v-if="canQuickPay"
                type="button"
                class="btn btn-primary"
                :disabled="saving || draftForm.lines.length === 0"
                @click="submitQuick('payment')"
              >
                {{ savingKind === 'payment' ? 'Kaydediliyor…' : quickPayLabel }}
              </button>
            </div>
            <button
              v-else
              type="submit"
              class="btn btn-primary"
              :disabled="saving || draftForm.lines.length === 0"
            >
              {{ saving ? 'Kaydediliyor…' : 'Faturayı Kaydet' }}
            </button>
          </div>
        </form>
      </div>

      <footer v-show="!panelMinimized" class="wp-foot">
        <span class="muted small"
          >Fatura taslağı otomatik kaydediliyor — menülerde gezinirken korunur.</span
        >
      </footer>
    </div>
  </Teleport>

  <!-- Kapanış onayı (taslak varken) -->
  <div v-if="showCloseConfirm" class="modal-backdrop" @click.self="showCloseConfirm = false">
    <div class="modal-content">
      <div class="modal-head">
        <h2>Taslak kapatılsın mı?</h2>
        <button class="modal-close" aria-label="Kapat" @click="showCloseConfirm = false">
          &times;
        </button>
      </div>
      <p>Kaydedilmemiş fatura taslağınız var. Kapatırsanız taslak silinir.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="showCloseConfirm = false">Vazgeç</button>
        <button class="btn btn-danger" @click="confirmDiscard">Taslağı Sil ve Kapat</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import {
  useInvoiceStore,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceDraft,
  type InvoiceLine,
  type QuickPaymentInput,
} from '@/stores/invoices';
import { useCashBankStore } from '@/stores/cash-bank';
import { useContactStore, type Contact } from '@/stores/contacts';
import { useStockStore, type StockItem } from '@/stores/stock';
import { useExpenseStore } from '@/stores/expense';
import { formatMoneyTR } from '@kuleplus/shared';
import FilterableSelect from '@/components/FilterableSelect.vue';

interface Warehouse {
  id: string;
  name: string;
}

/** Alış satırının cinsi: stok ürünü ya da gider kategorisi. Yalnızca arayüz durumudur, API'ye gönderilmez. */
type LineCostKind = 'product' | 'expense';
type DraftLine = InvoiceLine & { cost_kind?: LineCostKind };

const invoiceStore = useInvoiceStore();
const contactStore = useContactStore();
const stockStore = useStockStore();
const expenseStore = useExpenseStore();
const cashBankStore = useCashBankStore();

const invoices = computed(() => invoiceStore.invoices);
const loading = computed(() => invoiceStore.loading);
const pagination = computed(() => invoiceStore.pagination);
const storeError = computed(() => invoiceStore.error);

const route = useRoute();
const selectedId = ref<string | null>(null);
const searchQuery = ref('');
const typeFilter = ref('');
const statusFilter = ref('');
const dateFrom = ref('');
const dateTo = ref('');

const contacts = ref<Contact[]>([]);
const warehouses = ref<Warehouse[]>([]);

// ── Combobox (filtreli seçim) seçenekleri ──
const INVOICE_TYPE_OPTIONS = [
  { value: 'sales', label: 'Satış' },
  { value: 'purchase', label: 'Alış' },
  { value: 'proforma', label: 'Proforma' },
  { value: 'credit_note', label: 'Alınan İade' },
  { value: 'debit_note', label: 'Verilen İade' },
];
const INVOICE_TYPE_FILTER_OPTIONS = [{ value: '', label: 'Tümü' }, ...INVOICE_TYPE_OPTIONS];
const INVOICE_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tüm Durumlar' },
  { value: 'draft', label: 'Taslak' },
  { value: 'sent', label: 'Gönderildi' },
  { value: 'paid', label: 'Ödendi' },
  { value: 'partial', label: 'Kısmi' },
  { value: 'cancelled', label: 'İptal' },
  { value: 'overdue', label: 'Gecikmiş' },
];
const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Nakit' },
  { value: 'bank_transfer', label: 'Havale/EFT' },
  { value: 'check', label: 'Çek' },
  { value: 'credit_card', label: 'Kredi Kartı' },
  { value: 'other', label: 'Diğer' },
];
const CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];
const contactOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...contacts.value.map((c) => ({ value: c.id, label: c.name })),
]);
const warehouseOptions = computed(() => [
  { value: '', label: 'Seçiniz…' },
  ...warehouses.value.map((w) => ({ value: w.id, label: w.name })),
]);
const taxRateOptions = computed(() => [
  { value: '', label: '%0' },
  ...invoiceStore.taxRates.map((t) => ({ value: t.id, label: `%${t.rate}` })),
]);
/** Alış satırı cinsi seçenekleri ve kaynak listeleri (stok ürünü / gider kategorisi). */
const LINE_KIND_OPTIONS = [
  { value: 'product', label: 'Stok ürünü' },
  { value: 'expense', label: 'Gider' },
];
/** addLine'ın koyduğu varsayılan açıklamalar; ürün seçilince bunların yerine ürün adı yazılır. */
const DEFAULT_LINE_DESCRIPTIONS = ['Alış kalemi', 'Satış kalemi'];
const productOptions = computed(() =>
  stockStore.stock
    .filter((p) => p.is_active !== false)
    .map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })),
);
const expenseCategoryOptions = computed(() =>
  expenseStore.categories
    .filter((c) => c.status === 'active')
    .map((c) => ({ value: c.id, label: c.name })),
);

const showPaymentModal = ref(false);
const paymentForm = ref({
  amount: 0,
  payment_date: new Date().toISOString().split('T')[0],
  payment_method: 'cash',
  reference: '',
});
const paymentSaving = ref(false);
const saving = ref(false);
/** Sürmekte olan gönderimin türü; yalnız yeni fatura düğmelerinde etiket değiştirir. */
const savingKind = ref<'draft' | 'finalize' | 'payment' | null>(null);
// ── Kesinleştirme / iptal: sonuç bildirimi ve eylem kilidi ──
const notice = ref<{ kind: 'error' | 'success'; text: string } | null>(null);
const actionBusy = ref(false);

// ── Workspace panel durumu ──
const panelEl = ref<HTMLElement | null>(null);
const panelMinimized = ref(false);
const panelMaximized = ref(false);
const showCloseConfirm = ref(false);
const dragStart = ref<{ x: number; y: number; l: number; t: number } | null>(null);
const panelPos = ref({ left: 0, top: 0 });

const draftForm = ref<InvoiceDraft | null>(null);
const isDirty = ref(false);
/** Düzenlenen fatura kesinleşmişse formda yalnız not ve vade değişir (API kuralı). */
const formPosted = computed(
  () => invoiceStore.workspaceMode === 'edit' && draftForm.value?.posting_status === 'posted',
);

// Alış faturasında satır cinsi listeleri (ürünler, gider kategorileri) gerektiğinde yüklenir.
watch(
  () => draftForm.value?.type,
  (type) => {
    if (type !== 'purchase') return;
    void stockStore.fetchStock({ limit: 100 });
    void expenseStore.fetchCategories();
  },
  { immediate: true },
);

// Tevkifat türleri fatura tarihine göre (active_on) yüklenir; tarih değişince yeniden.
watch(
  () => draftForm.value?.issue_date,
  (date) => {
    if (date) void invoiceStore.fetchWithholdingTypes(date);
  },
  { immediate: true },
);

// ── İade faturası: orijinal fatura bağı (isteğe bağlı) ──
const sourceInvoices = ref<Invoice[]>([]);
let referenceSeq = 0;
const isReturnType = computed(
  () => draftForm.value?.type === 'credit_note' || draftForm.value?.type === 'debit_note',
);
const referenceOptions = computed(() =>
  sourceInvoices.value.map((i) => ({
    value: i.id,
    label: `${i.number} – ${formatDate(i.issue_date)} – ${formatCurrency(i.balance)}`,
  })),
);
/** Alınan iade → satış faturası, verilen iade → alış faturası listelenir (yalnızca kesinleşmiş). */
async function loadReferenceInvoices(type?: string, contactId?: string) {
  const seq = ++referenceSeq;
  const kind = type === 'credit_note' ? 'sales' : type === 'debit_note' ? 'purchase' : null;
  if (!kind || !contactId) {
    sourceInvoices.value = [];
    return;
  }
  const list = await invoiceStore.fetchReferenceInvoices(contactId, kind);
  if (seq !== referenceSeq) return;
  sourceInvoices.value = list;
  // Seçili orijinal yeni listede yoksa (cari ya da tür değişti) bağ kaldırılır.
  const d = draftForm.value;
  if (d?.reference_id && !list.some((i) => i.id === d.reference_id)) d.reference_id = undefined;
}
watch(
  () => [draftForm.value?.type, draftForm.value?.contact_id],
  ([type, contactId]) => {
    void loadReferenceInvoices(type, contactId);
  },
  { immediate: true },
);
function setReferenceInvoice(id: string) {
  if (!draftForm.value) return;
  draftForm.value.reference_id = id || undefined;
  isDirty.value = true;
}
/** Yalnızca oluşturma isteğinde gönderilir (düzenlemede bağ değiştirilemez). */
function referencePayload(): { reference_type?: string; reference_id?: string } {
  const d = draftForm.value;
  if (!d || !isReturnType.value || !d.reference_id) return {};
  return { reference_type: 'invoice', reference_id: d.reference_id };
}

/** Alış faturasında tedarikçi belge no'su her kayıtta gönderilir (boşsa '' → düzenlemede de temizlenir). */
function supplierDocumentPayload(): { supplier_document_no?: string } {
  const d = draftForm.value;
  if (!d || d.type !== 'purchase') return {};
  return { supplier_document_no: (d.supplier_document_no ?? '').trim() };
}

// Sütun genişlikleri (yerel kalıcılık)
const colKeys = ['product', 'qty', 'price', 'discount', 'tax', 'total'] as const;
const colW = ref<Record<(typeof colKeys)[number], string>>({
  product: 'minmax(16rem, 1fr)',
  qty: '7rem',
  price: '9rem',
  discount: '7rem',
  tax: '8rem',
  total: '10rem',
});

function loadColWidths() {
  try {
    const raw = localStorage.getItem('erp_invoice_colwidths_v1');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Record<(typeof colKeys)[number], string>>;
    for (const k of colKeys) {
      if (parsed[k] && /^minmax\(|^[0-9.]+rem$/.test(parsed[k]!)) colW.value[k] = parsed[k]!;
    }
  } catch {
    localStorage.removeItem('erp_invoice_colwidths_v1');
  }
}
function persistColWidths() {
  try {
    localStorage.setItem('erp_invoice_colwidths_v1', JSON.stringify(colW.value));
  } catch {
    /* storage kapalı */
  }
}
function onResizeStart(e: MouseEvent) {
  const th = (e.target as HTMLElement).closest('th');
  if (!th) return;
  e.preventDefault();
  const startX = e.clientX;
  const key = [...th.classList].find((c) => c.startsWith('col-'))?.replace('col-', '') as
    (typeof colKeys)[number] | undefined;
  if (!key || !(key in colW.value)) return;
  const startW = th.getBoundingClientRect().width;
  const onMove = (ev: MouseEvent) => {
    const w = Math.max(4, Math.min(30, startW / 16 + (ev.clientX - startX) / 16));
    colW.value[key] = `${w}rem`;
    persistColWidths();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function attachResize() {
  nextTick(() => {
    document.querySelectorAll<HTMLElement>('.lines-edit-table th').forEach((th) => {
      if (th.classList.contains('col-product') || th.classList.contains('col-aksiyon')) return;
      th.addEventListener('mousedown', onResizeStart);
    });
  });
}

const selectedInvoice = computed(() => {
  if (!selectedId.value) return null;
  return (
    (invoiceStore.currentInvoice?.id === selectedId.value
      ? invoiceStore.currentInvoice
      : invoices.value.find((i) => i.id === selectedId.value)) ?? null
  );
});

const typeLabel = (type: string) =>
  ({
    sales: 'Satış',
    purchase: 'Alış',
    proforma: 'Proforma',
    credit_note: 'Alınan İade',
    debit_note: 'Verilen İade',
  })[type] || type;

const typeBadgeClass = (type: string) =>
  `badge ${
    {
      sales: 'badge-info',
      purchase: 'badge-success',
      proforma: 'badge-neutral',
      credit_note: 'badge-warning',
      debit_note: 'badge-danger',
    }[type] || 'badge-neutral'
  }`;

// ── Kesinleştirme (muhasebeleştirme) ve kesinleşme durumu ──
/** Kesinleştirme yalnız satış, alış ve iade faturalarında yapılır (proforma hariç). */
const POSTABLE_TYPES: Invoice['type'][] = ['sales', 'purchase', 'credit_note', 'debit_note'];

const canPost = (invoice: Invoice) =>
  invoice.posting_status === 'draft' && POSTABLE_TYPES.includes(invoice.type);
const isPostedInvoice = (invoice: Invoice) => invoice.posting_status === 'posted';
const isCancelledInvoice = (invoice: Invoice) =>
  invoice.posting_status === 'cancelled' || invoice.status === 'cancelled';
/** Kesinleşmiş ve iptal edilmiş faturanın satırları değiştirilemez. */
const canEditLines = (invoice: Invoice) =>
  !isPostedInvoice(invoice) && !isCancelledInvoice(invoice);

/**
 * Listede ve detayda tek durum etiketi: iptal, ödeme ve kesinleşme bilgisi birlikte değerlendirilir.
 * Öncelik: iptal > ödendi > kısmi ödendi > kesinleşmiş (açık) > taslak.
 */
const invoiceState = (invoice: Invoice): { label: string; badge: string } => {
  if (isCancelledInvoice(invoice)) return { label: 'İptal', badge: 'badge-danger' };
  if (invoice.status === 'paid') return { label: 'Ödendi', badge: 'badge-success' };
  if (invoice.status === 'partial') return { label: 'Kısmi Ödendi', badge: 'badge-warning' };
  if (isPostedInvoice(invoice)) return { label: 'Açık', badge: 'badge-info' };
  return { label: 'Taslak', badge: 'badge-neutral' };
};

/** Düzenleme paneli bu faturayı açıksa kilit durumu sunucu sonucuyla eşitlenir. */
function syncOpenDraftPosting(id: string, postingStatus: string) {
  if (draftForm.value?.id === id) draftForm.value.posting_status = postingStatus;
}

async function postInvoiceAction(invoice: Invoice) {
  if (
    !confirm(
      'Fatura kesinleşsin mi? Kesinleşen fatura muhasebeleştirilir ve artık düzenlenemez/silinemez; düzeltme iptal veya iade faturasıyla yapılır.',
    )
  )
    return;
  notice.value = null;
  actionBusy.value = true;
  try {
    const result = await invoiceStore.postInvoice(invoice.id);
    const base = result.alreadyPosted ? 'Fatura zaten kesinleşmiş.' : 'Fatura kesinleşti.';
    notice.value = {
      kind: 'success',
      text: result.entryNo ? `${base} Yevmiye no ${result.entryNo}.` : base,
    };
    syncOpenDraftPosting(invoice.id, 'posted');
  } catch {
    notice.value = { kind: 'error', text: invoiceStore.error || 'Fatura kesinleştirilemedi.' };
  } finally {
    actionBusy.value = false;
  }
}

/** Kesinleşmiş faturayı iptal eder; sunucu yevmiye fişini ters kayıtla düzeltir. */
async function cancelInvoiceAction(invoice: Invoice) {
  if (
    !confirm(
      'Bu fatura iptal edilsin mi? Kesinleşmiş faturanın yevmiye fişi ters kayıtla düzeltilir.',
    )
  )
    return;
  notice.value = null;
  actionBusy.value = true;
  try {
    await invoiceStore.updateInvoice(invoice.id, { status: 'cancelled' });
    notice.value = { kind: 'success', text: 'Fatura iptal edildi.' };
    syncOpenDraftPosting(invoice.id, 'cancelled');
  } catch {
    notice.value = { kind: 'error', text: invoiceStore.error || 'Fatura iptal edilemedi.' };
  } finally {
    actionBusy.value = false;
  }
}

const paymentMethodLabel = (m: string) =>
  ({
    cash: 'Nakit',
    bank_transfer: 'Havale/EFT',
    check: 'Çek',
    credit_card: 'Kredi Kartı',
    other: 'Diğer',
  })[m] || m;

const formatDate = (d: string) =>
  d ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(d)) : '-';
const formatCurrency = (n: number | string | undefined) => formatMoneyTR(String(n ?? 0));
const formatQty = (q: number | string) => {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(n.toFixed(2)).replace('.', ',');
};
const formatPct = (p: number | string) =>
  Number(p).toFixed(2).replace('.', ',').replace(/0+$/, '').replace(/,$/, '') + '%';

function currentNumber(): string {
  return selectedInvoice.value?.number || '';
}

// ── Satır hesapları ──
function taxRateFor(id?: string): number {
  const t = invoiceStore.taxRates.find((x) => x.id === id);
  return t ? Number(t.rate) : 0;
}
function lineTotal(line: InvoiceLine): string {
  const base = Number(line.quantity) * Number(line.unit_price);
  const disc = (base * (Number(line.discount_percent) || 0)) / 100;
  const rate = taxRateFor(line.tax_rate_id);
  return String(base - disc + (base - disc) * (rate / 100));
}
const subtotal = computed(
  () =>
    draftForm.value?.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0) || 0,
);
const discountTotal = computed(
  () =>
    draftForm.value?.lines.reduce(
      (s, l) =>
        s + (Number(l.quantity) * Number(l.unit_price) * (Number(l.discount_percent) || 0)) / 100,
      0,
    ) || 0,
);
const taxTotal = computed(
  () =>
    draftForm.value?.lines.reduce((s, l) => {
      const base = Number(l.quantity) * Number(l.unit_price);
      const disc = (base * (Number(l.discount_percent) || 0)) / 100;
      return s + (base - disc) * (taxRateFor(l.tax_rate_id) / 100);
    }, 0) || 0,
);
const grandTotal = computed(() => subtotal.value - discountTotal.value + taxTotal.value);

// ── Tevkifat (KDV tevkifatı; yalnızca satış/alış faturası) ──
const supportsWithholding = computed(
  () => draftForm.value?.type === 'sales' || draftForm.value?.type === 'purchase',
);
/** Satırın KDV tutarı (tevkifatın uygulandığı tutar). */
function lineTaxAmount(line: InvoiceLine): number {
  const base = Number(line.quantity) * Number(line.unit_price);
  const disc = (base * (Number(line.discount_percent) || 0)) / 100;
  return (base - disc) * (taxRateFor(line.tax_rate_id) / 100);
}
/** Seçili tevkifat türünün oranı (0–1). Tür listede yoksa sunucunun döndüğü oran kullanılır. */
function withholdingRateFor(line: InvoiceLine): number {
  if (!line.withholding_type_id) return 0;
  const t = invoiceStore.withholdingTypes.find((x) => x.id === line.withholding_type_id);
  if (t) return Number(t.rate_numerator) / (Number(t.rate_denominator) || 10);
  return Number(line.withholding_rate ?? 0) / 100;
}
const withholdingTotal = computed(() =>
  supportsWithholding.value
    ? (draftForm.value?.lines ?? []).reduce(
        (s, l) => s + lineTaxAmount(l) * withholdingRateFor(l),
        0,
      )
    : 0,
);
const payableTotal = computed(() => grandTotal.value - withholdingTotal.value);
function withholdingOptionsFor(line: InvoiceLine) {
  const options: { value: string; label: string }[] = [
    { value: '', label: 'Yok' },
    ...invoiceStore.withholdingTypes.map((t) => ({
      value: t.id,
      label: `${t.einvoice_code} – ${t.name} (${t.rate_numerator}/${t.rate_denominator})`,
    })),
  ];
  const id = line.withholding_type_id;
  if (id && !invoiceStore.withholdingTypes.some((t) => t.id === id)) {
    options.push({ value: id, label: 'Seçili tür (listede yok)' });
  }
  return options;
}
function setLineWithholding(line: InvoiceLine, typeId: string) {
  line.withholding_type_id = typeId || undefined;
  onLineChange();
}
function onTaxPick(line: InvoiceLine) {
  // %0 KDV'de tevkifat uygulanamaz; seçili tür temizlenir.
  if (taxRateFor(line.tax_rate_id) <= 0) line.withholding_type_id = undefined;
  onLineChange();
}

// ── Panel açma ──
function emptyDraft(type: 'sales' | 'purchase' = 'sales'): InvoiceDraft {
  return {
    type,
    contact_id: '',
    warehouse_id: '',
    issue_date: new Date().toISOString().split('T')[0],
    due_date: '',
    currency: 'TRY',
    exchange_rate: 1,
    rate_date: '',
    notes: '',
    supplier_document_no: '',
    lines: [],
  };
}

function startNew(type: 'sales' | 'purchase') {
  invoiceStore.error = null;
  invoiceStore.openWorkspace('create', emptyDraft(type));
  isDirty.value = false;
  quickPaymentOpen.value = false;
  nextTick(() => {
    panelMaximized.value = true;
    attachResize();
    window.dispatchEvent(new CustomEvent('erp:invoice-panel-move'));
  });
}

function editInvoice(invoice: (typeof invoiceStore.invoices)[0]) {
  invoiceStore.error = null;
  invoiceStore.openWorkspace('edit', {
    id: invoice.id,
    type: invoice.type as InvoiceDraft['type'],
    contact_id: invoice.contact_id || '',
    warehouse_id: invoice.warehouse_id || '',
    issue_date: invoice.issue_date,
    due_date: invoice.due_date || '',
    currency: invoice.currency,
    exchange_rate: invoice.exchange_rate,
    rate_date: invoice.rate_date || '',
    notes: invoice.notes || '',
    supplier_document_no: invoice.supplier_document_no || '',
    posting_status: invoice.posting_status,
    reference_id:
      invoice.reference_type === 'invoice' && invoice.reference_id
        ? invoice.reference_id
        : undefined,
    lines: invoice.lines.map((l): DraftLine => ({
      ...l,
      cost_kind: l.product_id ? 'product' : l.expense_category_id ? 'expense' : undefined,
    })),
  });
  isDirty.value = false;
  nextTick(() => {
    panelMaximized.value = true;
    attachResize();
    window.dispatchEvent(new CustomEvent('erp:invoice-panel-move'));
  });
}

function onTypeChange() {
  isDirty.value = true;
}
function onLineChange() {
  isDirty.value = true;
}
function addLine() {
  if (!draftForm.value) return;
  draftForm.value.lines.push({
    description: draftForm.value.type === 'purchase' ? 'Alış kalemi' : 'Satış kalemi',
    quantity: 1,
    unit_price: 0,
    discount_percent: 0,
    tax_rate_id: '',
    sort_order: draftForm.value.lines.length,
  });
  isDirty.value = true;
}
function removeLine(index: number) {
  if (!draftForm.value) return;
  draftForm.value.lines.splice(index, 1);
  isDirty.value = true;
}

function lineKind(line: InvoiceLine): string {
  return (line as DraftLine).cost_kind ?? '';
}
function setLineKind(line: InvoiceLine, kind: string) {
  const next: LineCostKind | undefined =
    kind === 'product' || kind === 'expense' ? kind : undefined;
  const target = line as DraftLine;
  if (target.cost_kind === next) return;
  target.cost_kind = next;
  // Cins değişince önceki seçim (ürün ya da kategori) geçersiz kalır.
  target.product_id = undefined;
  target.expense_category_id = undefined;
  onLineChange();
}
function onProductPick(line: InvoiceLine, productId: string) {
  line.product_id = productId || undefined;
  line.expense_category_id = undefined;
  const product = stockStore.stock.find((p) => p.id === productId);
  const current = (line.description ?? '').trim();
  if (product && (!current || DEFAULT_LINE_DESCRIPTIONS.includes(current))) {
    line.description = product.name;
  }
  if (product) applyProductDefaults(line, product);
  onLineChange();
}

/**
 * Ürün kartındaki fiyat ve KDV, satıra yalnızca boşsa yazılır: kullanıcının elle girdiği
 * fiyat/KDV ürün değişince ezilmez. Alış tarafı (alış, borç dekontu) alış fiyatı ve alış KDV'sini,
 * diğerleri satış fiyatı ve satış KDV'sini kullanır.
 */
function applyProductDefaults(line: InvoiceLine, product: StockItem) {
  const type = draftForm.value?.type;
  const buying = type === 'purchase' || type === 'debit_note';
  if (!Number(line.unit_price)) {
    const price = Number(buying ? product.cost_price : product.sale_price);
    if (price > 0) line.unit_price = price;
  }
  if (!line.tax_rate_id) {
    const taxId = buying ? product.purchase_tax_rate_id : product.sale_tax_rate_id;
    if (taxId && invoiceStore.taxRates.some((t) => t.id === taxId)) line.tax_rate_id = taxId;
  }
}
function onExpenseCategoryPick(line: InvoiceLine, categoryId: string) {
  line.expense_category_id = categoryId || undefined;
  line.product_id = undefined;
  onLineChange();
}

/**
 * API'ye giden satırlar: arayüz alanı (cost_kind) çıkarılır, boş kimlikler gönderilmez,
 * gider kategorisi yalnızca alış faturasında gönderilir. Ürün ve kategori birlikte gönderilmez.
 * Tevkifat yalnızca satış/alış faturasında ve KDV'li satırda gönderilir (API aksi halde 400 döner).
 */
function toApiLines(lines: InvoiceLine[], type: InvoiceDraft['type']): InvoiceLine[] {
  const withholdingAllowed = type === 'sales' || type === 'purchase';
  return lines.map((line) => {
    const out: DraftLine = { ...(line as DraftLine) };
    delete out.cost_kind;
    if (!out.product_id) delete out.product_id;
    // %0 seçimi boş değer üretir; API boş metni UUID olarak reddeder, alan gönderilmez.
    if (!out.tax_rate_id) delete out.tax_rate_id;
    if (!out.expense_category_id || type !== 'purchase') delete out.expense_category_id;
    if (out.product_id) delete out.expense_category_id;
    if (!withholdingAllowed || !out.withholding_type_id || taxRateFor(out.tax_rate_id) <= 0) {
      delete out.withholding_type_id;
    }
    return out;
  });
}

/**
 * Yeni fatura gönderiminden önce istemci kontrolü (sunucuya gitmeden anlaşılır mesaj).
 * Cari her gönderimde; ürün/gider kategorisi ve tedarikçi belge no yalnız kesinleştirmede zorunlu
 * (sunucu bu kuralları kesinleştirmede uygular, taslak kaydı engellemez).
 */
function createFormProblem(finalize: boolean): string | null {
  const d = draftForm.value;
  if (!d) return null;
  if (!d.contact_id) {
    return d.type === 'purchase'
      ? 'Alış faturasında cari (tedarikçi) seçilmelidir.'
      : 'Lütfen bir cari seçin.';
  }
  if (!finalize || d.type !== 'purchase') return null;
  const lineIndex = d.lines.findIndex((l) => !l.product_id && !l.expense_category_id);
  if (lineIndex !== -1) return `Satır ${lineIndex + 1}: stok ürünü veya gider kategorisi seçin.`;
  if (!(d.supplier_document_no ?? '').trim()) {
    return 'Alış faturasında tedarikçi belge no zorunludur.';
  }
  return null;
}

/** Yeni fatura gövdesi: taslak ve tek ekran gönderimi aynı hazırlığı kullanır. */
function buildCreatePayload(d: InvoiceDraft): CreateInvoiceInput {
  return {
    type: d.type,
    contact_id: d.contact_id || undefined,
    warehouse_id: d.warehouse_id || undefined,
    issue_date: d.issue_date,
    due_date: d.due_date || undefined,
    currency: d.currency,
    exchange_rate: d.exchange_rate || undefined,
    rate_date: d.rate_date || undefined,
    notes: d.notes || undefined,
    ...referencePayload(),
    ...supplierDocumentPayload(),
    lines: toApiLines(d.lines, d.type),
  };
}

async function saveInvoice() {
  if (!draftForm.value || draftForm.value.lines.length === 0) return;
  if (invoiceStore.workspaceMode === 'edit') {
    if (!draftForm.value.contact_id) {
      invoiceStore.error = 'Lütfen bir cari seçin.';
      return;
    }
  } else {
    const problem = createFormProblem(false);
    if (problem) {
      invoiceStore.error = problem;
      return;
    }
  }
  saving.value = true;
  savingKind.value = 'draft';
  try {
    if (invoiceStore.workspaceMode === 'edit' && draftForm.value.id && formPosted.value) {
      // Kesinleşmiş fatura: API yalnız not ve vadeyi kabul eder; satırlar ve diğer alanlar gönderilmez.
      await invoiceStore.updateInvoice(draftForm.value.id, {
        due_date: draftForm.value.due_date || undefined,
        notes: draftForm.value.notes || undefined,
      });
    } else if (invoiceStore.workspaceMode === 'edit' && draftForm.value.id) {
      await invoiceStore.updateInvoice(draftForm.value.id, {
        type: draftForm.value.type,
        contact_id: draftForm.value.contact_id || undefined,
        warehouse_id: draftForm.value.warehouse_id || undefined,
        issue_date: draftForm.value.issue_date,
        due_date: draftForm.value.due_date || undefined,
        currency: draftForm.value.currency,
        exchange_rate: draftForm.value.exchange_rate || undefined,
        rate_date: draftForm.value.rate_date || undefined,
        notes: draftForm.value.notes || undefined,
        ...supplierDocumentPayload(),
      });
      await invoiceStore.replaceLines(
        draftForm.value.id,
        toApiLines(draftForm.value.lines, draftForm.value.type),
      );
    } else {
      const created = await invoiceStore.createInvoice(buildCreatePayload(draftForm.value));
      selectedId.value = created.id;
      await invoiceStore.fetchInvoice(created.id);
      notice.value = { kind: 'success', text: 'Fatura kaydedildi.' };
    }
    invoiceStore.discardDraft();
    isDirty.value = false;
    quickPaymentOpen.value = false;
    await invoiceStore.fetchInvoices();
  } catch (err) {
    /* hata store'da */
  } finally {
    saving.value = false;
    savingKind.value = null;
  }
}

// ── Yeni fatura: tek formdan kaydet / kesinleştir / peşin ödeme-tahsilat (POST /v1/invoices/quick) ──
const isNewWorkspace = computed(() => invoiceStore.workspaceMode === 'create');
/** Kesinleştirilebilen türler (proforma hariç). */
const canQuickFinalize = computed(() =>
  POSTABLE_TYPES.includes(draftForm.value?.type as Invoice['type']),
);
/** Peşin ödeme/tahsilat yalnız satış ve alış faturasında. */
const canQuickPay = computed(
  () => draftForm.value?.type === 'sales' || draftForm.value?.type === 'purchase',
);
const quickPayLabel = computed(() =>
  draftForm.value?.type === 'purchase'
    ? 'Kaydet, Kesinleştir ve Öde'
    : 'Kaydet, Kesinleştir ve Tahsil Et',
);

type QuickPayMethod = 'cash' | 'bank_transfer' | 'credit_card';
/** Hesap seçicinin etiketi; kart yalnız alışta seçilebilir. */
const QUICK_ACCOUNT_LABEL: Record<QuickPayMethod, string> = {
  cash: 'Kasa',
  bank_transfer: 'Banka hesabı',
  credit_card: 'Şirket kredi kartı',
};
const roundMoney = (n: number) => Math.round(n * 100) / 100;

const quickPaymentOpen = ref(false);
const quickPayment = ref<{
  method: QuickPayMethod;
  accountId: string;
  amount: number;
  date: string;
}>({ method: 'cash', accountId: '', amount: 0, date: '' });
/** Kullanıcı tutarı ya da tarihi elle değiştirdiyse form değiştikçe varsayılan yeniden yazılmaz. */
const quickAmountTouched = ref(false);
const quickDateTouched = ref(false);

const quickMethodOptions = computed(() => [
  { value: 'cash', label: 'Kasa' },
  { value: 'bank_transfer', label: 'Banka' },
  ...(draftForm.value?.type === 'purchase'
    ? [{ value: 'credit_card', label: 'Şirket kredi kartı' }]
    : []),
]);
const quickAccountOptions = computed(() => {
  const method = quickPayment.value.method;
  if (method === 'credit_card') {
    return cashBankStore.creditCards
      .filter((c) => c.status === 'active')
      .map((c) => ({
        value: c.id,
        label: c.cardNumberLast4 ? `${c.cardLabel} (•••• ${c.cardNumberLast4})` : c.cardLabel,
      }));
  }
  const accountType = method === 'cash' ? 'cash' : 'bank';
  return cashBankStore.accounts
    .filter((a) => a.accountType === accountType && a.status === 'active')
    .map((a) => ({ value: a.id, label: `${a.accountName} (${a.currency})` }));
});
const quickAccountEmptyText = computed(
  () =>
    `Kayıtlı ${QUICK_ACCOUNT_LABEL[quickPayment.value.method].toLocaleLowerCase('tr-TR')} bulunamadı.`,
);

/** Seçenek listesi değişince geçerli hesap kalmazsa: tek seçenek varsa o seçilir, değilse boş bırakılır. */
watch(quickAccountOptions, (options) => {
  const current = quickPayment.value.accountId;
  if (options.some((o) => o.value === current)) return;
  quickPayment.value.accountId = options.length === 1 ? options[0].value : '';
});

function setQuickMethod(method: string) {
  if (method === quickPayment.value.method) return;
  quickPayment.value.method = method as QuickPayMethod;
  quickPayment.value.accountId = '';
}
function setQuickAccount(id: string) {
  quickPayment.value.accountId = id;
}

/** Kasa/banka ve kart listesi: tüm hesap türleri, en fazla 100; paylaşılan filtreler sonra geri yüklenir. */
async function loadQuickAccounts() {
  const f = cashBankStore.filters;
  const saved = { accountType: f.accountType, status: f.status, limit: f.limit };
  f.accountType = undefined;
  f.status = undefined;
  f.limit = 100;
  try {
    await Promise.all([cashBankStore.fetchAccounts(), cashBankStore.fetchCreditCards()]);
  } finally {
    Object.assign(f, saved);
  }
}

/** Üçüncü düğme: bölümü açar, tutar ve tarihi varsayılanla doldurur. */
function openQuickPayment() {
  quickPaymentOpen.value = true;
  quickAmountTouched.value = false;
  quickDateTouched.value = false;
  quickPayment.value = {
    method: 'cash',
    accountId: '',
    amount: roundMoney(payableTotal.value),
    date: draftForm.value?.issue_date ?? '',
  };
  void loadQuickAccounts();
}

watch(payableTotal, (total) => {
  if (quickPaymentOpen.value && !quickAmountTouched.value) {
    quickPayment.value.amount = roundMoney(total);
  }
});
watch(
  () => draftForm.value?.issue_date,
  (date) => {
    if (quickPaymentOpen.value && !quickDateTouched.value) quickPayment.value.date = date ?? '';
  },
);
watch(
  () => draftForm.value?.type,
  (type) => {
    if (type !== 'sales' && type !== 'purchase') quickPaymentOpen.value = false;
    else if (type !== 'purchase' && quickPayment.value.method === 'credit_card') {
      setQuickMethod('cash');
    }
  },
);

/** Ödeme bölümü açıksa hesap ve tutar kontrolü; sunucuya gitmeden uyarır. */
function quickPaymentProblem(): string | null {
  const p = quickPayment.value;
  const verb = draftForm.value?.type === 'purchase' ? 'Ödeme' : 'Tahsilat';
  if (!p.accountId) {
    return `${verb} için ${QUICK_ACCOUNT_LABEL[p.method].toLocaleLowerCase('tr-TR')} seçin.`;
  }
  if (!(p.amount > 0)) return 'Ödeme tutarı sıfırdan büyük olmalıdır.';
  if (!p.date) return 'Ödeme tarihi seçin.';
  return null;
}

function buildQuickPayment(): QuickPaymentInput {
  const p = quickPayment.value;
  const card = p.method === 'credit_card';
  return {
    amount: roundMoney(p.amount),
    payment_date: p.date,
    payment_method: p.method,
    cash_bank_account_id: card ? undefined : p.accountId,
    credit_card_id: card ? p.accountId : undefined,
  };
}

/**
 * Tek ekran gönderimi. 'finalize': kaydet + kesinleştir. 'payment': + peşin ödeme/tahsilat.
 * Ödeme düğmesinin ilk basışı bölümü açar; hesap ve tutar onaylandıktan sonra ikinci basışta gönderir.
 * Hata olursa form açık kalır ve girilen veriler korunur.
 */
async function submitQuick(kind: 'finalize' | 'payment') {
  const d = draftForm.value;
  if (!d || d.lines.length === 0 || saving.value) return;
  if (kind === 'payment' && !quickPaymentOpen.value) {
    openQuickPayment();
    return;
  }
  const problem = createFormProblem(true) ?? (kind === 'payment' ? quickPaymentProblem() : null);
  if (problem) {
    invoiceStore.error = problem;
    return;
  }
  saving.value = true;
  savingKind.value = kind;
  let created: Invoice;
  try {
    created = await invoiceStore.createInvoiceQuick(buildCreatePayload(d), {
      finalize: true,
      payment: kind === 'payment' ? buildQuickPayment() : undefined,
    });
  } catch {
    /* hata store'da (error.message) */
    return;
  } finally {
    saving.value = false;
    savingKind.value = null;
  }
  // Kayıt tamam: detay gösterilir, form kapanır. Liste store tarafında tazelendi.
  selectedId.value = created.id;
  await invoiceStore.fetchInvoice(created.id).catch(() => undefined);
  isDirty.value = false;
  quickPaymentOpen.value = false;
  invoiceStore.discardDraft();
  notice.value = {
    kind: 'success',
    text:
      kind === 'payment'
        ? 'Fatura kesinleştirildi ve ödeme/tahsilat kaydedildi.'
        : 'Fatura kesinleştirildi.',
  };
}

function requestClose() {
  if (isDirty.value) {
    showCloseConfirm.value = true;
  } else {
    invoiceStore.closeWorkspace();
  }
}
function confirmDiscard() {
  invoiceStore.discardDraft();
  isDirty.value = false;
  showCloseConfirm.value = false;
  panelMaximized.value = false;
}

// ── Taslak kalıcılığı ──
watch(
  draftForm,
  (v) => {
    if (!v || !invoiceStore.workspaceOpen) return;
    if (isDirty.value) invoiceStore.updateDraft(v);
  },
  { deep: true },
);

function toggleMaximize() {
  panelMaximized.value = !panelMaximized.value;
  nextTick(attachResize);
  window.dispatchEvent(new CustomEvent('erp:invoice-panel-move'));
}

function startDrag(e: MouseEvent) {
  if (e.target !== e.currentTarget) return;
  if (panelMaximized.value) return;
  dragStart.value = { x: e.clientX, y: e.clientY, l: panelPos.value.left, t: panelPos.value.top };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove(e: MouseEvent) {
  if (!dragStart.value) return;
  const dx = e.clientX - dragStart.value.x;
  const dy = e.clientY - dragStart.value.y;
  panelPos.value.left = Math.max(0, dragStart.value.l + dx);
  panelPos.value.top = Math.max(0, dragStart.value.t + dy);
  window.dispatchEvent(new CustomEvent('erp:invoice-panel-move'));
}
function onDragEnd() {
  dragStart.value = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// ── Liste ──
async function loadData() {
  await Promise.all([
    invoiceStore.fetchInvoices(),
    invoiceStore.fetchTaxRates(),
    contactStore.fetchContacts().catch(() => {}),
  ]);
  contacts.value = contactStore.contacts;
  try {
    const wh = await (await fetch('/api/v1/stock/warehouses', { credentials: 'include' })).json();
    warehouses.value = Array.isArray(wh.data) ? wh.data : Array.isArray(wh) ? wh : [];
  } catch {
    warehouses.value = [];
  }
}

function applyFilters() {
  invoiceStore.setFilters({
    page: 1,
    q: searchQuery.value.trim() || undefined,
    type: typeFilter.value || undefined,
    status: statusFilter.value || undefined,
    date_from: dateFrom.value || undefined,
    date_to: dateTo.value || undefined,
  });
  invoiceStore.fetchInvoices();
}

const prevPage = () => {
  if (pagination.value.page > 1) {
    invoiceStore.setFilters({ page: pagination.value.page - 1 });
    invoiceStore.fetchInvoices();
  }
};
const nextPage = () => {
  if (pagination.value.page < pagination.value.pages) {
    invoiceStore.setFilters({ page: pagination.value.page + 1 });
    invoiceStore.fetchInvoices();
  }
};

async function selectInvoice(id: string) {
  if (selectedId.value === id) return;
  selectedId.value = id;
  notice.value = null;
  try {
    await invoiceStore.fetchInvoice(id);
  } catch {
    /* hata store'da */
  }
}

async function deleteInvoice(id: string) {
  if (!confirm('Bu faturayı silmek istediğinize emin misiniz?')) return;
  try {
    await invoiceStore.deleteInvoice(id);
    if (selectedId.value === id) selectedId.value = null;
  } catch {
    /* store hatası */
  }
}

// ── Ödeme ──
function openPayment() {
  showPaymentModal.value = true;
  paymentForm.value.amount = Number(selectedInvoice.value?.balance) || 0;
  paymentForm.value.payment_date = new Date().toISOString().split('T')[0];
  paymentForm.value.payment_method = 'cash';
  paymentForm.value.reference = '';
}
async function submitPayment() {
  if (!selectedId.value || !paymentForm.value.amount) return;
  paymentSaving.value = true;
  try {
    await invoiceStore.addPayment(selectedId.value, { ...paymentForm.value });
    showPaymentModal.value = false;
  } catch {
    /* store hatası */
  } finally {
    paymentSaving.value = false;
  }
}

function printInvoice() {
  window.print();
}

// ── Kısayol: Escape çalışmayı kapatmaz (erp-workspace-panels) ──
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && invoiceStore.workspaceOpen) {
    requestClose();
  }
}

function clampPanel() {
  const el = panelEl.value;
  if (!el || panelMaximized.value) return;
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  if (rect.left > maxLeft) panelPos.value.left = Math.min(panelPos.value.left, maxLeft);
}

onMounted(async () => {
  await loadData();
  invoiceStore.loadPanelState();
  const saved = invoiceStore.loadDraft();
  if (saved) {
    draftForm.value = saved;
    invoiceStore.workspaceOpen = true;
    invoiceStore.workspaceMode = saved.id ? 'edit' : 'create';
    isDirty.value = true;
    nextTick(() => {
      panelMaximized.value = true;
      attachResize();
      window.dispatchEvent(new CustomEvent('erp:invoice-panel-move'));
    });
  }
  loadColWidths();
  window.addEventListener('resize', clampPanel);
  window.addEventListener('keydown', onKeydown);
  // Muavin panelindeki "Belgeyi yeni sekmede aç" bağlantısı: /invoices?id=<faturaId>
  if (typeof route.query.id === 'string' && route.query.id) await selectInvoice(route.query.id);
});

watch(
  () => route.query.id,
  (id) => {
    if (typeof id === 'string' && id) void selectInvoice(id);
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', clampPanel);
  window.removeEventListener('keydown', onKeydown);
});

// Panel açıkken draftForm senkron
watch(
  () => invoiceStore.draft,
  (d) => {
    if (d && invoiceStore.workspaceOpen) {
      draftForm.value = d;
    }
  },
  { immediate: true },
);

// Döviz değişince kur/rate_date davranışını senkronla
watch(
  () => draftForm.value?.currency,
  (currency, prev) => {
    if (!draftForm.value) return;
    isDirty.value = true;
    if (currency === 'TRY') {
      draftForm.value.exchange_rate = 1;
      draftForm.value.rate_date = '';
    } else if (prev === 'TRY') {
      // Kur boş bırakılırsa API otomatik çözer; kur tarihi issue_date'e oturur.
      draftForm.value.exchange_rate = undefined;
      if (!draftForm.value.rate_date) draftForm.value.rate_date = draftForm.value.issue_date;
    }
  },
);
</script>

<style scoped>
/* Fintech paleti — erişilebilir kontrast */
.invoices-workspace {
  --c-primary: #1d4ed8;
  --c-border: #e2e8f0;
  --c-muted: #64748b;
  --c-bg: #f8fafc;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  padding: 1.5rem;
  min-height: 100%;
  max-width: 90rem;
  margin-inline: auto;
}

/* === MASTER: liste === */
.master-panel {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  overflow: hidden;
}
.master-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--c-border);
}
.master-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.master-title h2 {
  margin: 0;
  font-size: 1.125rem;
}
.master-title .count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--c-muted);
  background: var(--c-bg);
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
}
.master-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--c-border);
}
.search-input,
.type-select {
  font: inherit;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: #fff;
}
.search-input {
  flex: 1;
  min-width: 12rem;
  max-width: 24rem;
}
.search-input.date {
  max-width: 10rem;
  flex: none;
}
.type-select {
  flex: none;
}
.search-input:focus-visible,
.type-select:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
  border-color: var(--c-primary);
}
.list-wrap {
  overflow-x: auto;
}
.master-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.master-table th,
.master-table td {
  text-align: left;
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
}
.master-table th {
  background: var(--c-bg);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.master-table tbody tr {
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.master-table tbody tr:hover {
  background: var(--c-bg);
}
.master-table tbody tr.active {
  background: #eff6ff;
  box-shadow: inset 3px 0 0 var(--c-primary);
}
.master-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.master-table .strong {
  font-weight: 600;
}
.master-table .mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 0.8125rem;
}
.master-table .muted {
  color: var(--c-muted);
}
.master-table .empty-cell {
  text-align: center;
  color: var(--c-muted);
  padding: 2rem 1rem;
  white-space: normal;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--c-border);
  font-size: 0.875rem;
  color: var(--c-muted);
}

/* === DETAY (alt) === */
.detail-panel {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  padding: 1.5rem;
  min-width: 0;
}
.detail-panel.empty-state {
  display: grid;
  place-items: center;
  min-height: 12rem;
  color: var(--c-muted);
  padding: 2rem;
}
.detail-header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2rem;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--c-border);
}
.detail-header h2 {
  margin: 0.25rem 0 0;
  font-size: 1.375rem;
}
.detail-sub {
  margin: 0.125rem 0 0;
  color: var(--c-muted);
  font-size: 0.9375rem;
}
.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin: 0;
}
.lines-table .empty-cell {
  text-align: center;
  color: var(--c-muted);
  padding: 1.5rem 1rem;
}
.detail-meta dt,
.detail-summary .label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.detail-meta dd {
  margin: 0.125rem 0 0;
  font-weight: 600;
  font-size: 0.9375rem;
}
.detail-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 2rem;
  padding: 0.875rem 1rem;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  margin: 1rem 0 0;
}
.detail-summary .label {
  display: block;
  margin-bottom: 0.125rem;
}
.amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.amount.total {
  color: var(--c-primary);
  font-size: 1.0625rem;
}
.amount.paid {
  color: #047857;
}
.amount.balance {
  color: var(--c-primary);
}
.detail-section {
  margin-top: 1.25rem;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}
.section-head h3 {
  margin: 0;
  font-size: 1.0625rem;
}
.lines-wrap {
  overflow-x: auto;
}
.lines-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.lines-table th,
.lines-table td {
  text-align: left;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--c-border);
}
.lines-table th {
  background: var(--c-bg);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
  white-space: nowrap;
}
.lines-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lines-table .strong {
  font-weight: 600;
}
.lines-table .muted {
  color: var(--c-muted);
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--c-border);
}

/* === KALICI YENİ FATURA PANELİ === */
.invoice-workspace-panel {
  position: fixed;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  box-shadow: 0 24px 48px -16px rgb(15 23 42 / 0.35);
  left: var(--erp-invoice-left, calc(var(--erp-sidebar-width, 16rem) + 1.5rem));
  top: var(--erp-invoice-top, calc(var(--erp-header-height, 4rem) + 1.5rem));
  width: min(900px, calc(100vw - var(--erp-sidebar-width, 16rem) - 3rem));
  max-height: calc(100vh - var(--erp-header-height, 4rem) - 3rem);
  overflow: hidden;
}
.invoice-workspace-panel.maximized {
  left: var(--erp-sidebar-width, 16rem) !important;
  top: calc(var(--erp-header-height, 4rem) + 0.75rem) !important;
  right: 1.5rem;
  width: auto !important;
  max-height: calc(100vh - var(--erp-header-height, 4rem) - 2.25rem);
}
.invoice-workspace-panel.minimized {
  height: auto;
  width: 22rem;
}
.wp-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
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
.wp-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--c-primary);
}
.wp-dirty {
  color: var(--c-warning);
  font-size: 0.75rem;
}
.wp-controls {
  display: inline-flex;
  gap: 0.25rem;
  flex: none;
}
.wp-btn {
  border: 0;
  background: transparent;
  color: var(--c-muted);
  font-size: 0.875rem;
  line-height: 1;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
}
.wp-btn:hover {
  background: var(--c-bg);
  color: var(--c-text);
}
.wp-btn.danger:hover {
  color: var(--c-danger);
}
.wp-btn:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}
.wp-body {
  overflow-y: auto;
  padding: 1.25rem;
}
.invoice-form {
  display: grid;
  gap: 1rem;
}
.line-items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.line-items-head h3 {
  margin: 0;
  font-size: 1.0625rem;
}
.line-items-tools {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}
.lines-editor {
  overflow-x: auto;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
}
.lines-edit-table {
  width: 100%;
  min-width: 48rem;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.lines-edit-table th,
.lines-edit-table td {
  text-align: left;
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid var(--c-border);
  vertical-align: middle;
}
.lines-edit-table th {
  background: var(--c-bg);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
  white-space: nowrap;
  position: relative;
  user-select: none;
}
.lines-edit-table th:not(.col-product):not(.col-aksiyon) {
  cursor: col-resize;
}
.lines-edit-table th::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 3px;
  cursor: col-resize;
}
.lines-edit-table .input,
.lines-edit-table .select {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
}
.lines-edit-table .num-input {
  text-align: right;
}
.line-total {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lines-edit-table .empty-cell {
  text-align: center;
  color: var(--c-muted);
  padding: 1.5rem;
  white-space: normal;
}
.totals {
  max-width: 22rem;
  margin-left: auto;
  display: grid;
  gap: 0.375rem;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem;
  font-variant-numeric: tabular-nums;
}
.totals-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9375rem;
}
.totals-row.grand {
  font-weight: 700;
  font-size: 1.0625rem;
  border-top: 1px solid var(--c-border);
  padding-top: 0.5rem;
  color: var(--c-primary);
}
.panel-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.panel-actions-group {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
}
/* Peşin ödeme/tahsilat bölümü: .totals ile aynı yüzey ve kenar. */
.quick-pay {
  display: grid;
  gap: 0.75rem;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem;
}
.wp-foot {
  padding: 0.625rem 1.25rem;
  border-top: 1px solid var(--c-border);
  background: var(--c-bg);
  flex: none;
}
.wp-foot .small {
  font-size: 0.8125rem;
}

/* Mobil */
@media (max-width: 56rem) {
  .invoices-workspace {
    padding: 1rem;
  }
  .invoice-workspace-panel {
    left: 0.5rem !important;
    width: calc(100vw - 1rem) !important;
    max-height: calc(100vh - var(--erp-header-height, 4rem) - 1rem);
  }
  .master-actions {
    width: 100%;
  }
  .master-actions .btn {
    flex: 1;
  }
}
</style>
