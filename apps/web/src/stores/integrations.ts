import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
}

export interface Integration {
  id: string;
  tenant_id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  tenant_id: string;
  integration_id: string;
  external_event_id: string;
  event_type: string;
  payload: unknown;
  signature: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface ExternalMapping {
  id: string;
  tenant_id: string;
  integration_id: string;
  external_id: string;
  internal_type: string;
  internal_id: string;
  created_at: string;
}

// api.ts baseURL = '/api' → tam yol '/api/v1/integrations' (app.ts:106 mount).
// DİKKAT: '/v1' olmadan '/api/integrations' olur → 404. stock.ts/auth ile aynı desen.
const BASE = '/v1/integrations';

export const useIntegrationsStore = defineStore('integrations', () => {
  const integrations = ref<Integration[]>([]);
  const events = ref<WebhookEvent[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchIntegrations() {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.get<Integration[]>(`${BASE}`);
      integrations.value = data || [];
    } catch (err) {
      error.value = errorMessage(err, 'Entegrasyonlar yüklenemedi.');
    } finally {
      loading.value = false;
    }
  }

  async function createIntegration(provider: string, displayName: string): Promise<Integration | null> {
    error.value = null;
    try {
      const { data } = await api.post<Integration>(`${BASE}`, { provider, display_name: displayName });
      integrations.value = [data, ...integrations.value];
      return data;
    } catch (err) {
      error.value = errorMessage(err, 'Entegrasyon oluşturulamadı.');
      return null;
    }
  }

  async function deactivateIntegration(id: string) {
    error.value = null;
    try {
      const { data } = await api.post<Integration>(`${BASE}/${id}/deactivate`);
      const ix = integrations.value.findIndex((i) => i.id === id);
      if (ix >= 0) integrations.value[ix] = data;
      return data;
    } catch (err) {
      error.value = errorMessage(err, 'Entegrasyon pasife alınamadı.');
      return null;
    }
  }

  async function fetchEvents(integrationId: string) {
    error.value = null;
    try {
      const { data } = await api.get<WebhookEvent[]>(`${BASE}/${integrationId}/events`);
      events.value = data || [];
    } catch (err) {
      error.value = errorMessage(err, 'Webhook olayları yüklenemedi.');
    }
  }

  return {
    integrations,
    events,
    loading,
    error,
    fetchIntegrations,
    createIntegration,
    deactivateIntegration,
    fetchEvents,
  };
});
