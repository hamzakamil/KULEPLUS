<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Bildirimler</h1>
        <p class="page-sub">Görev, randevu ve sistem olaylarından gelen bildirim akışı.</p>
      </div>
      <div class="page-actions">
        <button
          type="button"
          class="btn btn-secondary"
          :class="{ 'is-active': filters.unread_only }"
          @click="toggleUnread"
        >
          Sadece okunmamış
        </button>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <p v-else-if="!notifications.length && !loading" class="state-msg">Henüz bildirim yok.</p>

    <ul v-else class="notification-list">
      <li
        v-for="n in notifications"
        :key="n.id"
        class="notification-item"
        :class="{ unread: !n.readAt }"
      >
        <div class="notification-main">
          <div class="notification-head">
            <span class="badge" :class="statusBadge(n.status)">{{
              typeLabel(n.notificationType)
            }}</span>
            <span class="muted small">{{ formatDateTime(n.createdAt) }}</span>
          </div>
          <p class="notification-title">{{ n.title }}</p>
          <p v-if="n.body" class="muted small">{{ n.body }}</p>
        </div>
        <button
          v-if="!n.readAt"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="onMarkRead(n.id)"
        >
          Okundu
        </button>
      </li>
    </ul>

    <div v-if="pagination.pages > 1" class="pager">
      <button
        class="btn btn-secondary"
        :disabled="pagination.page <= 1"
        @click="changePage(pagination.page - 1)"
      >
        ‹ Önceki
      </button>
      <span>Sayfa {{ pagination.page }} / {{ pagination.pages }}</span>
      <button
        class="btn btn-secondary"
        :disabled="pagination.page >= pagination.pages"
        @click="changePage(pagination.page + 1)"
      >
        Sonraki ›
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useManagementStore, type NotificationStatus } from '@/stores/management';

const store = useManagementStore();

const notifications = computed(() => store.notifications);
const loading = computed(() => store.loading);
const pagination = computed(() => store.notificationPagination);
const filters = computed(() => store.notificationFilters);

onMounted(fetchNotifications);

async function fetchNotifications() {
  await store.fetchNotifications();
}

function changePage(page: number) {
  store.notificationFilters.page = page;
  void fetchNotifications();
}

async function toggleUnread() {
  store.notificationFilters.unread_only = filters.value.unread_only ? undefined : true;
  store.notificationFilters.page = 1;
  await fetchNotifications();
}

async function onMarkRead(id: string) {
  try {
    await store.markNotificationRead(id);
  } catch {
    /* hata store'da tutulur */
  }
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    'task.assigned': 'Görev atandı',
    'task.due_soon': 'Görev yaklaşıyor',
    'task.overdue': 'Görev gecikti',
    'appointment.upcoming': 'Randevu yaklaşıyor',
    'appointment.created': 'Randevu oluşturuldu',
    'invoice.due_soon': 'Fatura yaklaşıyor',
    'invoice.overdue': 'Fatura gecikti',
    'payment.received': 'Ödeme alındı',
    'stock.critical': 'Kritik stok',
    'user.mentioned': 'Bahsedilme',
    'system.security_alert': 'Güvenlik uyarısı',
    'system.announcement': 'Duyuru',
  };
  return map[type] ?? type;
}

function statusBadge(s: NotificationStatus): string {
  const map: Record<NotificationStatus, string> = {
    pending: 'badge-neutral',
    sent: 'badge-info',
    failed: 'badge-danger',
    read: 'badge-success',
  };
  return map[s];
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
</script>

<style scoped>
.notification-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.notification-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  background: var(--c-surface);
}
.notification-item.unread {
  border-left: 3px solid var(--c-primary);
}
.notification-main {
  min-width: 0;
}
.notification-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.notification-title {
  margin: 0 0 0.125rem;
  font-weight: 600;
}
.is-active {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
}
</style>
