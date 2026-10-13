<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex justify-end">
      <div class="absolute inset-0 bg-black/40" aria-hidden="true" @click="onBackdrop" />
      <aside
        class="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
          <h2 class="text-lg font-semibold text-gray-900">{{ title }}</h2>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Kapat"
            @click="$emit('close')"
          >
            &times;
          </button>
        </header>

        <div class="flex-1 overflow-y-auto p-4">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="flex justify-end gap-3 border-t border-gray-200 p-4">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    closeOnBackdrop?: boolean;
  }>(),
  { title: '', closeOnBackdrop: true },
);

const emit = defineEmits<{
  (e: 'close'): void;
}>();

function onBackdrop() {
  if (props.closeOnBackdrop) emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>
