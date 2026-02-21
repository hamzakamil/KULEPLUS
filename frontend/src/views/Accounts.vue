<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAccountStore } from '../stores/accountStore';
import type { Account } from '../types';

const store = useAccountStore();
const searchQuery = ref('');
const selectedSinif = ref<number | null>(null);
const showForm = ref(false);

const formData = ref({
  hesapKodu: '',
  hesapAdi: '',
  normalBakiye: 1,
  dovizKodu: 'TRY',
  onMuhasebeBaglantiKodu: '',
  ozelKod: '',
  duzenleyiciHesapMi: false,
});

onMounted(() => {
  store.fetchAccounts();
});

const filteredAccounts = computed(() => {
  let list = store.accounts;
  if (selectedSinif.value) {
    list = list.filter((a) => a.hesapSinifi === selectedSinif.value);
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(
      (a) =>
        a.hesapKodu.includes(q) ||
        a.hesapAdi.toLowerCase().includes(q) ||
        (a.ozelKod && a.ozelKod.toLowerCase().includes(q))
    );
  }
  return list;
});

const siniflar = [
  { val: 1, label: '1 - Dönen Varlıklar' },
  { val: 2, label: '2 - Duran Varlıklar' },
  { val: 3, label: '3 - Kısa Vadeli Y.K.' },
  { val: 4, label: '4 - Uzun Vadeli Y.K.' },
  { val: 5, label: '5 - Öz Kaynaklar' },
  { val: 6, label: '6 - Gelir Tablosu' },
  { val: 7, label: '7 - Maliyet' },
];

async function handleSubmit() {
  try {
    await store.createAccount(formData.value as any);
    showForm.value = false;
    formData.value = { hesapKodu: '', hesapAdi: '', normalBakiye: 1, dovizKodu: 'TRY', onMuhasebeBaglantiKodu: '', ozelKod: '', duzenleyiciHesapMi: false };
  } catch {
    // Store zaten error set ediyor
  }
}

async function handleDelete(kod: string) {
  if (confirm(`${kod} hesabını silmek istediğinize emin misiniz?`)) {
    await store.deleteAccount(kod);
  }
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Hesap Planı</h1>
        <p class="text-sm text-gray-500">TDHP uyumlu hesap planı yönetimi</p>
      </div>
      <button
        @click="showForm = !showForm"
        class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
      >
        {{ showForm ? 'Kapat' : '+ Yeni Hesap' }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="store.error" class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
      {{ store.error }}
    </div>

    <!-- Add Form -->
    <div v-if="showForm" class="bg-white rounded-lg shadow p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">Yeni Hesap Oluştur</h3>
      <form @submit.prevent="handleSubmit" class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Hesap Kodu *</label>
          <input v-model="formData.hesapKodu" required placeholder="100" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Hesap Adı *</label>
          <input v-model="formData.hesapAdi" required placeholder="Kasa" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Döviz Kodu</label>
          <select v-model="formData.dovizKodu" class="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="TRY">TRY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Bağlantı Kodu</label>
          <input v-model="formData.onMuhasebeBaglantiKodu" placeholder="Ön muhasebe kodu" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Özel Kod</label>
          <input v-model="formData.ozelKod" placeholder="Kullanıcı tanımlı" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div class="flex items-end">
          <button type="submit" class="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition text-sm w-full">
            Kaydet
          </button>
        </div>
      </form>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-center">
      <input
        v-model="searchQuery"
        placeholder="Hesap kodu veya adı ara..."
        class="border rounded-lg px-3 py-2 text-sm flex-1 min-w-48"
      />
      <select
        v-model="selectedSinif"
        class="border rounded-lg px-3 py-2 text-sm"
      >
        <option :value="null">Tüm Sınıflar</option>
        <option v-for="s in siniflar" :key="s.val" :value="s.val">{{ s.label }}</option>
      </select>
      <span class="text-sm text-gray-500">
        {{ filteredAccounts.length }} hesap
      </span>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div v-if="store.loading" class="p-8 text-center text-gray-500">Yükleniyor...</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-gray-50 text-left">
          <tr>
            <th class="px-4 py-3 font-medium text-gray-600">Hesap Kodu</th>
            <th class="px-4 py-3 font-medium text-gray-600">Hesap Adı</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Sınıf</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Normal Bakiye</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Döviz</th>
            <th class="px-4 py-3 font-medium text-gray-600">Özel Kod</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-center">Durum</th>
            <th class="px-4 py-3 font-medium text-gray-600 text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="acc in filteredAccounts"
            :key="acc.hesapKodu"
            class="border-t hover:bg-gray-50 transition"
          >
            <td class="px-4 py-3 font-mono font-medium">{{ acc.hesapKodu }}</td>
            <td class="px-4 py-3">
              {{ acc.hesapAdi }}
              <span v-if="acc.duzenleyiciHesapMi" class="text-xs text-orange-500 ml-1">(D)</span>
            </td>
            <td class="px-4 py-3 text-center">{{ acc.hesapSinifi }}</td>
            <td class="px-4 py-3 text-center">
              <span :class="acc.normalBakiye === 1 ? 'text-blue-600' : 'text-green-600'">
                {{ acc.normalBakiye === 1 ? 'Borç' : 'Alacak' }}
              </span>
            </td>
            <td class="px-4 py-3 text-center">{{ acc.dovizKodu }}</td>
            <td class="px-4 py-3 text-gray-500">{{ acc.ozelKod || '-' }}</td>
            <td class="px-4 py-3 text-center">
              <span
                :class="[
                  'text-xs px-2 py-0.5 rounded-full',
                  acc.aktif ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                ]"
              >
                {{ acc.aktif ? 'Aktif' : 'Pasif' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                @click="handleDelete(acc.hesapKodu)"
                class="text-red-500 hover:text-red-700 text-xs"
              >
                Sil
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
