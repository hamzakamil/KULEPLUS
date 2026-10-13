<template>
  <div
    class="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center"
  >
    <div v-if="$slots.icon" class="mb-3 text-gray-400">
      <slot name="icon" />
    </div>
    <h3 class="text-base font-semibold text-gray-900">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-sm text-gray-500">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
  }>(),
  { description: '' },
);
</script>
