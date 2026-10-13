import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hatasından kullanıcı mesajı çıkarır. */
function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
}

export interface BackupSettingsShape {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'success' | 'failed' | 'running' | null;
  lastError: string | null;
}

export interface BackupStatusShape extends BackupSettingsShape {
  hasRunning: boolean;
  now: string;
}

export interface BackupJob {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  size_bytes: number | null;
  file_name: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Yedekleme store'u — dashboard paneli + ayarlar.
 *
 * - `startTimers()`: 1 sn'lik canlı geri sayım + 20 sn'lik durum/liste poll'u.
 * - `stopTimers()`: bileşen unmount'ta çağrılmalıdır.
 */
export const useBackupStore = defineStore('backup', () => {
  const settings = ref<BackupSettingsShape | null>(null);
  const items = ref<BackupJob[]>([]);
  const total = ref(0);
  const hasRunning = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const running = ref(false);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);

  // Canlı geri sayım: her saniye güncellenen `now`.
  const now = ref(Date.now());
  let timer: number | null = null;
  let pollTimer: number | null = null;

  // === Veri yükleme ===

  async function fetchStatus(): Promise<BackupStatusShape | undefined> {
    try {
      const res = await api.get<BackupStatusShape>('/v1/backups/status');
      settings.value = {
        enabled: res.data.enabled,
        intervalMinutes: res.data.intervalMinutes,
        retentionCount: res.data.retentionCount,
        nextRunAt: res.data.nextRunAt,
        lastRunAt: res.data.lastRunAt,
        lastStatus: res.data.lastStatus,
        lastError: res.data.lastError,
      };
      hasRunning.value = res.data.hasRunning;
      now.value = Date.now();
      return res.data;
    } catch (err) {
      error.value = errorMessage(err, 'Yedek durumu yüklenemedi');
      return undefined;
    }
  }

  async function fetchList(): Promise<{ items: BackupJob[]; total: number } | undefined> {
    try {
      const res = await api.get<{ items: BackupJob[]; total: number; hasRunning: boolean }>(
        '/v1/backups',
      );
      items.value = res.data.items;
      total.value = res.data.total;
      hasRunning.value = res.data.hasRunning;
      return { items: res.data.items, total: res.data.total };
    } catch (err) {
      error.value = errorMessage(err, 'Yedek listesi yüklenemedi');
      return undefined;
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([fetchStatus(), fetchList()]);
  }

  // === Ayarlar ===

  async function updateSettings(patch: Partial<BackupSettingsShape>): Promise<void> {
    saving.value = true;
    error.value = null;
    notice.value = null;
    try {
      const body: Record<string, unknown> = {};
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      if (patch.intervalMinutes !== undefined) body.intervalMinutes = patch.intervalMinutes;
      if (patch.retentionCount !== undefined) body.retentionCount = patch.retentionCount;
      const res = await api.put<Record<string, unknown>>('/v1/backups/settings', body);
      if (settings.value && res.data) {
        settings.value = {
          ...settings.value,
          enabled: Boolean(res.data.enabled ?? settings.value.enabled),
          intervalMinutes: Number(res.data.interval_minutes ?? settings.value.intervalMinutes),
          retentionCount: Number(res.data.retention_count ?? settings.value.retentionCount),
          nextRunAt: String(res.data.next_run_at ?? settings.value.nextRunAt),
        };
      }
      notice.value = 'Yedek ayarları kaydedildi.';
    } catch (err) {
      error.value = errorMessage(err, 'Ayarlar kaydedilemedi');
      throw err;
    } finally {
      saving.value = false;
    }
  }

  // === Çalıştırma / geçmiş ===

  async function runNow(): Promise<void> {
    running.value = true;
    error.value = null;
    try {
      const res = await api.post<{ job: BackupJob; alreadyRunning: boolean }>(
        '/v1/backups',
        {},
      );
      hasRunning.value = true;
      items.value = [res.data.job, ...items.value.filter((i) => i.id !== res.data.job.id)];
      if (!res.data.alreadyRunning) notice.value = 'Yedekleme başlatıldı.';
    } catch (err) {
      error.value = errorMessage(err, 'Yedek başlatılamadı');
      throw err;
    } finally {
      running.value = false;
    }
  }

  async function remove(id: string): Promise<void> {
    error.value = null;
    try {
      await api.delete(`/v1/backups/${id}`);
      items.value = items.value.filter((i) => i.id !== id);
      total.value = Math.max(0, total.value - 1);
      await fetchStatus();
    } catch (err) {
      error.value = errorMessage(err, 'Yedek silinemedi');
      throw err;
    }
  }

  async function download(id: string, fileName?: string): Promise<void> {
    error.value = null;
    try {
      const res = await api.get(`/v1/backups/${id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data as Blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName || `yedek-${id.slice(0, 8)}.sql.gz`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      error.value = errorMessage(err, 'Yedek indirilemedi');
    }
  }

  // === Canlı geri sayım / poll ===

  function startTimers(): void {
    stopTimers();
    timer = window.setInterval(() => {
      now.value = Date.now();
    }, 1000);
    pollTimer = window.setInterval(() => {
      void fetchStatus();
      void fetchList();
    }, 20_000);
  }

  function stopTimers(): void {
    if (timer) window.clearInterval(timer);
    if (pollTimer) window.clearInterval(pollTimer);
    timer = null;
    pollTimer = null;
  }

  // === Türetilmiş değerler ===

  /** Bir sonraki yedeğe kalan milisaniye (saniyede bir `now` ile canlı). */
  const nextInMs = computed(() => {
    if (!settings.value) return null;
    return Math.max(0, new Date(settings.value.nextRunAt).getTime() - now.value);
  });

  /** "14 dk 32 sn" gibi geri sayım etiketi. */
  const countdownLabel = computed(() => {
    if (!settings.value) return '';
    if (hasRunning.value) return 'Yedekleniyor…';
    if (!settings.value.enabled) return 'Otomatik yedekleme kapalı';
    const ms = nextInMs.value ?? 0;
    if (ms <= 0) return 'Başlamak üzere…';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86_400);
    const h = Math.floor((totalSec % 86_400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (d > 0) parts.push(`${d} gün`);
    if (h > 0) parts.push(`${h} sa`);
    parts.push(`${m} dk`);
    parts.push(`${s} sn`);
    return parts.join(' ');
  });

  /** İlerleme çubuğu doluluk yüzdesi (bu periyotta ne kadar doldu). */
  const progressPercent = computed(() => {
    if (!settings.value) return 0;
    const interval = Math.max(1, settings.value.intervalMinutes) * 60_000;
    const elapsed = interval - (nextInMs.value ?? 0);
    const pct = (elapsed / interval) * 100;
    return Math.min(100, Math.max(0, pct));
  });

  /** "az önce / 5 dk önce / 2 sa önce" gibi son yedek etiketi. */
  const lastBackupLabel = computed(() => {
    if (!settings.value?.lastRunAt) return 'henüz yok';
    const ran = new Date(settings.value.lastRunAt).getTime();
    const diff = Math.max(0, now.value - ran);
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'az önce';
    if (min < 60) return `${min} dk önce`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} sa önce`;
    const d = Math.floor(h / 24);
    return `${d} gün önce`;
  });

  function clearNotice(): void {
    notice.value = null;
  }

  return {
    settings,
    items,
    total,
    hasRunning,
    loading,
    saving,
    running,
    error,
    notice,
    now,
    fetchStatus,
    fetchList,
    refresh,
    updateSettings,
    runNow,
    remove,
    download,
    startTimers,
    stopTimers,
    countdownLabel,
    progressPercent,
    lastBackupLabel,
    clearNotice,
  };
});
