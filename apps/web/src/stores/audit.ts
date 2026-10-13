import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Denetim kayıtları ekranı (SPEC §27.3, ADR-0016).
 * Backend `/api/v1/audit-logs` altında; `authenticate` + `req.user.tenantId`
 * kapsamı (tenant dışı kayıt dönmez). Yanıt: `{ logs, total, page, limit }`.
 * Not: `audit` GOVERNANCE §2'de bir tenant modül kodu değildir (audit_logs
 * core tablodur) — nav'da entitlement kapısı olmadan görünür.
 */

/** API hata sözleşmesi: `{ error: { code, message } }` (SPEC §22.1). */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as AxiosError<{ error?: { message?: string }; message?: string }>).response?.data;
  return data?.error?.message || data?.message || fallback;
}

const BASE = '/v1/audit-logs';

/** Denetim kaydı satırı (audit_logs). */
export interface AuditLog {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

/** Liste sorgu parametreleri (backend schemas.ts auditListQuerySchema ile aynı). */
export interface AuditListParams {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  userId?: string;
  after?: string;
  before?: string;
  sortBy?: 'created_at' | 'action' | 'user_id';
  sortOrder?: 'asc' | 'desc';
}

interface AuditListResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export const useAuditStore = defineStore('audit', () => {
  const logs = ref<AuditLog[]>([]);
  const current = ref<AuditLog | null>(null);
  const total = ref(0);
  const page = ref(1);
  const limit = ref(20);

  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchLogs(params: AuditListParams = {}) {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<AuditListResponse>(BASE, { params });
      logs.value = res.data.logs ?? [];
      total.value = res.data.total ?? 0;
      page.value = res.data.page ?? 1;
      limit.value = res.data.limit ?? 20;
    } catch (err) {
      error.value = errorMessage(err, 'Denetim kayıtları yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function fetchLog(id: string) {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<AuditLog>(`${BASE}/${id}`);
      current.value = res.data;
    } catch (err) {
      error.value = errorMessage(err, 'Denetim kaydı bulunamadı');
      current.value = null;
    } finally {
      loading.value = false;
    }
  }

  function clearCurrent() {
    current.value = null;
  }

  return { logs, current, total, page, limit, loading, error, fetchLogs, fetchLog, clearCurrent };
});