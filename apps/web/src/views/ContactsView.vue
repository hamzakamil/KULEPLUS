<template>
  <div class="page contacts-page">
    <!-- ══ ÜST ÇUBUK ══ -->
    <header class="page-header">
      <div>
        <h1 class="page-title">Cari Hesaplar</h1>
        <p class="page-sub">
          Müşteri / tedarikçi kartları, ekstreler ve risk takibi. F2 yeni kayıt · F3 arama.
        </p>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-ghost" @click="showImport = true">İçe Aktar</button>
        <button type="button" class="btn btn-ghost" :disabled="exporting" @click="exportCsv">
          {{ exporting ? 'Aktarılıyor…' : 'Dışa Aktar' }}
        </button>
        <RouterLink :to="{ name: 'contact-create' }" class="btn btn-primary"
          >+ Yeni Cari</RouterLink
        >
      </div>
    </header>

    <!-- ══ BİLDİRİM ══ -->
    <div
      v-if="notice"
      class="alert"
      :class="notice.kind === 'error' ? 'alert-error' : 'alert-success'"
      role="alert"
    >
      <span>{{ notice.text }}</span>
      <button class="alert-dismiss" type="button" @click="notice = null" aria-label="Kapat">
        &times;
      </button>
    </div>

    <!-- ══ KPI ŞERİDİ ══ -->
    <div class="kpi-strip">
      <div class="kpi">
        <span class="kpi-label">Toplam Cari</span>
        <strong class="kpi-value">{{ stats?.total ?? 0 }}</strong>
        <span class="kpi-sub"
          >{{ stats?.active ?? 0 }} aktif · {{ stats?.inactive ?? 0 }} pasif</span
        >
      </div>
      <div class="kpi">
        <span class="kpi-label">Müşteri / Tedarikçi</span>
        <strong class="kpi-value">
          <span class="cust">{{ stats?.customers ?? 0 }}</span> /
          <span class="sup">{{ stats?.suppliers ?? 0 }}</span>
        </strong>
        <span class="kpi-sub">Dağılım</span>
      </div>
      <div class="kpi" :class="{ pos: (stats?.totalReceivable ?? 0) > 0 }">
        <span class="kpi-label">Toplam Alacak</span>
        <strong class="kpi-value">{{ money(stats?.totalReceivable ?? 0) }}</strong>
        <span class="kpi-sub">Açık satış faturaları</span>
      </div>
      <div class="kpi" :class="{ warn: (stats?.totalPayable ?? 0) > 0 }">
        <span class="kpi-label">Toplam Borç</span>
        <strong class="kpi-value">{{ money(stats?.totalPayable ?? 0) }}</strong>
        <span class="kpi-sub">Açık alış faturaları</span>
      </div>
      <div class="kpi" :class="netTone">
        <span class="kpi-label">Net Bakiye</span>
        <strong class="kpi-value">{{ money(stats?.netBalance ?? 0) }}</strong>
        <span class="kpi-sub">{{
          (stats?.netBalance ?? 0) >= 0 ? 'Alacaklıyız' : 'Borçluyuz'
        }}</span>
      </div>
      <div class="kpi" :class="{ danger: (stats?.overdueAmount ?? 0) > 0 }">
        <span class="kpi-label">Vadesi Geçen</span>
        <strong class="kpi-value">{{ money(stats?.overdueAmount ?? 0) }}</strong>
        <span class="kpi-sub">{{ stats?.missingTaxNumber ?? 0 }} caride VKN eksik</span>
      </div>
    </div>

    <!-- ══ FİLTRE ÇUBUĞU ══ -->
    <div class="filter-bar">
      <div class="search-box">
        <svg
          class="icon icon-sm"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          class="filter-search"
          placeholder="Kod, ünvan, VKN ara…"
          aria-label="Cari ara"
        />
        <kbd v-if="!search" class="kbd">F3</kbd>
      </div>
      <select v-model="typeFilter" class="mini-select" aria-label="Cari türü">
        <option value="">Tüm tür</option>
        <option value="customer">Müşteri</option>
        <option value="supplier">Tedarikçi</option>
      </select>
      <select v-model="statusFilter" class="mini-select" aria-label="Durum">
        <option value="">Tüm durum</option>
        <option value="active">Aktif</option>
        <option value="inactive">Pasif</option>
      </select>
      <select v-model="sortKey" class="mini-select" aria-label="Sıralama">
        <option value="name">Ada göre</option>
        <option value="code">Koda göre</option>
        <option value="balance">Bakiyeye göre</option>
        <option value="created_at">Kayıt tarihine göre</option>
      </select>
      <button
        type="button"
        class="sort-dir"
        :title="sortDir === 'asc' ? 'Artan sıra' : 'Azalan sıra'"
        @click="onSortDirToggle"
      >
        {{ sortDir === 'asc' ? '↑' : '↓' }}
      </button>
      <label class="check-inline">
        <input v-model="onlyWithBalance" type="checkbox" />
        <span>Bakiyesi olanlar</span>
      </label>
      <button
        type="button"
        class="btn btn-ghost btn-icon"
        :disabled="store.loading"
        title="Yenile"
        aria-label="Listeyi yenile"
        @click="refresh"
      >
        ⟳
      </button>
      <span class="result-count">{{ pagination?.total ?? 0 }} kayıt</span>
    </div>

    <!-- ══ MASTER + DETAY ══ -->
    <div class="contacts-layout">
      <!-- ── SOL: kompakt liste ── -->
      <aside class="master-card" aria-label="Cari hesap listesi">
        <table class="dense-table" role="listbox">
          <thead>
            <tr>
              <th class="col-name">Ünvan / Kod</th>
              <th class="col-type">Tür</th>
              <th class="col-bal num">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(c, i) in visibleContacts"
              :key="c.id"
              role="option"
              :aria-selected="selectedId === c.id"
              :class="{ active: selectedId === c.id, dim: !c.is_active, focused: focusIndex === i }"
              tabindex="0"
              @click="selectContact(c.id)"
              @dblclick="openEdit(c)"
              @keydown.enter="selectContact(c.id)"
            >
              <td class="col-name">
                <span class="row-title">{{ c.name.toLocaleUpperCase('tr-TR') }}</span>
                <span class="row-sub">
                  <span class="mono">{{ c.code }}</span>
                  <span v-if="c.tax_number" class="tax">· VKN {{ c.tax_number }}</span>
                </span>
              </td>
              <td class="col-type">
                <span class="pill" :class="c.type">{{ typeLabel(c.type) }}</span>
              </td>
              <td class="col-bal num" :class="balanceTone(c.balance)">
                <span class="bal-value">{{ money(c.balance) }}</span>
                <span class="bal-side">{{ balanceSide(c.balance) }}</span>
              </td>
            </tr>
            <tr v-if="store.loading">
              <td colspan="3" class="empty-cell">Yükleniyor…</td>
            </tr>
            <tr v-else-if="!visibleContacts.length">
              <td colspan="3" class="empty-cell">Kayıt bulunamadı.</td>
            </tr>
          </tbody>
        </table>
        <div v-if="pagination && pagination.pages > 1" class="pager">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="pagination.page <= 1"
            @click="changePage(pagination.page - 1)"
          >
            ‹
          </button>
          <span class="pager-text">{{ pagination.page }} / {{ pagination.pages }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="pagination.page >= pagination.pages"
            @click="changePage(pagination.page + 1)"
          >
            ›
          </button>
        </div>
      </aside>

      <!-- ── SAĞ: detay ── -->
      <section v-if="displayContact" class="detail-card" aria-label="Cari detayı">
        <div class="detail-header">
          <span class="avatar" :class="displayContact.type">
            {{ avatarInitials(displayContact) }}
          </span>
          <div class="detail-id">
            <div class="detail-badges">
              <span class="pill" :class="displayContact.type">
                {{ typeLabel(displayContact.type) }}
              </span>
              <span class="pill" :class="displayContact.is_active ? 'on' : 'off'">
                {{ displayContact.is_active ? 'Aktif' : 'Pasif' }}
              </span>
              <span v-if="summary?.risk.overdueDocuments" class="pill danger">
                {{ summary.risk.overdueDocuments }} vadesi geçen belge
              </span>
            </div>
            <h2 class="detail-name">{{ displayContact.name.toLocaleUpperCase('tr-TR') }}</h2>
            <div class="detail-meta">
              <span class="mono">{{ displayContact.code }}</span>
              <span v-if="displayContact.tax_number">· VKN {{ displayContact.tax_number }}</span>
              <span v-if="displayContact.tax_office">· {{ displayContact.tax_office }}</span>
              <span v-if="primaryPhone">· ☎ {{ primaryPhone }}</span>
            </div>
          </div>
          <div class="detail-actions">
            <button
              v-if="canManagement"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="openQuickTask"
            >
              + Görev
            </button>
            <button
              v-if="canManagement"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="openQuickAppt"
            >
              + Randevu
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="toggling"
              @click="toggleActive(displayContact)"
            >
              {{ displayContact.is_active ? 'Pasif Yap' : 'Aktif Yap' }}
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              @click="openEdit(displayContact)"
            >
              Düzenle
            </button>
            <button type="button" class="btn btn-danger btn-sm" @click="askDelete(displayContact)">
              Sil
            </button>
          </div>
        </div>

        <!-- Bakiye / risk göstergeleri -->
        <div class="metric-strip">
          <div class="metric">
            <span class="metric-label">Borç</span>
            <strong class="metric-value debit">{{ money(summary?.balance.debit ?? 0) }}</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Alacak</span>
            <strong class="metric-value credit">{{ money(summary?.balance.credit ?? 0) }}</strong>
          </div>
          <div class="metric" :class="netMetricTone">
            <span class="metric-label">Bakiye</span>
            <strong class="metric-value">{{ money(summary?.balance.balance ?? 0) }}</strong>
          </div>
          <div class="metric" :class="{ warn: (summary?.risk.totalReceivable ?? 0) > 0 }">
            <span class="metric-label">Açık Alacak</span>
            <strong class="metric-value">{{ money(summary?.risk.totalReceivable ?? 0) }}</strong>
          </div>
          <div class="metric" :class="{ danger: (summary?.risk.overdueAmount ?? 0) > 0 }">
            <span class="metric-label">Vadesi Geçen</span>
            <strong class="metric-value">{{ money(summary?.risk.overdueAmount ?? 0) }}</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Açık Belge</span>
            <strong class="metric-value">{{ summary?.risk.openDocuments ?? 0 }}</strong>
          </div>
        </div>

        <!-- Yaşlandırma çubuğu -->
        <div v-if="agingTotal > 0" class="aging-bar" aria-label="Alacak yaşlandırma">
          <div
            v-for="b in agingBars"
            :key="b.key"
            class="aging-seg"
            :class="b.tone"
            :style="{ flexGrow: b.value || 0.001 }"
            :title="`${b.label}: ${money(b.value)}`"
          ></div>
        </div>
        <div v-if="agingTotal > 0" class="aging-legend">
          <span v-for="b in agingBars" :key="b.key" class="legend-item">
            <i :class="b.tone"></i>{{ b.label }}: {{ money(b.value) }}
          </span>
        </div>

        <!-- Sekmeler -->
        <nav class="detail-tabs" role="tablist" aria-label="Cari detay sekmeleri">
          <button
            v-for="tab in detailTabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="detailTab === tab.key"
            :class="{ active: detailTab === tab.key }"
            @click="detailTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </nav>

        <!-- ── EKSTRE ── -->
        <div v-show="detailTab === 'ekstre'" class="tab-panel" role="tabpanel">
          <div class="panel-toolbar">
            <select v-model="ledgerTypeFilter" class="mini-select" aria-label="Ekstre filtresi">
              <option value="">Borç & Alacak</option>
              <option value="receivable">Sadece Borç</option>
              <option value="payable">Sadece Alacak</option>
            </select>
            <span class="muted small">
              Devir: {{ money(ledgerSummary?.openingBalance ?? 0) }}
            </span>
          </div>
          <div v-if="ledgerLoading" class="state-msg">Ekstre yükleniyor…</div>
          <p v-else-if="ledgerError" class="state-msg error-msg">{{ ledgerError }}</p>
          <template v-else-if="ledgerRows.length">
            <table class="dense-table ledger-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Belge</th>
                  <th>Açıklama</th>
                  <th class="num">Borç</th>
                  <th class="num">Alacak</th>
                  <th class="num">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in ledgerRows" :key="row.id">
                  <td class="nowrap">{{ shortDate(row.posted_at) }}</td>
                  <td class="mono small">{{ row.document_number || '—' }}</td>
                  <td class="desc">{{ row.description || row.document_type || '—' }}</td>
                  <td class="num debit">
                    {{ row.type === 'receivable' ? money(row.amount) : '' }}
                  </td>
                  <td class="num credit">{{ row.type === 'payable' ? money(row.amount) : '' }}</td>
                  <td class="num strong">{{ money(row.balance) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="ledgerPagination && ledgerPagination.pages > 1" class="pager">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="ledgerPage <= 1"
                @click="ledgerPage--"
              >
                ‹ Önceki
              </button>
              <span class="pager-text">{{ ledgerPage }} / {{ ledgerPagination.pages }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="ledgerPage >= ledgerPagination.pages"
                @click="ledgerPage++"
              >
                Sonraki ›
              </button>
            </div>
          </template>
          <p v-else class="state-msg">Bu cariye ait hareket bulunamadı.</p>
        </div>

        <!-- ── AÇIK BELGELER ── -->
        <div v-show="detailTab === 'belge'" class="tab-panel" role="tabpanel">
          <div v-if="summary" class="doc-matrix">
            <button
              v-for="d in docShortcuts"
              :key="d.key"
              type="button"
              class="doc-chip"
              :class="{ zero: !d.count }"
            >
              <span class="doc-chip-label">{{ d.label }}</span>
              <span class="doc-chip-count">{{ d.count }}</span>
            </button>
          </div>
          <table v-if="summary?.documents.length" class="dense-table">
            <thead>
              <tr>
                <th>Belge No</th>
                <th>Tür</th>
                <th>Tarih</th>
                <th>Vade</th>
                <th class="num">Toplam</th>
                <th class="num">Kalan</th>
                <th class="num">Gecikme</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in summary.documents" :key="doc.id">
                <td class="mono">{{ doc.number }}</td>
                <td>
                  <span class="pill" :class="doc.type === 'sales' ? 'on' : 'off'">
                    {{ doc.type === 'sales' ? 'Satış' : 'Alış' }}
                  </span>
                </td>
                <td class="nowrap">{{ shortDate(doc.issue_date) }}</td>
                <td class="nowrap">{{ doc.due_date ? shortDate(doc.due_date) : '—' }}</td>
                <td class="num">{{ money(doc.total) }}</td>
                <td class="num strong" :class="{ danger: doc.balance > 0 }">
                  {{ money(doc.balance) }}
                </td>
                <td class="num" :class="{ danger: doc.days_overdue > 0 }">
                  {{ doc.days_overdue > 0 ? `${doc.days_overdue} gün` : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="state-msg">Bu cariye ait belge bulunamadı.</p>
        </div>

        <!-- ── KÜNYE ── -->
        <div v-show="detailTab === 'kunya'" class="tab-panel" role="tabpanel">
          <dl class="kunya-grid">
            <div class="kunya-item">
              <dt>Hesap Kodu</dt>
              <dd class="mono">{{ displayContact.code }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Ünvan / Ad Soyad</dt>
              <dd>{{ displayContact.name.toLocaleUpperCase('tr-TR') }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Ticari Unvan</dt>
              <dd>{{ displayContact.trade_name?.toLocaleUpperCase('tr-TR') || '—' }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Cari Türü</dt>
              <dd>{{ typeLabel(displayContact.type) }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Vergi No / TCKN</dt>
              <dd>{{ displayContact.tax_number || '—' }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Vergi Dairesi</dt>
              <dd>{{ displayContact.tax_office?.toLocaleUpperCase('tr-TR') || '—' }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Kayıt Tarihi</dt>
              <dd>{{ shortDate(displayContact.created_at) }}</dd>
            </div>
            <div class="kunya-item">
              <dt>Son Güncelleme</dt>
              <dd>{{ shortDate(displayContact.updated_at) }}</dd>
            </div>
          </dl>
        </div>

        <!-- ── ADRESLER ── -->
        <div v-show="detailTab === 'adres'" class="tab-panel" role="tabpanel">
          <p v-if="!displayContact.addresses?.length" class="state-msg">Kayıtlı adres yok.</p>
          <ul v-else class="info-list">
            <li v-for="a in displayContact.addresses" :key="a.id" class="info-item">
              <span class="info-badge">{{ ADDRESS_TYPES[a.type] ?? a.type }}</span>
              <div class="info-body">
                <p>{{ addressLine(a) || 'Adres bilgisi girilmemiş.' }}</p>
                <p v-if="a.zip_code" class="info-sub">Posta Kodu: {{ a.zip_code }}</p>
              </div>
            </li>
          </ul>
        </div>

        <!-- ── İLETİŞİM ── -->
        <div v-show="detailTab === 'iletisim'" class="tab-panel" role="tabpanel">
          <div class="comm-cols">
            <div class="comm-section">
              <h4 class="comm-title">Telefonlar</h4>
              <p v-if="!displayContact.phones?.length" class="state-msg">Telefon yok.</p>
              <ul v-else class="info-list">
                <li v-for="p in displayContact.phones" :key="p.id" class="info-item">
                  <span class="info-badge">{{ PHONE_TYPES[p.type] ?? p.type }}</span>
                  <div class="info-body">
                    <p>{{ p.formatted ?? p.number }}</p>
                    <p v-if="p.is_primary" class="info-sub">Birincil</p>
                  </div>
                </li>
              </ul>
            </div>
            <div class="comm-section">
              <h4 class="comm-title">E-posta</h4>
              <p v-if="!displayContact.emails?.length" class="state-msg">E-posta yok.</p>
              <ul v-else class="info-list">
                <li v-for="e in displayContact.emails" :key="e.id" class="info-item">
                  <span class="info-badge">{{ EMAIL_TYPES[e.type] ?? e.type }}</span>
                  <div class="info-body">
                    <p>{{ e.email }}</p>
                    <p v-if="e.is_primary" class="info-sub">Birincil</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Boş durum ── -->
      <section v-else class="detail-card detail-empty">
        <div class="empty-state">
          <span class="empty-icon" aria-hidden="true">👤</span>
          <p>Detayları görmek için soldan bir cari seçin.</p>
          <p class="muted small">↑ / ↓ ile gezinin · Enter ile açın · Çift tıkla düzenleyin</p>
        </div>
      </section>
    </div>

    <!-- ══ DÜZENLE MODALI ══ -->
    <div v-if="editOpen" class="modal-overlay" @click.self="editOpen = false">
      <div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <header class="modal-header">
          <h3 id="edit-title">Cari Kartı Düzenle</h3>
          <button type="button" class="modal-close" @click="editOpen = false" aria-label="Kapat">
            &times;
          </button>
        </header>
        <form class="modal-body" novalidate @submit.prevent="saveEdit">
          <div class="form-grid">
            <div class="field">
              <label for="edit-code" class="field-label">Hesap Kodu</label>
              <input id="edit-code" v-model="editForm.code" type="text" class="input" disabled />
            </div>
            <div class="field">
              <label for="edit-type" class="field-label">Cari Türü</label>
              <select id="edit-type" v-model="editForm.type" class="input">
                <option value="customer">Müşteri</option>
                <option value="supplier">Tedarikçi</option>
              </select>
            </div>
            <div class="field">
              <label for="edit-name" class="field-label">Ünvan / Ad Soyad *</label>
              <input id="edit-name" v-model="editForm.name" type="text" class="input" required />
            </div>
            <div class="field">
              <label for="edit-trade" class="field-label">Ticari Unvan</label>
              <input id="edit-trade" v-model="editForm.trade_name" type="text" class="input" />
            </div>
            <div class="field">
              <label for="edit-taxno" class="field-label">Vergi No / TCKN</label>
              <input id="edit-taxno" v-model="editForm.tax_number" type="text" class="input" />
            </div>
            <div class="field">
              <label for="edit-taxoffice" class="field-label">Vergi Dairesi</label>
              <FilterableSelect
                id="edit-taxoffice"
                v-model="editForm.tax_office"
                :options="ALL_TAX_OFFICES"
                placeholder="Vergi dairesi yazıp seçin"
              />
            </div>
            <div class="field field-full">
              <label class="checkbox">
                <input v-model="editForm.is_active" type="checkbox" />
                <span>Aktif kart</span>
              </label>
            </div>
          </div>
          <p v-if="editError" class="form-error">{{ editError }}</p>
          <footer class="modal-footer">
            <button type="button" class="btn btn-ghost" @click="editOpen = false">İptal</button>
            <button type="submit" class="btn btn-primary" :disabled="editSaving">
              {{ editSaving ? 'Kaydediliyor…' : 'Kaydet' }}
            </button>
          </footer>
        </form>
      </div>
    </div>

    <!-- ══ SİLME ONAYI ══ -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
        <header class="modal-header">
          <h3 id="del-title">Cari Kartını Sil</h3>
          <button type="button" class="modal-close" @click="deleteTarget = null" aria-label="Kapat">
            &times;
          </button>
        </header>
        <div class="modal-body">
          <p>
            <strong>{{ deleteTarget.name.toLocaleUpperCase('tr-TR') }}</strong>
            ({{ deleteTarget.code }}) kartı kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </p>
          <p v-if="deleteError" class="form-error">{{ deleteError }}</p>
          <footer class="modal-footer">
            <button type="button" class="btn btn-ghost" @click="deleteTarget = null">Vazgeç</button>
            <button
              type="button"
              class="btn btn-danger"
              :disabled="deleting"
              @click="confirmDelete"
            >
              {{ deleting ? 'Siliniyor…' : 'Evet, Sil' }}
            </button>
          </footer>
        </div>
      </div>
    </div>

    <!-- ══ İÇE AKTARMA (CSV) ══ -->
    <div v-if="showImport" class="modal-overlay" @click.self="showImport = false">
      <div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header class="modal-header">
          <h3 id="import-title">CSV ile Cari İçe Aktar</h3>
          <button type="button" class="modal-close" @click="showImport = false" aria-label="Kapat">
            &times;
          </button>
        </header>
        <div class="modal-body">
          <p class="muted small">
            İlk satır başlık olmalıdır. Önizleme sonrası yalnızca geçerli satırlar aktarılır.
          </p>
          <input
            ref="fileInput"
            type="file"
            accept=".csv,text/csv"
            class="input"
            @change="onFilePicked"
          />
          <p v-if="importError" class="form-error">{{ importError }}</p>
          <div v-if="importReport" class="import-summary">
            <span
              >Toplam: <b>{{ importReport.summary.total }}</b></span
            >
            <span class="ok"
              >Geçerli: <b>{{ importReport.summary.valid }}</b></span
            >
            <span class="warn"
              >Mükerrer: <b>{{ importReport.summary.duplicates }}</b></span
            >
            <span class="err"
              >Hatalı: <b>{{ importReport.summary.invalid }}</b></span
            >
          </div>
          <footer class="modal-footer">
            <button type="button" class="btn btn-ghost" @click="showImport = false">Kapat</button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="!importCsv || importBusy"
              @click="runImport(false)"
            >
              Önizle
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!importReport || !importReport.summary.valid || importBusy"
              @click="runImport(true)"
            >
              {{ importBusy ? 'Aktarılıyor…' : 'Aktar' }}
            </button>
          </footer>
        </div>
      </div>
    </div>

    <!-- ══ HIZLI GÖREV (context-aware quick action) ══ -->
    <div v-if="quickTaskOpen" class="modal-overlay" @click.self="quickTaskOpen = false">
      <div
        class="modal modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-task-title"
      >
        <header class="modal-header">
          <h3 id="quick-task-title">Yeni Görev</h3>
          <button
            type="button"
            class="modal-close"
            @click="quickTaskOpen = false"
            aria-label="Kapat"
          >
            &times;
          </button>
        </header>
        <form class="modal-body" novalidate @submit.prevent="submitQuickTask">
          <p class="muted small">
            Cari: <b>{{ displayContact?.name }}</b>
          </p>
          <div class="form-grid">
            <div class="field field-full">
              <label for="quick-task-title" class="field-label">Başlık *</label>
              <input
                id="quick-task-title"
                v-model="quickTaskForm.title"
                type="text"
                class="input"
                maxlength="255"
                required
              />
            </div>
            <div class="field">
              <label for="quick-task-priority" class="field-label">Öncelik</label>
              <select id="quick-task-priority" v-model="quickTaskForm.priority" class="input">
                <option value="low">Düşük</option>
                <option value="normal">Normal</option>
                <option value="high">Yüksek</option>
                <option value="urgent">Acil</option>
              </select>
            </div>
            <div class="field">
              <label for="quick-task-due" class="field-label">Son Tarih</label>
              <input
                id="quick-task-due"
                v-model="quickTaskForm.due_at"
                type="datetime-local"
                class="input"
              />
            </div>
          </div>
          <p v-if="quickError" class="form-error">{{ quickError }}</p>
          <footer class="modal-footer">
            <button type="button" class="btn btn-ghost" @click="quickTaskOpen = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="quickSaving">
              {{ quickSaving ? 'Kaydediliyor…' : 'Görevi Oluştur' }}
            </button>
          </footer>
        </form>
      </div>
    </div>

    <!-- ══ HIZLI RANDEVU (context-aware quick action) ══ -->
    <div v-if="quickApptOpen" class="modal-overlay" @click.self="quickApptOpen = false">
      <div
        class="modal modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-appt-title"
      >
        <header class="modal-header">
          <h3 id="quick-appt-title">Yeni Randevu</h3>
          <button
            type="button"
            class="modal-close"
            @click="quickApptOpen = false"
            aria-label="Kapat"
          >
            &times;
          </button>
        </header>
        <form class="modal-body" novalidate @submit.prevent="submitQuickAppt">
          <p class="muted small">
            Cari: <b>{{ displayContact?.name }}</b>
          </p>
          <div class="form-grid">
            <div class="field field-full">
              <label for="quick-appt-title" class="field-label">Başlık *</label>
              <input
                id="quick-appt-title"
                v-model="quickApptForm.title"
                type="text"
                class="input"
                maxlength="255"
                required
              />
            </div>
            <div class="field">
              <label for="quick-appt-start" class="field-label">Başlangıç *</label>
              <input
                id="quick-appt-start"
                v-model="quickApptForm.starts_at"
                type="datetime-local"
                class="input"
                required
              />
            </div>
            <div class="field">
              <label for="quick-appt-location" class="field-label">Konum</label>
              <input
                id="quick-appt-location"
                v-model="quickApptForm.location"
                type="text"
                class="input"
                maxlength="255"
              />
            </div>
          </div>
          <p v-if="quickError" class="form-error">{{ quickError }}</p>
          <footer class="modal-footer">
            <button type="button" class="btn btn-ghost" @click="quickApptOpen = false">
              İptal
            </button>
            <button type="submit" class="btn btn-primary" :disabled="quickSaving">
              {{ quickSaving ? 'Kaydediliyor…' : 'Randevu Oluştur' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  useContactStore,
  type Contact,
  type ContactLedgerEntry,
  type ContactStats,
  type ContactSummary,
  type ContactWithBalance,
  type ImportReport,
} from '@/stores/contacts';
import { addMoney, subMoney } from '@kuleplus/shared';
import FilterableSelect from '@/components/FilterableSelect.vue';
import { taxOfficesOf } from '@/data/tr-locations';
import { useManagementStore } from '@/stores/management';
import { useEntitlementStore } from '@/stores/entitlement';

const store = useContactStore();
const management = useManagementStore();
const entitlements = useEntitlementStore();
const canManagement = computed(() => entitlements.hasModule('management'));
const ALL_TAX_OFFICES = taxOfficesOf(null).map((t) => ({ value: t, label: t }));

interface LedgerSummary {
  debit: number;
  credit: number;
  balance: number;
  openingBalance: number;
  entryCount: number;
}

// === Filtreler ===
const search = ref('');
const typeFilter = ref<'' | 'customer' | 'supplier'>('');
const statusFilter = ref<'' | 'active' | 'inactive'>('');
const sortKey = ref<'name' | 'code' | 'balance' | 'created_at'>('name');
const sortDir = ref<'asc' | 'desc'>('asc');
const onlyWithBalance = ref(false);
const listPage = ref(1);
const selectedId = ref<string | null>(null);
const focusIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);

// === Veri ===
const listRows = ref<ContactWithBalance[]>([]);
const stats = ref<ContactStats | null>(null);
const pagination = computed(() => store.pagination);

// === Detay ===
type DetailTab = 'ekstre' | 'belge' | 'kunya' | 'adres' | 'iletisim';
const detailTab = ref<DetailTab>('ekstre');
const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'ekstre', label: 'Ekstre' },
  { key: 'belge', label: 'Belgeler' },
  { key: 'kunya', label: 'Künye' },
  { key: 'adres', label: 'Adresler' },
  { key: 'iletisim', label: 'İletişim' },
];

const detailContact = ref<Contact | null>(null);
const summary = ref<ContactSummary | null>(null);
const displayContact = computed<Contact | null>(
  () => detailContact.value ?? listRows.value.find((c) => c.id === selectedId.value) ?? null,
);
// === Ekstre ===
const ledgerEntries = ref<ContactLedgerEntry[]>([]);
const ledgerPagination = ref<{ page: number; limit: number; total: number; pages: number } | null>(
  null,
);
const ledgerSummary = ref<LedgerSummary | null>(null);
const ledgerLoading = ref(false);
const ledgerError = ref<string | null>(null);
const ledgerTypeFilter = ref<'' | 'receivable' | 'payable'>('');
const ledgerPage = ref(1);

// === Diğer ===
const toggling = ref(false);
const exporting = ref(false);
const notice = ref<{ kind: 'error' | 'success'; text: string } | null>(null);
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref<string | null>(null);
const editForm = ref({
  code: '',
  name: '',
  trade_name: '',
  type: 'customer' as 'customer' | 'supplier',
  tax_number: '',
  tax_office: '',
  is_active: true,
});
const deleteTarget = ref<Contact | null>(null);
const deleting = ref(false);
const deleteError = ref<string | null>(null);

// === İçe aktarma ===
const showImport = ref(false);
const importCsv = ref('');
const importReport = ref<ImportReport | null>(null);
const importBusy = ref(false);
const importError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// === Context-aware quick actions (Faz 7 — Müşteri → [+Görev] [+Randevu]) ===
const quickTaskOpen = ref(false);
const quickApptOpen = ref(false);
const quickSaving = ref(false);
const quickError = ref<string | null>(null);
const quickTaskForm = ref({
  title: '',
  priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  due_at: '',
});
const quickApptForm = ref({ title: '', starts_at: '', location: '' });

function openQuickTask() {
  quickTaskForm.value = { title: '', priority: 'normal', due_at: '' };
  quickError.value = null;
  quickTaskOpen.value = true;
}

function openQuickAppt() {
  quickApptForm.value = { title: '', starts_at: '', location: '' };
  quickError.value = null;
  quickApptOpen.value = true;
}

async function submitQuickTask() {
  const contact = displayContact.value;
  if (!contact) return;
  if (!quickTaskForm.value.title.trim()) {
    quickError.value = 'Başlık gerekli.';
    return;
  }
  quickError.value = null;
  quickSaving.value = true;
  try {
    await management.createTask({
      title: quickTaskForm.value.title.trim(),
      priority: quickTaskForm.value.priority,
      due_at: quickTaskForm.value.due_at
        ? new Date(quickTaskForm.value.due_at).toISOString()
        : null,
      source: 'quick_action',
      related_entity_type: 'contact',
      related_entity_id: contact.id,
    });
    quickTaskOpen.value = false;
    notice.value = { kind: 'success', text: 'Görev oluşturuldu.' };
  } catch {
    quickError.value = 'Görev oluşturulamadı.';
  } finally {
    quickSaving.value = false;
  }
}

async function submitQuickAppt() {
  const contact = displayContact.value;
  if (!contact) return;
  if (!quickApptForm.value.title.trim() || !quickApptForm.value.starts_at) {
    quickError.value = 'Başlık ve başlangıç zamanı gerekli.';
    return;
  }
  quickError.value = null;
  quickSaving.value = true;
  try {
    await management.createAppointment({
      title: quickApptForm.value.title.trim(),
      starts_at: new Date(quickApptForm.value.starts_at).toISOString(),
      location: quickApptForm.value.location.trim() || null,
      contact_id: contact.id,
    });
    quickApptOpen.value = false;
    notice.value = { kind: 'success', text: 'Randevu oluşturuldu.' };
  } catch {
    quickError.value = 'Randevu oluşturulamadı.';
  } finally {
    quickSaving.value = false;
  }
}

// ══════════ Biçimlendirme ══════════
const money = (v: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  }).format(v || 0);

const shortDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(iso)) : '—';

const typeLabel = (t: string) => (t === 'customer' ? 'Müşteri' : 'Tedarikçi');

const balanceTone = (b: number) => (Math.abs(b) < 0.005 ? 'zero' : b > 0 ? 'debit' : 'credit');
const balanceSide = (b: number) => (Math.abs(b) < 0.005 ? '(0)' : b > 0 ? '(B)' : '(A)');

const netTone = computed(() => {
  const v = stats.value?.netBalance ?? 0;
  return Math.abs(v) < 0.005 ? '' : v > 0 ? 'pos' : 'neg';
});
const netMetricTone = computed(() => {
  const v = summary.value?.balance.balance ?? 0;
  return Math.abs(v) < 0.005 ? '' : v > 0 ? 'debit' : 'credit';
});

function avatarInitials(c: Contact): string {
  const words = c.name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toLocaleUpperCase('tr-TR');
}

function addressLine(a: NonNullable<Contact['addresses']>[number]): string {
  return [a.neighborhood, a.street, a.building, a.apartment, a.district, a.province]
    .filter(Boolean)
    .join(', ');
}

const primaryPhone = computed(() => {
  const phones = displayContact.value?.phones;
  if (!phones?.length) return null;
  return (phones.find((p) => p.is_primary) ?? phones[0]).formatted ?? phones[0].number;
});

const ADDRESS_TYPES: Record<string, string> = {
  default: 'Varsayılan',
  billing: 'Fatura',
  shipping: 'Teslimat',
  other: 'Diğer',
};
const PHONE_TYPES: Record<string, string> = { mobile: 'Cep', fax: 'Faks', work: 'İş', home: 'Ev' };
const EMAIL_TYPES: Record<string, string> = {
  default: 'Varsayılan',
  notifications: 'Bildirim',
  marketing: 'Pazarlama',
};

/** Durum filtresi — sayfa verisi üstünde istemci tarafı. */
const visibleContacts = computed(() => {
  if (statusFilter.value === 'active') return listRows.value.filter((c) => c.is_active);
  if (statusFilter.value === 'inactive') return listRows.value.filter((c) => !c.is_active);
  return listRows.value;
});

/** Belge kısayol çipleri. */
const docShortcuts = computed(() => {
  const s = summary.value?.documentStats;
  return [
    { key: 'sales', label: 'Satış Faturası', count: Number(s?.sales_invoices ?? 0) },
    { key: 'purchase', label: 'Alış Faturası', count: Number(s?.purchase_invoices ?? 0) },
    { key: 'quotes', label: 'Teklif', count: Number(s?.quotes ?? 0) },
    { key: 'orders', label: 'Sipariş', count: Number(s?.orders ?? 0) },
    { key: 'po', label: 'Satın Alma', count: Number(s?.purchase_orders ?? 0) },
    { key: 'delivery', label: 'İrsaliye', count: Number(s?.deliveries ?? 0) },
  ];
});

/** Yaşlandırma şeritleri. */
const agingBars = computed(() => {
  const a = summary.value?.risk.aging;
  return [
    { key: 'current', label: 'Vadesi gelmemiş', value: a?.current ?? 0, tone: 'ok' },
    { key: 'd1_30', label: '1–30 gün', value: a?.d1_30 ?? 0, tone: 'a1' },
    { key: 'd31_60', label: '31–60 gün', value: a?.d31_60 ?? 0, tone: 'a2' },
    { key: 'd61_90', label: '61–90 gün', value: a?.d61_90 ?? 0, tone: 'a3' },
    { key: 'd90_plus', label: '90+ gün', value: a?.d90_plus ?? 0, tone: 'a4' },
  ];
});
const agingTotal = computed(() => agingBars.value.reduce((s, b) => s + b.value, 0));

/** Ekstre: eskiden yeniye yürüyen bakiye, gösterimde yeniden eskiye. */
const ledgerRows = computed(() => {
  const opening = ledgerSummary.value?.openingBalance ?? 0;
  let running = String(opening);
  const chronological = [...ledgerEntries.value].sort(
    (a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime(),
  );
  const rows = chronological.map((e) => {
    running =
      e.type === 'receivable'
        ? addMoney(running, String(e.amount))
        : subMoney(running, String(e.amount));
    return { ...e, amount: Number(e.amount), balance: Number(running) };
  });
  return rows.reverse();
});

// ══════════ Yükleme ══════════
const loadContacts = async () => {
  await store.fetchContactsWithBalances({
    q: search.value.trim() || undefined,
    type: typeFilter.value || undefined,
    sort: sortKey.value,
    order: sortDir.value,
    page: listPage.value,
    limit: 25,
    only_with_balance: onlyWithBalance.value || undefined,
  });
  listRows.value = store.contacts as ContactWithBalance[];
};

const loadStats = async () => {
  stats.value = await store.fetchStats();
};

const loadLedger = async () => {
  if (!selectedId.value) return;
  ledgerLoading.value = true;
  ledgerError.value = null;
  try {
    const res = await store.fetchContactLedger(selectedId.value, {
      page: ledgerPage.value,
      limit: 50,
      type: (ledgerTypeFilter.value || undefined) as 'receivable' | 'payable' | undefined,
    });
    ledgerEntries.value = res.data;
    ledgerPagination.value = res.pagination;
    ledgerSummary.value = res.summary ?? null;
  } catch (e) {
    ledgerError.value = e instanceof Error ? e.message : 'Ekstre yüklenemedi.';
  } finally {
    ledgerLoading.value = false;
  }
};

const selectContact = async (id: string) => {
  if (selectedId.value === id) return;
  selectedId.value = id;
  detailTab.value = 'ekstre';
  ledgerPage.value = 1;
  ledgerTypeFilter.value = '';
  ledgerEntries.value = [];
  ledgerSummary.value = null;
  summary.value = null;
  detailContact.value = null;
  const idx = visibleContacts.value.findIndex((c) => c.id === id);
  if (idx >= 0) focusIndex.value = idx;

  const [contact, sum] = await Promise.allSettled([
    store.fetchContact(id),
    store.fetchContactSummary(id),
  ]);
  if (contact.status === 'fulfilled') detailContact.value = contact.value;
  if (sum.status === 'fulfilled') summary.value = sum.value;
  void loadLedger();
};

const refresh = async () => {
  await Promise.all([loadContacts(), loadStats()]);
  const id = selectedId.value;
  if (!id) return;
  const [c, s] = await Promise.allSettled([store.fetchContact(id), store.fetchContactSummary(id)]);
  if (c.status === 'fulfilled') detailContact.value = c.value;
  if (s.status === 'fulfilled') summary.value = s.value;
  void loadLedger();
};

const changePage = (page: number) => {
  listPage.value = Math.max(1, page);
  void loadContacts();
};

const onSortDirToggle = () => {
  sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  listPage.value = 1;
  void loadContacts();
};

// ══════════ Düzenleme ══════════
const openEdit = (c: Contact) => {
  editForm.value = {
    code: c.code,
    name: c.name,
    trade_name: c.trade_name ?? '',
    type: c.type,
    tax_number: c.tax_number ?? '',
    tax_office: c.tax_office ?? '',
    is_active: c.is_active,
  };
  editError.value = null;
  editOpen.value = true;
};

const saveEdit = async () => {
  const id = selectedId.value ?? displayContact.value?.id;
  if (!id) return;
  if (!editForm.value.name.trim()) {
    editError.value = 'Ünvan / Ad Soyad zorunludur.';
    return;
  }
  editSaving.value = true;
  editError.value = null;
  try {
    await store.updateContact(id, {
      name: editForm.value.name.trim().toLocaleUpperCase('tr-TR'),
      trade_name: editForm.value.trade_name.trim().toLocaleUpperCase('tr-TR') || null,
      type: editForm.value.type,
      tax_number: editForm.value.tax_number.trim() || null,
      tax_office: editForm.value.tax_office.trim() || null,
      is_active: editForm.value.is_active,
    } as Partial<Contact>);
    editOpen.value = false;
    notice.value = { kind: 'success', text: 'Cari kartı güncellendi.' };
    await refresh();
  } catch (e) {
    editError.value = e instanceof Error ? e.message : 'Cari kartı güncellenemedi.';
  } finally {
    editSaving.value = false;
  }
};

const toggleActive = async (c: Contact) => {
  if (toggling.value) return;
  toggling.value = true;
  try {
    await store.updateContact(c.id, { is_active: !c.is_active } as Partial<Contact>);
    await refresh();
  } catch {
    notice.value = { kind: 'error', text: 'Durum güncellenemedi.' };
  } finally {
    toggling.value = false;
  }
};

// ══════════ Silme ══════════
const askDelete = (c: Contact) => {
  deleteError.value = null;
  deleteTarget.value = c;
};

const confirmDelete = async () => {
  if (!deleteTarget.value) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    await store.deleteContact(deleteTarget.value.id);
    if (selectedId.value === deleteTarget.value.id) {
      selectedId.value = null;
      detailContact.value = null;
      summary.value = null;
    }
    notice.value = { kind: 'success', text: 'Cari kartı silindi.' };
    deleteTarget.value = null;
    await Promise.all([loadContacts(), loadStats()]);
  } catch {
    deleteError.value = 'Cari kartı silinirken bir hata oluştu.';
  } finally {
    deleting.value = false;
  }
};

// ══════════ Dışa aktarma ══════════
const exportCsv = async () => {
  exporting.value = true;
  notice.value = null;
  try {
    const filename = await store.exportContacts();
    notice.value = { kind: 'success', text: `Dışa aktarıldı: ${filename}` };
  } catch (e) {
    notice.value = {
      kind: 'error',
      text: e instanceof Error ? e.message : 'Dışa aktarma başarısız.',
    };
  } finally {
    exporting.value = false;
  }
};

// ══════════ İçe aktarma ══════════
const onFilePicked = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importCsv.value = String(reader.result ?? '');
    importReport.value = null;
    importError.value = null;
  };
  reader.readAsText(file, 'utf-8');
};

const runImport = async (commit: boolean) => {
  importBusy.value = true;
  importError.value = null;
  try {
    if (commit) {
      const res = await store.commitImport(importCsv.value);
      notice.value = {
        kind: 'success',
        text: `İçe aktarma tamamlandı: ${res.summary.created} kayıt eklendi.`,
      };
      showImport.value = false;
      importCsv.value = '';
      importReport.value = null;
      await Promise.all([loadContacts(), loadStats()]);
    } else {
      importReport.value = await store.dryRunImport(importCsv.value);
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'İçe aktarma başarısız.';
  } finally {
    importBusy.value = false;
  }
};

// ══════════ İzleyiciler / kısayollar ══════════
let searchTimer: ReturnType<typeof setTimeout>;
watch([search, typeFilter], () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    listPage.value = 1;
    void loadContacts();
  }, 350);
});
watch([sortKey, onlyWithBalance], () => {
  listPage.value = 1;
  void loadContacts();
});
watch(ledgerTypeFilter, () => {
  ledgerPage.value = 1;
  void loadLedger();
});
watch(ledgerPage, () => void loadLedger());

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'F3') {
    e.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    window.location.href = '/contacts/new';
    return;
  }
  if (!visibleContacts.value.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusIndex.value = Math.min(focusIndex.value + 1, visibleContacts.value.length - 1);
    const c = visibleContacts.value[focusIndex.value];
    if (c) void selectContact(c.id);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusIndex.value = Math.max(focusIndex.value - 1, 0);
    const c = visibleContacts.value[focusIndex.value];
    if (c) void selectContact(c.id);
  }
};

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  await Promise.all([loadContacts(), loadStats()]);
  const first = listRows.value[0];
  if (first) void selectContact(first.id);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(searchTimer);
});
</script>

