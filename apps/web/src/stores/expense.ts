import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hatasından kullanıcı mesajı çıkarır. API şekli: { error: { code, message } }. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ message?: string; error?: { message?: string } }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

/** Kategori adı → kod: "Yiyecek & İçecek" → "YIYECEK_ICECEK" (Türkçe karaktersiz). */
function autoCategoryCode(name: string): string {
  const tr: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Ç: 'C',
    Ğ: 'G',
    İ: 'I',
    Ö: 'O',
    Ş: 'S',
    Ü: 'U',
  };
  return name
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => tr[ch] ?? ch)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description?: string;
  /** Görsel gruplama anahtarı (kira, kamu-hizmetleri, isletme, personel, mevzuat, finansal). */
  grup?: string | null;
  /** Öne çıkan (sık kullanılan) kategori mi? */
  is_favorite?: boolean;
  status: 'active' | 'inactive';
  /** Bağlı muhasebe hesabı (6xx/7xx). Null ise ilk fişte 770 altında otomatik açılır. */
  account_id?: string | null;
  /** Salt okunur: bağlı hesabın kodu ve adı (listede/okumada gelir). */
  account_code?: string | null;
  account_name?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Hesap seçici için muhasebe hesabı (GET /v1/accounting, only_posting=true). */
export interface PostingAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}

/** Gider kategorisi grupları — kullanıcıya gösterilecek sıra ve etiketler. */
export const EXPENSE_GROUPS: { key: string; label: string; hint: string }[] = [
  { key: 'kira', label: 'Kira', hint: 'İşyeri / depo kirası' },
  { key: 'kamu-hizmetleri', label: 'Kamu Hizmetleri', hint: 'Elektrik, su, ısınma' },
  { key: 'isletme', label: 'İşletme Giderleri', hint: 'Bakım, demirbaş, yemek, telekom' },
  { key: 'personel', label: 'Personel', hint: 'İşçilik ve çalışan giderleri' },
  { key: 'mevzuat', label: 'Hukuk ve Resmi İşlemler', hint: 'Noter, mahkeme' },
  { key: 'finansal', label: 'Vergi ve Resmi Giderler', hint: 'Vergi, harç, resmi' },
];

