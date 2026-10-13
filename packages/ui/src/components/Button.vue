<template>
  <button
    :class="[
      'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:opacity-50 disabled:pointer-events-none',
      variantClasses,
      sizeClasses,
      $attrs.class,
    ]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  }>(),
  { variant: 'primary', size: 'md', disabled: false },
);

defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const VARIANT_CLASSES: Record<string, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus-visible:ring-gray-500',
  outline: 'border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-blue-500',
  ghost: 'hover:bg-gray-100 focus-visible:ring-gray-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
};

const SIZE_CLASSES: Record<string, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

// Tek varyant + tek boyut uygulanır (önceden tüm sınıflar aynı anda uygulanıyordu).
const variantClasses = computed(() => VARIANT_CLASSES[props.variant] ?? '');
const sizeClasses = computed(() => SIZE_CLASSES[props.size] ?? '');
</script>