<style scoped>
.contacts-page {
  --c-border: #e2e8f0;
  --c-muted: #64748b;
  --row-h: 2.25rem;
  max-width: 100rem;
  margin-inline: auto;
  padding: 1.25rem;
}
.page-sub {
  margin: 0.2rem 0 0;
  color: var(--c-muted);
  font-size: 0.8125rem;
}
.toolbar-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.icon {
  width: 1rem;
  height: 1rem;
}
.icon-sm {
  width: 0.875rem;
  height: 0.875rem;
}
.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}
.btn-icon {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
}
.kbd {
  font-size: 0.625rem;
  border: 1px solid var(--c-border);
  border-radius: 0.25rem;
  padding: 0 0.25rem;
  color: var(--c-muted);
}

/* ══ KPI şeridi ══ */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.kpi {
  background: #fff;
  border: 1px solid var(--c-border);
  border-left: 3px solid #cbd5e1;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
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
.kpi.danger {
  border-left-color: #dc2626;
  background: #fef2f2;
}
.kpi-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.kpi-value {
  font-size: 1.0625rem;
  font-weight: 700;
  color: #0f172a;
}
.kpi-value .cust {
  color: #1d4ed8;
}
.kpi-value .sup {
  color: #b45309;
}
.kpi-sub {
  font-size: 0.6875rem;
  color: var(--c-muted);
}

/* ══ Filtre çubuğu ══ */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.625rem;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
}
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex: 1 1 14rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: #f8fafc;
}
.search-box .icon {
  color: var(--c-muted);
  flex-shrink: 0;
}
.filter-search {
  border: none;
  background: transparent;
  outline: none;
  flex: 1;
  font-size: 0.8125rem;
  min-width: 0;
}
.mini-select {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  background: #fff;
  color: #334155;
  max-width: 11rem;
}
.sort-dir {
  font: inherit;
  font-size: 0.8125rem;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  background: #fff;
  cursor: pointer;
  color: #334155;
}
.sort-dir:hover {
  border-color: #1d4ed8;
  color: #1d4ed8;
}
.check-inline {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: #475569;
  white-space: nowrap;
}
.result-count {
  font-size: 0.75rem;
  color: var(--c-muted);
  margin-left: auto;
  white-space: nowrap;
}

