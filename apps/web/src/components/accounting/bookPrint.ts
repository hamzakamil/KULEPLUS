// Resmî defter (Yevmiye Defteri / Defter-i Kebir) yazdırma yardımcıları: biçimleme, sabit satırlı
// sayfalama ve yazdırma kapsamı (body sınıfı + @page). Bileşenler yalnızca bunu kullanır.
import './bookPrint.css';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useAccountingStore, type CompanyProfile } from '@/stores/accounting';
import { useAuthStore } from '@/stores/auth';
import { useCompanyStore } from '@/stores/company';

/** Yevmiye defterinde sayfa başına tablo satırı (fiş başlığı 1 satır + fiş satırları). */
export const JOURNAL_ROWS_PER_PAGE = 38;
/** Defter-i kebirde sayfa başına satır (hesap başlığı 2 satır sayılır). */
export const LEDGER_ROWS_PER_PAGE = 38;

export function formatMoney(v: number | string | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
    Number(v ?? 0),
  );
}

/** Satırda 0 yerine boş bırakmak için. */
export function moneyOrBlank(v: number | string | null | undefined): string {
  return Number(v ?? 0) === 0 ? '' : formatMoney(v);
}

/** YYYY-MM-DD → gg.aa.yyyy; saat dilimi kayması olmasın diye Date kullanılmaz. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Bakiye: `₺140,00 B` / `₺140,00 A` (0 ise yalnızca tutar). */
export function formatBalance(balance: number): string {
  const n = Math.round(Number(balance ?? 0) * 100) / 100;
  if (n === 0) return formatMoney(0);
  return `${formatMoney(Math.abs(n))} ${n > 0 ? 'B' : 'A'}`;
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  mahsup: 'Mahsup',
  tahsil: 'Tahsil',
  tediye: 'Tediye',
  acilis: 'Açılış',
  duzeltme: 'Düzeltme',
  ters: 'Ters',
  donem_sonu: 'Dönem sonu',
  kapanis: 'Kapanış',
};
export const entryTypeLabel = (t: string): string => ENTRY_TYPE_LABELS[t] ?? t;

/** Madde numarası etiketi: 2026/12. */
export const entryNoLabel = (e: { fiscal_year?: number | null; entry_no?: number | null }) =>
  e.entry_no === null || e.entry_no === undefined
    ? '—'
    : e.fiscal_year
      ? `${e.fiscal_year}/${e.entry_no}`
      : String(e.entry_no);

/** Tutarı kuruşa yuvarlayarak toplar (kayan nokta birikmesini önler). */
export const addMoney = (a: number, b: number): number => Math.round((a + b) * 100) / 100;

// --- Sayfalama ---------------------------------------------------------------------------------

/**
 * Bölünmez gruplar halinde verilen satırları sabit satır kapasiteli sayfalara yerleştirir.
 * Bir grup kalan yere sığmıyorsa bir sonraki sayfaya geçer; tek başına sayfadan büyük gruplar
 * çağıran tarafından önceden parçalanmış olmalıdır (yine de güvenlik için zorla bölünür).
 */
export function paginateGroups<T>(groups: T[][], capacity: number): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (cur.length + group.length > capacity && cur.length > 0) {
      pages.push(cur);
      cur = [];
    }
    if (group.length > capacity) {
      for (let i = 0; i < group.length; i += capacity) {
        const chunk = group.slice(i, i + capacity);
        if (cur.length > 0) {
          pages.push(cur);
          cur = [];
        }
        if (chunk.length === capacity) pages.push(chunk);
        else cur = chunk;
      }
      continue;
    }
    cur.push(...group);
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

// --- Yazdırma kapsamı --------------------------------------------------------------------------

const BODY_CLASS = 'book-report-active';
const PAGE_STYLE_ID = 'book-print-page-style';

function activate() {
  document.body.classList.add(BODY_CLASS);
  if (!document.getElementById(PAGE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    style.textContent = '@page { size: A4 portrait; margin: 12mm 10mm; }';
    document.head.appendChild(style);
  }
}

function deactivate() {
  document.body.classList.remove(BODY_CLASS);
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

/**
 * Defter raporu açıkken `body`ye `book-report-active` sınıfı ve A4 `@page` kuralı ekler; yazdırmada
 * (`@media print`) yalnızca `.book-print-root` basılır. Kapsam yalnızca rapor bileşeni açıkken
 * vardır (kapanınca temizlenir), böylece diğer ekranların yazdırması etkilenmez.
 */
export function useBookPrintScope() {
  onMounted(activate);
  onBeforeUnmount(deactivate);

  /** Sayfa yerleşimi otursun diye bir kare bekleyip tarayıcı yazdırmasını açar. */
  function print() {
    activate();
    window.requestAnimationFrame(() => window.setTimeout(() => window.print(), 0));
  }

  return { print };
}

// --- Şirket başlığı ----------------------------------------------------------------------------

/** Yazdırma başlığındaki şirket adı + (varsa) vergi dairesi / numarası. */
export function useCompanyHeader() {
  const accounting = useAccountingStore();
  const auth = useAuthStore();
  const companies = useCompanyStore();
  const profile = ref<CompanyProfile | null>(null);

  async function load() {
    profile.value = await accounting.fetchCompanyProfile();
    if (!profile.value && companies.companies.length === 0) await companies.fetchCompanies();
  }

  function companyName(): string {
    if (profile.value?.name) return profile.value.name;
    const c = companies.companies.find((x) => x.id === auth.company?.id);
    return c?.trade_name || c?.name || auth.company?.name || '';
  }

  function taxLine(): string {
    const p = profile.value;
    if (!p) return '';
    return [
      p.tax_office ? `Vergi Dairesi: ${p.tax_office}` : '',
      p.tax_number ? `VKN: ${p.tax_number}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return { load, companyName, taxLine };
}
