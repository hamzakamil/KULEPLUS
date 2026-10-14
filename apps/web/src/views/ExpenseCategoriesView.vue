<template>
  <div class="cat-settings">
    <header v-if="!embedded" class="page-header">
      <div>
        <h1 class="page-title">Gider Kategori Ayarları</h1>
        <p class="page-sub">
          Kategorileri düzenleyin, gruplara atayın, hızlı girişte öne çıkarın veya pasife alın.
        </p>
      </div>
      <RouterLink to="/expenses" class="btn btn-secondary">Giderlere Dön</RouterLink>
    </header>

    <p v-if="store.error" class="alert alert-error" role="alert">{{ store.error }}</p>

    <!-- Yeni kategori -->
    <section class="card new-card" aria-labelledby="yeni-kat">
      <h2 id="yeni-kat" class="card-title">Yeni Kategori</h2>
      <form class="new-grid" @submit.prevent="createNew">
        <label>
          <span>Ad *</span>
          <input
            v-model="form.name"
            type="text"
            class="input"
            placeholder="ör. Aidat"
            required
            maxlength="80"
          />
        </label>
        <label>
          <span>Kod (boşsa otomatik)</span>
          <input
            v-model="form.code"
            type="text"
            class="input mono"
            placeholder="AIDAT"
            maxlength="30"
          />
        </label>
        <label>
          <span>Grup</span>
          <select v-model="form.grup" class="select">
            <option :value="null">Grupsuz</option>
            <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }}</option>
          </select>
        </label>
        <label class="check">
          <input v-model="form.is_favorite" type="checkbox" />
          Hızlı girişte öne çıkar
        </label>
        <label class="full">
          <span>Açıklama</span>
          <input
            v-model="form.description"
            type="text"
            class="input"
            maxlength="200"
            placeholder="Kısa açıklama"
          />
        </label>
        <div class="full actions">
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            :disabled="creating || !form.name.trim()"
          >
            {{ creating ? 'Ekleniyor…' : '＋ Kategori Ekle' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Grup grup liste -->
    <section v-for="grp in grouped" :key="grp.key" class="card group-card" :aria-label="grp.label">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">{{ groupIcon(grp.key) }}</span>
        <div>
          <h2 class="group-title">{{ grp.label }}</h2>
          <p class="muted small">{{ grp.items.length }} kategori</p>
        </div>
      </header>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Ad</th>
              <th scope="col">Kod</th>
              <th scope="col">Grup</th>
              <th scope="col">Açıklama</th>
              <th scope="col">Hızlı Giriş</th>
              <th scope="col">Durum</th>
              <th scope="col" class="num">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="cat in grp.items"
              :key="cat.id"
              :class="{ inactive: cat.status !== 'active' }"
            >
              <td class="strong">
                <input
                  v-model="drafts[cat.id].name"
                  type="text"
                  class="input input-sm"
                  maxlength="80"
                  :aria-label="`${cat.name} adı`"
                />
              </td>
              <td class="mono muted">{{ cat.code }}</td>
              <td>
                <select
                  v-model="drafts[cat.id].grup"
                  class="select select-sm"
                  :aria-label="`${cat.name} grubu`"
                >
                  <option :value="null">Grupsuz</option>
                  <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }}</option>
                </select>
              </td>
              <td>
                <input
                  v-model="drafts[cat.id].description"
                  type="text"
                  class="input input-sm"
                  maxlength="200"
                  placeholder="—"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="star"
                  :class="{ on: drafts[cat.id].is_favorite }"
                  :title="
                    drafts[cat.id].is_favorite ? 'Öne çıkarmayı kaldır' : 'Hızlı girişte öne çıkar'
                  "
                  @click="drafts[cat.id].is_favorite = !drafts[cat.id].is_favorite"
                >
                  ★
                </button>
              </td>
              <td>
                <span
                  class="badge"
                  :class="cat.status === 'active' ? 'badge-success' : 'badge-neutral'"
                >
                  {{ cat.status === 'active' ? 'Aktif' : 'Pasif' }}
                </span>
              </td>
              <td class="num actions">
                <button
                  type="button"
                  class="link"
                  :disabled="savingId === cat.id"
                  @click="saveRow(cat.id)"
                >
                  {{ savingId === cat.id ? '…' : 'Kaydet' }}
                </button>
                <button
                  v-if="cat.status === 'active'"
                  type="button"
                  class="link"
                  @click="setStatus(cat.id, 'inactive')"
                >
                  Pasife Al
                </button>
                <button v-else type="button" class="link" @click="setStatus(cat.id, 'active')">
                  Aktifleştir
                </button>
                <button type="button" class="link danger" @click="removeRow(cat.id, cat.name)">
                  Sil
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="!store.categories.length && !store.loading" class="state-msg">Henüz kategori yok.</p>
    <p v-if="store.loading" class="state-msg">Yükleniyor…</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { EXPENSE_GROUPS, useExpenseStore, type ExpenseCategory } from '@/stores/expense';

