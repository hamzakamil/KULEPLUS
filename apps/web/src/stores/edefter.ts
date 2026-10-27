import { defineStore } from 'pinia';
import { api } from '@/lib/api';
import { errorMessage } from '@/stores/accounting';

export { errorMessage };

/** Ayarlar → Firma Profili → "e-Defter bilgileri" (`settings.edefter`). */
export interface EdefterAccountant {
  name: string;
  contractType: string;
  contractDate: string;
  contractNo: string;
  phone?: string;
  email?: string;
}

export interface EdefterSettings {
  title?: string;
  nace?: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  address?: {
    buildingNumber?: string;
    street?: string;
    street2?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
  accountants?: EdefterAccountant[];
  inHouse?: boolean;
  branch?: { no: string; name: string } | null;
  sourceApplication?: string;
  /** YYYY-MM */
  startMonth?: string;
  enteredBy?: string;
}

export interface EdefterProfileIssue {
  field: string;
  message: string;
}

export interface EdefterProfileStatus {
  settings: EdefterSettings;
  vkn: string;
  title: string;
  issues: EdefterProfileIssue[];
}

export type EdefterPartStatus = 'generated' | 'delivered';

/** Oluşturulmuş dosya (Y: yevmiye, K: kebir). */
export interface EdefterPart {
  period: string;
  book_type: 'Y' | 'K';
  part_no: number;
  unique_id: string;
  file_name: string;
  status: EdefterPartStatus;
  size_bytes: number;
  sha256: string;
  first_entry_no: number | null;
  last_entry_no: number | null;
  entry_count: number;
  line_count: number;
  total_debit: number;
  total_credit: number;
  created_at: string;
}

export interface EdefterYear {
  year: number;
  parts: EdefterPart[];
}

export interface EdefterIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  entryNo?: number | string | null;
  field?: string;
}

export interface EdefterSummary {
  entryCount: number;
  lineCount: number;
  firstEntry: number | null;
  lastEntry: number | null;
  totalDebit: number;
  totalCredit: number;
}

export interface EdefterPrecheck {
  period: string;
  fiscalYear: number;
  ready: boolean;
  issues: EdefterIssue[];
  profileIssues: EdefterProfileIssue[];
  summary: EdefterSummary;
  existing: EdefterPart[];
}

export interface EdefterGenerateResult {
  period: string;
  parts: Array<{
    book: 'Y' | 'K';
    partNo: number;
    uniqueId: string;
    fileName: string;
    periodStart: string;
    periodEnd: string;
    sizeBytes: number;
    sha256: string;
    signaturePending: number;
  }>;
  summary: EdefterSummary;
}

/** Content-Disposition başlığından dosya adı (filename*=UTF-8'' ya da filename=). */
export function fileNameFromDisposition(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* düz ada düş */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export const useEdefterStore = defineStore('edefter', () => {
  const profileStatus = async (): Promise<EdefterProfileStatus> => {
    const res = await api.get('/v1/edefter/profile');
    return res.data;
  };

  const fetchYear = async (year: number): Promise<EdefterYear> => {
    const res = await api.get('/v1/edefter', { params: { year } });
    return res.data;
  };

  const precheck = async (period: string): Promise<EdefterPrecheck> => {
    const res = await api.get(`/v1/edefter/${period}/precheck`);
    return res.data;
  };

  /** Ayı kilitler: kilit tarihi sonraki ayın ilk günüdür, o tarihe kadar fiş girilemez. */
  const lockMonth = async (period: string) => {
    const res = await api.post(`/v1/edefter/${period}/lock`);
    return res.data;
  };

  const generate = async (period: string): Promise<EdefterGenerateResult> => {
    const res = await api.post(`/v1/edefter/${period}/generate`);
    return res.data;
  };

  const setDelivered = async (period: string, delivered: boolean) => {
    const res = await api.post(`/v1/edefter/${period}/delivered`, { delivered });
    return res.data;
  };

  const removeMonth = async (period: string) => {
    const res = await api.delete(`/v1/edefter/${period}`);
    return res.data;
  };

  /** Ayın zip'ini indirip tarayıcıya kaydettirir; dönen değer kaydedilen dosya adıdır. */
  const downloadZip = async (period: string, fallbackName: string): Promise<string> => {
    let res;
    try {
      res = await api.get(`/v1/edefter/${period}/download`, { responseType: 'blob' });
    } catch (err) {
      // Hata gövdesi de blob gelir; JSON'a çevirip errorMessage'ın okuyabileceği hale getir.
      const data = (err as { response?: { data?: unknown } }).response?.data;
      if (data instanceof Blob) {
        try {
          (err as { response: { data: unknown } }).response.data = JSON.parse(await data.text());
        } catch {
          /* gövde JSON değil */
        }
      }
      throw err;
    }
    const name = fileNameFromDisposition(res.headers?.['content-disposition']) ?? fallbackName;
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  };

  return {
    profileStatus,
    fetchYear,
    precheck,
    lockMonth,
    generate,
    setDelivered,
    removeMonth,
    downloadZip,
  };
});
