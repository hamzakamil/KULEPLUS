<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

/**
 * Giriş yapmamış ziyaretçi için tanıtım (landing) sitesi adresi (VITE_SITE_URL, LockedModuleView ile ortak).
 * Tanımlıysa kök adres oraya gider; tanımlı değilse doğrudan girişe düşer (eski davranış).
 */
const landingUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() || '';

onMounted(() => {
  // Oturum açıksa paneli aç; değilse tanıtım sitesine ya da girişe yönlendir.
  if (auth.isAuthenticated) window.location.replace('/dashboard');
  else window.location.replace(landingUrl || '/login');
});
</script>

<template>
  <div class="root-redirect">
    <RouterLink v-if="!landingUrl" to="/login">Devam etmek için tıklayın…</RouterLink>
    <a v-else :href="landingUrl">Devam etmek için tıklayın…</a>
  </div>
</template>

<style scoped>
.root-redirect {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--c-muted);
}
</style>
