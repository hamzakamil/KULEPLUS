<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useJournalStore } from '../stores/journalStore';
import { useAccountStore } from '../stores/accountStore';
import type { EntryLine } from '../types';

const router = useRouter();
const journalStore = useJournalStore();
const accountStore = useAccountStore();

const form = ref({
  tarih: new Date().toISOString().split('T')[0],
  aciklama: '',
  fisTipi: 'mahsup' as string,
});

const lines = ref<(EntryLine & { searchQuery?: string })[]>([
  { hesapKodu: '', tutar: 0, yon: 1, aciklama: '' },
  { hesapKodu: '', tutar: 0, yon: -1, aciklama: '' },
]);

const searchResults = ref<Record<number, any[]>>({});

const toplamBorc = computed(() =>
  lines.value.filter((l) => l.yon === 1).reduce((s, l) => s + (l.tutar || 0), 0)
);
const toplamAlacak = computed(() =>
  lines.value.filter((l) => l.yon === -1).reduce((s, l) => s + (l.tutar || 0), 0)
);
const fark = computed(() => Math.abs(toplamBorc.value - toplamAlacak.value));
const dengeli = computed(() => fark.value < 0.01);

const error = ref<string | null>(null);
const saving = ref(false);

function addLine(yon: number) {
  lines.value.push({ hesapKodu: '', tutar: 0, yon, aciklama: '' });
}

function removeLine(index: number) {
  if (lines.value.length > 2) {
    lines.value.splice(index, 1);
  }
}

async function searchAccount(index: number, query: string) {
  if (query.length < 2) {
    searchResults.value[index] = [];
    return;
  }
  searchResults.value[index] = await accountStore.searchAccounts(query);
}

function selectAccount(index: number, acc: any) {
  lines.value[index].hesapKodu = acc.hesapKodu;
  lines.value[index].hesapAdi = acc.hesapAdi;
  searchResults.value[index] = [];
}

async function handleSubmit() {
  error.value = null;

  if (!form.value.aciklama.trim()) {
    error.value = 'Açıklama zorunludur';
    return;
  }

  if (!dengeli.value) {
    error.value = `Borç-Alacak dengesi tutmuyor! Fark: ${fark.value.toFixed(2)} TL`;
    return;
  }

  const invalidLines = lines.value.filter((l) => !l.hesapKodu || l.tutar <= 0);
  if (invalidLines.length > 0) {
    error.value = 'Tüm satırlarda geçerli hesap kodu ve pozitif tutar olmalıdır';
    return;
  }

  saving.value = true;
  try {
    await journalStore.createEntry({
      tarih: form.value.tarih,
      aciklama: form.value.aciklama,
      fisTipi: form.value.fisTipi,
      hareketler: lines.value.map((l) => ({
        hesapKodu: l.hesapKodu,
        tutar: l.tutar,
        yon: l.yon,
        aciklama: l.aciklama || undefined,
      })),
    });
    router.push('/yevmiye');
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Fiş oluşturulamadı';
  } finally {
    saving.value = false;
  }
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(val);
}
</script>

