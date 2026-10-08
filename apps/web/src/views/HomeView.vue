<script setup lang="ts">
import { SITE } from '@/config';
</script>

<template>
  <main class="shell">
    <h1>{{ SITE.name }}</h1>
    <p>{{ SITE.tagline }}</p>
    <p class="hint">
      Uygulama iskeleti — ekranlar Faz 1 (platform) ve Faz 2 (müşteri) fazlarında gelecek.
    </p>
    <nav aria-label="Başlangıç">
      <RouterLink to="/">Ana Sayfa</RouterLink>
    </nav>
  </main>
</template>

<style scoped>
.shell {
  max-width: 48rem;
  margin: 4rem auto;
  padding: 0 1rem;
  font-family: system-ui, sans-serif;
}
.hint {
  color: #475569;
}
</style>
