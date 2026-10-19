import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

export type ChequeStatus = 'portfolio' | 'endorsed' | 'collected' | 'bounced' | 'cancelled';
export type ChequeHolder = 'own' | 'bank' | 'pledged' | 'customer' | 'supplier';
export type ChequeTransactionType =
  | 'created'
  | 'endorsed'
  | 'collected'
  | 'bounced'
  | 'cancelled'
  | 'note'
  | 'deposited'
  | 'pledged'
  | 'released';

export interface Cheque {
  id: string;
  chequeType: 'cheque' | 'promissory';
  direction: 'incoming' | 'outgoing';
  serialNo?: string | null;
  chequeNo: string;
  bankName?: string | null;
  drawerName: string;
  endorserName?: string | null;
  issueDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: ChequeStatus;
  portfolioHolder: ChequeHolder;
  description?: string | null;
  cancelledReason?: string | null;
}

export interface PortfolioSummaryRow {
  holder: string;
  status: string;
  count: number;
  totalAmount: number;
}

export interface DueCalendarRow {
  id: string;
  chequeType: 'cheque' | 'promissory';
  direction: 'incoming' | 'outgoing';
  chequeNo: string;
  serialNo?: string | null;
  drawerName: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: ChequeStatus;
  portfolioHolder: ChequeHolder;
}

export interface ChequeTransaction {
  id: string;
  chequeId: string;
  transactionType: ChequeTransactionType;
  fromStatus: string | null;
  toStatus: string;
  transactionDate: string;
  amount: number | null;
  partyName: string | null;
  journalEntryId: string | null;
  description: string | null;
  createdAt: string;
}

export interface CreateChequeInput {
  cheque_type?: 'cheque' | 'promissory';
  direction: 'incoming' | 'outgoing';
  cheque_no: string;
  bank_name?: string;
  drawer_name: string;
  issue_date: string;
  due_date: string;
  amount: number;
  currency?: string;
  portfolio_holder?: ChequeHolder;
  description?: string;
}

export const useChequeStore = defineStore('cheque', () => {
  const cheques = ref<Cheque[]>([]);
  const portfolioSummary = ref<PortfolioSummaryRow[]>([]);
  const dueCalendar = ref<DueCalendarRow[]>([]);
  const transactions = ref<ChequeTransaction[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const fetchCheques = async (params: Record<string, unknown> = {}) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/cheques', { params });
      cheques.value = response.data.items ?? response.data.data ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Çekler yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const createCheque = async (input: CreateChequeInput) => {
    const response = await api.post('/v1/cheques', input);
    return response.data as Cheque;
  };

  const endorseCheque = async (
    id: string,
    input: {
      to_holder: ChequeHolder;
      party_name: string;
      transaction_date: string;
      description?: string;
    },
  ) => {
    await api.post(`/v1/cheques/${id}/endorse`, input);
  };

  const collectCheque = async (
    id: string,
    input: {
      cash_bank_account_id: string;
      transaction_date: string;
      amount?: number;
      description?: string;
    },
  ) => {
    await api.post(`/v1/cheques/${id}/collect`, input);
  };

  /** Tahsile ver: alınan, portföydeki, yeri own olan çek → yeri bank olur. */
  const depositCheque = async (
    id: string,
    input: {
      cash_bank_account_id: string;
      transaction_date: string;
      description?: string;
    },
  ) => {
    await api.post(`/v1/cheques/${id}/deposit`, input);
  };

  /** Teminata ver: alınan, portföydeki, yeri own olan çek → yeri pledged olur. */
  const pledgeCheque = async (
    id: string,
    input: {
      party_name: string;
      transaction_date: string;
      description?: string;
    },
  ) => {
    await api.post(`/v1/cheques/${id}/pledge`, input);
  };

  /** Portföye geri al: alınan, portföydeki, yeri bank veya pledged olan çek → yeri own olur. */
  const releaseCheque = async (
    id: string,
    input: {
      transaction_date: string;
      description?: string;
    },
  ) => {
    await api.post(`/v1/cheques/${id}/release`, input);
  };

  const bounceCheque = async (id: string, input: { transaction_date: string; reason: string }) => {
    await api.post(`/v1/cheques/${id}/bounce`, input);
  };

  const cancelCheque = async (id: string, input: { reason: string }) => {
    await api.post(`/v1/cheques/${id}/cancel`, input);
  };

  const fetchPortfolioSummary = async () => {
    error.value = null;
    try {
      const response = await api.get('/v1/cheques/portfolio/summary');
      portfolioSummary.value = response.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Portföy özeti yüklenemedi');
    }
  };

  /** Vade takvimi: portföydeki yaklaşan vadeler (backend dueCalendar — Faz 6.6). */
  const fetchDueCalendar = async (days = 30) => {
    error.value = null;
    try {
      const response = await api.get('/v1/cheques/portfolio/due-calendar', {
        params: { days },
      });
      dueCalendar.value = response.data ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Vade takvimi yüklenemedi');
    }
  };

  /** Çekin durum geçmişi (cheque_transactions — Faz 6.6). */
  const fetchTransactions = async (chequeId: string) => {
    error.value = null;
    try {
      const response = await api.get(`/v1/cheques/${chequeId}/transactions`, {
        params: { limit: 50 },
      });
      transactions.value = response.data.items ?? response.data.data ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Durum geçmişi yüklenemedi');
    }
  };

  return {
    cheques,
    portfolioSummary,
    dueCalendar,
    transactions,
    loading,
    error,
    fetchCheques,
    createCheque,
    endorseCheque,
    collectCheque,
    depositCheque,
    pledgeCheque,
    releaseCheque,
    bounceCheque,
    cancelCheque,
    fetchPortfolioSummary,
    fetchDueCalendar,
    fetchTransactions,
  };
});