export interface CreateCategoryInput {
  code?: string;
  name: string;
  description?: string;
  grup?: string | null;
  is_favorite?: boolean;
  status?: 'active' | 'inactive';
  /** null = otomatik (770 altında). */
  account_id?: string | null;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

/** Peşin giderin ödeme kaynağı türü: kasa/banka hesabı ya da şirket kredi kartı. */
export type PaymentSourceType = 'cash_bank' | 'credit_card';

export interface Expense {
  id: string;
  invoice_number?: string;
  invoice_date?: string;
  expense_date: string;
  category_id: string;
  contact_id?: string | null;
  description: string;
  /** KDV dahil toplam. Sunucu: amount = net_amount + tax_amount. */
  amount: number;
  /** Matrah (KDV hariç). */
  net_amount?: number;
  /** KDV oranı (%): 0, 1, 10, 20. */
  tax_rate?: number;
  /** KDV tutarı (sunucu hesaplar). */
  tax_amount?: number;
  /** Peşin gider: satıcı unvanı (carisiz giderde zorunlu, kesinleşmede). */
  counterparty_name?: string | null;
  /** Peşin gider: satıcı VKN/TCKN (isteğe bağlı). */
  counterparty_tax_number?: string | null;
  /** Peşin gider: ödeme kaynağı türü. */
  payment_source_type?: PaymentSourceType | null;
  /** Peşin gider: ödeme kaynağının kimliği (kasa/banka hesabı ya da kredi kartı). */
  payment_source_id?: string | null;
  currency: string;
  exchange_rate: number;
  base_amount: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  status: 'draft' | 'posted' | 'cancelled';
  notes?: string;
  receipt_file_url?: string;
  category?: ExpenseCategory;
  /** API düz alanları (LEFT JOIN sonucu). */
  category_code?: string;
  category_name?: string;
  contact_name?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Gider ödemesi gövdesi — POST /v1/expenses/:id/payments.
 * Yalnız carili ve kesinleşmiş gider; ödeme kalan borcu aşamaz (sunucu doğrular).
 */
export interface ExpensePaymentInput {
  amount: number;
  cash_bank_account_id: string;
  payment_date?: string;
  currency?: string;
  reference?: string;
  notes?: string;
}

export const useExpenseStore = defineStore('expense', () => {
  const categories = ref<ExpenseCategory[]>([]);
  /** Hesap seçici için 6xx/7xx detay hesapları. */
  const postingAccounts = ref<PostingAccount[]>([]);
  /** false ise (403: muhasebe yetkisi/modülü yok ya da hata) hesap seçici gizlenir. */
  const postingAccountsAvailable = ref(false);
  const expenses = ref<Expense[]>([]);
  const currentExpense = ref<Expense | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const filters = ref({
    page: 1,
    limit: 20,
    category_id: undefined as string | undefined,
    status: undefined as 'draft' | 'posted' | 'cancelled' | undefined,
    payment_status: undefined as 'unpaid' | 'partial' | 'paid' | undefined,
    expense_date_from: undefined as string | undefined,
    expense_date_to: undefined as string | undefined,
    q: undefined as string | undefined,
    sortBy: 'expense_date' as
      'date' | 'invoice_number' | 'expense_date' | 'amount' | 'status' | 'createdAt',
    sortOrder: 'desc' as 'asc' | 'desc',
  });

  const fetchCategories = async () => {
    try {
      const response = await api.get('/v1/expenses/categories');
      categories.value = response.data;
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  /**
   * Gider kategorisi hesap seçimi için yazılabilir (detay) muhasebe hesaplarını çeker.
   * Liste kod sırasıyla ve sayfa başına en fazla 100 kayıt döner; 6xx/7xx hesapların
   * ilk sayfada olmayabileceği için sayfalanır. Hata durumunda `error` ref'i değiştirilmez
   * (kategori sayfasındaki uyarı alanı yalnızca kategori hatalarını gösterir).
   */
  const fetchPostingAccounts = async () => {
    const MAX_PAGES = 30;
    const collected: PostingAccount[] = [];
    try {
      let page = 1;
      let totalPages = 1;
      do {
        const response = await api.get('/v1/accounting', {
          params: { only_posting: true, limit: 100, page },
        });
        collected.push(...((response.data.items ?? []) as PostingAccount[]));
        totalPages = Number(response.data.totalPages ?? 1);
        page += 1;
      } while (page <= totalPages && page <= MAX_PAGES);
      postingAccounts.value = collected.filter((a) => /^[67]/.test(a.code));
      postingAccountsAvailable.value = true;
    } catch {
      postingAccounts.value = [];
      postingAccountsAvailable.value = false;
    }
  };

  /** Sık kullanılan (öne çıkan) kategoriler — hızlı seçim kutucukları için. */
  const favoriteCategories = computed(() =>
    categories.value.filter((c) => c.is_favorite && c.status === 'active'),
  );

  /** Kategoriyi gruba göre döndürür (grup tanım sırasına göre). */
  const categoriesByGroup = computed(() =>
    EXPENSE_GROUPS.map((g) => ({
      ...g,
      items: categories.value.filter((c) => c.grup === g.key && c.status === 'active'),
    })).filter((g) => g.items.length > 0),
  );

  const categoryById = (id: string) => categories.value.find((c) => c.id === id) ?? null;

  /** Yeni kategori — kod verilmezse isimden otomatik üretilir. */
  const createCategory = async (input: CreateCategoryInput) => {
    error.value = null;
    try {
      const payload = {
        ...input,
        code: input.code?.trim() || autoCategoryCode(input.name),
      };
      const response = await api.post('/v1/expenses/categories', payload);
      const created = response.data as ExpenseCategory;
      categories.value.push(created);
      return created;
    } catch (err) {
      error.value = errorMessage(err, 'Kategori oluşturulamadı');
      throw err;
    }
  };

  const updateCategory = async (id: string, input: UpdateCategoryInput) => {
    error.value = null;
    try {
      const response = await api.patch(`/v1/expenses/categories/${id}`, input);
      const updated = response.data as ExpenseCategory;
      const index = categories.value.findIndex((c) => c.id === id);
      if (index !== -1) categories.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = errorMessage(err, 'Kategori güncellenemedi');
      throw err;
    }
  };

  const deleteCategory = async (id: string) => {
    error.value = null;
    try {
      await api.delete(`/v1/expenses/categories/${id}`);
      categories.value = categories.value.filter((c) => c.id !== id);
    } catch (err) {
      error.value = errorMessage(err, 'Kategori silinemedi');
      throw err;
    }
  };

  const toggleFavorite = (id: string) => {
    const cat = categoryById(id);
    if (!cat) return Promise.reject(new Error('Kategori bulunamadı'));
    return updateCategory(id, { is_favorite: !cat.is_favorite });
  };

  const fetchExpenses = async () => {
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      Object.entries(filters.value).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });

      const response = await api.get(`/v1/expenses?${params.toString()}`);
      expenses.value = response.data.items;
      pagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total,
        pages: response.data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Failed to fetch expenses');
    } finally {
      loading.value = false;
    }
  };

  const getExpenseById = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get(`/v1/expenses/${id}`);
      currentExpense.value = response.data;
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to fetch expense');
      return null;
    } finally {
      loading.value = false;
    }
  };

