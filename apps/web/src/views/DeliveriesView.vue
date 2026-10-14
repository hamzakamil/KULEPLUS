<template>
  <TradeDocScreen
    doc-type="delivery"
    title="İrsaliye"
    subtitle="Sevk irsaliyeleri; teslim edilen malların hareketini izler."
    list-title="İrsaliye Listesi"
    new-label="Yeni İrsaliye"
    :statuses="statuses"
    :transitions="transitions"
    :linked="{ key: 'order_id', label: 'Kaynak Sipariş', source: 'orders' }"
    camel-linked="orderId"
    :priced="false"
  />
</template>

<script setup lang="ts">
import TradeDocScreen from '@/components/TradeDocScreen.vue';

const statuses = [
  { value: 'draft', label: 'Taslak', tone: 'neutral' as const },
  { value: 'prepared', label: 'Hazırlandı', tone: 'info' as const },
  { value: 'shipped', label: 'Gönderildi', tone: 'warning' as const },
  { value: 'delivered', label: 'Teslim Edildi', tone: 'success' as const },
  { value: 'returned', label: 'İade', tone: 'violet' as const },
  { value: 'cancelled', label: 'İptal', tone: 'danger' as const },
];

const transitions: Record<string, string[]> = {
  draft: ['prepared', 'cancelled'],
  prepared: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
};
</script>
