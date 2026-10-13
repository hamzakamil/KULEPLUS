import { getPool } from '@kuleplus/db';
import {
  AppError,
  buildDashboardSummary,
  loadRuleStates,
  newId,
  type DashboardSummary,
  type RowQuery,
} from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import {
  RULE_DEFINITIONS,
  RULE_KEYS,
  isRuleKey,
  mergeRuleParams,
  type RuleKey,
  type RuleParamSpec,
  type RuleUpsertInput,
} from './rules';

export type { DashboardSummary, DashboardIndicator, TrafficStatus } from '@kuleplus/shared';

/**
 * Patron Görünümü v3 — kural bazlı trafik ışığı göstergeleri (SPEC §26, ROADMAP Faz 7).
 *
 * Yapay "sağlık skoru" YOKTUR; her gösterge tek bir kurala göre yeşil/sarı/kırmızı
 * olur. Değerlendirme mantığı paylaşılan kernel'dedir (@kuleplus/shared/management)
 * — worker günlük/haftalık özeti aynı kaynağı kullanır.
 *
 * Kural motoru (T-7.5): hazır kurallar kodda (`rules.ts`), eşikler tenant bazında
 * `management_rule_settings.params` ile özelleştirilebilir.
 */

export interface RuleSetting {
  key: RuleKey;
  label: string;
  link: string;
  description: string;
  enabled: boolean;
  params: Record<string, number>;
  defaults: Record<string, number>;
  paramSpec: RuleParamSpec[];
}

/** PoolClient.query'yi paylaşılan `RowQuery` sözleşmesine bağlar. */
function queryOf(client: PoolClient): RowQuery {
  return (text, params) => client.query(text, params as never);
}

export class ManagementDashboardService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(options?: { pool?: Pool }) {
    this.providedPool = options?.pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  private async withTenantClient<T>(
    tenantId: string | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ======================= Değerlendirme =======================

  async summary(tenantId?: string): Promise<DashboardSummary> {
    return this.withTenantClient(tenantId, (client) => buildDashboardSummary(queryOf(client)));
  }

  // ======================= Kural ayarları =======================

  async listRules(tenantId?: string): Promise<RuleSetting[]> {
    return this.withTenantClient(tenantId, async (client) => {
      const states = await loadRuleStates(queryOf(client));
      return RULE_KEYS.map((key) => {
        const def = RULE_DEFINITIONS[key];
        return {
          key,
          label: def.label,
          link: def.link,
          description: def.description,
          enabled: states[key].enabled,
          params: states[key].params,
          defaults: def.defaults,
          paramSpec: def.params,
        };
      });
    });
  }

  async upsertRule(
    key: string,
    input: RuleUpsertInput,
    userId: string,
    tenantId?: string,
  ): Promise<RuleSetting> {
    if (!isRuleKey(key)) throw new AppError('VALIDATION_ERROR', 'Geçersiz kural anahtarı');
    const merged = mergeRuleParams(key, input.params ?? null);
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO management_rule_settings
           (id, tenant_id, rule_key, enabled, params, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4::jsonb, $5, $5)
         ON CONFLICT (tenant_id, rule_key) DO UPDATE
           SET enabled = EXCLUDED.enabled,
               params = EXCLUDED.params,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()`,
        [newId(), key, input.enabled ?? true, JSON.stringify(merged), userId],
      );
    });
    const rules = await this.listRules(tenantId);
    return rules.find((r) => r.key === key)!;
  }
}
