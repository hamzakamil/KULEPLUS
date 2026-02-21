import { defineStore } from 'pinia';
import { ref } from 'vue';
import { accountApi } from '../services/api';
import type { Account } from '../types';

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([]);
  const accountTree = ref<Account[]>([]);
  const currentAccount = ref<Account | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAccounts(filter?: Record<string, string>) {
    loading.value = true;
    error.value = null;
    try {
      const res = await accountApi.getAll(filter);
      accounts.value = res.data.data || [];
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesaplar yüklenemedi';
    } finally {
      loading.value = false;
    }
  }

  async function fetchAccountTree() {
    loading.value = true;
    try {
      const res = await accountApi.getTree();
      accountTree.value = res.data.data || [];
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesap ağacı yüklenemedi';
    } finally {
      loading.value = false;
    }
  }

  async function fetchAccountByKod(kod: string) {
    loading.value = true;
    try {
      const res = await accountApi.getByKod(kod);
      currentAccount.value = res.data.data || null;
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesap bulunamadı';
    } finally {
      loading.value = false;
    }
  }

  async function searchAccounts(query: string): Promise<Account[]> {
    try {
      const res = await accountApi.search(query);
      return res.data.data || [];
    } catch {
      return [];
    }
  }

  async function createAccount(data: Partial<Account>) {
    loading.value = true;
    try {
      const res = await accountApi.create(data as Record<string, unknown>);
      await fetchAccounts();
      return res.data.data;
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesap oluşturulamadı';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function updateAccount(kod: string, data: Partial<Account>) {
    loading.value = true;
    try {
      const res = await accountApi.update(kod, data as Record<string, unknown>);
      await fetchAccounts();
      return res.data.data;
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesap güncellenemedi';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function deleteAccount(kod: string) {
    loading.value = true;
    try {
      await accountApi.delete(kod);
      await fetchAccounts();
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Hesap silinemedi';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    accounts, accountTree, currentAccount, loading, error,
    fetchAccounts, fetchAccountTree, fetchAccountByKod, searchAccounts,
    createAccount, updateAccount, deleteAccount,
  };
});
