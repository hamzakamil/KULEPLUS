<template>
  <TradeDocScreen
    doc-type="purchase"
    title="Satın Alma"
    subtitle="Tedarikçilere verilen satın alma siparişleri; mal kabulü ile tamamlanır."
    list-title="Satın Alma Siparişleri"
    new-label="Yeni Satın Alma"
    :statuses="statuses"
    :transitions="transitions"
    :extra-date="{ key: 'expected_date', label: 'Beklenen Tarih' }"
    camel-extra="expectedDate"
  />
</template>

<script setup lang="ts">
import TradeDocScreen from '@/components/TradeDocScreen.vue';

const statuses = [
  { value: 'draft', label: 'Taslak', tone: 'neutral' as const },
  { value: 'sent', label: 'Gönderildi', tone: 'info' as const },
  { value: 'confirmed', label: 'Onaylandı', tone: 'info' as const },
  { value: 'partial_received', label: 'Kısmi Kabul', tone: 'warning' as const },
  { value: 'received', label: 'Teslim Alındı', tone: 'success' as const },
  { value: 'invoiced', label: 'Faturalandı', tone: 'violet' as const },
  { value: 'cancelled', label: 'İptal', tone: 'danger' as const },
];

const transitions: Record<string, string[]> = {
  draft: ['sent', 'confirmed', 'cancelled'],
  sent: ['confirmed', 'cancelled'],
  confirmed: ['partial_received', 'received', 'cancelled'],
  partial_received: ['received', 'cancelled'],
  received: ['invoiced'],
};
</script>