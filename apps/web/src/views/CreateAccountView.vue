<template>
  <div class="page account-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Yeni Cari Kartı</h1>
        <p class="page-sub">
          Müşteri veya tedarikçi kartının tüm bilgilerini sekmeler halinde girin. İsim alanları
          büyük harfle kaydedilir; yalnızca yıldızlı (*) alanlar zorunludur.
        </p>
      </div>
      <RouterLink to="/contacts" class="btn btn-secondary">← Cari Hesaplar</RouterLink>
    </header>

    <div v-if="error" class="alert alert-error" role="alert">
      <span>{{ error }}</span>
      <button v-if="errorTab" type="button" class="alert-link" @click="selectTab(errorTab)">
        İlgili sekmeye git
      </button>
    </div>

    <div class="account-layout">
      <form id="account-form" class="account-main" novalidate @submit.prevent="handleSubmit">
        <div class="card form-card">
          <!-- ── Sekmeler ── -->
          <nav class="tabs account-tabs" role="tablist" aria-label="Cari kartı sekmeleri">
            <button
              v-for="(tab, i) in TABS"
              :id="`tab-${tab.key}`"
              :key="tab.key"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: activeTab === tab.key }"
              :aria-selected="activeTab === tab.key"
              :aria-controls="`panel-${tab.key}`"
              :tabindex="activeTab === tab.key ? 0 : -1"
              @click="selectTab(tab.key)"
              @keydown.left.prevent="moveTab(i, -1)"
              @keydown.right.prevent="moveTab(i, 1)"
            >
              {{ tab.label }}
              <span
                v-if="tabErrorCount(tab.key)"
                class="tab-badge"
                :title="`${tabErrorCount(tab.key)} eksik alan`"
              >
                {{ tabErrorCount(tab.key) }}
              </span>
            </button>
          </nav>
          <!-- ══ 1) GENEL ══ -->
          <div
            v-show="activeTab === 'genel'"
            id="panel-genel"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-genel"
          >
            <section class="form-section">
              <h3 class="form-section-title">Cari kimliği</h3>
              <div class="form-grid">
                <div>
                  <label for="ca-type" class="field-label">Cari Türü *</label>
                  <FilterableSelect
                    id="ca-type"
                    v-model="form.type"
                    :options="CONTACT_TYPE_OPTIONS"
                    placeholder="Müşteri / Tedarikçi seçin"
                  />
                  <span class="field-hint"
                    >Müşteri satış, tedarikçi alım tarafında listelenir.</span
                  >
                </div>
                <div>
                  <label for="ca-code" class="field-label">Cari Kodu *</label>
                  <div class="code-field">
                    <input
                      id="ca-code"
                      v-model="form.code"
                      type="text"
                      class="input"
                      :class="{ invalid: errors.code }"
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
                  <span class="field-hint"
                    >Otomatik üretilir; dilerseniz elle düzenleyebilirsiniz.</span
                  >
                  <p v-if="errors.code" class="field-error">{{ errors.code }}</p>
                </div>

                <div class="form-field-full">
                  <label for="ca-name" class="field-label">Ünvan / Ad Soyad *</label>
                  <input
                    id="ca-name"
                    v-model="form.name"
                    type="text"
                    class="input uppercase"
                    :class="{ invalid: errors.name }"
                    :placeholder="namePlaceholder"
                    required
                    @blur="uppercase('name')"
                  />
                  <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
                </div>

                <template v-if="form.entity_type === 'person'">
                  <div>
                    <label for="ca-first" class="field-label">Ad</label>
                    <input
                      id="ca-first"
                      v-model="form.first_name"
                      type="text"
                      class="input uppercase"
                      placeholder="ÖRN: AHMET"
                      @blur="uppercase('first_name')"
                    />
                  </div>
                  <div>
                    <label for="ca-last" class="field-label">Soyad</label>
                    <input
                      id="ca-last"
                      v-model="form.last_name"
                      type="text"
                      class="input uppercase"
                      placeholder="ÖRN: YILMAZ"
                      @blur="uppercase('last_name')"
                    />
                  </div>
                </template>

                <div>
                  <label for="ca-trade" class="field-label">Ticari Unvan</label>
                  <input
                    id="ca-trade"
                    v-model="form.trade_name"
                    type="text"
                    class="input uppercase"
                    placeholder="Fatura üzerindeki unvan"
                    @blur="uppercase('trade_name')"
                  />
                </div>
                <div>
                  <label for="ca-short" class="field-label">Kısa Ad</label>
                  <input
                    id="ca-short"
                    v-model="form.short_name"
                    type="text"
                    class="input uppercase"
                    placeholder="Listelerde görünen kısa ad"
                    @blur="uppercase('short_name')"
                  />
                </div>

                <div>
                  <label for="ca-group" class="field-label">Cari Grup</label>
                  <input
                    id="ca-group"
                    v-model="form.group"
                    type="text"
                    class="input uppercase"
                    list="ca-group-list"
                    placeholder="ÖRN: BAYİ"
                    @blur="uppercase('group')"
                  />
                  <datalist id="ca-group-list">
                    <option v-for="g in CONTACT_GROUP_SUGGESTIONS" :key="g" :value="g"></option>
                  </datalist>
                </div>
                <div>
                  <label for="ca-rep" class="field-label">Plasiyer / Temsilci</label>
                  <input
                    id="ca-rep"
                    v-model="form.representative"
                    type="text"
                    class="input uppercase"
                    placeholder="İlgili satış temsilcisi"
                    @blur="uppercase('representative')"
                  />
                </div>

                <div>
                  <label for="ca-entity" class="field-label">Kart Tipi</label>
                  <FilterableSelect
                    id="ca-entity"
                    v-model="form.entity_type"
                    :options="ENTITY_TYPE_OPTIONS"
                    placeholder="Şirket / Şahıs seçin"
                  />
                  <span class="field-hint"
                    >Şahıs seçilirken Ad/Soyad ve kimlik bilgileri istenir.</span
                  >
                </div>
                <div>
                  <label for="ca-sector" class="field-label">Sektör</label>
                  <input
                    id="ca-sector"
                    v-model="form.sector"
                    type="text"
                    class="input uppercase"
                    list="ca-sector-list"
                    placeholder="ÖRN: İMALAT"
                    @blur="uppercase('sector')"
                  />
                  <datalist id="ca-sector-list">
                    <option v-for="s in SECTOR_SUGGESTIONS" :key="s" :value="s"></option>
                  </datalist>
                </div>

                <div class="form-field-full">
                  <label for="ca-tags" class="field-label">Etiketler</label>
                  <input
                    id="ca-tags"
                    v-model="form.tags"
                    type="text"
                    class="input"
                    placeholder="öncelikli, vadeli, ihracat"
                  />
                  <span class="field-hint">
                    Virgülle ayırın; listelerde hızlı filtre olarak kullanılır.
                  </span>
                </div>

                <div class="form-field-full">
                  <label class="checkbox">
                    <input id="ca-foreign" v-model="form.is_foreign" type="checkbox" />
                    <span>Yabancı cari (ihracat / yurtdışı müşteri)</span>
                  </label>
                </div>

                <div class="form-field-full">
                  <label class="checkbox">
                    <input id="ca-active" v-model="form.is_active" type="checkbox" />
                    <span>Aktif kart (pasif cariler yeni işlemde seçilemez)</span>
                  </label>
                </div>
              </div>
            </section>
          </div>
          <!-- ══ 2) RESMÎ & ADRES ══ -->
          <div
            v-show="activeTab === 'resmi'"
            id="panel-resmi"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-resmi"
          >
            <section class="form-section">
              <h3 class="form-section-title">Vergi ve resmî bilgiler</h3>
              <div class="form-grid">
                <div>
                  <label for="ca-taxno" class="field-label">Vergi No / TCKN</label>
                  <input
                    id="ca-taxno"
                    v-model="form.tax_number"
                    type="text"
                    class="input"
                    :class="{ invalid: errors.tax_number }"
                    inputmode="numeric"
                    maxlength="11"
                    :placeholder="taxNumberPlaceholder"
                  />
                  <p v-if="errors.tax_number" class="field-error">{{ errors.tax_number }}</p>
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
                  <span class="field-hint">
                    Ana adreste il seçerseniz yalnızca o ilin vergi daireleri listelenir.
                  </span>
                </div>
                <div>
                  <label for="ca-mersis" class="field-label">MERSİS No</label>
                  <input
                    id="ca-mersis"
                    v-model="form.mersis_no"
                    type="text"
                    class="input"
                    inputmode="numeric"
                    placeholder="Mersis numarası"
                  />
                </div>
                <div>
                  <label for="ca-sicil" class="field-label">Ticaret Sicil No</label>
                  <input
                    id="ca-sicil"
                    v-model="form.trade_registry_no"
                    type="text"
                    class="input"
                    placeholder="Ticaret sicil numarası"
                  />
                </div>
                <div class="form-field-full">
                  <label for="ca-kep" class="field-label">KEP Adresi</label>
                  <input
                    id="ca-kep"
                    v-model="form.kep_address"
                    type="email"
                    class="input"
                    :class="{ invalid: errors.kep_address }"
                    placeholder="firma@hs01.kep.tr"
                  />
                  <span class="field-hint">
                    Tebligat için kullanılan kayıtlı elektronik posta adresi.
                  </span>
                  <p v-if="errors.kep_address" class="field-error">{{ errors.kep_address }}</p>
                </div>
              </div>
            </section>
            <section v-if="form.entity_type === 'person'" class="form-section">
              <h3 class="form-section-title">Şahıs künyesi</h3>
              <div class="form-grid">
                <div class="form-field-full">
                  <label for="ca-identity-serial" class="field-label">Kimlik Kartı Seri No</label>
                  <input
                    id="ca-identity-serial"
                    v-model="form.identity_serial"
                    type="text"
                    class="input"
                    placeholder="ÖRN: A12B34567"
                  />
                  <span class="field-hint">Nüfus cüzdanı / kimlik kartı seri numarası.</span>
                </div>
              </div>
            </section>
            <section class="form-section">
              <h3 class="form-section-title">Ana adres</h3>
              <div class="form-grid">
                <div>
                  <label for="ca-addr-type" class="field-label">Adres Tipi</label>
                  <FilterableSelect
                    id="ca-addr-type"
                    v-model="form.address.type"
                    :options="ADDRESS_TYPE_OPTIONS"
                    placeholder="Tip seçin"
                  />
                </div>
                <div>
                  <label for="ca-country" class="field-label">Ülke</label>
                  <input
                    id="ca-country"
                    v-model="form.address.country"
                    type="text"
                    class="input uppercase"
                    @blur="uppercase('address.country')"
                  />
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
                    no-options-message="Önce il seçin"
                  />
                </div>
                <div class="form-field-full">
                  <label for="ca-neighborhood" class="field-label">Mahalle / Cadde</label>
                  <input
                    id="ca-neighborhood"
                    v-model="form.address.neighborhood"
                    type="text"
                    class="input uppercase"
                    @blur="uppercase('address.neighborhood')"
                  />
                </div>
                <div>
                  <label for="ca-street" class="field-label">Sokak</label>
                  <input
                    id="ca-street"
                    v-model="form.address.street"
                    type="text"
                    class="input uppercase"
                    @blur="uppercase('address.street')"
                  />
                </div>
                <div>
                  <label for="ca-building" class="field-label">Bina No</label>
                  <input
                    id="ca-building"
                    v-model="form.address.building"
                    type="text"
                    class="input uppercase"
                    @blur="uppercase('address.building')"
                  />
                </div>
                <div>
                  <label for="ca-apartment" class="field-label">Daire</label>
                  <input
                    id="ca-apartment"
                    v-model="form.address.apartment"
                    type="text"
                    class="input"
                  />
                </div>
                <div>
                  <label for="ca-zip" class="field-label">Posta Kodu</label>
                  <input
                    id="ca-zip"
                    v-model="form.address.zip_code"
                    type="text"
                    class="input"
                    inputmode="numeric"
                    maxlength="5"
                  />
                </div>
              </div>
            </section>
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">Ek adresler (fatura / teslimat)</h3>
                <button type="button" class="btn btn-secondary btn-sm" @click="addAddress">
                  + Adres ekle
                </button>
              </div>
              <p v-if="!form.extraAddresses.length" class="empty-note">
                Fatura veya teslimat adresi ana adresten farklıysa buraya ekleyin.
              </p>
              <div v-for="(addr, i) in form.extraAddresses" :key="`addr-${i}`" class="repeat-row">
                <div class="repeat-row-head">
                  <span class="repeat-index">Adres {{ i + 2 }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :aria-label="`Adres ${i + 2} satırını kaldır`"
                    @click="removeAddress(i)"
                  >
                    Kaldır
                  </button>
                </div>
                <div class="form-grid">
                  <div>
                    <label :for="`ca-extra-type-${i}`" class="field-label">Adres Tipi</label>
                    <FilterableSelect
                      :id="`ca-extra-type-${i}`"
                      v-model="addr.type"
                      :options="ADDRESS_TYPE_OPTIONS"
                      placeholder="Tip seçin"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-country-${i}`" class="field-label">Ülke</label>
                    <input
                      :id="`ca-extra-country-${i}`"
                      v-model="addr.country"
                      type="text"
                      class="input uppercase"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-province-${i}`" class="field-label">İl</label>
                    <FilterableSelect
                      :id="`ca-extra-province-${i}`"
                      v-model="addr.province"
                      :options="provinceOptions"
                      placeholder="İl yazıp seçin"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-district-${i}`" class="field-label">İlçe</label>
                    <FilterableSelect
                      :id="`ca-extra-district-${i}`"
                      v-model="addr.district"
                      :options="districtsFor(addr.province)"
                      :disabled="!addr.province"
                      placeholder="Önce il seçin"
                      no-options-message="Önce il seçin"
                    />
                  </div>
                  <div class="form-field-full">
                    <label :for="`ca-extra-neighborhood-${i}`" class="field-label">
                      Mahalle / Cadde
                    </label>
                    <input
                      :id="`ca-extra-neighborhood-${i}`"
                      v-model="addr.neighborhood"
                      type="text"
                      class="input uppercase"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-street-${i}`" class="field-label">Sokak</label>
                    <input
                      :id="`ca-extra-street-${i}`"
                      v-model="addr.street"
                      type="text"
                      class="input uppercase"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-building-${i}`" class="field-label">Bina No</label>
                    <input
                      :id="`ca-extra-building-${i}`"
                      v-model="addr.building"
                      type="text"
                      class="input uppercase"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-apartment-${i}`" class="field-label">Daire</label>
                    <input
                      :id="`ca-extra-apartment-${i}`"
                      v-model="addr.apartment"
                      type="text"
                      class="input"
                    />
                  </div>
                  <div>
                    <label :for="`ca-extra-zip-${i}`" class="field-label">Posta Kodu</label>
                    <input
                      :id="`ca-extra-zip-${i}`"
                      v-model="addr.zip_code"
                      type="text"
                      class="input"
                      inputmode="numeric"
                      maxlength="5"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
          <!-- ══ 3) İLETİŞİM ══ -->
          <div
            v-show="activeTab === 'iletisim'"
            id="panel-iletisim"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-iletisim"
          >
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">Yetkili kişiler</h3>
                <button type="button" class="btn btn-secondary btn-sm" @click="addPerson">
                  + Yetkili ekle
                </button>
              </div>
              <div
                v-for="(person, i) in form.contactPersons"
                :key="`person-${i}`"
                class="repeat-row"
              >
                <div class="repeat-row-head">
                  <span class="repeat-index">Yetkili {{ i + 1 }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :disabled="form.contactPersons.length === 1"
                    :aria-label="`Yetkili ${i + 1} satırını kaldır`"
                    @click="removePerson(i)"
                  >
                    Kaldır
                  </button>
                </div>
                <div class="form-grid">
                  <div>
                    <label :for="`ca-person-name-${i}`" class="field-label">Ad Soyad</label>
                    <input
                      :id="`ca-person-name-${i}`"
                      v-model="person.name"
                      type="text"
                      class="input uppercase"
                      :placeholder="i === 0 ? 'ÖRN: AYŞE YILMAZ' : 'Yetkili adı'"
                      @blur="uppercase(`contactPersons.${i}.name`)"
                    />
                  </div>
                  <div>
                    <label :for="`ca-person-title-${i}`" class="field-label">Görevi</label>
                    <input
                      :id="`ca-person-title-${i}`"
                      v-model="person.title"
                      type="text"
                      class="input uppercase"
                      :placeholder="i === 0 ? 'ÖRN: SATIN ALMA MÜDÜRÜ' : 'Görevi'"
                      @blur="uppercase(`contactPersons.${i}.title`)"
                    />
                  </div>
                  <div>
                    <label :for="`ca-person-phone-${i}`" class="field-label">Telefon</label>
                    <input
                      :id="`ca-person-phone-${i}`"
                      v-model="person.phone"
                      type="tel"
                      class="input"
                      placeholder="05XX XXX XX XX"
                    />
                  </div>
                  <div>
                    <label :for="`ca-person-email-${i}`" class="field-label">E-posta</label>
                    <input
                      :id="`ca-person-email-${i}`"
                      v-model="person.email"
                      type="email"
                      class="input"
                      :class="{
                        invalid: errors[i === 0 ? 'contact_person_email' : `person_${i}_email`],
                      }"
                      placeholder="ornek@firma.com"
                    />
                    <p
                      v-if="errors[i === 0 ? 'contact_person_email' : `person_${i}_email`]"
                      class="field-error"
                    >
                      {{ errors[i === 0 ? 'contact_person_email' : `person_${i}_email`] }}
                    </p>
                  </div>
                </div>
              </div>
              <span class="field-hint">
                İlk satır birincil yetkilidir; fatura/işlemlerde varsayılan olarak gösterilir.
              </span>
            </section>
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">Telefonlar</h3>
                <button type="button" class="btn btn-secondary btn-sm" @click="addPhone">
                  + Telefon ekle
                </button>
              </div>
              <div class="repeat-table">
                <div v-for="(phone, i) in form.phones" :key="`phone-${i}`" class="repeat-inline">
                  <div>
                    <label
                      :for="i === 0 ? 'ca-phone-type' : `ca-phone-type-${i}`"
                      class="field-label"
                    >
                      Tip
                    </label>
                    <FilterableSelect
                      :id="i === 0 ? 'ca-phone-type' : `ca-phone-type-${i}`"
                      v-model="phone.type"
                      :options="PHONE_TYPE_OPTIONS"
                      placeholder="Tip seçin"
                    />
                  </div>
                  <div>
                    <label :for="i === 0 ? 'ca-phone' : `ca-phone-${i}`" class="field-label">
                      Telefon {{ i + 1 }}
                    </label>
                    <input
                      :id="i === 0 ? 'ca-phone' : `ca-phone-${i}`"
                      v-model="phone.number"
                      type="tel"
                      class="input"
                      :class="{ invalid: errors[`phone_${i}`] }"
                      placeholder="05XX XXX XX XX"
                    />
                    <p v-if="errors[`phone_${i}`]" class="field-error">
                      {{ errors[`phone_${i}`] }}
                    </p>
                  </div>
                  <div class="repeat-flags">
                    <label class="checkbox">
                      <input
                        v-model.number="form.primaryPhone"
                        type="radio"
                        name="ca-primary-phone"
                        :value="i"
                      />
                      <span>Birincil</span>
                    </label>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      :disabled="form.phones.length === 1"
                      :aria-label="`Telefon ${i + 1} satırını kaldır`"
                      @click="removePhone(i)"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              </div>
              <span class="field-hint">
                Birincil numara belgelerde ve listede gösterilir; diğerleri ek iletişim bilgisidir.
              </span>
            </section>
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">E-postalar</h3>
                <button type="button" class="btn btn-secondary btn-sm" @click="addEmail">
                  + E-posta ekle
                </button>
              </div>
              <div class="repeat-table">
                <div v-for="(mail, i) in form.emails" :key="`email-${i}`" class="repeat-inline">
                  <div>
                    <label
                      :for="i === 0 ? 'ca-email-type' : `ca-email-type-${i}`"
                      class="field-label"
                    >
                      Tip
                    </label>
                    <FilterableSelect
                      :id="i === 0 ? 'ca-email-type' : `ca-email-type-${i}`"
                      v-model="mail.type"
                      :options="EMAIL_TYPE_OPTIONS"
                      placeholder="Tip seçin"
                    />
                  </div>
                  <div>
                    <label :for="i === 0 ? 'ca-email' : `ca-email-${i}`" class="field-label">
                      E-posta {{ i + 1 }}
                    </label>
                    <input
                      :id="i === 0 ? 'ca-email' : `ca-email-${i}`"
                      v-model="mail.email"
                      type="email"
                      class="input"
                      :class="{ invalid: errors[`email_${i}`] }"
                      placeholder="ornek@firma.com"
                    />
                    <p v-if="errors[`email_${i}`]" class="field-error">
                      {{ errors[`email_${i}`] }}
                    </p>
                  </div>
                  <div class="repeat-flags">
                    <label class="checkbox">
                      <input
                        v-model.number="form.primaryEmail"
                        type="radio"
                        name="ca-primary-email"
                        :value="i"
                      />
                      <span>Birincil</span>
                    </label>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      :disabled="form.emails.length === 1"
                      :aria-label="`E-posta ${i + 1} satırını kaldır`"
                      @click="removeEmail(i)"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              </div>
              <span class="field-hint">
                Bildirim tipi e-posta, otomatik hatırlatmaların gönderileceği adrestir.
              </span>
            </section>

            <section class="form-section">
              <h3 class="form-section-title">Dijital kanallar</h3>
              <div class="form-grid">
                <div>
                  <label for="ca-website" class="field-label">Web Sitesi</label>
                  <input
                    id="ca-website"
                    v-model="form.website"
                    type="url"
                    class="input"
                    placeholder="https://firma.com"
                  />
                </div>
                <div>
                  <label for="ca-whatsapp" class="field-label">WhatsApp</label>
                  <input
                    id="ca-whatsapp"
                    v-model="form.whatsapp"
                    type="tel"
                    class="input"
                    placeholder="05XX XXX XX XX"
                  />
                </div>
              </div>
            </section>
          </div>
          <!-- ══ 4) FİNANS & TİCARİ ══ -->
          <div
            v-show="activeTab === 'finans'"
            id="panel-finans"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-finans"
          >
            <section class="form-section">
              <h3 class="form-section-title">Ticari koşullar</h3>
              <div class="form-grid">
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
                  <input
                    id="ca-risk"
                    v-model="form.risk_limit"
                    type="number"
                    min="0"
                    step="0.01"
                    class="input"
                    :class="{ invalid: errors.risk_limit }"
                    placeholder="0,00"
                  />
                  <span class="field-hint">Açık bakiyenin üstünde uyarı verilir.</span>
                  <p v-if="errors.risk_limit" class="field-error">{{ errors.risk_limit }}</p>
                </div>
                <div>
                  <label for="ca-term" class="field-label">Vade (Gün)</label>
                  <input
                    id="ca-term"
                    v-model="form.payment_term_days"
                    type="number"
                    min="0"
                    max="365"
                    step="1"
                    class="input"
                    placeholder="30"
                  />
                </div>
                <div>
                  <label for="ca-discount" class="field-label">İskonto Oranı (%)</label>
                  <input
                    id="ca-discount"
                    v-model="form.discount_rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    class="input"
                    :class="{ invalid: errors.discount_rate }"
                    placeholder="0"
                  />
                  <p v-if="errors.discount_rate" class="field-error">{{ errors.discount_rate }}</p>
                </div>
                <div>
                  <label for="ca-pricelist" class="field-label">Fiyat Listesi</label>
                  <input
                    id="ca-pricelist"
                    v-model="form.price_list"
                    type="text"
                    class="input uppercase"
                    list="ca-pricelist-list"
                    placeholder="ÖRN: BAYİ-2026"
                    @blur="uppercase('price_list')"
                  />
                  <datalist id="ca-pricelist-list">
                    <option value="PERAKENDE"></option>
                    <option value="BAYİ"></option>
                    <option value="PROJE"></option>
                  </datalist>
                </div>
                <div>
                  <label for="ca-payment" class="field-label">Ödeme Şekli</label>
                  <FilterableSelect
                    id="ca-payment"
                    v-model="form.payment_method"
                    :options="PAYMENT_METHOD_OPTIONS"
                    placeholder="Ödeme şekli seçin"
                  />
                </div>
                <div>
                  <label for="ca-opening" class="field-label">Açılış Bakiyesi (₺)</label>
                  <input
                    id="ca-opening"
                    v-model="form.opening_balance"
                    type="number"
                    step="0.01"
                    class="input mono"
                    :class="{ invalid: errors.opening_balance }"
                    placeholder="0,00"
                  />
                  <span class="field-hint"
                    >Devir bakiye; cari ekstrede ilk kayıt olarak işlenmez.</span
                  >
                  <p v-if="errors.opening_balance" class="field-error">
                    {{ errors.opening_balance }}
                  </p>
                </div>
                <div>
                  <label for="ca-opening-side" class="field-label">Bakiye Yönü</label>
                  <FilterableSelect
                    id="ca-opening-side"
                    v-model="form.opening_balance_side"
                    :options="OPENING_SIDE_OPTIONS"
                    :disabled="!hasOpeningBalance"
                    placeholder="Yön seçin"
                  />
                </div>
                <div>
                  <label for="ca-opening-date" class="field-label">Açılış Tarihi</label>
                  <input
                    id="ca-opening-date"
                    v-model="form.opening_date"
                    type="date"
                    class="input"
                    :disabled="!hasOpeningBalance"
                  />
                </div>
                <div>
                  <label for="ca-vat" class="field-label">Varsayılan KDV Oranı (%)</label>
                  <input
                    id="ca-vat"
                    v-model="form.vat_rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    class="input"
                    :class="{ invalid: errors.vat_rate }"
                    list="ca-vat-list"
                    placeholder="20"
                  />
                  <datalist id="ca-vat-list">
                    <option value="20"></option>
                    <option value="10"></option>
                    <option value="1"></option>
                    <option value="0"></option>
                  </datalist>
                  <span class="field-hint">Fatura satırında önerilen KDV oranı.</span>
                  <p v-if="errors.vat_rate" class="field-error">{{ errors.vat_rate }}</p>
                </div>
                <div class="form-field-full">
                  <div class="field-head">
                    <label for="ca-accounting" class="field-label">Muhasebe Hesap Kodu</label>
                    <div class="field-head-actions">
                      <button
                        type="button"
                        class="link-sm"
                        :aria-pressed="manualAccount"
                        @click="toggleManualAccount"
                      >
                        {{ manualAccount ? 'Hesap planından seç' : 'Elle gir' }}
                      </button>
                      <button
                        v-if="!manualAccount && accountsError"
                        type="button"
                        class="link-sm"
                        :disabled="accountsLoading"
                        @click="loadChartOfAccounts(true)"
                      >
                        ⟳ Yenile
                      </button>
                    </div>
                  </div>
                  <FilterableSelect
                    v-if="!manualAccount"
                    id="ca-accounting"
                    v-model="form.accounting_code"
                    :options="accountOptions"
                    :disabled="accountsLoading"
                    allow-clear
                    placeholder="Hesap kodu veya adı yazın (örn. 120)"
                    no-options-message="Hesap bulunamadı — “Elle gir” ile kod yazabilirsiniz"
                  />
                  <input
                    v-else
                    id="ca-accounting"
                    v-model="form.accounting_code"
                    type="text"
                    class="input mono"
                    placeholder="120.01.001"
                    aria-label="Muhasebe hesap kodu (elle giriş)"
                  />
                  <p v-if="selectedAccount" class="account-pick">
                    <span class="account-code mono">{{ selectedAccount.code }}</span>
                    <span>{{ selectedAccount.name }}</span>
                  </p>
                  <span v-if="accountsError" class="field-hint warn">{{ accountsError }}</span>
                  <span v-else-if="accountsLoading" class="field-hint"
                    >Hesap planı yükleniyor…</span
                  >
                  <span v-else class="field-hint">
                    Hesap planından (TDHP) seçilir; boş bırakılırsa cari türüne göre 120 (alıcılar)
                    veya 320 (satıcılar) kullanılır.
                  </span>
                </div>
              </div>
            </section>
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">Banka hesapları (IBAN)</h3>
                <button type="button" class="btn btn-secondary btn-sm" @click="addBank">
                  + Hesap ekle
                </button>
              </div>
              <p v-if="!form.banks.length" class="empty-note">
                Tahsilat/ödeme eşleştirmesi için cariye ait IBAN ekleyebilirsiniz.
              </p>
              <div v-for="(bank, i) in form.banks" :key="`bank-${i}`" class="repeat-row">
                <div class="repeat-row-head">
                  <span class="repeat-index">Hesap {{ i + 1 }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :aria-label="`Banka hesabı ${i + 1} satırını kaldır`"
                    @click="removeBank(i)"
                  >
                    Kaldır
                  </button>
                </div>
                <div class="form-grid">
                  <div>
                    <label :for="`ca-bank-name-${i}`" class="field-label">Banka</label>
                    <input
                      :id="`ca-bank-name-${i}`"
                      v-model="bank.bank"
                      type="text"
                      class="input uppercase"
                      placeholder="ÖRN: GARANTİ BBVA"
                    />
                  </div>
                  <div>
                    <label :for="`ca-bank-branch-${i}`" class="field-label">Şube</label>
                    <input
                      :id="`ca-bank-branch-${i}`"
                      v-model="bank.branch"
                      type="text"
                      class="input"
                    />
                  </div>
                  <div class="form-field-full">
                    <label :for="`ca-bank-iban-${i}`" class="field-label">IBAN</label>
                    <input
                      :id="`ca-bank-iban-${i}`"
                      v-model="bank.iban"
                      type="text"
                      class="input mono"
                      :class="{ invalid: errors[`bank_${i}`] }"
                      placeholder="TR00 0000 0000 0000 0000 0000 00"
                      maxlength="32"
                    />
                    <p v-if="errors[`bank_${i}`]" class="field-error">{{ errors[`bank_${i}`] }}</p>
                  </div>
                  <div class="form-field-full">
                    <label :for="`ca-bank-holder-${i}`" class="field-label">Hesap Sahibi</label>
                    <input
                      :id="`ca-bank-holder-${i}`"
                      v-model="bank.holder"
                      type="text"
                      class="input uppercase"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
          <!-- ══ 5) e-DÖNÜŞÜM ══ -->
          <div
            v-show="activeTab === 'edonusum'"
            id="panel-edonusum"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-edonusum"
          >
            <section class="form-section">
              <h3 class="form-section-title">e-Fatura / e-Arşiv</h3>
              <div class="form-grid">
                <div class="form-field-full">
                  <label class="checkbox">
                    <input id="ca-einvoice" v-model="form.e_invoice.taxpayer" type="checkbox" />
                    <span>e-Fatura mükellefi (GİB kayıtlı)</span>
                  </label>
                </div>
                <div>
                  <label for="ca-einvoice-scenario" class="field-label">e-Fatura Senaryosu</label>
                  <FilterableSelect
                    id="ca-einvoice-scenario"
                    v-model="form.e_invoice.scenario"
                    :options="EINVOICE_SCENARIO_OPTIONS"
                    :disabled="!form.e_invoice.taxpayer"
                    placeholder="Senaryo seçin"
                  />
                  <span class="field-hint"
                    >Ticari senaryo yalnızca mükellef alıcıda kullanılır.</span
                  >
                </div>
                <div>
                  <label for="ca-einvoice-alias" class="field-label">e-Fatura Etiketi (PK)</label>
                  <input
                    id="ca-einvoice-alias"
                    v-model="form.e_invoice.alias"
                    type="text"
                    class="input mono"
                    :disabled="!form.e_invoice.taxpayer"
                    placeholder="urn:mail:firma@hs01.kep.tr"
                  />
                </div>
                <div class="form-field-full">
                  <label class="checkbox">
                    <input id="ca-earchive" v-model="form.e_invoice.e_archive" type="checkbox" />
                    <span>e-Arşiv fatura gönderimi yapılacak</span>
                  </label>
                </div>
                <div class="form-field-full">
                  <label class="checkbox">
                    <input id="ca-ewaybill" v-model="form.e_waybill" type="checkbox" />
                    <span>e-İrsaliye gönderimi yapılacak (mükellef cari)</span>
                  </label>
                </div>
                <div class="form-field-full">
                  <label for="ca-integrator" class="field-label">Entegratör</label>
                  <input
                    id="ca-integrator"
                    v-model="form.e_invoice.integrator"
                    type="text"
                    class="input uppercase"
                    placeholder="ÖRN: UYUMLU, FORIBA, İZİBİZ"
                    @blur="uppercase('e_invoice.integrator')"
                  />
                  <span class="field-hint">
                    Bilgi amaçlıdır; gönderim ayarları e-Dönüşüm modülünden yönetilir.
                  </span>
                </div>
              </div>
            </section>
          </div>
          <!-- ══ 6) İLİŞKİLER & NOTLAR ══ -->
          <div
            v-show="activeTab === 'iliskiler'"
            id="panel-iliskiler"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-iliskiler"
          >
            <section class="form-section">
              <div class="section-head">
                <h3 class="form-section-title">İlişkili cariler</h3>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="!relationOptions.length"
                  @click="addRelation"
                >
                  + İlişki ekle
                </button>
              </div>
              <p v-if="!relationOptions.length" class="empty-note">
                İlişki eklemek için önce başka bir cari kartı kayıtlı olmalıdır.
              </p>
              <p v-else-if="!form.relations.length" class="empty-note">
                Grup şirketi, bağlı işletme veya referans cari bilgisi ekleyebilirsiniz.
              </p>
              <div v-for="(rel, i) in form.relations" :key="`rel-${i}`" class="repeat-row">
                <div class="repeat-row-head">
                  <span class="repeat-index">İlişki {{ i + 1 }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :aria-label="`İlişki ${i + 1} satırını kaldır`"
                    @click="removeRelation(i)"
                  >
                    Kaldır
                  </button>
                </div>
                <div class="form-grid">
                  <div class="form-field-full">
                    <label :for="`ca-relation-contact-${i}`" class="field-label">Cari</label>
                    <FilterableSelect
                      :id="`ca-relation-contact-${i}`"
                      v-model="rel.related_contact_id"
                      :options="relationOptions"
                      placeholder="Kod veya unvan yazıp seçin"
                    />
                    <p v-if="errors[`relation_${i}`]" class="field-error">
                      {{ errors[`relation_${i}`] }}
                    </p>
                  </div>
                  <div>
                    <label :for="`ca-relation-type-${i}`" class="field-label">İlişki Türü</label>
                    <FilterableSelect
                      :id="`ca-relation-type-${i}`"
                      v-model="rel.relation_type"
                      :options="RELATION_TYPE_OPTIONS"
                      placeholder="Tür seçin"
                    />
                  </div>
                  <div>
                    <label :for="`ca-relation-note-${i}`" class="field-label">Not</label>
                    <input
                      :id="`ca-relation-note-${i}`"
                      v-model="rel.notes"
                      type="text"
                      class="input"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section class="form-section">
              <h3 class="form-section-title">Genel notlar</h3>
              <div class="form-grid">
                <div class="form-field-full">
                  <label for="ca-notes" class="field-label">Dahili not</label>
                  <textarea
                    id="ca-notes"
                    v-model="form.notes"
                    class="textarea"
                    rows="4"
                    placeholder="Cariyle ilgili özel notlar (yalnızca şirket içinde görünür)"
                  ></textarea>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div class="form-actions">
          <RouterLink to="/contacts" class="btn btn-secondary">İptal</RouterLink>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? 'Kaydediliyor…' : 'Cari Kartı Kaydet' }}
          </button>
        </div>
      </form>

      <aside class="account-summary" aria-label="Kayıt özeti">
        <div class="card summary-card">
          <h2 class="summary-title">Kayıt özeti</h2>
          <p class="summary-name">{{ summaryName }}</p>
          <div class="summary-badges">
            <span class="pill" :class="form.type">{{ typeLabel }}</span>
            <span class="pill" :class="form.is_active ? 'on' : 'off'">
              {{ form.is_active ? 'Aktif' : 'Pasif' }}
            </span>
          </div>
          <dl class="summary-list">
            <div>
              <dt>Cari kodu</dt>
              <dd class="mono">{{ form.code || '—' }}</dd>
            </div>
            <div>
              <dt>Vergi no</dt>
              <dd class="mono">{{ form.tax_number || '—' }}</dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>{{ summaryPhone || '—' }}</dd>
            </div>
            <div>
              <dt>E-posta</dt>
              <dd class="break">{{ summaryEmail || '—' }}</dd>
            </div>
            <div>
              <dt>İl / İlçe</dt>
              <dd>{{ summaryCity }}</dd>
            </div>
            <div>
              <dt>Para birimi</dt>
              <dd>{{ form.currency }} · Vade {{ form.payment_term_days || 0 }} gün</dd>
            </div>
            <div>
              <dt>Risk limiti</dt>
              <dd>{{ summaryRisk }}</dd>
            </div>
            <div>
              <dt>Açılış bakiyesi</dt>
              <dd class="break">{{ summaryOpening }}</dd>
            </div>
            <div>
              <dt>Muhasebe hesabı</dt>
              <dd class="mono break">{{ summaryAccount }}</dd>
            </div>
          </dl>
          <button
            type="submit"
            form="account-form"
            class="btn btn-primary summary-save"
            :disabled="saving"
          >
            {{ saving ? 'Kaydediliyor…' : 'Cari Kartı Kaydet' }}
          </button>
          <p class="summary-hint">
            Zorunlu alanlar: cari türü, cari kodu ve ünvan. Diğer sekmeler isteğe bağlıdır.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Yeni Cari Kartı — sekmeli giriş formu (SPEC §11).
 *
 * Sekmeler bilgi ailesine göre ayrıldı: Genel · Resmî & Adres · İletişim · Finans ·
 * e-Dönüşüm · İlişkiler. Alanların çoğu `contacts` + alt tablolara (adres, telefon,
 * e-posta, ilişki) yazılır; kolon olmayan ticari/ticari-dışı ek bilgiler
 * `contacts.settings` (jsonb) altında anahtarlanır — şema değişikliği gerekmez.
 *
 * Zorunlu alanlar yalnızca cari türü, kodu ve ünvandır (mevcut API sözleşmesi:
 * `apps/api/src/modules/contacts/schemas.ts` → `createContactSchema`).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useContactStore, type ContactCreateInput } from '@/stores/contacts';
