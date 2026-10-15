import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Şantiye (saha) store'u — ROADMAP Faz 7.6.
 *
 * Şantiye kaydı kokpitteki "Şantiyeler" kartını ve **hava durumu** bölümünü
 * besler: `province`/`district` alanları MGM istasyon çözümlemesinin girdisidir.
 * İl/ilçe seçenekleri backend proxy'sinden gelir (`/v1/management/weather/*`);
 * tarayıcı `servis.mgm.gov.tr`yi doğrudan çağıramaz (CORS + Referer zorunluluğu).
 *
 * Sunucu kapıları (`requireEntitlement`, `requirePermission`) güvenlik sınırıdır;
 * bu store yalnızca veri taşır.
 */

export type SiteStatus = 'active' | 'paused' | 'completed' | 'archived';

export const SITE_STATUS_OPTIONS: ReadonlyArray<{ value: SiteStatus; label: string }> = [
  { value: 'active', label: 'Devam ediyor' },
  { value: 'paused', label: 'Askıda' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'archived', label: 'Arşiv' },
];

export function siteStatusLabel(status: SiteStatus | string): string {
  return SITE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? String(status);
}

export interface Site {
  id: string;
  code: string;
  name: string;
  province: string;
  district: string | null;
  address: string | null;
  contactId: string | null;
  contactName: string | null;
  status: SiteStatus;
  statusLabel: string;
  sortOrder: number;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SiteInput {
  code?: string;
  name: string;
  province: string;
  district?: string | null;
  address?: string | null;
  contact_id?: string | null;
  status?: SiteStatus;
  sort_order?: number;
  notes?: string | null;
}

export interface ProvinceOption {
  il: string;
  ilPlaka: number | null;
}

export interface SiteFilters {
  q: string;
  status: SiteStatus | '';
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ message?: string; error?: { message?: string } }>).response?.data;
  return data?.error?.message || data?.message || fallback;
}

export const useSitesStore = defineStore('sites', () => {
  const items = ref<Site[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  /** MGM il listesi (81 il) — sunucu tarafında 24 saat önbelleklenir. */
  const provinces = ref<ProvinceOption[]>([]);
  const provincesLoading = ref(false);
  /** Seçilen ilin MGM istasyon ilçeleri. */
  const districts = ref<string[]>([]);
  const districtsLoading = ref(false);
  const weatherError = ref<string | null>(null);

  const fetchSites = async (filters: Partial<SiteFilters> = {}) => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.status) params.set('status', filters.status);
      params.set('limit', '100');
      const response = await api.get(`/v1/management/sites?${params.toString()}`);
      const data = response.data as { items: Site[]; total: number };
      items.value = data.items ?? [];
      total.value = data.total ?? items.value.length;
    } catch (err) {
      error.value = errorMessage(err, 'Şantiyeler yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const createSite = async (input: SiteInput) => {
    saving.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/management/sites', input);
      const created = response.data as Site;
      items.value = [...items.value, created].sort((a, b) => a.sortOrder - b.sortOrder);
      total.value += 1;
      return created;
    } catch (err) {
      error.value = errorMessage(err, 'Şantiye oluşturulamadı');
      throw err;
    } finally {
      saving.value = false;
    }
  };

  const updateSite = async (id: string, input: Partial<SiteInput>) => {
    saving.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/management/sites/${id}`, input);
      const updated = response.data as Site;
      const index = items.value.findIndex((site) => site.id === id);
      if (index !== -1) items.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = errorMessage(err, 'Şantiye güncellenemedi');
      throw err;
    } finally {
      saving.value = false;
    }
  };

  const deleteSite = async (id: string) => {
    error.value = null;
    try {
      await api.delete(`/v1/management/sites/${id}`);
      items.value = items.value.filter((site) => site.id !== id);
      total.value = Math.max(0, total.value - 1);
    } catch (err) {
      error.value = errorMessage(err, 'Şantiye silinemedi');
      throw err;
    }
  };

  const fetchProvinces = async () => {
    if (provinces.value.length > 0) return;
    provincesLoading.value = true;
    weatherError.value = null;
    try {
      const response = await api.get('/v1/management/weather/provinces');
      provinces.value = (response.data as { items: ProvinceOption[] }).items ?? [];
    } catch (err) {
      weatherError.value = errorMessage(err, 'MGM il listesi alınamadı');
    } finally {
      provincesLoading.value = false;
    }
  };

  const fetchDistricts = async (province: string) => {
    districts.value = [];
    if (!province) return;
    districtsLoading.value = true;
    weatherError.value = null;
    try {
      const response = await api.get(
        `/v1/management/weather/districts?province=${encodeURIComponent(province)}`,
      );
      districts.value = (response.data as { items: string[] }).items ?? [];
    } catch (err) {
      weatherError.value = errorMessage(err, 'MGM ilçe listesi alınamadı');
    } finally {
      districtsLoading.value = false;
    }
  };

  return {
    items,
    total,
    loading,
    saving,
    error,
    provinces,
    provincesLoading,
    districts,
    districtsLoading,
    weatherError,
    fetchSites,
    createSite,
    updateSite,
    deleteSite,
    fetchProvinces,
    fetchDistricts,
  };
});

