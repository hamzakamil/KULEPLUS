<template>
  <div class="flex w-full">
    <label
      v-if="$slots.label || label"
      class="w-full flex items-center gap-2 text-sm font-medium text-gray-900"
    >
      <slot name="label">{{ label }}</slot>
    </label>

    <div class="relative w-full">
      <input
        :class="[
          'flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:pointer-events-none',
          $attrs.class,
        ]"
        :type="type"
        :placeholder="placeholder"
        :value="modelValue"
        :disabled="disabled"
        @input="onInput"
        @change="onInput"
      />

      <template v-if="$slots.prefix || prefix">
        <div
          class="absolute left-3 flex h-full items-center pointer-events-none text-sm text-gray-500"
        >
          <slot name="prefix">{{ prefix }}</slot>
        </div>
      </template>

      <template v-if="$slots.suffix || suffix">
        <div
          class="absolute right-3 flex h-full items-center pointer-events-none text-sm text-gray-500"
        >
          <slot name="suffix">{{ suffix }}</slot>
        </div>
      </template>
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
defineOptions({ inheritAttrs: false });

defineProps<{
  modelValue: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  prefix?: string;
  suffix?: string;
  helpText?: string;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

function onInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  emit('update:modelValue', target?.value ?? '');
}
</script>
