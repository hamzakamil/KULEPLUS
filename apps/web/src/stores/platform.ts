import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Platform paneli (SaaS işletmecisi) — SPEC §28.1, §8.9.
 * Tenant kullanıcılarından AYRI bir kimliktir: `GET /v1/platform/me` platform üyesi
 * değilse 403 döner. Menü/rota kapıları yalnızca görünümdür; asıl yetki API'dedir
 * (`requirePlatformUser` / `requirePlatformRole`).
 */

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

export interface PlatformUser {
  id: string;
  userId: string;
  isOwner: boolean;
  roles: string[];
}

export interface PlanMetrics {
  activeCount: number;
  mrr: number;
}

export interface MetricsSnapshot {
  metricDate: string;
  currency: string;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  planBreakdown: Record<string, PlanMetrics>;
  computedAt: string;
}

export interface MetricsSummary {
  current: MetricsSnapshot;
  /** En yeni önce. */
  series: MetricsSnapshot[];
}

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

/** Para alanları NUMERIC string gelir (float yok — SPEC §22.1). */
export interface Partner {
  id: string;
  code: string;
  name: string;
  /** Yüzde (örn. "20.00"). */
  commissionRate: string;
  isActive: boolean;
  createdAt: string;
  referralCount: number;
  pendingAmount: string;
  approvedAmount: string;
  paidAmount: string;
}

export interface Commission {
  id: string;
  tenantId: string;
  tenantName: string | null;
  orderId: string;
  orderNo: string | null;
  amount: string;
  status: CommissionStatus;
  createdAt: string;
}

export interface Referral {
  id: string;
  tenantId: string;
  tenantName: string | null;
  referredAt: string;
}

export interface TenantOption {
  id: string;
  name: string;
  /** Aynı adlı şirketleri ayırt etmek için seçicide gösterilir. */
  createdAt: string;
}

export const FINANCE_ROLE = 'platform_finance';

