import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/** Mevzuattaki KDV tevkifat payları (/10). Sunucu şemasıyla aynı küme. */
export const WITHHOLDING_RATE_NUMERATORS: readonly number[] = [2, 3, 4, 5, 7, 9, 10];

/** API hata sözleşmesi `{ error: { message } }`; yetki eksikliğinde (403) açıklayıcı varsayılan. */
export function withholdingErrorMessage(err: unknown, fallback: string): string {
  const response = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response;
  const apiMessage = response?.data?.error?.message || response?.data?.message;
  if (apiMessage) return apiMessage;
  if (response?.status === 403) return 'Bu işlem için yetkiniz yok (core.settings.update gerekli).';
  return fallback;
}

/**
 * Sunucu DATE kolonlarını YYYY-MM-DD'ye çevirir. Sürücü DATE değerlerini Node'un yerel
 * gece yarısı Date'i olarak döndürebildiği için ISO zaman damgası gelirse yerel tarih alınır.
 */
function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface WithholdingType {
  id: string;
  name: string;
  einvoice_code: string;
  kdv2_code: string;
  rate_numerator: number;
  rate_denominator: number;
  /** YYYY-MM-DD */
  valid_from: string;
  /** YYYY-MM-DD; null ise süresiz. */
  valid_to: string | null;
  is_active: boolean;
}

export interface WithholdingTypeInput {
  name: string;
  einvoice_code: string;
  kdv2_code: string;
  rate_numerator: number;
  valid_from?: string;
  valid_to?: string | null;
  is_active?: boolean;
}

function normalizeType(raw: WithholdingType): WithholdingType {
  return {
    ...raw,
    rate_numerator: Number(raw.rate_numerator),
    rate_denominator: Number(raw.rate_denominator),
    valid_from: toDateOnly(raw.valid_from) ?? raw.valid_from,
    valid_to: toDateOnly(raw.valid_to),
  };
}

export const useWithholdingStore = defineStore('withholding', () => {
  const types = ref<WithholdingType[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Tüm tevkifat türleri; `activeOn` verilirse yalnızca o tarihte geçerli aktif türler. */
  const fetchTypes = async (activeOn?: string) => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.get('/v1/invoices/withholding-types', {
        params: activeOn ? { active_on: activeOn } : {},
      });
      types.value = ((response.data.data ?? []) as WithholdingType[]).map(normalizeType);
    } catch (err) {
      error.value = withholdingErrorMessage(err, 'Tevkifat türleri yüklenemedi.');
    } finally {
      loading.value = false;
    }
  };

  /** Yeni tür oluşturur ve listeyi yeniler. Hata durumunda istisna fırlatır. */
  const createType = async (input: WithholdingTypeInput): Promise<WithholdingType> => {
    const response = await api.post('/v1/invoices/withholding-types', input);
    await fetchTypes();
    return normalizeType(response.data as WithholdingType);
  };

  /** Kısmi güncelleme; kesinleşmiş belgeler etkilenmez (kodlar/oran satıra kopyalıdır). */
  const updateType = async (
    id: string,
    input: Partial<WithholdingTypeInput>,
  ): Promise<WithholdingType> => {
    const response = await api.patch(`/v1/invoices/withholding-types/${id}`, input);
    await fetchTypes();
    return normalizeType(response.data as WithholdingType);
  };

  return {
    types,
    loading,
    error,
    fetchTypes,
    createType,
    updateType,
  };
});