/* ══ Yerleşim ══ */
.contacts-layout {
  display: grid;
  grid-template-columns: minmax(20rem, 26rem) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
@media (max-width: 70rem) {
  .contacts-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.master-card,
.detail-card {
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  overflow: hidden;
}

/* ══ Kompakt tablo ══ */
.dense-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.dense-table thead th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #475569;
  text-align: left;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid var(--c-border);
  z-index: 1;
}
.dense-table tbody td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.dense-table tbody tr {
  cursor: pointer;
  height: var(--row-h);
}
.dense-table tbody tr:hover {
  background: #f8fafc;
}
.dense-table tbody tr.active {
  background: #eff6ff;
  box-shadow: inset 3px 0 0 #1d4ed8;
}
.dense-table tbody tr.focused {
  outline: 1px dashed #93c5fd;
  outline-offset: -1px;
}
.dense-table tbody tr.dim {
  opacity: 0.55;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
}
.small {
  font-size: 0.6875rem;
}
.muted {
  color: var(--c-muted);
}
.strong {
  font-weight: 700;
}
.nowrap {
  white-space: nowrap;
}
.debit {
  color: #b91c1c;
}
.credit {
  color: #15803d;
}
.danger {
  color: #dc2626;
}
.empty-cell {
  text-align: center;
  padding: 1.5rem 0.5rem;
  color: var(--c-muted);
  font-size: 0.8125rem;
}
.master-card {
  max-height: calc(100vh - 20rem);
  overflow-y: auto;
}

/* Liste satırı */
.row-title {
  display: block;
  font-weight: 600;
  color: #0f172a;
  font-size: 0.8125rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 15rem;
}
.row-sub {
  display: flex;
  gap: 0.25rem;
  font-size: 0.6875rem;
  color: var(--c-muted);
}
.col-name {
  width: 55%;
}
.col-type {
  width: 22%;
}
.col-bal {
  width: 23%;
}
.bal-value {
  display: block;
  font-weight: 700;
}
.bal-side {
  display: block;
  font-size: 0.625rem;
  font-weight: 600;
  opacity: 0.75;
}

/* Etiketler */
.pill {
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  background: #f1f5f9;
  color: #334155;
  white-space: nowrap;
}
.pill.customer {
  background: #dbeafe;
  color: #1e40af;
}
.pill.supplier {
  background: #fef3c7;
  color: #92400e;
}
.pill.on {
  background: #dcfce7;
  color: #166534;
}
.pill.off {
  background: #f1f5f9;
  color: #64748b;
}
.pill.danger {
  background: #fee2e2;
  color: #b91c1c;
}

/* ══ Detay ══ */
.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--c-border);
  background: linear-gradient(180deg, #f8fafc, #fff);
}
.avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.875rem;
  color: #fff;
  background: #1d4ed8;
  flex-shrink: 0;
}
.avatar.supplier {
  background: #b45309;
}
.detail-id {
  flex: 1;
  min-width: 0;
}
.detail-badges {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-bottom: 0.2rem;
}
.detail-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
}
.detail-meta {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: var(--c-muted);
  margin-top: 0.2rem;
}
.detail-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Metrik şeridi */
.metric-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--c-border);
  background: #fafbfc;
}
.metric {
  border-left: 2px solid #e2e8f0;
  padding-left: 0.5rem;
}
.metric.debit {
  border-left-color: #dc2626;
}
.metric.credit {
  border-left-color: #16a34a;
}
.metric.warn {
  border-left-color: #d97706;
}
.metric.danger {
  border-left-color: #dc2626;
}
.metric-label {
  display: block;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--c-muted);
  letter-spacing: 0.02em;
}
.metric-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}
.metric.debit .metric-value {
  color: #b91c1c;
}
.metric.credit .metric-value {
  color: #15803d;
}

