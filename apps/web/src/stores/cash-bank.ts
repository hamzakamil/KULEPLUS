import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hatasından kullanıcı mesajı çıkarır. */
function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
}

export interface CashBankAccount {
  id: string;
  accountType: 'cash' | 'bank';
  accountName: string;
  accountNumber?: string;
  currency: string;
  description?: string;
  balance: number;
  status: 'active' | 'inactive';
  openingBalance: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashBankMovement {
  id: string;
  accountId: string;
  accountName?: string;
  targetAccountId?: string;
  targetAccountName?: string;
  movementType: 'deposit' | 'withdrawal' | 'transfer';
  transactionDate: string;
  amount: number;
  currency: string;
  reference?: string;
  description?: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt?: string;
}

export interface DepositInput {
  accountId: string;
  transactionDate: string;
  amount: number;
  currency?: string;
  reference?: string;
  description?: string;
}

export type WithdrawalInput = DepositInput;

export interface TransferInput {
  sourceAccountId: string;
  targetAccountId: string;
  transactionDate: string;
  amount: number;
  currency?: string;
  reference?: string;
  description?: string;
}

/** Banka kredisi (banka hesabına bağlı). */
export interface BankLoan {
  id: string;
  bankAccountId?: string;
  bankAccountName?: string;
  loanNumber?: string | null;
  loanType: 'term' | 'revolving' | 'overdraft' | 'mortgage';
  principal: number;
  interestRate: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentAmount: number;
  remainingBalance: number;
  startDate: string;
  endDate?: string | null;
  currency: string;
  status: 'active' | 'closed' | 'overdue';
  description?: string | null;
}

/** Kredi kartı (ödemeler için; banka hesabına bağlı). */
export interface CreditCard {
  id: string;
  bankAccountId?: string;
  bankAccountName?: string;
  cardLabel: string;
  cardNumberLast4?: string | null;
  cardNetwork?: 'visa' | 'mastercard' | 'troy' | 'amex' | 'other' | null;
  creditLimit: number;
  currentDebt: number;
  availableLimit: number;
  statementDay?: number | null;
  dueDay?: number | null;
  currency: string;
  status: 'active' | 'blocked' | 'closed';
  description?: string | null;
}

/** POS hesabı (kredi kartı ile tahsilat için; banka hesabına bağlı). */
export interface PosAccount {
  id: string;
  bankAccountId?: string;
  bankAccountName?: string;
  posLabel: string;
  terminalId?: string | null;
  merchantNumber?: string | null;
  commissionRate: number;
  installmentSupported: boolean;
  currency: string;
  status: 'active' | 'inactive' | 'closed';
  description?: string | null;
}

export const useCashBankStore = defineStore('cash-bank', () => {
  const accounts = ref<CashBankAccount[]>([]);
  const currentAccount = ref<CashBankAccount | null>(null);
  const movements = ref<CashBankMovement[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const movementPagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const filters = ref({
    page: 1,
    limit: 20,
    accountType: undefined as 'cash' | 'bank' | undefined,
    status: undefined as 'active' | 'inactive' | undefined,
    currency: undefined as string | undefined,
    search: undefined as string | undefined,
    sortBy: 'createdAt' as 'number' | 'accountName' | 'balance' | 'createdAt' | 'status',
    sortOrder: 'desc' as 'asc' | 'desc',
  });
  const movementFilters = ref({
    page: 1,
    limit: 20,
    accountId: undefined as string | undefined,
    movementType: undefined as 'deposit' | 'withdrawal' | 'transfer' | undefined,
    currency: undefined as string | undefined,
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
    search: undefined as string | undefined,
    sortBy: 'date' as 'date' | 'reference' | 'amount' | 'type' | 'createdAt',
    sortOrder: 'desc' as 'asc' | 'desc',
  });

  const fetchAccounts = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });

      const response = await api.get(`/v1/cash-bank?${params.toString()}`);
      accounts.value = response.data.items;
      pagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        pages: response.data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Failed to fetch accounts');
    } finally {
      loading.value = false;
    }
  };

  const getAccountById = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/cash-bank/${id}`);
      currentAccount.value = response.data;
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to fetch account');
      return null;
    } finally {
      loading.value = false;
    }
  };

  const createAccount = async (accountData: Partial<CashBankAccount>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/cash-bank', accountData);
      accounts.value = [...accounts.value, response.data];
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to create account');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateAccount = async (id: string, accountData: Partial<CashBankAccount>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/cash-bank/${id}`, accountData);
      const index = accounts.value.findIndex((acc) => acc.id === id);
      if (index !== -1) {
        accounts.value = accounts.value.map((acc, i) => (i === index ? response.data : acc));
      }
      if (currentAccount.value?.id === id) {
        currentAccount.value = response.data;
      }
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to update account');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteAccount = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/cash-bank/${id}`);
      accounts.value = accounts.value.filter((acc) => acc.id !== id);
      if (currentAccount.value?.id === id) {
        currentAccount.value = null;
      }
    } catch (err) {
      error.value = errorMessage(err, 'Failed to delete account');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // ---- Hareketler (movements) ----

  const fetchMovements = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(movementFilters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
      const response = await api.get(`/v1/cash-bank/movements?${params.toString()}`);
      movements.value = response.data.items;
      movementPagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        pages: response.data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Hareketler yüklenemedi');
    } finally {
      loading.value = false;
    }
  };

  const deposit = async (input: DepositInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/cash-bank/movements/deposit', input);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Para yatırma başarısız');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const withdrawal = async (input: WithdrawalInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/cash-bank/movements/withdrawal', input);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Para çekme başarısız');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const transfer = async (input: TransferInput) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/cash-bank/movements/transfer', input);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Transfer başarısız');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const cancelMovement = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/cash-bank/movements/${id}/cancel`);
      movements.value = movements.value.filter((m) => m.id !== id);
    } catch (err) {
      error.value = errorMessage(err, 'Hareket iptal edilemedi');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // ---- Banka alt modülleri: krediler, kredi kartları, POS ----

  const bankLoans = ref<BankLoan[]>([]);
  const creditCards = ref<CreditCard[]>([]);
  const posAccounts = ref<PosAccount[]>([]);

  const fetchBankLoans = async (bankAccountId?: string) => {
    try {
      const qs = bankAccountId ? `?bankAccountId=${bankAccountId}` : '';
      const response = await api.get(`/v1/cash-bank/bank/loans${qs}`);
      bankLoans.value = response.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Krediler yüklenemedi');
    }
  };

  const createBankLoan = async (data: Partial<BankLoan>) => {
    const response = await api.post('/v1/cash-bank/bank/loans', data);
    bankLoans.value = [response.data, ...bankLoans.value];
    return response.data;
  };

  const updateBankLoan = async (id: string, data: Partial<BankLoan>) => {
    const response = await api.patch(`/v1/cash-bank/bank/loans/${id}`, data);
    bankLoans.value = bankLoans.value.map((l) => (l.id === id ? response.data : l));
    return response.data;
  };

  const deleteBankLoan = async (id: string) => {
    await api.delete(`/v1/cash-bank/bank/loans/${id}`);
    bankLoans.value = bankLoans.value.filter((l) => l.id !== id);
  };

  const fetchCreditCards = async (bankAccountId?: string) => {
    try {
      const qs = bankAccountId ? `?bankAccountId=${bankAccountId}` : '';
      const response = await api.get(`/v1/cash-bank/bank/credit-cards${qs}`);
      creditCards.value = response.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Kredi kartları yüklenemedi');
    }
  };

  const createCreditCard = async (data: Partial<CreditCard>) => {
    const response = await api.post('/v1/cash-bank/bank/credit-cards', data);
    creditCards.value = [response.data, ...creditCards.value];
    return response.data;
  };

  const updateCreditCard = async (id: string, data: Partial<CreditCard>) => {
    const response = await api.patch(`/v1/cash-bank/bank/credit-cards/${id}`, data);
    creditCards.value = creditCards.value.map((c) => (c.id === id ? response.data : c));
    return response.data;
  };

  const deleteCreditCard = async (id: string) => {
    await api.delete(`/v1/cash-bank/bank/credit-cards/${id}`);
    creditCards.value = creditCards.value.filter((c) => c.id !== id);
  };

  const fetchPosAccounts = async (bankAccountId?: string) => {
    try {
      const qs = bankAccountId ? `?bankAccountId=${bankAccountId}` : '';
      const response = await api.get(`/v1/cash-bank/bank/pos${qs}`);
      posAccounts.value = response.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'POS hesapları yüklenemedi');
    }
  };

  const createPosAccount = async (data: Partial<PosAccount>) => {
    const response = await api.post('/v1/cash-bank/bank/pos', data);
    posAccounts.value = [response.data, ...posAccounts.value];
    return response.data;
  };

  const updatePosAccount = async (id: string, data: Partial<PosAccount>) => {
    const response = await api.patch(`/v1/cash-bank/bank/pos/${id}`, data);
    posAccounts.value = posAccounts.value.map((p) => (p.id === id ? response.data : p));
    return response.data;
  };

  const deletePosAccount = async (id: string) => {
    await api.delete(`/v1/cash-bank/bank/pos/${id}`);
    posAccounts.value = posAccounts.value.filter((p) => p.id !== id);
  };

  return {
    accounts,
    currentAccount,
    movements,
    bankLoans,
    creditCards,
    posAccounts,
    loading,
    error,
    pagination,
    movementPagination,
    filters,
    movementFilters,
    fetchAccounts,
    getAccountById,
    createAccount,
    updateAccount,
    deleteAccount,
    fetchMovements,
    deposit,
    withdrawal,
    transfer,
    cancelMovement,
    fetchBankLoans,
    createBankLoan,
    updateBankLoan,
    deleteBankLoan,
    fetchCreditCards,
    createCreditCard,
    updateCreditCard,
    deleteCreditCard,
    fetchPosAccounts,
    createPosAccount,
    updatePosAccount,
    deletePosAccount,
  };
});
