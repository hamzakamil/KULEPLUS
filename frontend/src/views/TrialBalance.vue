<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { reportApi } from '../services/api';
import type { MizanRapor } from '../types';

const mizan = ref<MizanRapor | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const filters = ref({
  tarihBaslangic: '',
  tarihBitis: new Date().toISOString().split('T')[0],
  sinif: '',
});

async function fetchMizan() {
  loading.value = true;
  error.value = null;
  try {
    const params: Record<string, string> = {};
    if (filters.value.tarihBaslangic) params.tarihBaslangic = filters.value.tarihBaslangic;
    if (filters.value.tarihBitis) params.tarihBitis = filters.value.tarihBitis;
    if (filters.value.sinif) params.sinif = filters.value.sinif;
    const res = await reportApi.getMizan(params);
    mizan.value = res.data.data;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Mizan yüklenemedi';
  } finally {
    loading.value = false;
  }
}

onMounted(fetchMizan);

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Mizan Raporu</h1>
        <p class="text-sm text-gray-500">Tüm hesapların borç-alacak toplamları ve bakiyeleri</p>
      </div>
    </div>

    <div v-if="error" class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{{ error }}</div>

    <!-- Filters -->
    <div class="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-end">
      <div>
        <label class="block text-xs text-gray-500 mb-1">Başlangıç Tarihi</label>
        <input v-model="filters.tarihBaslangic" type="date" class="border rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-1">Bitiş Tarihi</label>
        <input v-model="filters.tarihBitis" type="date" class="border rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-1">Hesap Sınıfı</label>
        <select v-model="filters.sinif" class="border rounded-lg px-3 py-2 text-sm">
          <option value="">Tümü</option>
          <option v-for="i in 7" :key="i" :value="i">{{ i }}. Sınıf</option>
        </select>
      </div>
      <button @click="fetchMizan" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900">
        Rapor Oluştur
      </button>
    </div>

    <!-- Mizan Table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-gray-500">Yükleniyor...</div>
      <template v-else-if="mizan">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Hesap Kodu</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Hesap Adı</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600">Borç Toplamı</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600">Alacak Toplamı</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600">Borç Bakiye</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600">Alacak Bakiye</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="mizan.satirlar.length === 0">
              <td colspan="6" class="px-4 py-8 text-center text-gray-400">Veri bulunamadı</td>
            </tr>
            <tr
              v-for="satir in mizan.satirlar"
              :key="satir.hesapKodu"
              class="border-t hover:bg-gray-50"
            >
              <td class="px-4 py-2 font-mono font-medium">{{ satir.hesapKodu }}</td>
              <td class="px-4 py-2">{{ satir.hesapAdi }}</td>
              <td class="px-4 py-2 text-right font-mono">{{ formatCurrency(satir.borcToplam) }}</td>
              <td class="px-4 py-2 text-right font-mono">{{ formatCurrency(satir.alacakToplam) }}</td>
              <td class="px-4 py-2 text-right font-mono text-blue-600">
                {{ satir.borcBakiye > 0 ? formatCurrency(satir.borcBakiye) : '' }}
              </td>
              <td class="px-4 py-2 text-right font-mono text-green-600">
                {{ satir.alacakBakiye > 0 ? formatCurrency(satir.alacakBakiye) : '' }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-100 font-bold border-t-2">
            <tr>
              <td colspan="2" class="px-4 py-3">TOPLAM</td>
              <td class="px-4 py-3 text-right font-mono">{{ formatCurrency(mizan.genelBorcToplam) }}</td>
              <td class="px-4 py-3 text-right font-mono">{{ formatCurrency(mizan.genelAlacakToplam) }}</td>
              <td class="px-4 py-3 text-right font-mono text-blue-600">{{ formatCurrency(mizan.genelBorcBakiye) }}</td>
              <td class="px-4 py-3 text-right font-mono text-green-600">{{ formatCurrency(mizan.genelAlacakBakiye) }}</td>
            </tr>
            <tr>
              <td colspan="6" class="px-4 py-2 text-center">
                <span
                  :class="[
                    'text-sm px-3 py-1 rounded-full',
                    mizan.denklikDurumu ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  ]"
                >
                  {{ mizan.denklikDurumu ? 'Mizan dengeli' : 'UYARI: Mizan dengeli degil!' }}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </template>
    </div>
  </div>
</template>
