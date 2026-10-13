<template>
  <TradeDocScreen
    doc-type="quote"
    title="Teklifler"
    subtitle="Müşterilere verilen fiyat teklifleri; kabul edilenler siparişe dönüşür."
    list-title="Teklif Listesi"
    new-label="Yeni Teklif"
    :statuses="statuses"
    :transitions="transitions"
    :extra-date="{ key: 'valid_until', label: 'Geçerlilik' }"
    camel-extra="validUntil"
  />
</template>

<script setup lang="ts">
import TradeDocScreen from '@/components/TradeDocScreen.vue';

const statuses = [
  { value: 'draft', label: 'Taslak', tone: 'neutral' as const },
  { value: 'sent', label: 'Gönderildi', tone: 'info' as const },
  { value: 'accepted', label: 'Kabul Edildi', tone: 'success' as const },
  { value: 'rejected', label: 'Reddedildi', tone: 'danger' as const },
  { value: 'expired', label: 'Süresi Doldu', tone: 'warning' as const },
  { value: 'converted', label: 'Siparişe Dönüştü', tone: 'violet' as const },
];

/** API'de tanımlı geçerli durum geçişleri (sales-quote.service updateQuoteStatus). */
const transitions: Record<string, string[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: ['converted'],
};
</script>