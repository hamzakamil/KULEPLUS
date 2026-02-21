<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useJournalStore } from '../stores/journalStore';
import { useRouter } from 'vue-router';

const store = useJournalStore();
const router = useRouter();

const filters = ref({
  tarihBaslangic: '',
  tarihBitis: '',
  durum: '',
  fisTipi: '',
});

onMounted(() => {
  store.fetchEntries();
});

function applyFilter() {
  const params: Record<string, string> = {};
  if (filters.value.tarihBaslangic) params.tarihBaslangic = filters.value.tarihBaslangic;
  if (filters.value.tarihBitis) params.tarihBitis = filters.value.tarihBitis;
  if (filters.value.durum) params.durum = filters.value.durum;
  if (filters.value.fisTipi) params.fisTipi = filters.value.fisTipi;
  store.fetchEntries(params);
}

async function handleApprove(fisNo: string) {
  await store.approveEntry(fisNo);
}

async function handleCancel(fisNo: string) {
  await store.cancelEntry(fisNo);
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('tr-TR');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Yevmiye Fişleri</h1>
        <p class="text-sm text-gray-500">Çift taraflı kayıt esaslı yevmiye defterleri</p>
      </div>
      <router-link
        to="/yevmiye/yeni"
        class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
      >
        + Yeni Fiş
      </router-link>
    </div>

    <div v-if="store.error" class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
      {{ store.error }}
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-end">
      <div>
        <label class="block text-xs text-gray-500 mb-1">Başlangıç</label>
        <input v-model="filters.tarihBaslangic" type="date" class="border rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-1">Bitiş</label>
        <input v-model="filters.tarihBitis" type="date" class="border rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-1">Durum</label>
        <select v-model="filters.durum" class="border rounded-lg px-3 py-2 text-sm">
          <option value="">Tümü</option>
          <option value="taslak">Taslak</option>
          <option value="onaylandi">Onaylandı</option>
          <option value="iptal">İptal</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-1">Fiş Tipi</label>
        <select v-model="filters.fisTipi" class="border rounded-lg px-3 py-2 text-sm">
          <option value="">Tümü</option>
          <option value="mahsup">Mahsup</option>
          <option value="tahsil">Tahsil</option>
          <option value="tediye">Tediye</option>
        </select>
      </div>
      <button @click="applyFilter" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900 transition">
        Filtrele
      </button>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div v-if="store.loading" class="p-8 text-center text-gray-500">Yükleniyor...</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-gray-50 text-left">
          <tr>
            <th class="px-4 py-3 font-medium text-gray-600">Fiş No</th>
            <th class="px-4 py-3 font-medium text-gray-600">Tarih</th>
            <th class="px-4 py-3 font-medium text-gray-600">Açıklama</th>
            <th class="px-4 py-3 font-medium text-gray-600">Tip</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-right">Borç</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-right">Alacak</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Kaynak</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Durum</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.entries.length === 0">
            <td colspan="9" class="px-4 py-8 text-center text-gray-400">Kayıt bulunamadı</td>
          </tr>
          <tr
            v-for="entry in store.entries"
            :key="entry.fisNo"
            class="border-t hover:bg-gray-50 transition"
          >
            <td class="px-4 py-3 font-mono font-medium text-blue-600">{{ entry.fisNo }}</td>
            <td class="px-4 py-3">{{ formatDate(entry.tarih) }}</td>
            <td class="px-4 py-3 max-w-xs truncate">{{ entry.aciklama }}</td>
            <td class="px-4 py-3 capitalize">{{ entry.fisTipi }}</td>
            <td class="px-4 py-3 text-right font-mono">{{ formatCurrency(entry.toplamBorc) }}</td>
            <td class="px-4 py-3 text-right font-mono">{{ formatCurrency(entry.toplamAlacak) }}</td>
            <td class="px-4 py-3 text-center">
              <span v-if="entry.kaynakEntegrasyon" class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                {{ entry.kaynakEntegrasyon }}
              </span>
              <span v-else class="text-gray-400">-</span>
            </td>
            <td class="px-4 py-3 text-center">
              <span
                :class="[
                  'text-xs px-2 py-0.5 rounded-full',
                  entry.durum === 'onaylandi' ? 'bg-green-100 text-green-700' :
                  entry.durum === 'iptal' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700',
                ]"
              >
                {{ entry.durum }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-2">
              <button
                v-if="entry.durum === 'taslak'"
                @click="handleApprove(entry.fisNo)"
                class="text-green-600 hover:text-green-800 text-xs"
              >Onayla</button>
              <button
                v-if="entry.durum !== 'iptal'"
                @click="handleCancel(entry.fisNo)"
                class="text-red-500 hover:text-red-700 text-xs"
              >İptal</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
