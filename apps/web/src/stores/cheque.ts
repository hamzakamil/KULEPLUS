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
export type ChequeHolder = 'own' | 'bank' | 'customer' | 'supplier';

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

  return {
    cheques,
    portfolioSummary,
    loading,
    error,
    fetchCheques,
    createCheque,
    endorseCheque,
    collectCheque,
    bounceCheque,
    cancelCheque,
    fetchPortfolioSummary,
  };
});
