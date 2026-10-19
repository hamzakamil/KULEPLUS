<script setup lang="ts">
// Düz metindeki hesap kodlarını (391, 191, 360.02 …) tıklanabilir muavin bağlantısına çevirir.
import { computed } from 'vue';
import AccountCodeLink from './AccountCodeLink.vue';

const props = defineProps<{
  text: string;
  from?: string;
  to?: string;
  excludeSources?: string[];
}>();

/**
 * 3 haneli, isteğe bağlı noktalı alt hesaplı kodlar (770, 360.02, 120.01.003). Tutar ("1.200,50"),
 * yıl/tarih ve "250 TL" gibi para/yüzde ifadeleri eşleşmez.
 */
const CODE = /(?<![\d.,-])([1-9]\d{2}(?:\.\d{1,3}){0,2})(?![\d,]|\.\d|-\d|\s?(?:TL|₺|%))/g;

interface Part {
  text: string;
  code?: string;
}

const parts = computed<Part[]>(() => {
  const out: Part[] = [];
  let last = 0;
  for (const m of props.text.matchAll(CODE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: props.text.slice(last, start) });
    out.push({ text: m[1], code: m[1] });
    last = start + m[1].length;
  }
  if (last < props.text.length) out.push({ text: props.text.slice(last) });
  return out;
});
</script>

<template>
  <span>
    <template v-for="(p, i) in parts" :key="i">
      <AccountCodeLink
        v-if="p.code"
        :code="p.code"
        :from="from"
        :to="to"
        :exclude-sources="excludeSources"
      />
      <template v-else>{{ p.text }}</template>
    </template>
  </span>
</template>
