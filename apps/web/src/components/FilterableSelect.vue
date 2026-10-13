<script setup lang="ts">
// FilterableSelect — tüm dropdown'lar için ortak "combobox" bileşeni.
// Yazınca filtreler (TR karakter duyarsız), klavye ile gezilir, ok/enter/escape destekler.
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();

export interface FilterOption {
  value: string;
  label: string;
}

type RawOption = string | FilterOption;

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    /** 'string' veya { value, label } elemanları; string ise hem değer hem etiket aynıdır. */
    options: RawOption[];
    placeholder?: string;
    /** Boş değere dönmek için ✕ butonu gösterir. Filtre alanlarında "Tümü" anlamına gelir. */
    allowClear?: boolean;
    disabled?: boolean;
    noOptionsMessage?: string;
    id?: string;
    name?: string;
  }>(),
  {
    modelValue: null,
    placeholder: 'Seçin…',
    allowClear: false,
    disabled: false,
    noOptionsMessage: 'Sonuç bulunamadı',
    id: undefined,
    name: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'select', option: FilterOption): void;
}>();

function toOption(o: RawOption): FilterOption {
  return typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value };
}

const options = computed<FilterOption[]>(() => props.options.map(toOption));

/** TR karakterleri ASCII'ye indirgeyerek büyük/küçük harf duyarsız arama. */
function norm(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] as string);
}

const root = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const open = ref(false);
const editing = ref(false);
const query = ref('');
const highlight = ref(-1);

const LIST_ID = computed(() => `${props.id ?? 'fs'}-list`);

/** $attrs içinde class/style dışındaki atributları (aria-label vb.) input'a bağlar. */
const inputAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs as Record<string, unknown>;
  return rest;
});

const currentLabel = computed(() => {
  const v = props.modelValue;
  if (v === null || v === undefined || v === '') return '';
  return options.value.find((o) => o.value === v)?.label ?? String(v);
});

const inputValue = computed(() => (editing.value ? query.value : currentLabel.value));

const filtered = computed<FilterOption[]>(() => {
  const q = norm((editing.value && query.value) || '');
  const base = q
    ? options.value.filter((o) => norm(o.label).includes(q) || norm(o.value).includes(q))
    : options.value;
  return base.slice(0, 200);
});

// Dışarıdan modelValue değişirse gösterim senkron kalır.
watch(
  () => props.modelValue,
  () => {
    if (!editing.value) query.value = '';
  },
);

function scrollHighlightIntoView(): void {
  const el = listEl.value?.children[highlight.value] as HTMLElement | undefined;
  el?.scrollIntoView({ block: 'nearest' });
}

function openList(): void {
  if (props.disabled) return;
  open.value = true;
  highlight.value = filtered.value.length ? 0 : -1;
}

function closeList(): void {
  open.value = false;
  editing.value = false;
  query.value = '';
  highlight.value = -1;
}

function select(opt: FilterOption): void {
  emit('update:modelValue', opt.value);
  emit('select', opt);
  editing.value = false;
  query.value = '';
  open.value = false;
  highlight.value = -1;
  inputEl.value?.focus();
}

function clear(): void {
  emit('update:modelValue', '');
  editing.value = false;
  query.value = '';
  open.value = false;
  highlight.value = -1;
  inputEl.value?.focus();
}

function onFocus(): void {
  if (props.disabled) return;
  editing.value = false;
  openList();
}

function onInput(e: Event): void {
  editing.value = true;
  query.value = (e.target as HTMLInputElement).value;
  open.value = true;
  highlight.value = filtered.value.length ? 0 : -1;
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!open.value) return openList();
    highlight.value = Math.min(highlight.value + 1, filtered.value.length - 1);
    scrollHighlightIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open.value) return openList();
    highlight.value = Math.max(highlight.value - 1, -1);
    scrollHighlightIntoView();
  } else if (e.key === 'Enter') {
    if (open.value && highlight.value >= 0 && filtered.value[highlight.value]) {
      e.preventDefault();
      select(filtered.value[highlight.value]);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeList();
  } else if (e.key === 'Tab') {
    closeList();
  }
}

function onDocPointerDown(e: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) closeList();
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown));
</script>

<template>
  <div ref="root" class="fs-select" :class="[$attrs.class, { 'fs-disabled': disabled }]">
    <div class="fs-control">
      <input
        :id="id"
        ref="inputEl"
        v-bind="inputAttrs"
        :value="inputValue"
        :name="name"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        :disabled="disabled || options.length === 0"
        :placeholder="options.length === 0 ? noOptionsMessage : placeholder"
        :aria-expanded="open"
        aria-haspopup="listbox"
        :aria-controls="LIST_ID"
        :aria-activedescendant="open && highlight >= 0 ? `${LIST_ID}-opt-${highlight}` : undefined"
        @focus="onFocus"
        @input="onInput"
        @keydown="onKeydown"
      />
      <span v-if="!disabled" class="fs-chev" aria-hidden="true">▾</span>
      <button
        v-if="allowClear && modelValue"
        type="button"
        class="fs-clear"
        :disabled="disabled"
        aria-label="Seçimi temizle"
        @pointerdown.prevent="clear"
      >
        ×
      </button>
    </div>

    <ul v-if="open && !disabled" :id="LIST_ID" ref="listEl" class="fs-list" role="listbox">
      <li v-if="filtered.length === 0" class="fs-empty" role="option" aria-disabled="true">
        {{ noOptionsMessage }}
      </li>
      <li
        v-for="(opt, i) in filtered"
        :id="`${LIST_ID}-opt-${i}`"
        :key="`${opt.value}::${opt.label}`"
        class="fs-opt"
        :class="{ 'fs-selected': opt.value === modelValue, 'fs-highlight': i === highlight }"
        role="option"
        :aria-selected="opt.value === modelValue"
        @mousedown.prevent
        @click="select(opt)"
        @mouseenter="highlight = i"
      >
        {{ opt.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fs-select {
  position: relative;
  width: 100%;
}

.fs-control {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  min-height: 2.375rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.25rem 0.75rem;
  cursor: text;
  box-sizing: border-box;
}

.fs-control:focus-within {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 3px #eff6ff;
}

.fs-control input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 0.9375rem;
  color: #0f172a;
  padding: 0.3125rem 0;
}

.fs-control input::placeholder {
  color: #94a3b8;
}

.fs-select.fs-disabled .fs-control {
  background: #f8fafc;
  opacity: 0.65;
  cursor: not-allowed;
}

.fs-select.fs-disabled .fs-control input {
  cursor: not-allowed;
}

.fs-chev {
  color: #64748b;
  font-size: 0.6875rem;
  line-height: 1;
  pointer-events: none;
  flex-shrink: 0;
}

.fs-clear {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.125rem;
  flex-shrink: 0;
}

.fs-clear:hover {
  color: #475569;
}

.fs-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  max-height: 15rem;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  box-shadow: 0 10px 28px rgb(15 23 42 / 0.14);
}

.fs-opt {
  padding: 0.4375rem 0.625rem;
  font-size: 0.875rem;
  color: #334155;
  border-radius: 0.375rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fs-opt.fs-highlight,
.fs-opt:hover {
  background: #eff6ff;
  color: #1e40af;
}

.fs-opt.fs-selected {
  font-weight: 600;
  background: #eff6ff;
  color: #1d4ed8;
}

.fs-empty {
  padding: 0.4375rem 0.625rem;
  font-size: 0.875rem;
  color: #94a3b8;
}
</style>
