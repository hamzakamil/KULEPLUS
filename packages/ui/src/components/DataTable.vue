<template>
  <div class="w-full overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
            @click="handleSort(col.key)"
          >
            <div class="flex items-center gap-1">
              <span>{{ col.label }}</span>
              <span v-if="sortKey === col.key" class="text-gray-400">
                {{ sortOrder === 'asc' ? '↑' : '↓' }}
              </span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length" class="px-4 py-8 text-center text-sm text-gray-500">
            <slot name="empty">
              <div class="flex flex-col items-center justify-center py-8">
                <svg
                  class="w-8 h-8 text-gray-300 mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <span class="text-sm text-gray-500">Kayıt bulunamadı</span>
              </div>
            </slot>
          </td>
        </tr>
        <tr
          v-else
          v-for="(row, rowIndex) in sortedRows"
          :key="rowKey ? getRowKey(row, rowIndex) : rowIndex"
          class="hover:bg-gray-50 transition-colors"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-4 py-3 whitespace-nowrap text-sm text-gray-900"
          >
            <slot :name="col.key" :row="row" :value="getRowValue(row, col.key)">
              {{ getRowValue(row, col.key) }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
}

const props = defineProps<{
  rows: Record<string, unknown>[];
  columns: Column[];
  rowKey?: (row: Record<string, unknown>, index: number) => string | number;
  defaultSortKey?: string;
  defaultSortOrder?: 'asc' | 'desc';
}>();

const sortKey = ref(props.defaultSortKey ?? '');
const sortOrder = ref<'asc' | 'desc'>(props.defaultSortOrder ?? 'asc');

function getRowKey(row: Record<string, unknown>, index: number): string | number {
  if (props.rowKey) return props.rowKey(row, index);
  return (row.id as string | number) ?? index;
}

function getRowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

const sortedRows = computed(() => {
  if (!sortKey.value) return props.rows;

  const key = sortKey.value;
  return [...props.rows].sort((a, b) => {
    const aVal = a[key] ?? '';
    const bVal = b[key] ?? '';
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortOrder.value === 'asc' ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal);
    const bStr = String(bVal);
    const cmp = aStr.localeCompare(bStr, 'tr-TR');
    return sortOrder.value === 'asc' ? cmp : -cmp;
  });
});

function handleSort(key: string) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortOrder.value = 'asc';
  }
  emit('sort', { key: sortKey.value, order: sortOrder.value });
}

const emit = defineEmits<{
  (e: 'sort', payload: { key: string; order: 'asc' | 'desc' }): void;
}>();
</script>
