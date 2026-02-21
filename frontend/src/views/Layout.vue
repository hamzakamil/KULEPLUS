<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const sidebarOpen = ref(true);

const menuItems = [
  { path: '/', label: 'Dashboard', icon: '&#9632;' },
  { path: '/hesaplar', label: 'Hesap Plan\u0131', icon: '&#9776;' },
  { path: '/yevmiye', label: 'Yevmiye Fi\u015fleri', icon: '&#9997;' },
  { path: '/raporlar', label: 'Raporlar', icon: '&#9733;' },
  { path: '/entegrasyonlar', label: 'Entegrasyonlar', icon: '&#8644;' },
];
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex">
    <!-- Sidebar -->
    <aside
      :class="[sidebarOpen ? 'w-64' : 'w-16', 'bg-gray-900 text-white transition-all duration-300 flex flex-col']"
    >
      <div class="p-4 border-b border-gray-700 flex items-center justify-between">
        <h1 v-if="sidebarOpen" class="text-lg font-bold tracking-tight">
          TDHP Muhasebe
        </h1>
        <button @click="sidebarOpen = !sidebarOpen" class="text-gray-400 hover:text-white">
          <span v-html="sidebarOpen ? '&#10094;' : '&#10095;'" />
        </button>
      </div>

      <nav class="flex-1 py-4">
        <router-link
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :class="[
            'flex items-center px-4 py-3 text-sm transition-colors',
            route.path === item.path || (item.path !== '/' && route.path.startsWith(item.path))
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-800 hover:text-white',
          ]"
        >
          <span v-html="item.icon" class="text-lg w-8 text-center" />
          <span v-if="sidebarOpen" class="ml-2">{{ item.label }}</span>
        </router-link>
      </nav>

      <div v-if="sidebarOpen" class="p-4 border-t border-gray-700 text-xs text-gray-500">
        TDHP-Muhasebe-Core v0.1.0
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col">
      <!-- Top Bar -->
      <header class="bg-white shadow-sm border-b px-6 py-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-800">
          {{ route.meta.title || 'TDHP Muhasebe' }}
        </h2>
        <div class="flex items-center gap-4 text-sm text-gray-500">
          <span>{{ new Date().toLocaleDateString('tr-TR') }}</span>
        </div>
      </header>

      <!-- Page Content -->
      <div class="flex-1 p-6 overflow-auto">
        <router-view />
      </div>
    </main>
  </div>
</template>