import { useAccountingStore, type AccountingAccount } from '@/stores/accounting';
import FilterableSelect from '@/components/FilterableSelect.vue';
import { districtsOf, taxOfficesOf, TR_PROVINCES } from '@/data/tr-locations';
import type { AxiosError } from 'axios';

const router = useRouter();
const store = useContactStore();
const accounting = useAccountingStore();

type TabKey = 'genel' | 'resmi' | 'iletisim' | 'finans' | 'edonusum' | 'iliskiler';
type ContactType = 'customer' | 'supplier';
/** Kart tipi: tüzel kişi (şirket/kurum) veya gerçek kişi (şahıs). */
type EntityType = 'company' | 'person';
/** Açılış bakiyesi yönü — party_ledger_entries tipleriyle aynı adlandırma. */
type OpeningSide = 'receivable' | 'payable';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'genel', label: 'Genel' },
  { key: 'resmi', label: 'Resmî & Adres' },
  { key: 'iletisim', label: 'İletişim' },
  { key: 'finans', label: 'Finans & Ticari' },
  { key: 'edonusum', label: 'e-Dönüşüm' },
  { key: 'iliskiler', label: 'İlişkiler & Notlar' },
];

const activeTab = ref<TabKey>('genel');
const saving = ref(false);
const error = ref<string | null>(null);
const codeTouched = ref(false);
const errors = ref<Record<string, string>>({});

