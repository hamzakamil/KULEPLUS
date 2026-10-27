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

export type CardTransactionType = 'purchase' | 'payment' | 'refund' | 'fee' | 'interest';

/** Kredi kartı hareketi — POST/GET /v1/cash-bank/bank/credit-cards/:id/transactions. */
export interface CreditCardTransaction {
  id: string;
  creditCardId: string;
  transactionDate: string;
  transactionType: CardTransactionType;
  description: string;
  amount: number;
  installmentCount: number;
  reference?: string | null;
  createdAt?: string;
}

/** Banka kredisi taksiti — GET /v1/cash-bank/bank/loans/:id/installments. */
export interface BankLoanInstallment {
  id: string;
  bankLoanId: string;
  installmentNo: number;
  dueDate: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  paidAmount: number;
  paidAt?: string | null;
  status: 'pending' | 'paid' | 'overdue';
}

export interface LoanInstallmentSummary {
  total: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  paidAmount: number;
  remainingAmount: number;
  nextDueDate: string | null;
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

/** Döviz kuru satırı — GET /v1/cash-bank/exchange-rates dönüşü. */
export interface ExchangeRateItem {
  id: string;
  rateDate: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  source: string;
  createdAt: string;
}

/** Her para birimi için en son kur — GET /v1/cash-bank/exchange-rates/latest dönüşü. */
export interface LatestRateRow {
  currency: string;
  rate: number;
  rateDate: string;
  source: string;
}

/** Dönem sonu değerleme satırı — POST /v1/cash-bank/exchange-rates/revalue dönüşü. */
export interface RevaluationEntry {
  accountId: string;
  accountName: string;
  currency: string;
  accountType?: string;
  rateDate: string;
  foreignPosition: number;
  currentBaseValue: number;
  newBaseValue: number;
  diff: number;
  rateAvailable: boolean;
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

  // ---- Kart hareketleri ----
  const cardTransactions = ref<CreditCardTransaction[]>([]);
  const cardTransactionTotals = ref({ debit: 0, credit: 0 });
  const cardTransactionPagination = ref({ page: 1, limit: 50, total: 0, pages: 0 });

  const fetchCardTransactions = async (
    cardId: string,
    params?: { page?: number; limit?: number; transactionType?: CardTransactionType },
  ) => {
    try {
      const qs = new URLSearchParams();
      qs.append('page', String(params?.page ?? 1));
      qs.append('limit', String(params?.limit ?? 50));
      if (params?.transactionType) qs.append('transactionType', params.transactionType);
      const response = await api.get(
        `/v1/cash-bank/bank/credit-cards/${cardId}/transactions?${qs.toString()}`,
      );
      cardTransactions.value = response.data.items ?? [];
      cardTransactionTotals.value = response.data.totals ?? { debit: 0, credit: 0 };
      cardTransactionPagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        pages: response.data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Kart hareketleri yüklenemedi');
    }
  };

  const createCardTransaction = async (
    cardId: string,
    data: {
      transactionDate: string;
      transactionType: CardTransactionType;
      description: string;
      amount: number;
      installmentCount?: number;
      reference?: string;
    },
  ) => {
    const response = await api.post(
      `/v1/cash-bank/bank/credit-cards/${cardId}/transactions`,
      data,
    );
    await fetchCreditCards();
    return response.data;
  };

  const deleteCardTransaction = async (cardId: string, transactionId: string) => {
    await api.delete(`/v1/cash-bank/bank/credit-cards/${cardId}/transactions/${transactionId}`);
    await fetchCreditCards();
    await fetchCardTransactions(cardId);
  };

  // ---- Kredi taksit planı ----
  const loanInstallments = ref<BankLoanInstallment[]>([]);
  const loanInstallmentSummary = ref<LoanInstallmentSummary>({
    total: 0,
    paidCount: 0,
    pendingCount: 0,
    overdueCount: 0,
    paidAmount: 0,
    remainingAmount: 0,
    nextDueDate: null,
  });

  const applyInstallmentPlan = (data: {
    items?: BankLoanInstallment[];
    summary?: LoanInstallmentSummary;
  }) => {
    loanInstallments.value = data.items ?? [];
    if (data.summary) loanInstallmentSummary.value = data.summary;
  };

  const fetchLoanInstallments = async (loanId: string) => {
    try {
      const response = await api.get(`/v1/cash-bank/bank/loans/${loanId}/installments`);
      applyInstallmentPlan(response.data);
    } catch (err) {
      error.value = errorMessage(err, 'Ödeme planı yüklenemedi');
    }
  };

  const generateLoanInstallments = async (loanId: string) => {
    const response = await api.post(`/v1/cash-bank/bank/loans/${loanId}/installments/generate`);
    applyInstallmentPlan(response.data);
    await fetchBankLoans();
    return response.data;
  };

  const payLoanInstallment = async (loanId: string, installmentId: string, paidDate?: string) => {
    const response = await api.post(
      `/v1/cash-bank/bank/loans/${loanId}/installments/${installmentId}/pay`,
      paidDate ? { paidDate } : {},
    );
    applyInstallmentPlan(response.data);
    await fetchBankLoans();
    return response.data;
  };

  const unpayLoanInstallment = async (loanId: string, installmentId: string) => {
    const response = await api.delete(
      `/v1/cash-bank/bank/loans/${loanId}/installments/${installmentId}/pay`,
    );
    applyInstallmentPlan(response.data);
    await fetchBankLoans();
    return response.data;
  };

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

