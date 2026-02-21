import axios from 'axios';
import type { ApiResponse } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Token interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Hata interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// === HESAP API ===
export const accountApi = {
  getAll: (params?: Record<string, string>) =>
    api.get<ApiResponse>('/accounts', { params }),

  getTree: () =>
    api.get<ApiResponse>('/accounts/tree'),

  getByKod: (kod: string) =>
    api.get<ApiResponse>(`/accounts/${kod}`),

  search: (q: string) =>
    api.get<ApiResponse>('/accounts/search', { params: { q } }),

  create: (data: Record<string, unknown>) =>
    api.post<ApiResponse>('/accounts', data),

  update: (kod: string, data: Record<string, unknown>) =>
    api.put<ApiResponse>(`/accounts/${kod}`, data),

  delete: (kod: string) =>
    api.delete<ApiResponse>(`/accounts/${kod}`),
};

// === YEVMİYE FİŞİ API ===
export const journalApi = {
  getAll: (params?: Record<string, string>) =>
    api.get<ApiResponse>('/journal-entries', { params }),

  getByFisNo: (fisNo: string) =>
    api.get<ApiResponse>(`/journal-entries/${fisNo}`),

  create: (data: Record<string, unknown>) =>
    api.post<ApiResponse>('/journal-entries', data),

  approve: (fisNo: string) =>
    api.patch<ApiResponse>(`/journal-entries/${fisNo}/approve`),

  cancel: (fisNo: string) =>
    api.patch<ApiResponse>(`/journal-entries/${fisNo}/cancel`),

  getHesapHareketleri: (hesapKodu: string, params?: Record<string, string>) =>
    api.get<ApiResponse>(`/journal-entries/account/${hesapKodu}/movements`, { params }),
};

// === RAPOR API ===
export const reportApi = {
  getHesapBakiye: (hesapKodu: string, tarih?: string) =>
    api.get<ApiResponse>(`/reports/balance/${hesapKodu}`, { params: { tarih } }),

  getMizan: (params?: Record<string, string>) =>
    api.get<ApiResponse>('/reports/trial-balance', { params }),

  getBilanco: (tarih?: string) =>
    api.get<ApiResponse>('/reports/balance-sheet', { params: { tarih } }),

  getGelirTablosu: (params?: Record<string, string>) =>
    api.get<ApiResponse>('/reports/income-statement', { params }),

  getHesapEkstresi: (hesapKodu: string, params?: Record<string, string>) =>
    api.get<ApiResponse>(`/reports/account-statement/${hesapKodu}`, { params }),
};

// === ENTEGRASYON API ===
export const integrationApi = {
  getSupported: () =>
    api.get<ApiResponse>('/integrations/supported'),

  getConfigured: () =>
    api.get<ApiResponse>('/integrations'),

  upsertConfig: (programAdi: string, data: Record<string, unknown>) =>
    api.put<ApiResponse>(`/integrations/${programAdi}/config`, data),

  testConnection: (programAdi: string) =>
    api.post<ApiResponse>(`/integrations/${programAdi}/test`),

  sync: (programAdi: string, baslangic: string, bitis: string) =>
    api.post<ApiResponse>(`/integrations/${programAdi}/sync`, { baslangic, bitis }),

  syncAll: (baslangic: string, bitis: string) =>
    api.post<ApiResponse>('/integrations/sync-all', { baslangic, bitis }),
};