interface AddressForm {
  type: string;
  country: string;
  neighborhood: string;
  street: string;
  building: string;
  apartment: string;
  province: string;
  district: string;
  zip_code: string;
}

interface PhoneForm {
  type: string;
  number: string;
}

interface EmailForm {
  type: string;
  email: string;
}

interface BankForm {
  bank: string;
  branch: string;
  iban: string;
  holder: string;
}

interface RelationForm {
  related_contact_id: string;
  relation_type: string;
  notes: string;
}

interface PersonForm {
  name: string;
  title: string;
  phone: string;
  email: string;
}

/** Boş adres satırı — ana adres ve ek adresler aynı yapıyı kullanır. */
function emptyAddress(): AddressForm {
  return {
    type: 'default',
    country: 'TÜRKİYE',
    neighborhood: '',
    street: '',
    building: '',
    apartment: '',
    province: '',
    district: '',
    zip_code: '',
  };
}

const form = ref({
  // Genel
  code: '',
  name: '',
  /** Kart tipi — şahıs kartlarda Ad/Soyad + kimlik alanları istenir. */
  entity_type: 'company' as EntityType,
  first_name: '',
  last_name: '',
  is_foreign: false,
  sector: '',
  trade_name: '',
  short_name: '',
  group: '',
  representative: '',
  tags: '',
  type: 'customer' as ContactType,
  is_active: true,
  // Resmî & adres
  tax_number: '',
  tax_office: '',
  identity_serial: '',
  mersis_no: '',
  trade_registry_no: '',
  kep_address: '',
  address: emptyAddress(),
  extraAddresses: [] as AddressForm[],
  // İletişim — birden fazla yetkili kişi; ilk satır birincildir.
  contactPersons: [{ name: '', title: '', phone: '', email: '' }] as PersonForm[],
  phones: [{ type: 'mobile', number: '' }] as PhoneForm[],
  primaryPhone: 0,
  emails: [{ type: 'default', email: '' }] as EmailForm[],
  primaryEmail: 0,
  website: '',
  whatsapp: '',
  // Finans
  currency: 'TRY',
  // `type="number"` girdilerinde Vue değeri SAYIYA çevirir; bu yüzden alanlar
  // `string | number` tutulur ve okurken `numStr()` ile normalize edilir.
  risk_limit: '' as string | number,
  payment_term_days: '' as string | number,
  discount_rate: '' as string | number,
  /** Açılış (devir) bakiyesi — settings'e yazılır; ekstre kalıcı kayıt yazmazdır. */
  opening_balance: '' as string | number,
  opening_balance_side: '' as '' | OpeningSide,
  opening_date: '',
  vat_rate: '' as string | number,
  price_list: '',
  payment_method: '',
  accounting_code: '',
  banks: [] as BankForm[],
  // e-Dönüşüm
  e_invoice: { taxpayer: false, scenario: 'temel', e_archive: false, alias: '', integrator: '' },
  e_waybill: false,
  // İlişkiler & notlar
  relations: [] as RelationForm[],
  notes: '',
});