/* Yaşlandırma */
.aging-bar {
  display: flex;
  height: 0.75rem;
  margin: 0.5rem 0.75rem 0.25rem;
  border-radius: 0.25rem;
  overflow: hidden;
  background: #f1f5f9;
}
.aging-seg {
  transition: flex-grow 0.2s ease;
}
.aging-seg.ok {
  background: #86efac;
}
.aging-seg.a1 {
  background: #fde047;
}
.aging-seg.a2 {
  background: #fb923c;
}
.aging-seg.a3 {
  background: #f87171;
}
.aging-seg.a4 {
  background: #b91c1c;
}
.aging-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  padding: 0 0.75rem 0.5rem;
  font-size: 0.6875rem;
  color: var(--c-muted);
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.legend-item i {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 0.125rem;
  display: inline-block;
}
.legend-item i.ok {
  background: #86efac;
}
.legend-item i.a1 {
  background: #fde047;
}
.legend-item i.a2 {
  background: #fb923c;
}
.legend-item i.a3 {
  background: #f87171;
}
.legend-item i.a4 {
  background: #b91c1c;
}

/* Sekmeler */
.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--c-border);
  padding: 0 0.5rem;
  background: #fafbfc;
  overflow-x: auto;
}
.detail-tabs button {
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  border-bottom: 2px solid transparent;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
}
.detail-tabs button:hover {
  color: #1d4ed8;
}
.detail-tabs button.active {
  color: #1d4ed8;
  border-bottom-color: #1d4ed8;
}
.tab-panel {
  padding: 0.625rem 0.75rem;
  max-height: calc(100vh - 24rem);
  overflow-y: auto;
}
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

