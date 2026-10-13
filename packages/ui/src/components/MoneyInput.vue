<template>
  <div class="flex w-full">
    <label
      v-if="$slots.label || label"
      class="w-full flex items-center gap-2 text-sm font-medium text-gray-900"
    >
      <slot name="label">{{ label }}</slot>
    </label>

    <div class="relative w-full">
      <div class="flex items-center">
        <template v-if="$slots.prefix || currencySymbol">
          <span
            class="flex h-10 items-center justify-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-900"
          >
            <slot name="prefix">{{ currencySymbol }}</slot>
          </span>
        </template>

        <input
          :class="[
            'flex-1 h-10 rounded-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-right',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
            'disabled:opacity-50 disabled:pointer-events-none',
            $attrs.class,
          ]"
          type="tel"
          inputmode="decimal"
          :value="formattedValue"
          :disabled="disabled"
          @input="onInput"
          @blur="onBlur"
          @focus="onFocus"
          :placeholder="placeholder"
        />

        <template v-if="$slots.suffix">
          <span
            class="flex h-10 items-center justify-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-900"
          >
            <slot name="suffix" />
          </span>
        </template>
      </div>
    </div>

    <template v-if="$slots.help || helpText">
      <p class="mt-1 text-xs text-gray-500">
        <slot name="help">{{ helpText }}</slot>
      </p>
    </template>

    <template v-if="$slots.error || errorMessage">
      <p class="mt-1 text-xs text-red-600">
        <slot name="error">{{ errorMessage }}</slot>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue: number | string;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  currencySymbol?: string;
  helpText?: string;
  errorMessage?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const internalValue = ref(0);
const formattedValue = ref('');

function parseValue(value: string | number): number {
  if (typeof value === 'number') return value;
  const num = parseFloat(value.replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function formatValue(value: number): string {
  if (isNaN(value)) return '';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: props.precision ?? 2,
    maximumFractionDigits: props.precision ?? 2,
  }).format(value);
}

function onInput(e: Event) {
  const input = e.target as HTMLInputElement;
  let value = input.value;

  // Allow only numbers, decimal point, and minus sign
  value = value.replace(/[^0-9.,-]/g, '');

  // Handle Turkish decimal separator (comma)
  if (value.includes(',')) {
    const parts = value.split(',');
    if (parts.length > 2) {
      // More than one comma, keep only the last one as decimal
      value = parts.slice(0, -1).join('') + ',' + parts.pop();
    }
  } else {
    // Convert dot to comma for Turkish format
    value = value.replace('.', ',');
  }

  // Limit to one comma
  if (value.split(',').length > 2) {
    value = value.slice(0, -1);
  }

  input.value = value;
  formattedValue.value = value;
  const numValue = parseValue(value.replace(',', '.'));
  emit('update:modelValue', numValue);
}

function onBlur() {
  if (formattedValue.value === '') {
    internalValue.value = 0;
    emit('update:modelValue', 0);
    return;
  }

  const numValue = parseValue(formattedValue.value.replace(',', '.'));
  // Apply min/max constraints
  if (props.min !== undefined && numValue < props.min) {
    internalValue.value = props.min;
    formattedValue.value = formatValue(props.min);
    emit('update:modelValue', props.min);
    return;
  }

  if (props.max !== undefined && numValue > props.max) {
    internalValue.value = props.max;
    formattedValue.value = formatValue(props.max);
    emit('update:modelValue', props.max);
    return;
  }

  internalValue.value = numValue;
  formattedValue.value = formatValue(numValue);
  emit('update:modelValue', numValue);
}

function onFocus() {
  // Show raw number on focus for easier editing
  if (internalValue.value !== 0) {
    formattedValue.value = internalValue.value.toLocaleString('en-US', {
      minimumFractionDigits: props.precision ?? 2,
      maximumFractionDigits: props.precision ?? 2,
    });
  }
}

// Watch for external modelValue changes
watch(
  () => props.modelValue,
  (value) => {
    const numValue = parseValue(value);
    internalValue.value = numValue;
    formattedValue.value = formatValue(numValue);
  },
);

// Initialize
watch(
  () => props.modelValue,
  (value) => {
    const numValue = parseValue(value);
    internalValue.value = numValue;
    formattedValue.value = formatValue(numValue);
  },
  { immediate: true },
);
</script>
