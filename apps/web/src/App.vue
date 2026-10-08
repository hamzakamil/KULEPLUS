<script setup lang="ts">
import { t } from '@/i18n';
</script>

<template>
  <a class="skip-link" href="#icerik">{{ t('web.a11y.skip') }}</a>
  <RouterView id="icerik" />
</template>

<style scoped>
.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 0;
  z-index: 100;
  padding: 0.75rem 1rem;
  background: #1d4ed8;
  color: #fff;
}
</style>