/** İl / ilçe / vergi dairesi seçenekleri — açık veri kaynağı (81 il, 973 ilçe, 1042 v.d.). */
const provinceOptions = TR_PROVINCES.map((p) => ({
  value: p.name,
  label: `${p.name} (${p.plate})`,
}));

function districtsFor(province: string): Array<{ value: string; label: string }> {
  return districtsOf(province).map((d) => ({ value: d, label: d }));
}

const districtOptions = computed(() => districtsFor(form.value.address.province));
const taxOfficeOptions = computed(() =>
  taxOfficesOf(form.value.address.province).map((t) => ({ value: t, label: t })),
);

const CONTACT_TYPE_OPTIONS = [
  { value: 'customer', label: 'Müşteri' },
  { value: 'supplier', label: 'Tedarikçi' },
];
const ENTITY_TYPE_OPTIONS: Array<{ value: EntityType; label: string }> = [
  { value: 'company', label: 'Şirket / Kurum (tüzel)' },
  { value: 'person', label: 'Gerçek kişi / Şahsi işletme' },
];
const OPENING_SIDE_OPTIONS: Array<{ value: OpeningSide; label: string }> = [
  { value: 'receivable', label: 'Bize borç (veresiye)' },
  { value: 'payable', label: 'Bizden alacak (avans)' },
];
const SECTOR_SUGGESTIONS = [
  'İMALAT',
  'TOPTAN',
  'PERAKENDE',
  'İNŞAAT',
  'HİZMET',
  'TEKNOLOJİ',
  'TARIM',
  'TURİZM',
  'İHRACAT',
  'DİĞER',
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
const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Nakit' },
  { value: 'bank_transfer', label: 'Havale / EFT' },
  { value: 'cheque', label: 'Çek' },
  { value: 'promissory', label: 'Senet' },
  { value: 'credit_card', label: 'Kredi Kartı' },
  { value: 'open_account', label: 'Açık Hesap' },
];
const EINVOICE_SCENARIO_OPTIONS = [
  { value: 'temel', label: 'Temel' },
  { value: 'ticari', label: 'Ticari' },
];
const RELATION_TYPE_OPTIONS = [
  { value: 'parent', label: 'Ana şirket' },
  { value: 'child', label: 'Bağlı şirket' },
  { value: 'partner', label: 'İş ortağı' },
  { value: 'reference', label: 'Referans' },
  { value: 'other', label: 'Diğer' },
];
const CONTACT_GROUP_SUGGESTIONS = ['BAYİ', 'PERAKENDE', 'PROJE', 'KAMU', 'İHRACAT', 'GRUP İÇİ'];

