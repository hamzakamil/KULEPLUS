import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool } from 'pg';

export interface WebhookEventRecord {
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

export interface IntegrationRecord {
  id: string;
  tenant_id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalMappingRecord {
  id: string;
  tenant_id: string;
  integration_id: string;
  external_id: string;
  internal_type: string;
  internal_id: string;
  created_at: string;
}

export interface RecordWebhookInput {
  tenantId: string;
  integrationId: string;
  externalEventId: string;
  eventType: string;
  payload: unknown;
  signature?: string;
}

export interface VerifySignatureInput {
  rawBody: string;
  signature: string;
  secret: string;
}

/**
 * HMAC-SHA256 imza doğrulama (SPEC §20).
 * Sağlayıcı imzası `sha256=<hex>` formatında gelir.
 */
export function verifyHmacSignature(input: VerifySignatureInput): boolean {
  const { createHmac, timingSafeEqual } = require('crypto') as typeof import('crypto');
  const expected = createHmac('sha256', input.secret).update(input.rawBody).digest('hex');
  const provided = input.signature.replace(/^sha256=/, '');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export class IntegrationService {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getPool('app');
  }

  async recordWebhookEvent(input: RecordWebhookInput): Promise<WebhookEventRecord> {
    const id = newId();
    const { rows } = await this.pool.query<WebhookEventRecord>(
      `INSERT INTO webhook_events (id, tenant_id, integration_id, external_event_id, event_type, payload, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (integration_id, external_event_id) DO NOTHING
       RETURNING *`,
      [id, input.tenantId, input.integrationId, input.externalEventId, input.eventType, JSON.stringify(input.payload), input.signature ?? null],
    );
    if (rows.length === 0) {
      const existing = await this.pool.query<WebhookEventRecord>(
        `SELECT * FROM webhook_events WHERE integration_id = $1 AND external_event_id = $2`,
        [input.integrationId, input.externalEventId],
      );
      return existing.rows[0]!;
    }
    return rows[0]!;
  }

  async listIntegrations(tenantId: string): Promise<IntegrationRecord[]> {
    const { rows } = await this.pool.query<IntegrationRecord>(
      `SELECT * FROM integrations WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  async getIntegration(tenantId: string, id: string): Promise<IntegrationRecord | null> {
    const { rows } = await this.pool.query<IntegrationRecord>(
      `SELECT * FROM integrations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async createIntegration(tenantId: string, provider: string, displayName: string): Promise<IntegrationRecord> {
    const id = newId();
    const { rows } = await this.pool.query<IntegrationRecord>(
      `INSERT INTO integrations (id, tenant_id, provider, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, tenantId, provider, displayName],
    );
    return rows[0]!;
  }

  async deactivateIntegration(tenantId: string, id: string): Promise<IntegrationRecord | null> {
    const { rows } = await this.pool.query<IntegrationRecord>(
      `UPDATE integrations SET is_active = false, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async findMapping(
    tenantId: string,
    integrationId: string,
    externalId: string,
    internalType: string,
  ): Promise<ExternalMappingRecord | null> {
    const { rows } = await this.pool.query<ExternalMappingRecord>(
      `SELECT * FROM external_mappings
       WHERE tenant_id = $1 AND integration_id = $2 AND external_id = $3 AND internal_type = $4`,
      [tenantId, integrationId, externalId, internalType],
    );
    return rows[0] ?? null;
  }

  async createMapping(
    tenantId: string,
    integrationId: string,
    externalId: string,
    internalType: string,
    internalId: string,
  ): Promise<ExternalMappingRecord> {
    const id = newId();
    const { rows } = await this.pool.query<ExternalMappingRecord>(
      `INSERT INTO external_mappings (id, tenant_id, integration_id, external_id, internal_type, internal_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, tenantId, integrationId, externalId, internalType, internalId],
    );
    return rows[0]!;
  }

  async markEventProcessed(tenantId: string, eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_events SET processed_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, eventId],
    );
  }

  async getPendingEvents(tenantId: string, integrationId: string, limit = 50): Promise<WebhookEventRecord[]> {
    const { rows } = await this.pool.query<WebhookEventRecord>(
      `SELECT * FROM webhook_events
       WHERE tenant_id = $1 AND integration_id = $2 AND processed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $3`,
      [tenantId, integrationId, limit],
    );
    return rows;
  }
}
