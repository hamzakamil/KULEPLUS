import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';
import { saveSession, isRemembered } from '@/lib/token-storage';
import { useEntitlementStore } from './entitlement';

/**
 * Şirket seçici (Faz 2 UX kabuğu) — `GET /company/my-companies` + `POST /company/switch`.
 * Switch ucu yeni access token döner (JWT tenant bağlamı taşır); token değişince
 * tüm ekranların yeni bağlamla yüklenmesi için sayfa yeniden yükletilir.
 */
export interface UserCompany {
  id: string;
  name: string;
  trade_name: string | null;
  status: string;
  isOwner: boolean;
}

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<UserCompany[]>([]);
  const loading = ref(false);
  const switching = ref(false);
  const error = ref<string | null>(null);

  async function fetchCompanies(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get('/v1/company/my-companies');
      companies.value = res.data as UserCompany[];
    } catch {
      error.value = 'Şirketler listelenemedi';
    } finally {
      loading.value = false;
    }
  }

  /** Şirket bağlamını değiştirir; başarıda sayfa yeni token ile yenilenir. */
  async function switchTo(tenantId: string): Promise<boolean> {
    if (switching.value) return false;
    switching.value = true;
    error.value = null;
    try {
      const res = await api.post('/v1/company/switch', { tenantId });
      const accessToken = res.data?.accessToken as string | undefined;
      const newTenantId = (res.data?.tenantId as string | undefined) ?? tenantId;
      if (!accessToken) throw new Error('Switch yanıtında access token yok');

      saveSession(accessToken, newTenantId, isRemembered());
      // Hak listesi yeni tenant'a aittir; zorla yeniden çek + ekranları tazele
      useEntitlementStore().reset();
      window.location.reload();
      return true;
    } catch {
      error.value = 'Şirket değiştirilemedi';
      return false;
    } finally {
      switching.value = false;
    }
  }

  return { companies, loading, switching, error, fetchCompanies, switchTo };
});