  // ================= Döviz Kurları (Faz 6.2) =================
  const latestRates = ref<LatestRateRow[]>([]);
  const latestAsOf = ref<string | null>(null);
  const exchangeRates = ref<ExchangeRateItem[]>([]);
  const exchangeRatePagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const revaluationEntries = ref<RevaluationEntry[]>([]);
/** Dönem sonu değerleme kapanış fişi (book edildiyse) — Faz 6.6. */
const revaluationJournalId = ref<string | null>(null);
const revaluationJournalNo = ref<number | null>(null);
  const revaluationTotalDiff = ref(0);
  const ratesLoading = ref(false);
  const ratesError = ref<string | null>(null);

  const fetchLatestRates = async () => {
    ratesLoading.value = true;
    ratesError.value = null;
    try {
      const response = await api.get('/v1/cash-bank/exchange-rates/latest');
      latestRates.value = response.data.items ?? [];
      latestAsOf.value = response.data.asOf ?? null;
    } catch (err) {
      ratesError.value = errorMessage(err, 'Güncel kurlar yüklenemedi');
    } finally {
      ratesLoading.value = false;
    }
  };

  const fetchExchangeRates = async (params?: { page?: number; limit?: number }) => {
    ratesLoading.value = true;
    ratesError.value = null;
    try {
      const qs = new URLSearchParams();
      if (params?.page) qs.append('page', String(params.page));
      qs.append('limit', String(params?.limit ?? 20));
      const response = await api.get(`/v1/cash-bank/exchange-rates?${qs.toString()}`);
      exchangeRates.value = response.data.items ?? [];
      exchangeRatePagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        pages: response.data.totalPages,
      };
    } catch (err) {
      ratesError.value = errorMessage(err, 'Kur geçmişi yüklenemedi');
    } finally {
      ratesLoading.value = false;
    }
  };

  const importExchangeRates = async (rateDate?: string) => {
    ratesLoading.value = true;
    ratesError.value = null;
    try {
      const response = await api.post(
        '/v1/cash-bank/exchange-rates/import',
        rateDate ? { rateDate } : {},
      );
      await fetchLatestRates();
      await fetchExchangeRates();
      return response.data as { count: number; inserted: number; updated: number };
    } catch (err) {
      ratesError.value = errorMessage(err, 'Kurlar içe aktarılamadı');
      throw err;
    } finally {
      ratesLoading.value = false;
    }
  };

  const runRevaluation = async (valuationDate?: string) => {
    ratesLoading.value = true;
    ratesError.value = null;
    try {
      const response = await api.post(
        '/v1/cash-bank/exchange-rates/revalue',
        valuationDate ? { valuationDate } : {},
      );
      revaluationEntries.value = response.data.entries ?? [];
      revaluationTotalDiff.value = response.data.totalDiff ?? 0;
      return response.data as { entries: RevaluationEntry[]; totalDiff: number };
    } catch (err) {
      ratesError.value = errorMessage(err, 'Değerleme yapılamadı');
      throw err;
    } finally {
      ratesLoading.value = false;
    }
  };

  /**
   * Dönem sonu değerleme + KAPANIŞ FİŞİ (Faz 6.6).
   * POST /v1/cash-bank/exchange-rates/revalue/book — 646/656 hesabına dengeli
   * `mahsup` yevmiye fişi yazar; aynı tarih için idempotenttir.
   */
  const bookRevaluation = async (valuationDate?: string) => {
    ratesLoading.value = true;
    ratesError.value = null;
    try {
      const response = await api.post(
        '/v1/cash-bank/exchange-rates/revalue/book',
        valuationDate ? { valuationDate } : {},
      );
      revaluationEntries.value = response.data.entries ?? [];
      revaluationTotalDiff.value = response.data.totalDiff ?? 0;
      revaluationJournalId.value = response.data.journalEntryId ?? null;
      revaluationJournalNo.value = response.data.entryNo ?? null;
      return response.data as {
        entries: RevaluationEntry[];
        totalDiff: number;
        journalEntryId: string | null;
        booked: boolean;
        entryNo?: number;
      };
    } catch (err) {
      ratesError.value = errorMessage(err, 'Kapanış fişi oluşturulamadı');
      throw err;
    } finally {
      ratesLoading.value = false;
    }
  };


  return {
    accounts,
    currentAccount,
    movements,
    bankLoans,
    creditCards,
    posAccounts,
    cardTransactions,
    cardTransactionTotals,
    cardTransactionPagination,
    loanInstallments,
    loanInstallmentSummary,
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
    fetchCardTransactions,
    createCardTransaction,
    deleteCardTransaction,
    fetchLoanInstallments,
    generateLoanInstallments,
    payLoanInstallment,
    unpayLoanInstallment,
    fetchPosAccounts,
    createPosAccount,
    updatePosAccount,
    deletePosAccount,
    // Döviz kurları (Faz 6.2)
    latestRates,
    latestAsOf,
    exchangeRates,
    exchangeRatePagination,
    revaluationEntries,
    revaluationTotalDiff,
    revaluationJournalId,
    revaluationJournalNo,
    ratesLoading,
    ratesError,
    fetchLatestRates,
    fetchExchangeRates,
    importExchangeRates,
    runRevaluation,
    bookRevaluation,
  };
});
