import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Yönetici Kokpiti yüklemesi — `GET /v1/management/cockpit`.
 *
 * Alan Sözleşmesi apps/api/src/modules/management/cockpit.service.ts ile birebir
 * aynıdır (backend tek doğruluk kaynağı). Kokpit iframe'i token taşımaz: veri
 * burada (yetkili SPA istemcisiyle) çekilir ve `postMessage` ile iframe'e
 * verilir — buradan sonra rota değişse de iframe'e ham token girmez.
 */

export interface CockpitTx {
  date: string;
  description: string;
  amount: number;
  currency: string;
  tag: string | null;
}

export interface CockpitAccount {
  id: string;
  name: string;
  group: string;
  groupLabel: string;
  type: 'cash' | 'bank';
  currency: string;
  balance: number;
  openingBalance: number;
  low: boolean;
  transactions: CockpitTx[];
}

export interface CockpitContact {
  id: string;
  name: string;
  role: 'customer' | 'supplier' | 'other';
  balance: number;
  overdueDays: number;
  overdueInvoices: number;
  lastActivity: string | null;
  tag: string;
  tone: 'good' | 'warn' | 'bad';
  invoices: Array<{ number: string; dueDate: string | null; amount: number }>;
}

export interface CockpitDue {
  title: string;
  dueDate: string;
  daysLeft: number;
  amount: number;
  source: 'invoice' | 'expense' | 'cheque';
  overdue: boolean;
}

export interface CockpitCheque {
  id: string;
  no: string;
  kind: 'cheque' | 'promissory';
  direction: 'incoming' | 'outgoing';
  party: string;
  bank: string;
  dueDate: string | null;
  daysLeft: number | null;
  amount: number;
  currency: string;
  status: string;
}

export interface CockpitStockItem {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  value: number;
  critical: boolean;
}

export interface CockpitStockMove {
  date: string;
  name: string;
  where: string;
  quantity: number;
  unit: string;
}

export interface CockpitApproval {
  id: string;
  requestType: string;
  title: string;
  summary: string | null;
  amount: number;
  requestedBy: string | null;
  createdAt: string;
  dueAt: string | null;
}

export interface CockpitAlert {
  key: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'bad';
  link: string;
  amount: number | null;
}

export interface CockpitPayload {
  generatedAt: string;
  currency: string;
  sections: { live: string[]; demo: string[] };
  kpis: {
    cash: { total: number; cash: number; bank: number; accounts: number };
    month: { revenue: number; expense: number; net: number };
    overdue: { amount: number; count: number; maxDays: number };
    approvals: { count: number; amount: number };
  };
  accounts: CockpitAccount[];
  contacts: CockpitContact[];
  cashflow: {
    basis: 'actual' | 'forecast' | 'none';
    label: string;
    weeks: Array<{ label: string; inflow: number; outflow: number }>;
  };
  dues: CockpitDue[];
  cheques: CockpitCheque[];
  stock: {
    items: CockpitStockItem[];
    critical: CockpitStockItem[];
    movements: CockpitStockMove[];
    totalValue: number;
    productCount: number;
  };
  approvals: CockpitApproval[];
  approvalsEditable: boolean;
  alerts: CockpitAlert[];
  finance: {
    cash: CockpitTx[];
    current: CockpitTx[];
    cheque: CockpitTx[];
    expense: CockpitTx[];
  };
  banks: Array<{ id: string; name: string; transactions: CockpitTx[] }>;
  suppliers: Array<{ name: string; amount: number; share: number; nextDue: string | null }>;
  fx: Array<{ code: string; rate: number; date: string }>;
  /** Şantiyeler (saha kayıtları) — `sites` tablosu. */
  sites: CockpitSite[];
  /** Şantiye başına MGM (Meteoroloji) tahmini. */
  weather: CockpitWeather[];
}

export interface CockpitSite {
  id: string;
  name: string;
  province: string;
  district: string | null;
  status: string;
  statusLabel: string;
}

export interface CockpitWeatherDay {
  date: string;
  label: string;
  min: number | null;
  max: number | null;
  condition: string;
  conditionLabel: string;
  windKph: number | null;
  windDirShort: string;
}

export interface CockpitWeather {
  siteId: string;
  siteName: string;
  province: string;
  district: string | null;
  status: 'ok' | 'unresolved' | 'unavailable';
  message: string | null;
  station: { il: string; ilce: string | null; merkezId: number | null } | null;
  updatedAt: string | null;
  temp: number | null;
  feelsLike: number | null;
  humidity: number | null;
  condition: string;
  conditionLabel: string;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  windDirShort: string;
  windDirLong: string;
  windRisk: 'ok' | 'limit' | 'stop';
  daily: CockpitWeatherDay[];
}

export const useCockpitStore = defineStore('cockpit', () => {
  const payload = ref<CockpitPayload | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Son başarılı yükleme zamanı (başlıkta "güncellendi" bilgisi için). */
  const loadedAt = ref<string | null>(null);

  const errorMessage = (err: unknown, fallback: string): string =>
    (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;

  /** Kokpit verisini çeker; hata durumunda `payload` eski haliyle kalır. */
  async function load(): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get<CockpitPayload>('/v1/management/cockpit');
      payload.value = response.data;
      loadedAt.value = new Date().toISOString();
      return true;
    } catch (err) {
      error.value = errorMessage(err, 'Kokpit verisi yüklenemedi');
      return false;
    } finally {
      loading.value = false;
    }
  }

  return { payload, loading, error, loadedAt, load };
});
