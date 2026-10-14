<template>
  <div class="management-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Bildirim Tercihleri</h1>
        <p class="page-sub">
          Bildirim türlerini hangi kanallardan almak istediğinizi seçin. Sessiz saatlerde
          (varsayılan 22:00–08:00) anlık bildirimler ertelenir.
        </p>
      </div>
    </header>

    <section class="push-card">
      <div class="push-head">
        <div>
          <h2 class="push-title">Web Push (bu cihaz)</h2>
          <p class="muted small">
            Bu tarayıcıda anlık bildirim alın. Kapalıysa yalnızca uygulama içi bildirimler görünür.
          </p>
        </div>
        <span class="badge" :class="pushBadgeClass">{{ pushStatusLabel }}</span>
      </div>

      <p v-if="pushError" class="state-msg error">{{ pushError }}</p>
      <p v-else-if="pushMessage" class="state-msg">{{ pushMessage }}</p>

      <div class="push-actions">
        <template v-if="pushSupported">
          <button
            v-if="!subscribed"
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="pushBusy"
            @click="enablePush"
          >
            {{ pushBusy ? 'Etkinleştiriliyor…' : 'Bildirimleri etkinleştir' }}
          </button>
          <template v-else>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="pushBusy"
              @click="sendTest"
            >
              Test bildirimi gönder
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="pushBusy"
              @click="disablePush"
            >
              Bu cihazda kapat
            </button>
          </template>
        </template>
        <p v-else class="muted small">Bu tarayıcı Web Push desteklemiyor.</p>
      </div>
    </section>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>

    <p v-else-if="loading && !store.preferences.length" class="state-msg">Yükleniyor…</p>

    <ul v-else class="pref-list">
      <li v-for="type in notificationTypes" :key="type.key" class="pref-card">
        <div class="pref-head">
          <div class="pref-info">
            <span class="pref-title">{{ type.label }}</span>
            <span class="badge badge-info">{{ type.key }}</span>
          </div>
        </div>

        <div class="channel-row">
          <label v-for="ch in CHANNELS" :key="ch.key" class="channel-toggle">
            <input
              type="checkbox"
              :checked="draftOf(type.key).channels[ch.key]"
              @change="toggleChannel(type.key, ch.key, $event)"
            />
            <span class="channel-label">{{ ch.label }}</span>
          </label>
        </div>

        <div class="quiet-row">
          <span class="muted small">Sessiz saatler</span>
          <label class="quiet-field">
            <span class="muted small">Başlangıç</span>
            <input
              class="input"
              type="time"
              :value="draftOf(type.key).quietStart"
              @input="setQuiet(type.key, 'quietStart', $event)"
            />
          </label>
          <label class="quiet-field">
            <span class="muted small">Bitiş</span>
            <input
              class="input"
              type="time"
              :value="draftOf(type.key).quietEnd"
              @input="setQuiet(type.key, 'quietEnd', $event)"
            />
          </label>
        </div>

        <div class="pref-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="savingKey === type.key"
            @click="save(type.key)"
          >
            {{ savingKey === type.key ? 'Kaydediliyor…' : 'Kaydet' }}
          </button>
          <span v-if="savedKey === type.key" class="saved-msg small">Kaydedildi ✓</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useManagementStore, type NotificationChannel } from '@/stores/management';
import {
  fetchVapidPublicKey,
  getCurrentSubscription,
  notificationPermission,
  pushSupported as isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push';

const CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: 'in_app', label: 'Uygulama içi' },
  { key: 'email', label: 'E-posta' },
  { key: 'push', label: 'Anlık (push)' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
];

const notificationTypes: { key: string; label: string }[] = [
  { key: 'task.assigned', label: 'Görev atandı' },
  { key: 'task.due_soon', label: 'Görev yaklaşıyor' },
  { key: 'task.overdue', label: 'Görev gecikti' },
  { key: 'appointment.upcoming', label: 'Randevu yaklaşıyor' },
  { key: 'appointment.created', label: 'Randevu oluşturuldu' },
  { key: 'whatsapp.message_received', label: 'WhatsApp mesajı alındı' },
  { key: 'invoice.due_soon', label: 'Fatura yaklaşıyor' },
  { key: 'invoice.overdue', label: 'Fatura gecikti' },
  { key: 'payment.received', label: 'Ödeme alındı' },
  { key: 'cash.low_balance', label: 'Kasa bakiyesi düşük' },
  { key: 'stock.critical', label: 'Kritik stok' },
  { key: 'user.mentioned', label: 'Bahsedilme' },
  { key: 'subscription.payment_failed', label: 'Abonelik ödemesi başarısız' },
  { key: 'subscription.expiring', label: 'Abonelik bitiyor' },
  { key: 'system.security_alert', label: 'Güvenlik uyarısı' },
  { key: 'system.announcement', label: 'Sistem duyurusu' },
];

const store = useManagementStore();
const loading = computed(() => store.preferencesLoading);

interface Draft {
  channels: Record<NotificationChannel, boolean>;
  quietStart: string;
  quietEnd: string;
}

const drafts = ref<Record<string, Draft>>({});
const savingKey = ref<string | null>(null);
const savedKey = ref<string | null>(null);

// Web Push (bu cihaz) durumu
const pushSupported = ref(false);
const permission = ref<NotificationPermission>('default');
const subscribed = ref(false);
const pushBusy = ref(false);
const pushMessage = ref<string | null>(null);
const pushError = ref<string | null>(null);