/* Ekstre */
.ledger-table .desc {
  max-width: 20rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Belge çipleri */
.doc-matrix {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.375rem;
  margin-bottom: 0.625rem;
}
.doc-chip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  background: #fff;
  font: inherit;
  cursor: default;
}
.doc-chip.zero {
  opacity: 0.5;
}
.doc-chip-label {
  font-size: 0.6875rem;
  color: var(--c-muted);
}
.doc-chip-count {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

/* Künye */
.kunya-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.5rem 0.75rem;
  margin: 0;
}
.kunya-item dt {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--c-muted);
  letter-spacing: 0.02em;
}
.kunya-item dd {
  margin: 0.1rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
}

/* Bilgi listeleri */
.info-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}
.info-item {
  display: flex;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
  background: #fafbfc;
}
.info-badge {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  background: #e2e8f0;
  color: #334155;
  border-radius: 0.25rem;
  padding: 0.0625rem 0.3rem;
  height: fit-content;
  white-space: nowrap;
}
.info-body p {
  margin: 0;
  font-size: 0.8125rem;
}
.info-sub {
  font-size: 0.6875rem;
  color: var(--c-muted);
}
.comm-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem;
}
.comm-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--c-muted);
  margin: 0 0 0.375rem;
}

/* Durum mesajları */
.state-msg {
  padding: 0.75rem;
  text-align: center;
  color: var(--c-muted);
  font-size: 0.8125rem;
}
.error-msg {
  color: #b91c1c;
}
.detail-empty {
  display: grid;
  place-items: center;
  min-height: 20rem;
}
.empty-state {
  text-align: center;
  color: var(--c-muted);
}
.empty-icon {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.5rem;
}

/* Sayfalayıcı */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.375rem;
  border-top: 1px solid var(--c-border);
}
.pager-text {
  font-size: 0.75rem;
  color: var(--c-muted);
}

/* İçe aktarma özeti */
.import-summary {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  padding: 0.5rem;
  background: #f8fafc;
  border-radius: 0.375rem;
  margin-top: 0.5rem;
}
.import-summary .ok {
  color: #15803d;
}
.import-summary .warn {
  color: #b45309;
}
.import-summary .err {
  color: #b91c1c;
}
.form-error {
  color: #b91c1c;
  font-size: 0.8125rem;
  margin: 0.5rem 0 0;
}
</style>
