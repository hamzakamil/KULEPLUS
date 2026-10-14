<template>
  <div class="management-view">
    <header v-if="!embedded" class="page-header">
      <div>
        <h1 class="page-title">Kural Ayarları</h1>
        <p class="page-sub">
          Patron paneli trafik ışığı eşikleri. Kuralları açıp kapatabilir, parametreleri işletmenize
          göre ayarlayabilirsiniz.
        </p>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <p v-else-if="loading && !rules.length" class="state-msg">Yükleniyor…</p>

    <p v-else-if="!rules.length" class="state-msg">Kural bulunamadı.</p>

    <ul v-else class="rule-list">
      <li
        v-for="rule in rules"
        :key="rule.key"
        class="rule-card"
        :class="{ disabled: !draftOf(rule).enabled }"
      >
        <div class="rule-head">
          <div class="rule-info">
            <div class="rule-title-row">
              <span class="rule-title">{{ rule.label }}</span>
              <span
                class="badge"
                :class="draftOf(rule).enabled ? 'badge-success' : 'badge-neutral'"
              >
                {{ draftOf(rule).enabled ? 'Açık' : 'Kapalı' }}
              </span>
              <span class="badge badge-info">{{ rule.key }}</span>
            </div>
            <p class="muted small">{{ rule.description }}</p>
            <RouterLink class="rule-link small" :to="rule.link">{{ rule.link }}</RouterLink>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="draftOf(rule).enabled"
              @change="toggle(rule, $event)"
            />
            <span class="switch-label">Etkin</span>
          </label>
        </div>

        <div class="rule-params">
          <div v-for="spec in rule.paramSpec" :key="spec.key" class="field">
            <label class="field-label" :for="`${rule.key}-${spec.key}`">{{ spec.label }}</label>
            <input
              :id="`${rule.key}-${spec.key}`"
              class="input"
              type="number"
              :min="spec.min"
              :max="spec.max"
              step="1"
              :value="draftOf(rule).params[spec.key]"
              @input="setParam(rule, spec.key, $event)"
            />
            <span class="muted small">Varsayılan: {{ spec.default }}</span>
          </div>
        </div>

        <div class="rule-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="!isDirty(rule) || savingKey === rule.key"
            @click="reset(rule)"
          >
            Geri al
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="savingKey === rule.key"
            @click="restoreDefaults(rule)"
          >
            Varsayılana dön
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!isDirty(rule) || savingKey === rule.key"
            @click="save(rule)"
          >
            {{ savingKey === rule.key ? 'Kaydediliyor…' : 'Kaydet' }}
          </button>
          <span v-if="savedKey === rule.key" class="saved-msg small">Kaydedildi ✓</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useManagementStore, type RuleSetting } from '@/stores/management';

defineProps<{ embedded?: boolean }>();

const store = useManagementStore();
const rules = computed(() => store.rules);
const loading = computed(() => store.rulesLoading);

interface Draft {
  enabled: boolean;
  params: Record<string, number>;
}

const drafts = ref<Record<string, Draft>>({});
const savingKey = ref<string | null>(null);
const savedKey = ref<string | null>(null);

onMounted(async () => {
  await store.fetchRules();
  syncDrafts();
});

function syncDrafts(): void {
  const next: Record<string, Draft> = {};
  for (const rule of store.rules) {
    next[rule.key] = { enabled: rule.enabled, params: { ...rule.params } };
  }
  drafts.value = next;
}

function draftOf(rule: RuleSetting): Draft {
  return drafts.value[rule.key] ?? { enabled: rule.enabled, params: { ...rule.params } };
}

function isDirty(rule: RuleSetting): boolean {
  const draft = drafts.value[rule.key];
  if (!draft) return false;
  if (draft.enabled !== rule.enabled) return true;
  return rule.paramSpec.some((spec) => draft.params[spec.key] !== rule.params[spec.key]);
}

function toggle(rule: RuleSetting, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  drafts.value[rule.key] = { ...draftOf(rule), enabled: checked };
}

function setParam(rule: RuleSetting, key: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  const draft = draftOf(rule);
  drafts.value[rule.key] = {
    ...draft,
    params: { ...draft.params, [key]: Number.isFinite(raw) ? raw : draft.params[key] },
  };
}

function reset(rule: RuleSetting): void {
  drafts.value[rule.key] = { enabled: rule.enabled, params: { ...rule.params } };
}

function restoreDefaults(rule: RuleSetting): void {
  drafts.value[rule.key] = { enabled: true, params: { ...rule.defaults } };
}

async function save(rule: RuleSetting): Promise<void> {
  const draft = drafts.value[rule.key];
  if (!draft) return;
  savingKey.value = rule.key;
  try {
    const updated = await store.updateRule(rule.key, {
      enabled: draft.enabled,
      params: draft.params,
    });
    drafts.value[rule.key] = { enabled: updated.enabled, params: { ...updated.params } };
    savedKey.value = rule.key;
    window.setTimeout(() => {
      if (savedKey.value === rule.key) savedKey.value = null;
    }, 2000);
  } catch {
    /* hata store'da tutulur */
  } finally {
    savingKey.value = null;
  }
}
</script>

<style scoped>
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rule-card {
  padding: 1rem 1.25rem;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  background: var(--c-surface);
}
.rule-card.disabled {
  opacity: 0.7;
}
.rule-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.rule-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.rule-title {
  font-weight: 600;
}
.rule-info {
  min-width: 0;
}
.rule-link {
  color: var(--c-primary);
  text-decoration: none;
}
.rule-params {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 1rem 0;
}
.rule-params .field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.rule-params .input {
  width: 8rem;
}
.rule-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.saved-msg {
  color: var(--c-success, #16a34a);
}
.switch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}
.switch-label {
  font-size: 0.875rem;
}
</style>

