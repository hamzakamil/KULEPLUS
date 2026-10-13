import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { insertNotification, recordActivity } from './events';
import type {
  ApprovalListQuery,
  CreateApprovalRequestInput,
  DecideApprovalRequestInput,
} from './schemas';

/**
 * Onay Kutusu servisi — ROADMAP Faz 7 (SPEC §26 bağlamı).
 *
 * Farklı modüllerden gelen onay taleplerini (ödeme limiti, fatura iptali, fiş onayı)
 * tek kutuda toplar. Talep kaynağı `related_entity_type`/`related_entity_id` + `payload`
 * ile taşınır; ilgili modülün iş kuralı burada tekrar yazılmaz.
 *
 * Karar (approved/rejected) geri alınmaz; düzeltme yeni taleple yapılır.
 * Tenant izolasyonu: servis kendi transaction'ında `app.tenant_id` set eder (RLS).
 */

interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export class ApprovalService {
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

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; limit: number },
  ): PageResult<T> {
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // ======================= Sorgular =======================

  async listApprovalRequests(query: ApprovalListQuery, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['a.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.status) {
        conditions.push(`a.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.request_type) {
        conditions.push(`a.request_type = $${i}`);
        values.push(query.request_type);
        i++;
      }
      if (query.assigned_to) {
        conditions.push(`a.assigned_to = $${i}`);
        values.push(query.assigned_to);
        i++;
      }
      if (query.related_entity_type) {
        conditions.push(`a.related_entity_type = $${i}`);
        values.push(query.related_entity_type);
        i++;
      }
      if (query.related_entity_id) {
        conditions.push(`a.related_entity_id = $${i}`);
        values.push(query.related_entity_id);
        i++;
      }
      if (query.q) {
        conditions.push(`(a.title ILIKE $${i} OR a.summary ILIKE $${i})`);
        values.push(`%${query.q}%`);
        i++;
      }
      const where = conditions.join(' AND ');
      const sortColumnMap: Record<string, string> = {
        createdAt: 'a.created_at',
        amount: 'a.amount',
        due_at: 'a.due_at NULLS LAST',
        status: 'a.status',
      };
      const sortColumn = sortColumnMap[query.sortBy] ?? 'a.created_at';
      const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT a.* FROM approval_requests a WHERE ${where}
           ORDER BY ${sortColumn} ${sortOrder} LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM approval_requests a WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapApprovalRow), Number(count.rows[0].total), query);
    });
  }

  async getApprovalRequest(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapApprovalRow(r.rows[0]);
    });
  }

  /** Bekleyen onay sayısı (rozet için). */
  async countPending(tenantId?: string): Promise<number> {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM approval_requests
          WHERE tenant_id = app.current_tenant_id() AND status = 'pending'`,
      );
      return Number(r.rows[0].total);
    });
  }

  // ======================= Komutlar =======================

  async createApprovalRequest(
    input: CreateApprovalRequestInput,
    userId: string,
    tenantId?: string,
  ) {
    const id = newId();
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO approval_requests
           (id, tenant_id, request_type, status, title, summary, amount, currency,
            requested_by, assigned_to, related_entity_type, related_entity_id, payload, due_at,
            created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, 'pending', $3, $4, $5, $6,
                 $7, $8, $9, $10, $11::jsonb, $12, $7, $7)`,
        [
          id,
          input.request_type,
          input.title,
          input.summary ?? null,
          input.amount ?? null,
          input.currency?.toUpperCase() ?? null,
          userId,
          input.assigned_to ?? null,
          input.related_entity_type ?? null,
          input.related_entity_id ?? null,
          JSON.stringify(input.payload ?? {}),
          input.due_at ?? null,
        ],
      );
      await recordActivity(client, {
        actorUserId: userId,
        activityType: 'approval.created',
        entityType: 'approval_request',
        entityId: id,
        summary: `Onay talebi oluşturuldu: ${input.title}`,
        metadata: { request_type: input.request_type },
      });
      if (input.assigned_to && input.assigned_to !== userId) {
        await insertNotification(client, {
          userId: input.assigned_to,
          notificationType: 'system.announcement',
          title: 'Yeni onay talebi',
          body: input.title,
          entityType: 'approval_request',
          entityId: id,
          actorUserId: userId,
        });
      }
    });
    return this.getApprovalRequest(id, tenantId);
  }

  async decideApprovalRequest(
    id: string,
    input: DecideApprovalRequestInput,
    userId: string,
    tenantId?: string,
  ) {
    const existing = await this.getApprovalRequest(id, tenantId);
    if (!existing) throw new AppError('NOT_FOUND', 'Onay talebi bulunamadı');
    if (existing.status !== 'pending') {
      throw new AppError('VALIDATION_ERROR', 'Yalnızca bekleyen talepler karara bağlanabilir');
    }
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE approval_requests
            SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4,
                updated_by = $3, updated_at = now(), version = version + 1
          WHERE id = $1 AND tenant_id = app.current_tenant_id() AND status = 'pending'`,
        [id, input.decision, userId, input.note ?? null],
      );
      await recordActivity(client, {
        actorUserId: userId,
        activityType: 'approval.decided',
        entityType: 'approval_request',
        entityId: id,
        summary: `Onay talebi ${input.decision === 'approved' ? 'onaylandı' : 'reddedildi'}`,
        metadata: { decision: input.decision },
      });
      if (existing.requestedBy && existing.requestedBy !== userId) {
        await insertNotification(client, {
          userId: existing.requestedBy,
          notificationType: 'system.announcement',
          title: input.decision === 'approved' ? 'Onay talebi onaylandı' : 'Onay talebi reddedildi',
          body: existing.title,
          entityType: 'approval_request',
          entityId: id,
          payload: { decision: input.decision },
          actorUserId: userId,
        });
      }
    });
    return this.getApprovalRequest(id, tenantId);
  }

  async cancelApprovalRequest(id: string, userId: string, tenantId?: string) {
    const existing = await this.getApprovalRequest(id, tenantId);
    if (!existing) throw new AppError('NOT_FOUND', 'Onay talebi bulunamadı');
    if (existing.status !== 'pending') {
      throw new AppError('VALIDATION_ERROR', 'Yalnızca bekleyen talepler iptal edilebilir');
    }
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE approval_requests
            SET status = 'cancelled', decided_by = $2, decided_at = now(),
                updated_by = $2, updated_at = now(), version = version + 1
          WHERE id = $1 AND tenant_id = app.current_tenant_id() AND status = 'pending'`,
        [id, userId],
      );
      await recordActivity(client, {
        actorUserId: userId,
        activityType: 'approval.cancelled',
        entityType: 'approval_request',
        entityId: id,
        summary: `Onay talebi iptal edildi: ${existing.title}`,
      });
    });
    return this.getApprovalRequest(id, tenantId);
  }
}

// ======================= Row Mapper =======================

export interface ApprovalRequestView {
  id: string;
  requestType: string;
  status: string;
  title: string;
  summary: string | null;
  amount: number | null;
  currency: string | null;
  requestedBy: string | null;
  assignedTo: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  payload: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  dueAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRequestView {
  return {
    id: row.id as string,
    requestType: row.request_type as string,
    status: row.status as string,
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: (row.currency as string | null) ?? null,
    requestedBy: (row.requested_by as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null,
    relatedEntityType: (row.related_entity_type as string | null) ?? null,
    relatedEntityId: (row.related_entity_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: toIso(row.decided_at),
    decisionNote: (row.decision_note as string | null) ?? null,
    dueAt: toIso(row.due_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