/** İlişki seçenekleri — mevcut cari kartları (kod + unvan) listeler. */
const relationOptions = computed(() =>
  store.contacts.map((c) => ({
    value: c.id,
    label: `${c.code} — ${c.name}`,
  })),
);

/* ── Muhasebe hesap planı (TDHP) — hesap kodu seçici ─────────────────────────
   Cari kartındaki "Muhasebe Hesap Kodu" serbest metin değil, hesap planından
   seçilir. Kaynak `GET /v1/accounting` (aktif + detay hesaplar, sayfa başına 100);
   yetki yoksa veya plan boşsa akış bloke edilmez — alan elle girişe düşer. */

/** Cari türüne göre varsayılan TDHP kodu: 120 Alıcılar, 320 Satıcılar (SPEC §11). */
const DEFAULT_ACCOUNTING_CODE: Record<ContactType, string> = {
  customer: '120',
  supplier: '320',
};

const accountList = ref<AccountingAccount[]>([]);
const accountsLoading = ref(false);
const accountsError = ref<string | null>(null);
/** Hesap planı kullanılamıyorsa (yetki yok/boş plan) elle giriş moduna geçilir. */
const manualAccount = ref(false);
let accountsLoaded = false;

const accountOptions = computed(() =>
  accountList.value.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
);

