<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @click.self="onBackdrop"
    >
      <div :class="['w-full rounded-lg bg-white p-6 shadow-xl', maxWidthClass]">
        <div class="mb-4 flex items-start justify-between gap-4">
          <h2 class="text-lg font-semibold text-gray-900">{{ title }}</h2>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Kapat"
            @click="$emit('close')"
          >
            &times;
          </button>
        </div>

        <slot />

        <div v-if="$slots.footer" class="mt-6 flex justify-end gap-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    size?: 'sm' | 'md' | 'lg';
    closeOnBackdrop?: boolean;
  }>(),
  {
    title: '',
    size: 'md',
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const maxWidthClass = computed(
  () =>
    ({
      sm: 'max-w-sm',
      md: 'max-w-lg',
      lg: 'max-w-2xl',
    })[props.size],
);

function onBackdrop() {
  if (props.closeOnBackdrop) emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close');
}

// Escape ile kapatma + gövde kaydırma kilidi (SPEC §28 a11y)
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
