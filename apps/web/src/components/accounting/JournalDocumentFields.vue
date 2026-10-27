<script setup lang="ts">
// Yevmiye fişi belge alanları (başlık ya da satır): belge tipi, belge adı, no, tarih, ödeme yöntemi.
import {
  JOURNAL_DOCUMENT_TYPES,
  JOURNAL_PAYMENT_METHODS,
  type JournalDocumentFields,
} from '@/lib/journalDocument';

const props = defineProps<{
  /** Alanların kimlik/etiket ön eki; sayfada benzersiz olmalı. */
  idPrefix: string;
  /** Etiketlerin başına gelen bağlam (ör. "Satır 2 "); erişilebilir adlar için. */
  labelPrefix?: string;
  /** Boş belge tipinin seçenek metni. */
  emptyLabel?: string;
}>();

const model = defineModel<JournalDocumentFields>({ required: true });

const pfx = () => props.labelPrefix ?? '';
</script>

<template>
  <div class="jd-grid">
    <div class="jd-field">
      <label :for="`${idPrefix}-type`">{{ pfx() }}Belge tipi</label>
      <select :id="`${idPrefix}-type`" v-model="model.document_type" class="select">
        <option value="">{{ emptyLabel ?? 'Belgesiz (açılış, amortisman, yansıtma vb.)' }}</option>
        <option v-for="t in JOURNAL_DOCUMENT_TYPES" :key="t.value" :value="t.value">
          {{ t.label }}
        </option>
      </select>
    </div>
    <div v-if="model.document_type === 'other'" class="jd-field">
      <label :for="`${idPrefix}-desc`">{{ pfx() }}Belgenin adı</label>
      <input
        :id="`${idPrefix}-desc`"
        v-model="model.document_type_description"
        type="text"
        class="input"
        maxlength="120"
        placeholder="Ör. Ücret Bordrosu, Dekont, Sigorta Poliçesi"
        :aria-describedby="`${idPrefix}-desc-help`"
      />
      <small :id="`${idPrefix}-desc-help`" class="muted">
        İşlem adı (havale, EFT) değil, belgenin adı yazılır.
      </small>
    </div>
    <div class="jd-field">
      <label :for="`${idPrefix}-no`">{{ pfx() }}Belge no</label>
      <input
        :id="`${idPrefix}-no`"
        v-model="model.document_number"
        type="text"
        class="input"
        maxlength="60"
      />
    </div>
    <div class="jd-field">
      <label :for="`${idPrefix}-date`">{{ pfx() }}Belge tarihi</label>
      <input :id="`${idPrefix}-date`" v-model="model.document_date" type="date" class="input" />
    </div>
    <div class="jd-field">
      <label :for="`${idPrefix}-pay`">{{ pfx() }}Ödeme yöntemi</label>
      <select :id="`${idPrefix}-pay`" v-model="model.payment_method" class="select">
        <option value="">—</option>
        <option v-for="m in JOURNAL_PAYMENT_METHODS" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.jd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.6rem 0.75rem;
}
.jd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 0.8rem;
  color: #555;
}
.jd-grid small {
  font-size: 0.72rem;
}
</style>