/** Seçili kodun hesap planındaki karşılığı (ad gösterimi için). */
const selectedAccount = computed(() =>
  accountList.value.find((a) => a.code === form.value.accounting_code.trim()),
);

/** Hesap planını sayfa sayfa çeker; yalnızca bir kez (force ile yeniden). */
async function loadChartOfAccounts(force = false): Promise<void> {
  if (accountsLoading.value) return;
  if (accountsLoaded && !force) return;
  accountsLoading.value = true;
  accountsError.value = null;
  try {
    const all: AccountingAccount[] = [];
    for (let page = 1; page <= 30; page++) {
      const { items, totalPages } = await accounting.searchAccounts('', page);
      all.push(...items);
      if (items.length === 0 || page >= totalPages) break;
    }
    accountList.value = all;
    accountsLoaded = true;
    if (!all.length) {
      manualAccount.value = true;
      accountsError.value =
        'Hesap planı boş görünüyor. Muhasebe ekranından planı oluşturun ya da kodu elle girin.';
      return;
    }
    applyDefaultAccount();
  } catch {
    // Yetki yok veya ağ hatası: seçici yerine elle giriş, kayıt akışı devam eder.
    manualAccount.value = true;
    accountsError.value = 'Hesap planı yüklenemedi; kodu elle girebilirsiniz.';
  } finally {
    accountsLoading.value = false;
  }
}

/** Boş ya da önceki varsayılanda kalan kodu cari türünün varsayılanına çeker. */
function applyDefaultAccount(): void {
  const current = form.value.accounting_code.trim();
  if (current && current !== '120' && current !== '320') return;
  const wanted = DEFAULT_ACCOUNTING_CODE[form.value.type];
  if (accountList.value.some((a) => a.code === wanted)) form.value.accounting_code = wanted;
}

function toggleManualAccount(): void {
  manualAccount.value = !manualAccount.value;
  if (!manualAccount.value) {
    void loadChartOfAccounts();
    applyDefaultAccount();
  }
}

/** Kart tipine göre input örnek metinleri (şahıs kartı farklı örnek ister). */
const namePlaceholder = computed(() =>
  form.value.entity_type === 'person' ? 'ÖRN: AHMET YILMAZ' : 'ÖRN: ACME TEKNOLOJİ A.Ş.',
);
const taxNumberPlaceholder = computed(() =>
  form.value.entity_type === 'person' ? '11 hane TCKN' : '10 hane VKN',
);

/** Açılış bakiyesi dolu mu? Yön/tarih alanları bakiye varken anlamlıdır. */
const hasOpeningBalance = computed(() => numOrNull(form.value.opening_balance) !== null);

const summaryOpening = computed(() => {
  const amount = numOrNull(form.value.opening_balance);
  if (amount === null) return '—';
  const side = form.value.opening_balance_side === 'payable' ? 'bizden alacak' : 'bize borç';
  const date = form.value.opening_date ? ` · ${form.value.opening_date}` : '';
  const text = amount.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
  return `${text} (${side}${date})`;
});

const typeLabel = computed(() => (form.value.type === 'customer' ? 'Müşteri' : 'Tedarikçi'));
const summaryName = computed(
  () => form.value.name.trim().toLocaleUpperCase('tr-TR') || 'Yeni cari kartı',
);
const summaryPhone = computed(
  () =>
    form.value.phones
      .map((p) => p.number.trim())
      .filter(Boolean)
      .join(' · ') || form.value.contactPersons[0]?.phone.trim(),
);
const summaryEmail = computed(
  () =>
    form.value.emails
      .map((m) => m.email.trim())
      .filter(Boolean)
      .join(' · ') || form.value.contactPersons[0]?.email.trim(),
);
const summaryCity = computed(() => {
  const { province, district } = form.value.address;
  if (!province && !district) return '—';
  return [province, district].filter(Boolean).join(' / ');
});
const summaryRisk = computed(() => {
  const num = numOrNull(form.value.risk_limit);
  if (num === null) return '—';
  return num.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
});
const summaryAccount = computed(() => {
  const code = form.value.accounting_code.trim();
  if (!code) return '—';
  return selectedAccount.value ? `${code} — ${selectedAccount.value.name}` : code;
});

/* ── Sekme yardımcıları ───────────────────────────────────────────────────── */

/** Hata anahtarının hangi sekmeye ait olduğu (sekme üzerindeki uyarı rozeti için). */
function fieldTab(key: string): TabKey {
  if (key.startsWith('phone_') || key.startsWith('email_') || key.startsWith('person_')) {
    return 'iletisim';
  }
  if (key === 'contact_person_email') return 'iletisim';
  if (key.startsWith('bank_')) return 'finans';
  if (['risk_limit', 'discount_rate', 'opening_balance', 'vat_rate'].includes(key)) return 'finans';
  if (key.startsWith('relation')) return 'iliskiler';
  if (key === 'tax_number' || key === 'kep_address' || key === 'identity_serial') return 'resmi';
  return 'genel';
}

function tabErrorCount(key: TabKey): number {
  return Object.keys(errors.value).filter((k) => fieldTab(k) === key).length;
}

const errorTab = computed<TabKey | null>(() => {
  const first = Object.keys(errors.value)[0];
  return first ? fieldTab(first) : null;
});

function selectTab(key: TabKey): void {
  activeTab.value = key;
  // Hesap planı yalnızca gerektiğinde (Finans sekmesi açılınca) bir kez çekilir.
  if (key === 'finans') void loadChartOfAccounts();
}

/** Klavye ile sekmeler arasında gezinme (role=tablist, ARIA authoring practices). */
function moveTab(index: number, dir: number): void {
  const next = TABS[(index + dir + TABS.length) % TABS.length];
  selectTab(next.key);
  void nextTick(() => document.getElementById(`tab-${next.key}`)?.focus());
}

/* ── Biçimlendirme yardımcıları ───────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Noktalı yol ile form alanını TR kuralına göre büyük harfe çevirir (örn. 'address.street'). */
function uppercase(path: string): void {
  const parts = path.split('.');
  let target = form.value as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  const key = parts[parts.length - 1];
  target[key] = String(target[key] ?? '')
    .trim()
    .toLocaleUpperCase('tr-TR');
}

const upper = (value: string): string => value.trim().toLocaleUpperCase('tr-TR');
const optional = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};
/** Sayı girdisini (Vue number cast eder) boş olabilecek metne çevirir. */
const numStr = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value).trim();
/** Metin/sayı girdisini sonlu sayıya çevirir; boş veya geçersizse null. */
const numOrNull = (value: string | number | null | undefined): number | null => {
  const raw = numStr(value);
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};
/** Adres satırında (tip ve ülke varsayılanı dışında) dolu alan var mı? */
function hasAddressData(addr: AddressForm): boolean {
  return Object.entries(addr).some(
    ([key, value]) => key !== 'type' && key !== 'country' && String(value).trim().length > 0,
  );
}

