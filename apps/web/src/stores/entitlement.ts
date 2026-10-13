import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/lib/api';

/**
 * Modül hakları (entitlement) — SPEC §5.1/§8.5, README §4.1.
 *
 * Sunucu kapıyı her istekte kapatır (`requireEntitlement`); bu store yalnızca
 * **görünüm** içindir: navigasyonda kilitli modülü göstermek ve kilitli modül
 * önizleme ekranını açmak. Güvenlik sınırının yerine geçmez.
 */
export type ModuleCode =
  | 'core'
  | 'platform'
  | 'contacts'
  | 'stock'
  | 'trade'
  | 'cashbank'
  | 'einvoice'
  | 'subscription'
  | 'accounting'
  | 'cheque'
  | 'reports_plus'
  | 'management'
  | 'sms'
  | 'integrations';

interface EntitlementRow {
  moduleCode: string;
  status: string;
  expiresAt: string | null;
}

export const useEntitlementStore = defineStore('entitlement', () => {
  const entitlements = ref<EntitlementRow[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Aktif modül kodları — 'active' olmayan (grace/expired) hak sayılmaz. */
  const activeModules = computed(
    () => new Set(entitlements.value.filter((e) => e.status === 'active').map((e) => e.moduleCode)),
  );

  function hasModule(code: ModuleCode | string): boolean {
    // Henüz yüklenmediyse menüyü kilitleme — ilk yükleme sonrası yeniden değerlendirilir.
    if (!loaded.value) return true;
    return activeModules.value.has(code);
  }

  async function fetchEntitlements(force = false): Promise<void> {
    if (loading.value || (loaded.value && !force)) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get('/v1/entitlements');
      entitlements.value = (res.data?.entitlements ?? []) as EntitlementRow[];
      loaded.value = true;
    } catch {
      // Hak listesi alınamazsa menü açık kalır (salt görünüm; API kapıları zaten devrede)
      error.value = 'Modül hakları alınamadı';
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    entitlements.value = [];
    loaded.value = false;
  }

  return { entitlements, loaded, loading, error, activeModules, hasModule, fetchEntitlements, reset };
});