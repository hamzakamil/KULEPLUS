<script setup lang="ts">
// Hesap kodunu link görünümlü düğme olarak gösterir; tıklayınca muavin panelini açar.
import { computed } from 'vue';
import { useLedgerDrawerStore } from '@/stores/ledgerDrawer';

const props = defineProps<{
  /** Tek hesap modu: kodu (alt hesaplarıyla) açar. */
  code?: string;
  /** Ön ek modu: bu ön ekle başlayan tüm hesapları açar (`code` yoksa). */
  prefix?: string;
  from?: string;
  to?: string;
  excludeSources?: string[];
  /** Görünen metin; verilmezse kod/ön ek. Slot içeriği bunun yerine geçer. */
  label?: string;
  /** Panel başlığı (ön ek modunda varsayılan "63 ile başlayan hesaplar"). */
  title?: string;
  /** Tek aralıklı (mono olmayan) görünüm: kalem adları gibi düz metin etiketler için. */
  plain?: boolean;
}>();

const drawer = useLedgerDrawerStore();

const shown = computed(() => props.label ?? props.code ?? props.prefix ?? '');
const hint = computed(() =>
  props.code ? `Muavin: ${props.code}` : `Muavin: ${props.prefix} ile başlayan hesaplar`,
);

const ariaLabel = computed(() => (props.label ? `${props.label}, ${hint.value}` : hint.value));

function openDrawer() {
  const opts = {
    from: props.from,
    to: props.to,
    excludeSources: props.excludeSources,
    title: props.title,
  };
  if (props.code) drawer.openAccount(props.code, opts);
  else if (props.prefix) drawer.openPrefix(props.prefix, opts);
}
</script>

<template>
  <button
    type="button"
    :class="['acl', { mono: !plain }]"
    :title="hint"
    :aria-label="ariaLabel"
    @click.stop="openDrawer"
  >
    <slot>{{ shown }}</slot>
  </button>
</template>

<style scoped>
.acl {
  display: inline;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  color: var(--c-primary, #1d4ed8);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  text-align: inherit;
}
.acl:hover {
  text-decoration-style: solid;
  color: var(--c-primary-dark, #1e3a8a);
}
.acl:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
