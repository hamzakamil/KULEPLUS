import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** API hatasından kullanıcı mesajı çıkarır. */
function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
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
  createdAt: Date;
  updatedAt: Date;
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
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export interface Expense {
  id: string;
  invoice_number?: string;
  invoice_date?: string;
  expense_date: string;
  category_id: string;
  contact_id?: string;
  description: string;
  amount: number;
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

export const useExpenseStore = defineStore('expense', () => {
  const categories = ref<ExpenseCategory[]>([]);
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

  return {
    categories,
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
    createCategory,
    updateCategory,
    deleteCategory,
    toggleFavorite,
    fetchExpenses,
    getExpenseById,
    createExpense,
    updateExpense,
    deleteExpense,
  };
});