const pushStatusLabel = computed(() => {
  if (!pushSupported.value) return 'Desteklenmiyor';
  if (permission.value === 'denied') return 'İzin reddedildi';
  return subscribed.value ? 'Açık' : 'Kapalı';
});

const pushBadgeClass = computed(() => {
  if (subscribed.value) return 'badge-success';
  return permission.value === 'denied' ? 'badge-danger' : 'badge-neutral';
});

onMounted(async () => {
  await store.fetchPreferences();
  syncDrafts();
  await refreshPushState();
});

async function refreshPushState(): Promise<void> {
  pushSupported.value = isPushSupported();
  if (!pushSupported.value) return;
  permission.value = notificationPermission();
  const sub = await getCurrentSubscription();
  subscribed.value = !!sub;
}

function deviceTokenOf(sub: PushSubscription): string {
  return JSON.stringify(sub);
}

async function enablePush(): Promise<void> {
  pushBusy.value = true;
  pushError.value = null;
  pushMessage.value = null;
  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) throw new Error('Sunucuda Web Push yapılandırılmamış (VAPID anahtarı yok).');
    const sub = await subscribeToPush(publicKey);
    await store.registerDevice({
      device_token: deviceTokenOf(sub),
      platform: 'web',
      device_name: navigator.userAgent.slice(0, 200),
    });
    subscribed.value = true;
    pushMessage.value = 'Bu cihazda bildirimler etkinleştirildi.';
  } catch (err) {
    pushError.value = err instanceof Error ? err.message : 'Bildirimler etkinleştirilemedi';
  } finally {
    pushBusy.value = false;
    permission.value = notificationPermission();
  }
}

async function disablePush(): Promise<void> {
  pushBusy.value = true;
  pushError.value = null;
  pushMessage.value = null;
  try {
    const sub = await getCurrentSubscription();
    if (sub) {
      const token = deviceTokenOf(sub);
      await store.fetchDevices();
      const match = store.devices.find((d) => d.deviceToken === token);
      await unsubscribeFromPush();
      if (match) await store.deleteDevice(match.id);
    }
    subscribed.value = false;
    pushMessage.value = 'Bu cihazda bildirimler kapatıldı.';
  } catch (err) {
    pushError.value = err instanceof Error ? err.message : 'Bildirimler kapatılamadı';
  } finally {
    pushBusy.value = false;
  }
}

async function sendTest(): Promise<void> {
  pushBusy.value = true;
  pushError.value = null;
  pushMessage.value = null;
  try {
    const res = await store.sendTestPush();
    pushMessage.value = `Test bildirimi kuyruğa alındı (${res.devices} cihaz). Birkaç saniye içinde görünür.`;
  } catch (err) {
    pushError.value = err instanceof Error ? err.message : 'Test bildirimi gönderilemedi';
  } finally {
    pushBusy.value = false;
  }
}

function defaultChannels(): Record<NotificationChannel, boolean> {
  return {
    in_app: true,
    email: true,
    push: false,
    whatsapp: false,
    sms: false,
  };
}

function syncDrafts(): void {
  const next: Record<string, Draft> = {};
  for (const type of notificationTypes) {
    next[type.key] = {
      channels: defaultChannels(),
      quietStart: '22:00',
      quietEnd: '08:00',
    };
  }
  for (const pref of store.preferences) {
    const draft = next[pref.notificationType];
    if (!draft) continue;
    draft.channels[pref.channel] = pref.enabled;
    if (pref.quietHoursStart) draft.quietStart = pref.quietHoursStart.slice(0, 5);
    if (pref.quietHoursEnd) draft.quietEnd = pref.quietHoursEnd.slice(0, 5);
  }
  drafts.value = next;
}

function draftOf(type: string): Draft {
  return (
    drafts.value[type] ?? {
      channels: defaultChannels(),
      quietStart: '22:00',
      quietEnd: '08:00',
    }
  );
}

function toggleChannel(type: string, channel: NotificationChannel, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  const draft = draftOf(type);
  drafts.value[type] = { ...draft, channels: { ...draft.channels, [channel]: checked } };
}

function setQuiet(type: string, field: 'quietStart' | 'quietEnd', event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  drafts.value[type] = { ...draftOf(type), [field]: value };
}

async function save(type: string): Promise<void> {
  const draft = draftOf(type);
  savingKey.value = type;
  try {
    await Promise.all(
      CHANNELS.map((ch) =>
        store.savePreference({
          notification_type: type,
          channel: ch.key,
          enabled: draft.channels[ch.key],
          quiet_hours_start: draft.quietStart || null,
          quiet_hours_end: draft.quietEnd || null,
        }),
      ),
    );
    savedKey.value = type;
    window.setTimeout(() => {
      if (savedKey.value === type) savedKey.value = null;
    }, 2000);
  } catch {
    /* hata store'da tutulur */
  } finally {
    savingKey.value = null;
  }
}
</script>

<style scoped>
.push-card {
  margin-bottom: 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  background: var(--c-surface);
}
.push-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.push-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
}
.push-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}
.pref-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pref-card {
  padding: 1rem 1.25rem;
  border: 1px solid var(--c-border);
  border-radius: 0.75rem;
  background: var(--c-surface);
}
.pref-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.pref-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.pref-title {
  font-weight: 600;
}
.channel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0.75rem 0;
}
.channel-toggle {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}
.channel-label {
  font-size: 0.875rem;
}
.quiet-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--c-border);
}
.quiet-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.quiet-field .input {
  width: 7rem;
}
.pref-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.saved-msg {
  color: var(--c-success, #16a34a);
}
</style>
