import { defineStore } from 'pinia';
import { ref } from 'vue';
import { journalApi } from '../services/api';
import type { JournalEntry } from '../types';

export const useJournalStore = defineStore('journal', () => {
  const entries = ref<JournalEntry[]>([]);
  const currentEntry = ref<JournalEntry | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchEntries(filter?: Record<string, string>) {
    loading.value = true;
    error.value = null;
    try {
      const res = await journalApi.getAll(filter);
      entries.value = res.data.data || [];
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Fişler yüklenemedi';
    } finally {
      loading.value = false;
    }
  }

  async function fetchByFisNo(fisNo: string) {
    loading.value = true;
    try {
      const res = await journalApi.getByFisNo(fisNo);
      currentEntry.value = res.data.data || null;
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Fiş bulunamadı';
    } finally {
      loading.value = false;
    }
  }

  async function createEntry(data: Record<string, unknown>) {
    loading.value = true;
    try {
      const res = await journalApi.create(data);
      await fetchEntries();
      return res.data.data;
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Fiş oluşturulamadı';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function approveEntry(fisNo: string) {
    try {
      await journalApi.approve(fisNo);
      await fetchEntries();
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Fiş onaylanamadı';
      throw e;
    }
  }

  async function cancelEntry(fisNo: string) {
    try {
      await journalApi.cancel(fisNo);
      await fetchEntries();
    } catch (e: any) {
      error.value = e.response?.data?.error || 'Fiş iptal edilemedi';
      throw e;
    }
  }

  return {
    entries, currentEntry, loading, error,
    fetchEntries, fetchByFisNo, createEntry, approveEntry, cancelEntry,
  };
});
