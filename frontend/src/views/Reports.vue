<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const reports = [
  {
    title: 'Mizan',
    description: 'Tüm hesapların borç-alacak toplamları ve bakiyeleri',
    path: '/raporlar/mizan',
    icon: '&#9776;',
    color: 'bg-blue-500',
  },
  {
    title: 'Bilanço',
    description: 'Aktif-Pasif taraf, düzenleyici hesaplarla netleştirme',
    path: '/raporlar/mizan',
    icon: '&#9878;',
    color: 'bg-green-500',
  },
  {
    title: 'Gelir Tablosu',
    description: '6. ve 7. sınıf hesaplar, dönem kar/zarar',
    path: '/raporlar/mizan',
    icon: '&#9733;',
    color: 'bg-purple-500',
  },
  {
    title: 'Hesap Ekstresi',
    description: 'Belirli bir hesabın tüm hareketleri ve kalan bakiyesi',
    path: '/raporlar/mizan',
    icon: '&#9998;',
    color: 'bg-orange-500',
  },
];
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Raporlar</h1>
      <p class="text-sm text-gray-500">TDHP uyumlu muhasebe raporları</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div
        v-for="report in reports"
        :key="report.title"
        @click="router.push(report.path)"
        class="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition group"
      >
        <div :class="[report.color, 'w-12 h-12 rounded-lg flex items-center justify-center text-white text-xl mb-4']">
          <span v-html="report.icon" />
        </div>
        <h3 class="text-lg font-semibold mb-2 group-hover:text-blue-600 transition">{{ report.title }}</h3>
        <p class="text-sm text-gray-500">{{ report.description }}</p>
      </div>
    </div>
  </div>
</template>
