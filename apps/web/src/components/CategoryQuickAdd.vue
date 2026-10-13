<template>
  <!-- Satır içi yeni kategori ekleme: gider listesi ve gider formu tarafından kullanılır. -->
  <div class="cat-add">
    <button
      v-if="!open"
      type="button"
      class="cat-add-trigger"
      :class="triggerClass"
      @click="open = true"
    >
      <span aria-hidden="true">＋</span> {{ triggerLabel }}
    </button>

    <form v-else class="cat-add-form" @submit.prevent="save">
      <p class="cat-add-title">Yeni Gider Kategorisi</p>
      <label class="cat-add-field">
        <span>Kategori adı *</span>
        <input
          ref="nameInput"
          v-model="form.name"
          type="text"
          class="input"
          placeholder="ör. Aidat"
          required
          maxlength="80"
        />
      </label>
      <label class="cat-add-field">
        <span>Grup</span>
        <select v-model="form.grup" class="select">
          <option :value="null">Grupsuz</option>
          <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }}</option>
        </select>
      </label>
      <label class="cat-add-check">
        <input v-model="form.is_favorite" type="checkbox" />
        Hızlı girişte öne çıkar
      </label>
      <p v-if="localError" class="cat-add-error" role="alert">{{ localError }}</p>
      <div class="cat-add-actions">
        <button type="button" class="btn btn-secondary btn-sm" @click="close">Vazgeç</button>
        <button type="submit" class="btn btn-primary btn-sm" :disabled="saving || !canSave">
          {{ saving ? 'Ekleniyor…' : 'Ekle' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { EXPENSE_GROUPS, useExpenseStore } from '@/stores/expense';

const props = withDefaults(
  defineProps<{
    /** Hangi grupta açılacağı (varsayılan grup ön seçimi). */
    defaultGroup?: string | null;
    /** Tetikleyici buton metni. */
    triggerLabel?: string;
    /** Tetikleyiciye ek sınıf (tile / chip varyantı). */
    triggerClass?: string;
  }>(),
  { defaultGroup: null, triggerLabel: 'Yeni kategori ekle', triggerClass: '' },
);

const emit = defineEmits<{ created: [id: string] }>();

const expenseStore = useExpenseStore();
const groups = EXPENSE_GROUPS;
const open = ref(false);
const saving = ref(false);
const localError = ref<string | null>(null);
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');

const form = ref<{ name: string; grup: string | null; is_favorite: boolean }>({
  name: '',
  grup: props.defaultGroup,
  is_favorite: false,
});

const canSave = computed(() => form.value.name.trim().length > 0);

const close = () => {
  open.value = false;
  localError.value = null;
  form.value = { name: '', grup: props.defaultGroup, is_favorite: false };
};

const save = async () => {
  saving.value = true;
  localError.value = null;
  try {
    const created = await expenseStore.createCategory({
      name: form.value.name.trim(),
      grup: form.value.grup,
      is_favorite: form.value.is_favorite,
    });
    emit('created', created.id);
    close();
  } catch (err) {
    localError.value =
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
      expenseStore.error ||
      'Kategori eklenemedi';
  } finally {
    saving.value = false;
  }
};

// Panel açılınca ad alanına odaklan (klavye dostu).
const watchOpen = () => {
  if (open.value) nextTick(() => nameInput.value?.focus());
};
import { watch } from 'vue';
watch(open, watchOpen);
</script>

<style scoped>
.cat-add-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px dashed #94a3b8;
  background: transparent;
  color: #475569;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
}
.cat-add-trigger:hover {
  border-color: #1d4ed8;
  color: #1d4ed8;
  background: #eff6ff;
}
.cat-add-form {
  border: 1px solid #bfdbfe;
  background: #f8fbff;
  border-radius: 0.625rem;
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
  min-width: 12rem;
}
.cat-add-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
}
.cat-add-field {
  display: grid;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #475569;
}
.cat-add-check {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: #475569;
}
.cat-add-error {
  margin: 0;
  font-size: 0.75rem;
  color: #b91c1c;
}
.cat-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