<template>
  <div class="max-w-5xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Yeni Yevmiye Fişi</h1>
      <p class="text-sm text-gray-500">Borç = Alacak denklik kontrolü otomatik yapılır</p>
    </div>

    <div v-if="error" class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
      {{ error }}
    </div>

    <form @submit.prevent="handleSubmit">
      <!-- Header -->
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tarih *</label>
            <input v-model="form.tarih" type="date" required class="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Fiş Tipi</label>
            <select v-model="form.fisTipi" class="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="mahsup">Mahsup</option>
              <option value="tahsil">Tahsil</option>
              <option value="tediye">Tediye</option>
              <option value="acilis">Açılış</option>
              <option value="kapanis">Kapanış</option>
              <option value="diger">Diğer</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Açıklama *</label>
            <input v-model="form.aciklama" required placeholder="Fiş açıklaması" class="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <!-- Lines -->
      <div class="bg-white rounded-lg shadow overflow-hidden mb-6">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-3 text-left font-medium text-gray-600 w-12">#</th>
              <th class="px-3 py-3 text-left font-medium text-gray-600">Hesap Kodu</th>
              <th class="px-3 py-3 text-left font-medium text-gray-600">Hesap Adı</th>
              <th class="px-3 py-3 text-center font-medium text-gray-600 w-24">B/A</th>
              <th class="px-3 py-3 text-right font-medium text-gray-600 w-36">Tutar</th>
              <th class="px-3 py-3 text-left font-medium text-gray-600">Açıklama</th>
              <th class="px-3 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, idx) in lines" :key="idx" class="border-t">
              <td class="px-3 py-2 text-gray-400">{{ idx + 1 }}</td>
              <td class="px-3 py-2 relative">
                <input
                  v-model="line.hesapKodu"
                  @input="searchAccount(idx, line.hesapKodu)"
                  placeholder="Hesap kodu"
                  class="w-full border rounded px-2 py-1.5 text-sm font-mono"
                />
                <div
                  v-if="searchResults[idx]?.length"
                  class="absolute z-10 bg-white shadow-lg border rounded mt-1 w-64 max-h-48 overflow-y-auto"
                >
                  <div
                    v-for="acc in searchResults[idx]"
                    :key="acc.hesapKodu"
                    @click="selectAccount(idx, acc)"
                    class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  >
                    <span class="font-mono font-medium">{{ acc.hesapKodu }}</span>
                    <span class="text-gray-500 ml-2">{{ acc.hesapAdi }}</span>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2 text-gray-500">{{ line.hesapAdi || '' }}</td>
              <td class="px-3 py-2 text-center">
                <select v-model="line.yon" class="border rounded px-2 py-1.5 text-sm">
                  <option :value="1">Borç</option>
                  <option :value="-1">Alacak</option>
                </select>
              </td>
              <td class="px-3 py-2">
                <input
                  v-model.number="line.tutar"
                  type="number"
                  step="0.01"
                  min="0"
                  class="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                />
              </td>
              <td class="px-3 py-2">
                <input v-model="line.aciklama" placeholder="Satır açıklaması" class="w-full border rounded px-2 py-1.5 text-sm" />
              </td>
              <td class="px-3 py-2">
                <button v-if="lines.length > 2" @click="removeLine(idx)" type="button" class="text-red-400 hover:text-red-600">
                  X
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="p-3 bg-gray-50 flex gap-2">
          <button @click="addLine(1)" type="button" class="text-blue-600 text-sm hover:underline">+ Borç Satırı</button>
          <button @click="addLine(-1)" type="button" class="text-green-600 text-sm hover:underline">+ Alacak Satırı</button>
        </div>
      </div>

      <!-- Summary -->
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <div class="grid grid-cols-3 gap-4 text-center">
          <div>
            <p class="text-sm text-gray-500">Borç Toplamı</p>
            <p class="text-2xl font-bold text-blue-600">{{ formatCurrency(toplamBorc) }}</p>
          </div>
          <div>
            <p class="text-sm text-gray-500">Alacak Toplamı</p>
            <p class="text-2xl font-bold text-green-600">{{ formatCurrency(toplamAlacak) }}</p>
          </div>
          <div>
            <p class="text-sm text-gray-500">Fark</p>
            <p :class="['text-2xl font-bold', dengeli ? 'text-green-600' : 'text-red-600']">
              {{ formatCurrency(fark) }}
              <span v-if="dengeli" class="text-sm"> (Dengeli)</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Submit -->
      <div class="flex justify-end gap-3">
        <router-link to="/yevmiye" class="px-6 py-2 border rounded-lg text-sm hover:bg-gray-50 transition">
          İptal
        </router-link>
        <button
          type="submit"
          :disabled="saving || !dengeli"
          :class="[
            'px-6 py-2 rounded-lg text-sm text-white transition',
            saving || !dengeli ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700',
          ]"
        >
          {{ saving ? 'Kaydediliyor...' : 'Kaydet' }}
        </button>
      </div>
    </form>
  </div>
</template>