/* ── Tekrarlanan satırlar (adres / telefon / e-posta / banka / ilişki) ─────── */

function addAddress(): void {
  form.value.extraAddresses.push({ ...emptyAddress(), type: 'billing' });
}

function removeAddress(index: number): void {
  form.value.extraAddresses.splice(index, 1);
}

function addPerson(): void {
  form.value.contactPersons.push({ name: '', title: '', phone: '', email: '' });
}

function removePerson(index: number): void {
  if (form.value.contactPersons.length === 1) return;
  form.value.contactPersons.splice(index, 1);
}

function addPhone(): void {
  form.value.phones.push({ type: 'work', number: '' });
}

function removePhone(index: number): void {
  if (form.value.phones.length === 1) return;
  form.value.phones.splice(index, 1);
  if (form.value.primaryPhone >= form.value.phones.length) {
    form.value.primaryPhone = form.value.phones.length - 1;
  }
}

function addEmail(): void {
  form.value.emails.push({ type: 'notifications', email: '' });
}

function removeEmail(index: number): void {
  if (form.value.emails.length === 1) return;
  form.value.emails.splice(index, 1);
  if (form.value.primaryEmail >= form.value.emails.length) {
    form.value.primaryEmail = form.value.emails.length - 1;
  }
}

function addBank(): void {
  form.value.banks.push({ bank: '', branch: '', iban: '', holder: '' });
}

function removeBank(index: number): void {
  form.value.banks.splice(index, 1);
}

function addRelation(): void {
  form.value.relations.push({ related_contact_id: '', relation_type: 'parent', notes: '' });
}

function removeRelation(index: number): void {
  form.value.relations.splice(index, 1);
}

/* ── Doğrulama ────────────────────────────────────────────────────────────── */

function validate(): Record<string, string> {
  const out: Record<string, string> = {};

  if (!form.value.name.trim()) out.name = 'Ünvan / ad soyad zorunludur.';
  if (!form.value.code.trim()) out.code = 'Cari kodu zorunludur.';

  const tax = form.value.tax_number.trim();
  if (tax && !/^\d{10,11}$/.test(tax)) {
    out.tax_number = 'Vergi no 10 (VKN) veya 11 (TCKN) hane olmalıdır.';
  }
  if (form.value.kep_address.trim() && !isEmail(form.value.kep_address)) {
    out.kep_address = 'Geçerli bir KEP adresi girin.';
  }

  form.value.phones.forEach((phone, i) => {
    const value = phone.number.trim();
    if (value && value.replace(/\D/g, '').length < 7) {
      out[`phone_${i}`] = 'Telefon en az 7 hane olmalıdır.';
    }
  });

  form.value.emails.forEach((mail, i) => {
    const value = mail.email.trim();
    if (value && !isEmail(value)) out[`email_${i}`] = 'Geçerli bir e-posta adresi girin.';
  });

  form.value.banks.forEach((bank, i) => {
    const value = bank.iban.replace(/\s+/g, '').toLocaleUpperCase('tr-TR');
    if (value && !/^TR\d{24}$/.test(value)) {
      out[`bank_${i}`] = 'IBAN “TR” ile başlamalı ve 26 karakter olmalıdır.';
    }
  });

  const risk = numStr(form.value.risk_limit);
  if (risk && !(Number(risk) >= 0)) out.risk_limit = 'Risk limiti 0 veya daha büyük olmalıdır.';

  const discount = numStr(form.value.discount_rate);
  if (discount && !(Number(discount) >= 0 && Number(discount) <= 100)) {
    out.discount_rate = 'İskonto oranı 0–100 arasında olmalıdır.';
  }

  const vat = numStr(form.value.vat_rate);
  if (vat && !(Number(vat) >= 0 && Number(vat) <= 100)) {
    out.vat_rate = 'KDV oranı 0–100 arasında olmalıdır.';
  }

  if (numStr(form.value.opening_balance) && numOrNull(form.value.opening_balance) === null) {
    out.opening_balance = 'Açılış bakiyesi sayısal bir değer olmalıdır.';
  }

  form.value.contactPersons.forEach((person, i) => {
    if (person.email.trim() && !isEmail(person.email)) {
      out[i === 0 ? 'contact_person_email' : `person_${i}_email`] =
        'Geçerli bir e-posta adresi girin.';
    }
  });

  const seen = new Set<string>();
  form.value.relations.forEach((rel, i) => {
    if (!rel.related_contact_id) return;
    if (seen.has(rel.related_contact_id)) {
      out[`relation_${i}`] = 'Aynı cari birden fazla kez seçilemez.';
    }
    seen.add(rel.related_contact_id);
  });

  return out;
}

/** Hata varsa ilk hatalı sekmeyi açar ve ilk hatalı alana odaklanır. */
async function focusFirstError(): Promise<void> {
  const tab = errorTab.value;
  if (!tab) return;
  selectTab(tab);
  await nextTick();
  const panel = document.getElementById(`panel-${tab}`);
  const field = panel?.querySelector<HTMLElement>('.invalid, .field-error');
  field?.focus?.();
  field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ── Kayıt ────────────────────────────────────────────────────────────────── */

/** Mevcut kayıtlardan en yüksek M-xxxx / T-xxxx sırasını bulup sonrakini üretir. */
function generateCode(type: ContactType): string {
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

/** Seçili birincil satırı koruyarak dolu satırları API biçimine çevirir. */
function buildPhones() {
  const filled = form.value.phones
    .map((phone, index) => ({ ...phone, index }))
    .filter((phone) => phone.number.trim().length > 0);
  const primary = filled.some((p) => p.index === form.value.primaryPhone)
    ? form.value.primaryPhone
    : filled[0]?.index;
  return filled.map((phone) => ({
    type: phone.type,
    number: phone.number.trim(),
    is_primary: phone.index === primary,
  }));
}

function buildEmails() {
  const filled = form.value.emails
    .map((mail, index) => ({ ...mail, index }))
    .filter((mail) => mail.email.trim().length > 0);
  const primary = filled.some((m) => m.index === form.value.primaryEmail)
    ? form.value.primaryEmail
    : filled[0]?.index;
  return filled.map((mail) => ({
    type: mail.type,
    email: mail.email.trim(),
    is_primary: mail.index === primary,
  }));
}

function buildAddresses(): NonNullable<ContactCreateInput['addresses']> {
  const rows: NonNullable<ContactCreateInput['addresses']> = [];
  const main = form.value.address;
  if (hasAddressData(main)) {
    rows.push({
      type: main.type,
      is_primary: true,
      province: optional(upper(main.province)),
      district: optional(upper(main.district)),
      neighborhood: optional(upper(main.neighborhood)),
      street: optional(upper(main.street)),
      building: optional(upper(main.building)),
      apartment: optional(main.apartment),
      zip_code: optional(main.zip_code),
      parsed: { country: upper(main.country) || 'TÜRKİYE' },
    });
  }
  for (const addr of form.value.extraAddresses) {
    if (!hasAddressData(addr)) continue;
    rows.push({
      type: addr.type,
      is_primary: false,
      province: optional(upper(addr.province)),
      district: optional(upper(addr.district)),
      neighborhood: optional(upper(addr.neighborhood)),
      street: optional(upper(addr.street)),
      building: optional(upper(addr.building)),
      apartment: optional(addr.apartment),
      zip_code: optional(addr.zip_code),
      parsed: { country: upper(addr.country) || 'TÜRKİYE' },
    });
  }
  return rows;
}

/** `contacts.settings` (jsonb) — kolon olmayan ek bilgiler tek nesnede saklanır. */
function buildSettings(): Record<string, unknown> {
  // Yetkili kişiler: dolu satırlar listelenir; ilk satır (birincil) eski
  // `contact_person` anahtarına da yazılır (önceki ekran/sorgular bozulmasın).
  const persons = form.value.contactPersons
    .filter((person) => person.name.trim() || person.phone.trim() || person.email.trim())
    .map((person) => ({
      name: optional(upper(person.name)) ?? null,
      title: optional(upper(person.title)) ?? null,
      phone: optional(person.phone) ?? null,
      email: optional(person.email) ?? null,
    }));
  const openingAmount = numOrNull(form.value.opening_balance);
  return {
    entity_type: form.value.entity_type,
    first_name: optional(upper(form.value.first_name)) ?? null,
    last_name: optional(upper(form.value.last_name)) ?? null,
    is_foreign: form.value.is_foreign,
    sector: optional(upper(form.value.sector)) ?? null,
    identity_serial: optional(form.value.identity_serial) ?? null,
    contact_persons: persons,
    contact_person: persons[0] ?? null,
    short_name: optional(upper(form.value.short_name)) ?? null,
    group: optional(upper(form.value.group)) ?? null,
    representative: optional(upper(form.value.representative)) ?? null,
    tags: form.value.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    notes: form.value.notes.trim() || null,
    country: upper(form.value.address.country) || 'TÜRKİYE',
    mersis_no: optional(form.value.mersis_no) ?? null,
    trade_registry_no: optional(form.value.trade_registry_no) ?? null,
    kep_address: optional(form.value.kep_address) ?? null,
    website: optional(form.value.website) ?? null,
    whatsapp: optional(form.value.whatsapp) ?? null,
    currency: form.value.currency,
    risk_limit: numOrNull(form.value.risk_limit),
    payment_term_days: numOrNull(form.value.payment_term_days),
    discount_rate: numOrNull(form.value.discount_rate),
    opening_balance: openingAmount,
    opening_balance_side:
      openingAmount !== null ? form.value.opening_balance_side || 'receivable' : null,
    opening_date:
      openingAmount !== null && form.value.opening_date ? form.value.opening_date : null,
    vat_rate: numOrNull(form.value.vat_rate),
    price_list: optional(upper(form.value.price_list)) ?? null,
    payment_method: optional(form.value.payment_method) ?? null,
    accounting_code: optional(form.value.accounting_code) ?? null,
    // Hesap planından seçildiyse kimlik + ad da saklanır (kod tek başına da çözümlenir).
    accounting_account_id: selectedAccount.value?.id ?? null,
    accounting_account_name: selectedAccount.value?.name ?? null,
    bank_accounts: form.value.banks
      .filter((bank) => bank.iban.trim() || bank.bank.trim())
      .map((bank) => ({
        bank: optional(upper(bank.bank)) ?? null,
        branch: optional(bank.branch) ?? null,
        iban: optional(bank.iban.replace(/\s+/g, '').toLocaleUpperCase('tr-TR')) ?? null,
        holder: optional(upper(bank.holder)) ?? null,
      })),
    e_invoice: {
      taxpayer: form.value.e_invoice.taxpayer,
      scenario: form.value.e_invoice.taxpayer ? form.value.e_invoice.scenario : null,
      e_archive: form.value.e_invoice.e_archive,
      alias: form.value.e_invoice.taxpayer ? (optional(form.value.e_invoice.alias) ?? null) : null,
      integrator: optional(upper(form.value.e_invoice.integrator)) ?? null,
    },
    e_waybill: form.value.e_waybill,
  };
}

const handleSubmit = async (): Promise<void> => {
  const found = validate();
  errors.value = found;
  if (Object.keys(found).length) {
    error.value = `Formda ${Object.keys(found).length} eksik veya hatalı alan var. İlgili sekmeyi kontrol edin.`;
    await focusFirstError();
    return;
  }

  saving.value = true;
  error.value = null;
  try {
    await store.createContact({
      code: upper(form.value.code),
      name: upper(form.value.name),
      type: form.value.type,
      trade_name: optional(upper(form.value.trade_name)) ?? null,
      tax_number: optional(form.value.tax_number) ?? null,
      tax_office: optional(form.value.tax_office) ?? null,
      is_active: form.value.is_active,
      settings: buildSettings(),
      phones: buildPhones(),
      emails: buildEmails(),
      addresses: buildAddresses(),
      relations: form.value.relations
        .filter((rel) => rel.related_contact_id)
        .map((rel) => ({
          related_contact_id: rel.related_contact_id,
          relation_type: rel.relation_type,
          notes: optional(rel.notes),
        })),
    });
    router.push('/contacts');
  } catch (e) {
    const axiosError = e as AxiosError<{ message?: string }>;
    error.value = axiosError.response?.data?.message || 'Cari kaydedilemedi.';
  } finally {
    saving.value = false;
  }
};

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
    // Varsayılan muhasebe hesabı da türle birlikte değişir (120 ↔ 320).
    applyDefaultAccount();
  },
);

