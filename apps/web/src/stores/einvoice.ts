import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * e-Dönüşüm (e-Arşiv / e-Fatura) ekranı (Faz 4 — SPEC §21).
 * Backend `/api/v1/einvoice` altında; tüm uçlar auth + tenant + `einvoice`
 * entitlement + `einvoice.document.*` RBAC ister. Listeler `{ items: [] }`
 * (sayfalama sorgu paramı olarak gider, gövdede dizi döner).
 */

/** API hata sözleşmesi: `{ error: { code, message } }` (SPEC §22.1). */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response
    ?.data;
  return data?.error?.message || data?.message || fallback;
}

const BASE = '/v1/einvoice';

export type InvoiceStatus =
  'draft' | 'sent' | 'delivered' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export type DocumentType =
  'invoice' | 'credit_note' | 'debit_note' | 'delivery_note' | 'original_evrak' | 'evrak_eni';

export type SourceType =
  'sales_quote' | 'sales_order' | 'purchase_order' | 'delivery' | 'invoice' | 'manual';

/** Gönderim kutusu kaydı (einvoice_documents). */
export interface EInvoiceDocument {
  id: string;
  tenant_id: string;
  source_type: SourceType;
  source_id: string;
  document_type: DocumentType;
  status: InvoiceStatus;
  xml_payload?: string;
  pdf_path?: string;
  provider_response?: string;
  external_invoice_id?: string;
  attempts: number;
  max_attempts: number;
  last_attempt_at?: string;
  created_at: string;
  updated_at: string;
}

/** Gelen kutusu kaydı (provider'dan çekilmiş fatura). */
export interface InboxInvoice {
  id: string;
  external_invoice_id: string;
  direction: 'incoming' | 'outgoing';
  document_type: string;
  title: string;
  received_at: string;
}

/** Durum geçmişi olayı (einvoice_status_events). */
export interface StatusEvent {
  status: string;
  provider_response: string | null;
  created_at: string;
}

/** `{ items: [] }` liste yanıtı. */
interface ItemsResponse<T> {
  items: T[];
}

export const useEinvoiceStore = defineStore('einvoice', () => {
  const documents = ref<EInvoiceDocument[]>([]);
  const inbox = ref<InboxInvoice[]>([]);
  const current = ref<EInvoiceDocument | null>(null);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);

  async function fetchDocuments(
    params: { status?: InvoiceStatus; page?: number; limit?: number } = {},
  ) {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<ItemsResponse<EInvoiceDocument>>(`${BASE}/`, { params });
      documents.value = res.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'e-Dönüşüm belgeleri yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function fetchInbox(direction?: 'incoming' | 'outgoing') {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<ItemsResponse<InboxInvoice>>(`${BASE}/inbox`, {
        params: direction ? { direction } : undefined,
      });
      inbox.value = res.data.items ?? [];
    } catch (err) {
      error.value = errorMessage(err, 'Gelen kutusu yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function syncInbox() {
    loading.value = true;
    error.value = null;
    notice.value = null;
    try {
      const res = await api.post<{ message: string; inserted: number }>(`${BASE}/inbox/sync`);
      notice.value = res.data.message;
      await fetchInbox();
    } catch (err) {
      error.value = errorMessage(err, 'Gelen kutusu tazelenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function sendDocument(sourceType: SourceType, sourceId: string) {
    loading.value = true;
    error.value = null;
    notice.value = null;
    try {
      const res = await api.post<{ message: string; documentId: string }>(`${BASE}/send`, {
        sourceType,
        sourceId,
      });
      notice.value = res.data.message;
      await fetchDocuments();
      return res.data.documentId;
    } catch (err) {
      error.value = errorMessage(err, 'Belge gönderilemedi');
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function cancelDocument(id: string, reason: string) {
    loading.value = true;
    error.value = null;
    notice.value = null;
    try {
      const res = await api.post<{ message: string }>(`${BASE}/${id}/cancel`, { reason });
      notice.value = res.data.message;
      await fetchDocuments();
    } catch (err) {
      error.value = errorMessage(err, 'Belge iptal edilemedi');
    } finally {
      loading.value = false;
    }
  }

  return {
    documents,
    inbox,
    current,
    loading,
    error,
    notice,
    fetchDocuments,
    fetchInbox,
    syncInbox,
    sendDocument,
    cancelDocument,
  };
});
