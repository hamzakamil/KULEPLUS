<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { integrationApi } from '../services/api';
import type { IntegrationConfig, SyncResult } from '../types';

const supported = ref<{ id: string; ad: string }[]>([]);
const configured = ref<IntegrationConfig[]>([]);
const loading = ref(true);
const syncResult = ref<SyncResult | null>(null);
const syncing = ref<string | null>(null);
const showConfigForm = ref(false);

const configForm = ref({
  programAdi: '',
  programGorunenAd: '',
  apiUrl: '',
  apiKey: '',
  apiSecret: '',
  aktif: true,
});

const syncForm = ref({
  baslangic: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
  bitis: new Date().toISOString().split('T')[0],
});

onMounted(async () => {
  try {
    const [supportedRes, configuredRes] = await Promise.all([
      integrationApi.getSupported(),
      integrationApi.getConfigured(),
    ]);
    supported.value = supportedRes.data.data || [];
    configured.value = configuredRes.data.data || [];
  } catch {
    // API bağlantısı yoksa boş göster
  } finally {
    loading.value = false;
  }
});

async function saveConfig() {
  try {
    await integrationApi.upsertConfig(configForm.value.programAdi, configForm.value as any);
    const res = await integrationApi.getConfigured();
    configured.value = res.data.data || [];
    showConfigForm.value = false;
  } catch (e: any) {
    alert(e.response?.data?.error || 'Kayıt hatası');
  }
}

async function testConnection(programAdi: string) {
  try {
    const res = await integrationApi.testConnection(programAdi);
    alert(res.data.data?.connected ? 'Bağlantı başarılı!' : 'Bağlantı başarısız');
  } catch {
    alert('Bağlantı başarısız');
  }
}

async function startSync(programAdi: string) {
  syncing.value = programAdi;
  syncResult.value = null;
  try {
    const res = await integrationApi.sync(programAdi, syncForm.value.baslangic, syncForm.value.bitis);
    syncResult.value = res.data.data;
  } catch (e: any) {
    alert(e.response?.data?.error || 'Senkronizasyon hatası');
  } finally {
    syncing.value = null;
  }
}

function selectProgram(id: string, ad: string) {
  configForm.value.programAdi = id;
  configForm.value.programGorunenAd = ad;
  showConfigForm.value = true;
}
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Fatura Entegrasyonları</h1>
      <p class="text-sm text-gray-500">Fatura programlarını bağlayın, faturaları otomatik muhasebeleştirin</p>
    </div>

    <!-- Supported Programs -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">Desteklenen Programlar</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          v-for="prog in supported"
          :key="prog.id"
          @click="selectProgram(prog.id, prog.ad)"
          :class="[
            'p-4 border-2 rounded-lg text-center transition text-sm',
            configured.find(c => c.programAdi === prog.id)
              ? 'border-green-500 bg-green-50'
              : 'border-gray-200 hover:border-blue-400',
          ]"
        >
          <p class="font-medium">{{ prog.ad }}</p>
          <p v-if="configured.find(c => c.programAdi === prog.id)" class="text-xs text-green-600 mt-1">Konfigüre edildi</p>
        </button>
      </div>
    </div>

    <!-- Config Form -->
    <div v-if="showConfigForm" class="bg-white rounded-lg shadow p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">{{ configForm.programGorunenAd }} Konfigürasyonu</h3>
      <form @submit.prevent="saveConfig" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">API URL *</label>
          <input v-model="configForm.apiUrl" required placeholder="https://api.example.com" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <input v-model="configForm.apiKey" type="password" placeholder="API anahtarı" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">API Secret</label>
          <input v-model="configForm.apiSecret" type="password" placeholder="API secret" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div class="flex items-end gap-2">
          <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-700">Kaydet</button>
          <button type="button" @click="showConfigForm = false" class="px-4 py-2 border rounded-lg text-sm">İptal</button>
        </div>
      </form>
    </div>

    <!-- Configured Integrations -->
    <div v-if="configured.length > 0" class="bg-white rounded-lg shadow p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">Aktif Entegrasyonlar</h3>

      <!-- Sync Date Range -->
      <div class="flex gap-4 items-end mb-4 pb-4 border-b">
        <div>
          <label class="block text-xs text-gray-500 mb-1">Senkronizasyon Başlangıç</label>
          <input v-model="syncForm.baslangic" type="date" class="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Bitiş</label>
          <input v-model="syncForm.bitis" type="date" class="border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div class="space-y-3">
        <div
          v-for="config in configured"
          :key="config.programAdi"
          class="flex items-center justify-between p-4 border rounded-lg"
        >
          <div>
            <p class="font-medium">{{ config.programGorunenAd }}</p>
            <p class="text-xs text-gray-500">
              {{ config.apiUrl }}
              <span v-if="config.sonSenkronizasyon" class="ml-2">
                | Son sync: {{ new Date(config.sonSenkronizasyon).toLocaleString('tr-TR') }}
              </span>
            </p>
          </div>
          <div class="flex gap-2">
            <button
              @click="testConnection(config.programAdi)"
              class="px-3 py-1.5 border rounded text-xs hover:bg-gray-50"
            >Test</button>
            <button
              @click="startSync(config.programAdi)"
              :disabled="syncing === config.programAdi"
              :class="[
                'px-3 py-1.5 rounded text-xs text-white',
                syncing === config.programAdi ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700',
              ]"
            >
              {{ syncing === config.programAdi ? 'Senkronize ediliyor...' : 'Senkronize Et' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync Result -->
    <div v-if="syncResult" class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold mb-4">Senkronizasyon Sonucu</h3>
      <div class="grid grid-cols-3 gap-4 text-center mb-4">
        <div class="bg-green-50 p-4 rounded-lg">
          <p class="text-2xl font-bold text-green-600">{{ syncResult.basarili }}</p>
          <p class="text-sm text-gray-500">Başarılı</p>
        </div>
        <div class="bg-red-50 p-4 rounded-lg">
          <p class="text-2xl font-bold text-red-600">{{ syncResult.basarisiz }}</p>
          <p class="text-sm text-gray-500">Başarısız</p>
        </div>
        <div class="bg-blue-50 p-4 rounded-lg">
          <p class="text-2xl font-bold text-blue-600">{{ syncResult.basarili + syncResult.basarisiz }}</p>
          <p class="text-sm text-gray-500">Toplam</p>
        </div>
      </div>
      <div v-if="syncResult.hatalar.length > 0" class="mt-4">
        <h4 class="text-sm font-medium text-red-600 mb-2">Hatalar:</h4>
        <div v-for="h in syncResult.hatalar" :key="h.faturaNo" class="text-sm text-red-500 py-1">
          {{ h.faturaNo }}: {{ h.hata }}
        </div>
      </div>
    </div>
  </div>
</template>