onMounted(async () => {
  await store.fetchContacts({ limit: 100 });
  if (!codeTouched.value) form.value.code = generateCode(form.value.type);
  // Varsayılan TDHP kodu önceden doldurulur; hesap planı Finans sekmesinde yüklenir.
  if (!form.value.accounting_code) {
    form.value.accounting_code = DEFAULT_ACCOUNTING_CODE[form.value.type];
  }
});
</script>

<style scoped>
.account-page {
  max-width: 76rem;
  padding-bottom: 2.5rem;
}
.account-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 19rem;
  gap: 1.25rem;
  align-items: start;
}
.account-main {
  min-width: 0;
}
.form-card {
  padding: 0;
  overflow: hidden;
}

/* Sekmeler: uzun formda kaydırırken erişilebilir kalsın (kart içinde yapışkan). */
.account-tabs {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0;
  padding: 0 0.75rem;
  background: var(--c-surface);
  overflow-x: auto;
  scrollbar-width: thin;
  flex-wrap: nowrap;
}
.account-tabs .tab {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
}
.tab-panel {
  padding: 1.25rem;
}

/* Bölüm (grup) başlıkları */
.form-section + .form-section {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px dashed var(--c-border);
}
.form-section-title {
  margin: 0 0 0.75rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--c-text);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.section-head .form-section-title {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.875rem 1rem;
}
.form-field-full {
  grid-column: 1 / -1;
}
.field-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--c-muted);
}
.field-hint.warn {
  color: #92400e;
}
/* Etiket + sağa yaslı küçük eylem (örn. hesap kodu: "Elle gir") */
.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.field-head-actions {
  display: flex;
  gap: 0.625rem;
  align-items: baseline;
}
.link-sm {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--c-primary);
  text-decoration: underline;
  cursor: pointer;
}
.link-sm:hover:not(:disabled) {
  color: var(--c-primary-dark);
}
.link-sm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* Seçili muhasebe hesabının kodu + adı */
.account-pick {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.375rem 0 0;
  padding: 0.375rem 0.625rem;
  border-radius: 0.5rem;
  background: var(--c-primary-soft);
  color: var(--c-primary-dark);
  font-size: 0.8125rem;
  font-weight: 600;
}
.account-code {
  flex-shrink: 0;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.3125rem;
  background: #fff;
  border: 1px solid #bfdbfe;
}
.field-error {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--c-danger);
}
.input.invalid {
  border-color: var(--c-danger);
  background: var(--c-danger-soft);
}
.uppercase {
  text-transform: uppercase;
}
.code-field {
  display: flex;
  gap: 0.375rem;
}
.code-field .input {
  flex: 1;
  min-width: 0;
}
.code-field .btn {
  flex-shrink: 0;
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
  accent-color: var(--c-primary);
  flex-shrink: 0;
}

/* Tekrarlanan satırlar */
.repeat-row {
  margin-bottom: 0.875rem;
  padding: 0.75rem;
  border: 1px solid var(--c-border);
  border-radius: 0.625rem;
  background: var(--c-bg);
}
.repeat-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.repeat-index {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.repeat-table {
  display: grid;
  gap: 0.75rem;
}
.repeat-inline {
  display: grid;
  grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  padding-bottom: 0.75rem;
  border-bottom: 1px dashed var(--c-border);
}
.repeat-inline:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.repeat-flags {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.375rem;
  padding-top: 1.5rem;
}
.alert-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: var(--c-danger-soft);
  color: #b91c1c;
  border: 1px solid #fecaca;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}
.alert-link {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

/* Aksiyonlar */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* Özet kartı */
.account-summary {
  position: sticky;
  top: 1rem;
}
.summary-card {
  display: grid;
  gap: 0.75rem;
}
.summary-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-muted);
}
.summary-name {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.summary-badges {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}
.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  border: 1px solid var(--c-border);
  color: var(--c-muted);
}
.pill.customer {
  background: var(--c-primary-soft);
  border-color: #bfdbfe;
  color: var(--c-primary-dark);
}
.pill.supplier {
  background: var(--c-warning-soft);
  border-color: #fde68a;
  color: #92400e;
}
.pill.on {
  background: var(--c-success-soft);
  border-color: #a7f3d0;
  color: #047857;
}
.pill.off {
  background: var(--c-bg);
}
.summary-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 0 0;
  border-top: 1px solid var(--c-border);
}
.summary-list div {
  display: grid;
  gap: 0.125rem;
}
.summary-list dt {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--c-muted);
}
.summary-list dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}
.summary-list dd.break {
  overflow-wrap: anywhere;
}
.summary-save {
  width: 100%;
}
.summary-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--c-muted);
}

@media (max-width: 64rem) {
  .account-layout {
    grid-template-columns: 1fr;
  }
  .account-summary {
    position: static;
    order: -1;
  }
  .summary-card {
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    align-items: start;
  }
  .summary-title,
  .summary-hint {
    grid-column: 1 / -1;
  }
  .summary-save {
    grid-column: 1 / -1;
  }
}

@media (max-width: 40rem) {
  .page {
    padding: 1rem;
  }
  /* Telefonda özet kartı formun önüne geçmesin: alta taşınır ve kompaktlaşır. */
  .account-summary {
    order: 1;
  }
  .summary-card {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .summary-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    display: grid;
    gap: 0.5rem;
  }
  .tab-panel {
    padding: 1rem 0.875rem;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .repeat-inline {
    grid-template-columns: 1fr;
  }
  .repeat-flags {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding-top: 0;
  }
}
</style>