  const createExpense = async (expenseData: Partial<Expense>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post('/v1/expenses', expenseData);
      expenses.value.unshift(response.data);
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to create expense');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const updateExpense = async (id: string, expenseData: Partial<Expense>) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.patch(`/v1/expenses/${id}`, expenseData);
      const index = expenses.value.findIndex((e) => e.id === id);
      if (index !== -1) {
        expenses.value[index] = response.data;
      }
      if (currentExpense.value?.id === id) {
        currentExpense.value = response.data;
      }
      return response.data;
    } catch (err) {
      error.value = errorMessage(err, 'Failed to update expense');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const deleteExpense = async (id: string) => {
    loading.value = true;
    error.value = null;
    try {
      await api.delete(`/v1/expenses/${id}`);
      expenses.value = expenses.value.filter((e) => e.id !== id);
      if (currentExpense.value?.id === id) {
        currentExpense.value = null;
      }
    } catch (err) {
      error.value = errorMessage(err, 'Failed to delete expense');
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Gider ödemesi kaydeder (carili ve kesinleşmiş gider). Hata store `error`'una yazılmaz:
   * liste ekranı `error` doluyken tabloyu gizlediği için çağıran ekran mesajı kendi gösterir.
   */
  const createExpensePayment = async (expenseId: string, input: ExpensePaymentInput) => {
    try {
      const response = await api.post(`/v1/expenses/${expenseId}/payments`, input);
      return response.data;
    } catch (err) {
      throw new Error(errorMessage(err, 'Ödeme kaydedilemedi'));
    }
  };

  return {
    categories,
    postingAccounts,
    postingAccountsAvailable,
    expenses,
    currentExpense,
    loading,
    error,
    pagination,
    filters,
    favoriteCategories,
    categoriesByGroup,
    categoryById,
    fetchCategories,
    fetchPostingAccounts,
    createCategory,
    updateCategory,
    deleteCategory,
    toggleFavorite,
    fetchExpenses,
    getExpenseById,
    createExpense,
    updateExpense,
    deleteExpense,
    createExpensePayment,
  };
});
