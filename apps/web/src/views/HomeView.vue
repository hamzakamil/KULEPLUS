<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

onMounted(() => {
  // Oturum açıksa paneli aç, değilse girişe yönlendir.
  if (auth.isAuthenticated) window.location.replace('/dashboard');
  else window.location.replace('/login');
});
</script>

<template>
  <div class="root-redirect">
    <RouterLink to="/login">Devam etmek için tıklayın…</RouterLink>
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
