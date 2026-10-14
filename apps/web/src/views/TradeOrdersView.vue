<template>
  <TradeDocScreen
    doc-type="order"
    title="Siparişler"
    subtitle="Satış siparişleri; onaylanan siparişler irsaliye ve faturaya dönüşür."
    list-title="Sipariş Listesi"
    new-label="Yeni Sipariş"
    :statuses="statuses"
    :transitions="transitions"
    :linked="{ key: 'quote_id', label: 'Kaynak Teklif', source: 'quotes' }"
    camel-linked="quoteId"
  />
</template>

<script setup lang="ts">
import TradeDocScreen from '@/components/TradeDocScreen.vue';

const statuses = [
  { value: 'draft', label: 'Taslak', tone: 'neutral' as const },
  { value: 'confirmed', label: 'Onaylandı', tone: 'info' as const },
  { value: 'partial_delivered', label: 'Kısmi Sevk', tone: 'warning' as const },
  { value: 'delivered', label: 'Sevk Edildi', tone: 'success' as const },
  { value: 'invoiced', label: 'Faturalandı', tone: 'violet' as const },
  { value: 'cancelled', label: 'İptal', tone: 'danger' as const },
];

const transitions: Record<string, string[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['partial_delivered', 'delivered', 'cancelled'],
  partial_delivered: ['delivered', 'cancelled'],
  delivered: ['invoiced'],
};
</script>
