<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Entegrasyonlar</h1>
        <p class="page-sub">Dış sistem ve webhook (Faz 8) entegrasyonlarının yönetimi.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openCreate = true">+ Yeni entegrasyon</button>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>
    <p v-else-if="store.loading && !store.integrations.length" class="state-msg">Yükleniyor…</p>
    <p v-else-if="!store.integrations.length" class="state-msg">Kayıtlı entegrasyon yok.</p>

    <div v-else class="grid cards-grid">
      <article v-for="it in store.integrations" :key="it.id" class="card">
        <header class="card-head">
          <div>
            <strong>{{ it.display_name }}</strong>
            <span class="muted small" style="margin-left: 8px">{{ it.provider }}</span>
          </div>
          <span class="badge" :class="it.is_active ? 'badge-success' : 'badge-neutral'">
            {{ it.is_active ? 'Aktif' : 'Pasif' }}
          </span>
        </header>
        <p class="muted small">{{ it.id }}</p>
        <footer class="card-foot">
          <button class="btn btn-secondary btn-sm" @click="viewEvents(it.id)">
            Webhook olayları
          </button>
          <button
            v-if="it.is_active"
            class="btn btn-secondary btn-sm"
            @click="store.deactivateIntegration(it.id)"
          >
            Pasife al
          </button>
        </footer>
      </article>
    </div>

    <!-- create modal -->
    <div v-if="openCreate" class="modal-backdrop">
      <form class="modal card" @submit.prevent="create">
        <h2 class="page-title" style="font-size: 1.1rem">Yeni entegrasyon</h2>
        <label class="field">
          <span class="field-label">Sağlayıcı</span>
          <input class="input" v-model="draft.provider" required placeholder="manual, stripe, …" />
        </label>
        <label class="field">
          <span class="field-label">Görünen ad</span>
          <input class="input" v-model="draft.displayName" required />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" @click="openCreate = false">İptal</button>
          <button type="submit" class="btn btn-primary" :disabled="creating">
            {{ creating ? 'Kaydediliyor…' : 'Kaydet' }}
          </button>
        </div>
      </form>
    </div>

    <!-- events drawer -->
    <aside v-if="openEventsId" class="events-aside">
      <header class="aside-head">
        <h3>Olaylar</h3>
        <button class="btn btn-secondary btn-sm" @click="openEventsId = null">Kapat</button>
      </header>
      <p v-if="!store.events.length" class="muted small">Olay yok.</p>
      <ul class="event-list">
        <li v-for="e in store.events" :key="e.id" class="event-item">
          <div class="event-head">
            <span class="badge badge-info">{{ e.event_type }}</span>
            <span class="muted small">{{ e.processed_at ? 'İşlendi' : 'Bekliyor' }}</span>
          </div>
          <code class="small">{{ e.external_event_id }}</code>
        </li>
      </ul>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useIntegrationsStore, type Integration } from '@/stores/integrations';

const store = useIntegrationsStore();
const openCreate = ref(false);
const creating = ref(false);
const openEventsId = ref<string | null>(null);
const draft = reactive({ provider: '', displayName: '' });

onMounted(() => void store.fetchIntegrations());

async function create() {
  creating.value = true;
  const res = await store.createIntegration(draft.provider.trim(), draft.displayName.trim());
  creating.value = false;
  if (res) {
    openCreate.value = false;
    draft.provider = '';
    draft.displayName = '';
  }
}

async function viewEvents(id: string) {
  openEventsId.value = id;
  await store.fetchEvents(id);
}
</script>
