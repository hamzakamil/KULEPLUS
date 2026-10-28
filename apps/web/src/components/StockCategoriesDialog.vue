<template>
  <Modal :open="open" title="Ürün Kategorileri" size="lg" @close="$emit('close')">
    <p class="mb-3 text-sm text-gray-600">
      Kategoriler ürün kartında ve listede süzgeç olarak kullanılır. Ürün kartından yazarak da
      kategori ekleyebilirsiniz.
    </p>

    <div v-if="error" class="mb-3 rounded bg-red-50 p-3 text-sm text-red-700" role="alert">
      {{ error }}
    </div>

    <form class="mb-4 flex gap-2" @submit.prevent="add">
      <label class="sr-only" for="cat-new">Yeni kategori adı</label>
      <input
        id="cat-new"
        v-model="newName"
        class="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        placeholder="Yeni kategori adı (örn. Hırdavat)"
        maxlength="100"
        autocomplete="off"
      />
      <button type="submit" class="btn btn-primary" :disabled="busy || !newName.trim()">
        Ekle
      </button>
    </form>

    <p
      v-if="!store.categories.length"
      class="rounded border border-dashed p-4 text-sm text-gray-500"
    >
      Henüz kategori yok. Yukarıdan ekleyin.
    </p>

    <ul
      v-else
      class="divide-y divide-gray-200 rounded border border-gray-200"
      aria-label="Kategori listesi"
    >
      <li v-for="c in store.categories" :key="c.id" class="flex flex-wrap items-center gap-2 p-3">
        <!-- Yeniden adlandırma -->
        <form
          v-if="editingId === c.id"
          class="flex flex-1 items-center gap-2"
          @submit.prevent="saveRename(c.id)"
        >
          <input
            v-model="editName"
            class="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            :aria-label="`${c.name} yeni adı`"
            maxlength="100"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary btn-sm" :disabled="busy || !editName.trim()">
            Kaydet
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="editingId = null">
            Vazgeç
          </button>
        </form>

        <!-- Birleştirme -->
        <form
          v-else-if="mergingId === c.id"
          class="flex flex-1 flex-wrap items-center gap-2"
          @submit.prevent="merge(c)"
        >
          <span class="text-sm"
            >“<strong>{{ c.name }}</strong
            >” ürünlerini şuraya taşı:</span
          >
          <select
            v-model="mergeTarget"
            class="rounded border border-gray-300 px-2 py-1 text-sm"
            :aria-label="`${c.name} kategorisinin birleştirileceği kategori`"
          >
            <option value="" disabled>Kategori seçin…</option>
            <option
              v-for="o in store.categories.filter((x) => x.id !== c.id)"
              :key="o.id"
              :value="o.id"
            >
              {{ o.name }}
            </option>
          </select>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="busy || !mergeTarget">
            Birleştir
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="mergingId = null">
            Vazgeç
          </button>
        </form>

        <!-- Normal satır -->
        <template v-else>
          <span class="flex-1 text-sm font-medium text-gray-900">{{ c.name }}</span>
          <span class="text-xs text-gray-500">{{ c.product_count }} ürün</span>
          <button type="button" class="link" :disabled="busy" @click="startRename(c)">
            Yeniden adlandır
          </button>
          <button
            type="button"
            class="link"
            :disabled="busy || store.categories.length < 2"
            :title="
              store.categories.length < 2 ? 'Birleştirmek için en az iki kategori gerekir' : ''
            "
            @click="startMerge(c.id)"
          >
            Birleştir
          </button>
          <button type="button" class="link danger" :disabled="busy" @click="remove(c)">Sil</button>
        </template>
      </li>
    </ul>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="$emit('close')">Kapat</button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Modal } from '@kuleplus/ui';
import { useStockStore, type ProductCategory } from '@/stores/stock';

const props = defineProps<{ open: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const store = useStockStore();

const newName = ref('');
const editingId = ref<string | null>(null);
const editName = ref('');
const mergingId = ref<string | null>(null);
const mergeTarget = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

function resetState(): void {
  newName.value = '';
  editingId.value = null;
  mergingId.value = null;
  mergeTarget.value = '';
  error.value = null;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    resetState();
    void store.fetchCategories();
  },
  { immediate: true },
);

/** Tek bir işlemi çalıştırır; hata mesajını pencerede gösterir. Başarıda `true` döner. */
async function run(action: () => Promise<unknown>): Promise<boolean> {
  busy.value = true;
  error.value = null;
  try {
    await action();
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'İşlem tamamlanamadı.';
    return false;
  } finally {
    busy.value = false;
  }
}

async function add(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  if (await run(() => store.createCategory(name))) newName.value = '';
}

function startRename(c: ProductCategory): void {
  mergingId.value = null;
  editingId.value = c.id;
  editName.value = c.name;
}

async function saveRename(id: string): Promise<void> {
  if (await run(() => store.renameCategory(id, editName.value.trim()))) editingId.value = null;
}

function startMerge(id: string): void {
  editingId.value = null;
  mergingId.value = id;
  mergeTarget.value = '';
}

async function merge(source: ProductCategory): Promise<void> {
  const target = store.categories.find((c) => c.id === mergeTarget.value);
  if (!target) return;
  const ok = window.confirm(
    `“${source.name}” kategorisindeki ${source.product_count} ürün “${target.name}” kategorisine taşınacak ve “${source.name}” silinecek. Devam edilsin mi?`,
  );
  if (!ok) return;
  if (await run(() => store.mergeCategories(source.id, target.id))) mergingId.value = null;
}

async function remove(c: ProductCategory): Promise<void> {
  const detail =
    c.product_count > 0
      ? `${c.product_count} ürün kategorisiz kalacak (ürünler silinmez).`
      : 'Bu kategoride ürün yok.';
  if (!window.confirm(`“${c.name}” kategorisi silinsin mi? ${detail}`)) return;
  await run(() => store.deleteCategory(c.id));
}
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background-color: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
}
.btn-secondary {
  background-color: #f3f4f6;
  border-color: #d1d5db;
  color: #111827;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #e5e7eb;
}
.link {
  background: none;
  border: none;
  padding: 0.125rem 0.25rem;
  font-size: 0.8125rem;
  color: #2563eb;
  cursor: pointer;
}
.link:hover:not(:disabled) {
  text-decoration: underline;
}
.link:disabled {
  color: #9ca3af;
  cursor: not-allowed;
}
.link.danger {
  color: #dc2626;
}
</style>
