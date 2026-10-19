import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface LedgerDrawerOptions {
  from?: string;
  to?: string;
  /** Dışlanacak kaynak türleri (ör. gelir tablosundan açılırken `year_end_result`). */
  excludeSources?: string[];
  /** Başlıkta hesap adı yerine gösterilecek metin. */
  title?: string;
}

function localIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Sağdan açılan tek örnekli "Muavin paneli" durumu. Ekranlar `openAccount` / `openPrefix` ile açar;
 * panelden düzeltme fişi kaydedilince `lastSavedAt` güncellenir — ekranlar bunu izleyip kendi
 * önizleme/raporlarını yeniler.
 */
export const useLedgerDrawerStore = defineStore('ledgerDrawer', () => {
  const open = ref(false);
  const code = ref<string | undefined>(undefined);
  const prefix = ref<string | undefined>(undefined);
  const from = ref('');
  const to = ref('');
  const excludeSources = ref<string[]>([]);
  const title = ref<string | undefined>(undefined);
  /** Panelden fiş kaydedilince `Date.now()` ile güncellenir. */
  const lastSavedAt = ref(0);

  function apply(opts: LedgerDrawerOptions) {
    const today = localIso(new Date());
    const end = opts.to || today;
    from.value = opts.from || `${end.slice(0, 4)}-01-01`;
    to.value = end;
    excludeSources.value = opts.excludeSources ? [...opts.excludeSources] : [];
    title.value = opts.title;
    open.value = true;
  }

  /** Tek hesabın (alt hesaplarıyla) muavinini açar. */
  function openAccount(accountCode: string, opts: LedgerDrawerOptions = {}) {
    code.value = accountCode.trim();
    prefix.value = undefined;
    apply(opts);
  }

  /** Bir ön ekle başlayan tüm hesapların birleşik muavinini açar (ör. `63`). */
  function openPrefix(accountPrefix: string, opts: LedgerDrawerOptions = {}) {
    prefix.value = accountPrefix.trim();
    code.value = undefined;
    apply(opts);
  }

  function close() {
    open.value = false;
  }

  function markSaved() {
    lastSavedAt.value = Date.now();
  }

  return {
    open,
    code,
    prefix,
    from,
    to,
    excludeSources,
    title,
    lastSavedAt,
    openAccount,
    openPrefix,
    close,
    markSaved,
  };
});
