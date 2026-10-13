<template>
  <svg :id="id" width="200" height="40" viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kuleplus">
    <text x="0" y="30" fill="#1D4ED8" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-weight="800" font-size="28" letter-spacing="-0.5">KULEPLUS</text>
    <text x="140" y="30" fill="#F59E0B" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-weight="800" font-size="28" letter-spacing="-0.5">+</text>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  id?: string;
}>()
</script>