defineProps<{ embedded?: boolean }>();

const store = useExpenseStore();
const groups = EXPENSE_GROUPS;
const creating = ref(false);
const savingId = ref<string | null>(null);

const form = ref({
  name: '',
  code: '',
  grup: null as string | null,
  is_favorite: false,
  description: '',
});

/** Satır taslakları — inputlar doğrudan store'u kirletmesin diye kopya üzerinde düzenlenir. */
const drafts = reactive<
  Record<string, { name: string; grup: string | null; description: string; is_favorite: boolean }>
>({});

const syncDrafts = (list: ExpenseCategory[]) => {
  for (const c of list) {
    drafts[c.id] = {
      name: c.name,
      grup: c.grup ?? null,
      description: c.description ?? '',
      is_favorite: !!c.is_favorite,
    };
  }
};

onMounted(async () => {
  await store.fetchCategories();
  syncDrafts(store.categories);
});
watch(
  () => store.categories,
  (list) => syncDrafts(list),
  { deep: true },
);

const grouped = computed(() => {
  const known = new Map(groups.map((g) => [g.key, { ...g, items: [] as ExpenseCategory[] }]));
  const ungrouped: ExpenseCategory[] = [];
  for (const c of store.categories) {
    const g = c.grup ? known.get(c.grup) : undefined;
    if (g) g.items.push(c);
    else ungrouped.push(c);
  }
  const out = [...known.values()].filter((g) => g.items.length > 0);
  if (ungrouped.length) out.push({ key: '', label: 'Grupsuz', hint: '', items: ungrouped });
  return out;
});

const createNew = async () => {
  creating.value = true;
  try {
    await store.createCategory({
      name: form.value.name.trim(),
      code: form.value.code.trim() || undefined,
      grup: form.value.grup,
      is_favorite: form.value.is_favorite,
      description: form.value.description.trim() || undefined,
    });
    form.value = { name: '', code: '', grup: null, is_favorite: false, description: '' };
  } catch {
    /* hata store'da */
  } finally {
    creating.value = false;
  }
};

const saveRow = async (id: string) => {
  savingId.value = id;
  try {
    await store.updateCategory(id, {
      name: drafts[id].name.trim(),
      grup: drafts[id].grup,
      description: drafts[id].description.trim() || undefined,
      is_favorite: drafts[id].is_favorite,
    });
  } catch {
    /* hata store'da */
  } finally {
    savingId.value = null;
  }
};

const setStatus = async (id: string, status: 'active' | 'inactive') => {
  savingId.value = id;
  try {
    await store.updateCategory(id, { status });
  } catch {
    /* hata store'da */
  } finally {
    savingId.value = null;
  }
};

const removeRow = async (id: string, name: string) => {
  if (!window.confirm(`"${name}" kategorisi silinsin mi? Kullanılan kategoriler silinemez.`))
    return;
  try {
    await store.deleteCategory(id);
  } catch {
    /* hata store'da (örn. kullanımda) */
  }
};

const groupIcon = (grup?: string | null): string => {
  const map: Record<string, string> = {
    kira: '🏢',
    'kamu-hizmetleri': '💡',
    isletme: '🔧',
    personel: '👥',
    mevzuat: '⚖️',
    finansal: '🧾',
  };
  return map[grup ?? ''] ?? '📁';
};
</script>

<style scoped>
.cat-settings {
  max-width: 90rem;
  margin-inline: auto;
  padding: 1.5rem;
  display: grid;
  gap: 1.25rem;
}
.page-sub {
  margin: 0.25rem 0 0;
  color: #64748b;
  font-size: 0.9375rem;
}
.new-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  align-items: end;
}
.new-grid label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 500;
}
.new-grid .full {
  grid-column: 1 / -1;
}
.new-grid .actions {
  display: flex;
  justify-content: flex-end;
}
.check {
  display: flex !important;
  align-items: center;
  gap: 0.375rem;
}
.group-card {
  padding: 1rem 1.25rem;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 0.75rem;
}
.group-icon {
  font-size: 1.375rem;
}
.group-title {
  margin: 0;
  font-size: 1rem;
}
.muted {
  color: #64748b;
}
.small {
  font-size: 0.8125rem;
  margin: 0;
}
tr.inactive td {
  opacity: 0.65;
}
.star {
  font-size: 1.125rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #cbd5e1;
  padding: 0 0.25rem;
}
.star.on {
  color: #d97706;
}
.group-foot {
  margin-top: 0.625rem;
  display: flex;
  justify-content: flex-end;
}
.move-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: #475569;
}
</style>

