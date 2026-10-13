import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, saveAccessToken, clearSession } from './token-storage';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Request interceptor for adding auth token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// Tek uçuşlu refresh: aynı anda patlayan N tane 401 tek refresh isteği üretir.
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE_URL}/v1/auth/refresh`, {}, { withCredentials: true })
      .then((res) => {
        const token = res.data?.accessToken as string | undefined;
        if (!token) throw new Error('Refresh yanıtında access token yok');
        saveAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Response interceptor: 401'de önce sessiz refresh dene, olmazsa oturumu
// temizleyip login'e gönder. (Temizlemeden yönlendirmek login↔dashboard
// sonsuz döngüsü yaratıyordu.)
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;
    const url = original?.url || '';
    // Auth uçlarındaki (login/2fa/refresh) 401'ler form hatasıdır, dokunma
    const isAuthEndpoint = url.includes('/auth/');
    if (error.response?.status === 401 && original && !isAuthEndpoint && !original._retry) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.set('Authorization', `Bearer ${token}`);
        return api(original);
      } catch {
        // Refresh de öldüyse oturum gerçekten bitmiş demektir
      }
      clearSession();
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/2fa')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export { api };
