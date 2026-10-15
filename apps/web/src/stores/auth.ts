import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/lib/api';
import {
  getAccessToken,
  getCompanyId,
  saveSession,
  clearSession,
  isRemembered,
} from '@/lib/token-storage';
import type { AxiosError } from 'axios';

export interface Company {
  id: string;
  name: string;
  taxNumber: string;
}

/** `roles` tablosu — `code` nullable (migration 202610050001). */
export interface UserRole {
  id: string;
  name: string;
  code: string | null;
}

/**
 * Yönetici kokpiti kapısı. Backend'deki gerçek izin kodu
 * (`packages/shared/permissions.ts` → `management.dashboard.read`); frontend
 * YALNIZCA menü/yönlendirme için okur, asıl yetki endpoint'te verilir.
 */
export const COCKPIT_PERMISSION = 'management.dashboard.read';

/** `GET /api/v1/auth/me` yanıt sözleşmesi. */
export interface MeResponse {
  user: { id: string; email: string };
  tenantId: string;
  isOwner: boolean;
  roles: UserRole[];
  permissions: string[];
}

export const useAuthStore = defineStore('auth', () => {
  // Oturumu saklama yerinden geri yükle (localStorage: beni hatırla, sessionStorage: tek sekme)
  const token = ref<string | null>(getAccessToken());
  const company = ref<Company | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);
  const rememberMe = ref<boolean>(isRemembered());

  /**
   * RBAC durumu. JWT rol TAŞIMAZ (yalnızca sub/email/jti/tenantId/authVersion),
   * bu yüzden rol ve izinler `GET /v1/auth/me` ile backend'den çözülür.
   * Frontend kendi rolünü uydurmaz: buradaki liste, backend'in `requirePermission`
   * kararıyla aynı kaynaktan (`permission-grants.ts`) gelir.
   */
  const roles = ref<UserRole[]>([]);
  const permissions = ref<string[]>([]);
  /** `tenant_users.is_owner` — owner tüm izinleri taşır (SPEC §6.6). */
  const isOwner = ref(false);
  const profileLoaded = ref(false);
  /** Eşzaman guard çağrılarında tek istek — korunan rota yanlışlıkla reddedilmesin. */
  let mePromise: Promise<boolean> | null = null;

  // Initialize company from storage if token exists
  if (token.value) {
    const companyId = getCompanyId();
    if (companyId) {
      company.value = { id: companyId, name: '', taxNumber: '' };
    }
  }

  const login = async (email: string, password: string, remember = true, totpCode?: string) => {
    loading.value = true;
    error.value = null;
    // Önceki hesabın rol/izinleri yeni oturuma taşınmasın.
    clearProfile();
    try {
      const response = await api.post('/v1/auth/login', {
        email: email.trim().toLowerCase(),
        password,
        rememberMe: remember,
        // 2FA etkinse ikinci adımda gönderilir (backend alan adı: totpCode)
        ...(totpCode ? { totpCode } : {}),
      });
      token.value = response.data.accessToken;
      company.value = { id: response.data.tenantId, name: response.data.user.name, taxNumber: '' };
      rememberMe.value = remember;
      saveSession(response.data.accessToken, response.data.tenantId, remember);
      return response.data;
    } catch (err) {
      const axiosError = err as AxiosError;
      const data = axiosError.response?.data;
      const message =
        typeof data === 'object' && data ? (data as { message?: string }).message : undefined;
      error.value = message || 'Giriş sırasında bir hata oluştu.';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const logout = async () => {
    try {
      await api.post('/v1/auth/logout');
    } catch {
      // Oturum zaten geçersizse sessizce devam et
    }
    token.value = null;
    company.value = null;
    clearProfile();
    clearSession();
    window.location.href = '/login';
  };

  // TOTP 2FA
  const get2FASetup = async () => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/auth/2fa/setup');
      return response.data;
    } catch (err) {
      const axiosError = err as AxiosError;
      error.value = '2FA ayarlanırken bir hata oluştu.';
      throw axiosError;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 2FA'yı onayla ve etkinleştir (kullanıcı oturumu açıkken, kurulum ekranından).
   * Backend kontratı `totpCode` alanını kullanır; yanıt `{ message, backupCodes }`
   * döner (yalnızca bu adımda görülen yedek kodlar) — bir access token DEĞİL.
   */
  const verify2FA = async (totpCode: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<{ message: string; backupCodes: string[] }>(
        '/v1/auth/2fa/verify',
        { totpCode },
      );
      return response.data;
    } catch (err) {
      const axiosError = err as AxiosError;
      const data = axiosError.response?.data;
      const message =
        typeof data === 'object' && data ? (data as { message?: string }).message : undefined;
      error.value = message || '2FA doğrulaması başarısız oldu.';
      throw axiosError;
    } finally {
      loading.value = false;
    }
  };

  const disable2FA = async (password: string, totpCode?: string, backupCode?: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.post('/v1/auth/2fa/disable', { password, totpCode, backupCode });
    } catch (err) {
      const axiosError = err as AxiosError;
      error.value = '2FA devre dışı bırakılırken bir hata oluştu.';
      throw axiosError;
    } finally {
      loading.value = false;
    }
  };

  /** Oturum profiline ait RBAC durumunu sıfırla. */
  const clearProfile = () => {
    roles.value = [];
    permissions.value = [];
    isOwner.value = false;
    profileLoaded.value = false;
    mePromise = null;
  };

  /**
   * Rol + izinleri yükler (önbellekli, eşzaman çağrılarda tek istek).
   * Hata → fail-closed: liste boş kalır, korunan rotalar reddedilir.
   */
  const fetchMe = (force = false): Promise<boolean> => {
    if (!token.value) return Promise.resolve(false);
    if (profileLoaded.value && !force) return Promise.resolve(true);
    if (!mePromise) {
      mePromise = (async () => {
        try {
          const response = await api.get<MeResponse>('/v1/auth/me');
          roles.value = response.data.roles ?? [];
          permissions.value = response.data.permissions ?? [];
          isOwner.value = response.data.isOwner === true;
          profileLoaded.value = true;
          return true;
        } catch {
          clearProfile();
          return false;
        }
      })();
    }
    return mePromise;
  };

  const permissionIndex = computed(() => new Set(permissions.value));

  /** İzin sorgusu — yalnızca menü/yönlendirme içindir, güvenlik kapısı DEĞİLDİR. */
  const can = (code: string): boolean => isOwner.value || permissionIndex.value.has(code);

  /** Yönetici kokpitine erişebilir mi? (owner veya `management.dashboard.read`) */
  const isManager = computed(() => can(COCKPIT_PERMISSION));

  /** Giriş sonrası varış yeri: yönetici → kokpit, diğerleri → klasik panel. */
  const landingRoute = computed(() => (isManager.value ? 'management-cockpit' : 'dashboard'));

  const isAuthenticated = computed(() => !!token.value);

  return {
    token,
    company,
    error,
    loading,
    rememberMe,
    roles,
    permissions,
    isOwner,
    profileLoaded,
    isManager,
    landingRoute,
    can,
    fetchMe,
    clearProfile,
    login,
    logout,
    get2FASetup,
    verify2FA,
    disable2FA,
    isAuthenticated,
  };
});
