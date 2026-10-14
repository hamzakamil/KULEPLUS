import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';

export type AuditLogRow = {
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
  created_at: Date;
};

export type CreateAuditLogInput = {
  tenantId?: string;
  userId?: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export class AuditService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  /** Denetim kaydı oluştur — ADR-0016, SPEC §27.3 */
  async create(input: CreateAuditLogInput): Promise<void> {
    const now = new Date();
    const {
      tenantId,
      userId,
      action,
      entityType,
      entityId,
      oldValues,
      newValues,
      ipAddress,
      userAgent,
      requestId,
    } = input;

    await this.getPoolInstance().query(
      `INSERT INTO audit_logs (
        id, tenant_id, user_id, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        crypto.randomUUID() as string,
        tenantId ?? null,
        userId ?? null,
        action,
        entityType ?? null,
        entityId ?? null,
        oldValues ?? null,
        newValues ?? null,
        ipAddress ?? null,
        userAgent ?? null,
        requestId ?? null,
        now,
      ],
    );
  }

  /** Tek sayfa denetim kayıtları — tenant bazlı RLS korumalı liste */
  async list(
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      action?: string;
      entityType?: string;
      userId?: string;
      after?: Date;
      before?: Date;
      sortBy?: 'created_at' | 'action' | 'user_id';
      sortOrder?: 'asc' | 'desc';
    },
  ): Promise<{ logs: AuditLogRow[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    let countSql = `SELECT COUNT(*)::bigint AS total FROM audit_logs a WHERE a.tenant_id = $1`;
    let selectSql = `SELECT a.* FROM audit_logs a WHERE a.tenant_id = $1`;
    // count ve select farklı sayıda parametre taşıyabilir (LIMIT/OFFSET yalnız select'te) —
    // ayrı listeler + ayrı placeholder sayaçları zorunludur; ortak sayaç "prepared statement
    // requires N" hatasına yol açar.
    const countParams: unknown[] = [tenantId];
    const selectParams: unknown[] = [tenantId];

    if (query.action) {
      countSql += ` AND a.action = $${countParams.length + 1}`;
      selectSql += ` AND a.action = $${selectParams.length + 1}`;
      countParams.push(query.action);
      selectParams.push(query.action);
    }
    if (query.entityType) {
      countSql += ` AND a.entity_type = $${countParams.length + 1}`;
      selectSql += ` AND a.entity_type = $${selectParams.length + 1}`;
      countParams.push(query.entityType);
      selectParams.push(query.entityType);
    }
    if (query.userId) {
      countSql += ` AND a.user_id = $${countParams.length + 1}`;
      selectSql += ` AND a.user_id = $${selectParams.length + 1}`;
      countParams.push(query.userId);
      selectParams.push(query.userId);
    }
    if (query.after) {
      countSql += ` AND a.created_at >= $${countParams.length + 1}`;
      selectSql += ` AND a.created_at >= $${selectParams.length + 1}`;
      countParams.push(query.after);
      selectParams.push(query.after);
    }
    if (query.before) {
      countSql += ` AND a.created_at <= $${countParams.length + 1}`;
      selectSql += ` AND a.created_at <= $${selectParams.length + 1}`;
      countParams.push(query.before);
      selectParams.push(query.before);
    }

    const sortColumn = query.sortBy ?? 'created_at';
    const sortOrder = (query.sortOrder ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
    if (!['created_at', 'action', 'user_id'].includes(sortColumn)) {
      throw new AppError('VALIDATION_ERROR', `Geçersiz sıralama kolonu: ${sortColumn}`);
    }
    selectSql += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${selectParams.length + 1} OFFSET $${selectParams.length + 2}`;
    selectParams.push(limit, offset);

    const [countResult, listResult] = await Promise.all([
      this.getPoolInstance().query<{ total: string }>(countSql, countParams),
      this.getPoolInstance().query<AuditLogRow>(selectSql, selectParams),
    ]);

    return {
      logs: listResult.rows.map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        user_id: row.user_id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        old_values: row.old_values as AuditLogRow['old_values'],
        new_values: row.new_values as AuditLogRow['new_values'],
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        request_id: row.request_id,
        created_at: row.created_at,
      })),
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
    };
  }

  /** Tek bir denetim kaydını getir */
  async get(tenantId: string, logId: string): Promise<AuditLogRow | null> {
    const result = await this.getPoolInstance().query<AuditLogRow>(
      `SELECT * FROM audit_logs WHERE id = $1 AND tenant_id = $2`,
      [logId, tenantId],
    );
    return result.rows[0] ?? null;
  }
}

export default AuditService;
