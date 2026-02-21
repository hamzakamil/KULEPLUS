<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { reportApi, accountApi, journalApi } from '../services/api';

const stats = ref({
  hesapSayisi: 0,
  fisSayisi: 0,
  borcToplam: 0,
  alacakToplam: 0,
});
const recentEntries = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [accountsRes, entriesRes, mizanRes] = await Promise.all([
      accountApi.getAll({ aktif: 'true' }),
      journalApi.getAll({ limit: '5' }),
      reportApi.getMizan(),
    ]);

    stats.value.hesapSayisi = accountsRes.data.data?.length || 0;
    recentEntries.value = entriesRes.data.data || [];
    stats.value.fisSayisi = recentEntries.value.length;

    if (mizanRes.data.data) {
      stats.value.borcToplam = mizanRes.data.data.genelBorcToplam || 0;
      stats.value.alacakToplam = mizanRes.data.data.genelAlacakToplam || 0;
    }
  } catch (e) {
    // API henüz bağlı değilse varsayılan değerler göster
  } finally {
    loading.value = false;
  }
});

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);
}
</script>

<template>
  <div>
    <!-- Stat Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-sm text-gray-500 mb-1">Aktif Hesap</p>
        <p class="text-3xl font-bold text-gray-900">{{ stats.hesapSayisi }}</p>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-sm text-gray-500 mb-1">Yevmiye Fişi</p>
        <p class="text-3xl font-bold text-gray-900">{{ stats.fisSayisi }}</p>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-sm text-gray-500 mb-1">Toplam Borç</p>
        <p class="text-3xl font-bold text-blue-600">{{ formatCurrency(stats.borcToplam) }}</p>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-sm text-gray-500 mb-1">Toplam Alacak</p>
        <p class="text-3xl font-bold text-green-600">{{ formatCurrency(stats.alacakToplam) }}</p>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Hızlı İşlemler</h3>
        <div class="grid grid-cols-2 gap-3">
          <router-link
            to="/yevmiye/yeni"
            class="bg-blue-600 text-white px-4 py-3 rounded-lg text-center hover:bg-blue-700 transition"
          >
            Yeni Fiş
          </router-link>
          <router-link
            to="/hesaplar"
            class="bg-gray-100 text-gray-800 px-4 py-3 rounded-lg text-center hover:bg-gray-200 transition"
          >
            Hesap Planı
          </router-link>
          <router-link
            to="/raporlar/mizan"
            class="bg-gray-100 text-gray-800 px-4 py-3 rounded-lg text-center hover:bg-gray-200 transition"
          >
            Mizan
          </router-link>
          <router-link
            to="/entegrasyonlar"
            class="bg-gray-100 text-gray-800 px-4 py-3 rounded-lg text-center hover:bg-gray-200 transition"
          >
            Entegrasyonlar
          </router-link>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Son Yevmiye Fişleri</h3>
        <div v-if="loading" class="text-gray-500 text-sm">Yükleniyor...</div>
        <div v-else-if="recentEntries.length === 0" class="text-gray-400 text-sm">
          Henüz fiş kaydı yok.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="entry in recentEntries"
            :key="entry.fisNo"
            class="flex items-center justify-between py-2 border-b last:border-0"
          >
            <div>
              <p class="text-sm font-medium">{{ entry.fisNo }}</p>
              <p class="text-xs text-gray-500">{{ entry.aciklama }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm font-medium">{{ formatCurrency(entry.toplamBorc) }}</p>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
