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

export const useAuthStore = defineStore('auth', () => {
  // Oturumu saklama yerinden geri yükle (localStorage: beni hatırla, sessionStorage: tek sekme)
  const token = ref<string | null>(getAccessToken());
  const company = ref<Company | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);
  const rememberMe = ref<boolean>(isRemembered());

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

  const isAuthenticated = computed(() => !!token.value);

  return {
    token,
    company,
    error,
    loading,
    rememberMe,
    login,
    logout,
    get2FASetup,
    verify2FA,
    disable2FA,
    isAuthenticated,
  };
});
