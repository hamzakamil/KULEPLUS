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

/**
 * Oturum yanıtı sözleşmesi — `POST /v1/auth/login`, `/register` ve `/google`
 * BİREBİR aynı yapıyı döner (ADR-0023). Bu yüzden üçü de `applySession`'dan geçer.
 */
export interface SessionResponse {
  accessToken: string;
  tenantId: string;
  user: { id: string; email: string; name: string; totpEnabled: boolean };
  /** Yalnızca Google ile ilk girişte: yeni çalışma alanı mı açıldı? */
  isNewUser?: boolean;
}

/** Kayıt formu alanları — backend `registerSchema` ile birebir. */
export interface SignupInput {
  email: string;
  password: string;
  name: string;
  companyName?: string;
  startingModule?: 'contacts' | 'stock';
  /** KVKK aydınlatma kabulü — backend'de `z.literal(true)`, kabul edilmeden kayıt olmaz. */
  acceptTerms: true;
}

/** `GET /v1/auth/google/config` — buton yalnızca `enabled: true` ise basılır. */
export interface GoogleAuthConfig {
  enabled: boolean;
  clientId: string | null;
}

/**
 * Axios hatasından gösterilecek mesajı çıkarır.
 *
 * Hata sözleşmesi iki biçim taşıyabiliyor: merkezi hata middleware'i
 * `{ error: { code, message } }` üretir (ADR-0017), bazı uçlar ise düz `{ message }`
 * döner (ör. doğrulama yanıtları). İkisi de okunur; hiçbiri yoksa temele düşülür —
 * kullanıcı "bilinmeyen hata" yerine sunucunun söylediğini görmelidir.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError)?.response?.data as
    { message?: string; error?: { message?: string } } | undefined;
  return data?.message || data?.error?.message || fallback;
}

export const useAuthStore = defineStore('auth', () => {
  // Oturumu saklama yerinden geri yükle (localStorage: beni hatırla, sessionStorage: tek sekme)
  const token = ref<string | null>(getAccessToken());
  const company = ref<Company | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);
  const rememberMe = ref<boolean>(isRemembered());
  /**
   * Google ile giriş yapılandırması — `fetchGoogleConfig()` ile dolar. Varsayılan
   * KAPALI: istek dönmeden veya hata verirse buton basılmaz (ADR-0023).
   */
  const googleConfig = ref<GoogleAuthConfig>({ enabled: false, clientId: null });

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

  /**
   * Oturum yanıtını uygular (ADR-0023).
   *
   * Giriş, kayıt ve Google girişi aynı yanıt sözleşmesini döner; token'ın nereye
   * yazıldığı ("beni hatırla" → localStorage, değilse sessionStorage) burada tek
   * kez kararlaştırılır. Üç ayrı yol olsaydı sosyal giriş saklama kuralını
   * atlayabilir ve sekme kapanınca oturum sessizce kaybolurdu.
   */
  const applySession = (data: SessionResponse, remember: boolean) => {
    clearProfile();
    token.value = data.accessToken;
    company.value = { id: data.tenantId, name: data.user?.name ?? '', taxNumber: '' };
    rememberMe.value = remember;
    saveSession(data.accessToken, data.tenantId, remember);
  };

  const login = async (email: string, password: string, remember = true, totpCode?: string) => {
    loading.value = true;
    error.value = null;
    // Önceki hesabın rol/izinleri yeni oturuma taşınmasın.
    clearProfile();
    try {
      const response = await api.post<SessionResponse>('/v1/auth/login', {
        email: email.trim().toLowerCase(),
        password,
        rememberMe: remember,
        // 2FA etkinse ikinci adımda gönderilir (backend alan adı: totpCode)
        ...(totpCode ? { totpCode } : {}),
      });
      applySession(response.data, remember);
      return response.data;
    } catch (err) {
      error.value = apiErrorMessage(err, 'Giriş sırasında bir hata oluştu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Kendi kendine kayıt (ADR-0023): kullanıcı + şirket backend'de tek transaction'da
   * açılır, yanıtta oturum hemen geldiği için kullanıcı ikinci kez giriş yapmaz.
   */
  const signup = async (input: SignupInput, remember = true) => {
    loading.value = true;
    error.value = null;
    clearProfile();
    try {
      const response = await api.post<SessionResponse>('/v1/auth/register', {
        ...input,
        email: input.email.trim().toLowerCase(),
      });
      applySession(response.data, remember);
      return response.data;
    } catch (err) {
      error.value = apiErrorMessage(err, 'Kayıt sırasında bir hata oluştu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Google ile giriş — GIS butonunun ID token'ı sunucuya gönderilir; doğrulama ve
   * hesap eşleştirme backend'dedir (`identity/service.ts` → `loginWithGoogle`).
   */
  const loginWithGoogle = async (credential: string, remember = true) => {
    loading.value = true;
    error.value = null;
    clearProfile();
    try {
      const response = await api.post<SessionResponse>('/v1/auth/google', {
        credential,
        rememberMe: remember,
      });
      applySession(response.data, remember);
      return response.data;
    } catch (err) {
      error.value = apiErrorMessage(err, 'Google ile giriş başarısız oldu.');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Google giriş yapılandırmasını okur. Hata → `enabled: false`: sosyal giriş
   * kurulu olmayan ortamda ölü buton göstermeyiz, parola akışı çalışmaya devam eder.
   */
  const fetchGoogleConfig = async (): Promise<GoogleAuthConfig> => {
    try {
      const response = await api.get<GoogleAuthConfig>('/v1/auth/google/config');
      googleConfig.value = {
        enabled: response.data?.enabled === true,
        clientId: response.data?.clientId ?? null,
      };
    } catch {
      googleConfig.value = { enabled: false, clientId: null };
    }
    return googleConfig.value;
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
    googleConfig,
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
    signup,
    loginWithGoogle,
    fetchGoogleConfig,
    logout,
    get2FASetup,
    verify2FA,
    disable2FA,
    isAuthenticated,
  };
});