export const usePlatformStore = defineStore('platform', () => {
  const platformUser = ref<PlatformUser | null>(null);
  const meLoaded = ref(false);
  let mePromise: Promise<void> | null = null;

  const metrics = ref<MetricsSummary | null>(null);
  const loading = ref(false);
  const computing = ref(false);
  const error = ref<string | null>(null);

  const isPlatform = computed(() => platformUser.value !== null);
  const isOwner = computed(() => platformUser.value?.isOwner === true);
  /** Gelir paneli ve ortak/komisyon ekranları: platform_finance rolü veya owner. */
  const hasFinanceAccess = computed(
    () => isOwner.value || (platformUser.value?.roles.includes(FINANCE_ROLE) ?? false),
  );

  const partners = ref<Partner[]>([]);
  const commissions = ref<Commission[]>([]);
  const referrals = ref<Referral[]>([]);
  const tenantOptions = ref<TenantOption[]>([]);

  /** Platform üyeliğini çözer; üye değilse (403) sessizce `null` bırakır. Tek uçuşlu. */
  function fetchMe(force = false): Promise<void> {
    if (meLoaded.value && !force) return Promise.resolve();
    if (!mePromise) {
      mePromise = api
        .get<{ platformUser: PlatformUser }>('/v1/platform/me')
        .then((res) => {
          platformUser.value = res.data.platformUser ?? null;
        })
        .catch(() => {
          platformUser.value = null;
        })
        .finally(() => {
          meLoaded.value = true;
          mePromise = null;
        });
    }
    return mePromise;
  }

  async function fetchMetrics(days = 30): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<MetricsSummary>('/v1/platform/metrics', { params: { days } });
      metrics.value = res.data;
    } catch (err) {
      error.value = errorMessage(err, 'Gelir metrikleri yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  /** Bugünün snapshot'ını hesaplayıp yazar (yalnızca platform_owner), sonra seriyi tazeler. */
  async function computeSnapshot(days = 30): Promise<boolean> {
    computing.value = true;
    error.value = null;
    try {
      await api.post('/v1/platform/metrics/snapshot');
      await fetchMetrics(days);
      return !error.value;
    } catch (err) {
      error.value = errorMessage(err, 'Günlük snapshot hesaplanamadı');
      return false;
    } finally {
      computing.value = false;
    }
  }

  // ===== Ortak (SMMM) programı =====

  /** Hatayı store'a yazar; başarıda `true` döner (ekran toast/yenileme kararı verir). */
  async function run(action: () => Promise<void>, fallback: string): Promise<boolean> {
    error.value = null;
    try {
      await action();
      return true;
    } catch (err) {
      error.value = errorMessage(err, fallback);
      return false;
    }
  }

  async function fetchPartners(): Promise<void> {
    loading.value = true;
    await run(async () => {
      const res = await api.get<{ partners: Partner[] }>('/v1/platform/partners');
      partners.value = res.data.partners ?? [];
    }, 'Ortaklar yüklenemedi');
    loading.value = false;
  }

  function createPartner(input: {
    code: string;
    name: string;
    commissionRate: number;
  }): Promise<boolean> {
    return run(async () => {
      await api.post('/v1/platform/partners', input);
      await fetchPartners();
    }, 'Ortak oluşturulamadı');
  }

  function updatePartner(
    partnerId: string,
    patch: { name?: string; commissionRate?: number; isActive?: boolean },
  ): Promise<boolean> {
    return run(async () => {
      await api.patch(`/v1/platform/partners/${partnerId}`, patch);
      await fetchPartners();
    }, 'Ortak güncellenemedi');
  }

  async function fetchCommissions(partnerId: string, status?: CommissionStatus): Promise<void> {
    await run(async () => {
      const res = await api.get<{ commissions: Commission[] }>(
        `/v1/platform/partners/${partnerId}/commissions`,
        { params: status ? { status } : undefined },
      );
      commissions.value = res.data.commissions ?? [];
    }, 'Komisyonlar yüklenemedi');
  }

  /** Durum değişince hem satırlar hem ortak toplamları tazelenir. */
  function setCommissionStatus(
    partnerId: string,
    commissionId: string,
    status: Exclude<CommissionStatus, 'pending'>,
    filter?: CommissionStatus,
  ): Promise<boolean> {
    return run(async () => {
      await api.patch(`/v1/platform/commissions/${commissionId}/status`, { status });
      await Promise.all([fetchCommissions(partnerId, filter), fetchPartners()]);
    }, 'Komisyon durumu güncellenemedi');
  }

  async function fetchReferrals(partnerId: string): Promise<void> {
    await run(async () => {
      const res = await api.get<{ referrals: Referral[] }>(
        `/v1/platform/partners/${partnerId}/referrals`,
      );
      referrals.value = res.data.referrals ?? [];
    }, 'Müşteri atıfları yüklenemedi');
  }

  function addReferral(partnerId: string, tenantId: string): Promise<boolean> {
    return run(async () => {
      await api.post(`/v1/platform/partners/${partnerId}/referrals`, { tenantId });
      await Promise.all([fetchReferrals(partnerId), fetchPartners()]);
    }, 'Şirket ortağa bağlanamadı');
  }

  /** Atıf için şirket seçici (ilk 100 — platform tenant listesi sayfalıdır). */
  async function fetchTenantOptions(): Promise<void> {
    await run(async () => {
      const res = await api.get<{ items: { id: string; name: string; created_at: string }[] }>(
        '/v1/platform/tenants',
        { params: { limit: 100 } },
      );
      tenantOptions.value = (res.data.items ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.created_at,
      }));
    }, 'Şirket listesi yüklenemedi');
  }

  function reset(): void {
    platformUser.value = null;
    meLoaded.value = false;
    metrics.value = null;
    partners.value = [];
    commissions.value = [];
    referrals.value = [];
    tenantOptions.value = [];
    error.value = null;
  }

  return {
    platformUser,
    meLoaded,
    metrics,
    loading,
    computing,
    error,
    isPlatform,
    isOwner,
    hasFinanceAccess,
    partners,
    commissions,
    referrals,
    tenantOptions,
    fetchMe,
    fetchMetrics,
    computeSnapshot,
    fetchPartners,
    createPartner,
    updatePartner,
    fetchCommissions,
    setCommissionStatus,
    fetchReferrals,
    addReferral,
    fetchTenantOptions,
    reset,
  };
});
