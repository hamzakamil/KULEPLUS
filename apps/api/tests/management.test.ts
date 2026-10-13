import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApprovalService } from '../src/modules/management/approval.service';
import type { Pool, PoolClient } from 'pg';

/**
 * Onay Kutusu servisi — ROADMAP Faz 7 (SPEC §26 bağlamı).
 *
 * `ApprovalService` constructor'ına sahte `pool` enjekte edilir; servis
 * `withTenantClient` → `pool.connect()` → `client.query` (BEGIN/set_config/
 * veri sorguları/COMMIT) akışını kullanır. Gerçek Postgres'e bağlanılmaz.
 *
 * Kapsanan kritik yollar:
 *  - Karar geri alınamaz: yalnızca `pending` talepler karara bağlanabilir.
 *  - Talep yoksa NOT_FOUND.
 *  - Başarılı karar: UPDATE + talep edene bildirim (recordActivity de koşar).
 *  - createApprovalRequest: `pending` açar, atanan kişiye bildirim gönderir.
 */

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  const clientQuery = vi.fn(queryImpl);
  const client: MockClient = { query: clientQuery, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
  return { pool, client, clientQuery };
}

/** Transaction/oturum sorgularını otomatik geçir. */
function base(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  return (sql: string, params?: unknown[]) => {
    const s = sql.trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK' || s.includes('set_config')) {
      return Promise.resolve({ rows: [] });
    }
    return queryImpl(sql, params);
  };
}

const pendingRow = {
  id: 'appr-1',
  request_type: 'payment_over_limit',
  status: 'pending',
  title: 'Ödeme limiti talebi',
  summary: '50.000 TL ödeme',
  amount: '50000',
  currency: 'TRY',
  requested_by: 'user-requester',
  assigned_to: 'user-approver',
  related_entity_type: null,
  related_entity_id: null,
  payload: {},
  decided_by: null,
  decided_at: null,
  decision_note: null,
  due_at: null,
  created_at: new Date('2026-10-01'),
  updated_at: new Date('2026-10-01'),
};

describe('ApprovalService (Faz 7)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createApprovalRequest', () => {
    it('talep `pending` açılır, para birimi büyük harfe çevrilir', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) {
            return Promise.resolve({ rows: [pendingRow] });
          }
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      const result = await svc.createApprovalRequest(
        { request_type: 'payment_over_limit', title: 'Ödeme limiti talebi', payload: {}, amount: 50000, currency: 'try', assigned_to: 'user-approver' },
        'user-requester',
        'tenant-1',
      );

      const insert = clientQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO approval_requests'));
      expect(insert).toBeTruthy();
      expect(String(insert?.[0])).toContain("'pending'");
      const params = insert?.[1] as unknown[];
      expect(params).toContain('TRY');
      expect(result?.status).toBe('pending');
      expect(result?.requestedBy).toBe('user-requester');
    });

    it('atanan kişi farklıysa bildirim + activity üretilir', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) return Promise.resolve({ rows: [pendingRow] });
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      await svc.createApprovalRequest(
        { request_type: 'payment_over_limit', title: 'X', payload: {}, assigned_to: 'user-approver' },
        'user-requester',
        'tenant-1',
      );

      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO notifications'))).toBe(true);
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO activities'))).toBe(true);
    });

    it('atanan kişi yoksa/kendisi ise bildirim üretilmez', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) return Promise.resolve({ rows: [pendingRow] });
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      await svc.createApprovalRequest(
        { request_type: 'payment_over_limit', title: 'X', payload: {} },
        'user-requester',
        'tenant-1',
      );

      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO notifications'))).toBe(false);
    });
  });

  describe('decideApprovalRequest — karar geri alınamaz', () => {
    it('talep yoksa → NOT_FOUND (UPDATE çalışmaz)', async () => {
      const { pool, clientQuery } = makeMockPool(base(() => Promise.resolve({ rows: [] })));
      const svc = new ApprovalService({ pool });

      await expect(
        svc.decideApprovalRequest('yok', { decision: 'approved' }, 'user-approver', 'tenant-1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE approval_requests'))).toBe(false);
    });

    it('pending olmayan talep → VALIDATION_ERROR (karar değiştirilemez)', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) {
            return Promise.resolve({ rows: [{ ...pendingRow, status: 'approved' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      await expect(
        svc.decideApprovalRequest('appr-1', { decision: 'rejected' }, 'user-approver', 'tenant-1'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE approval_requests'))).toBe(false);
    });

    it('geçerli karar → pending-guard UPDATE + talep edene bildirim + activity', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) {
            const reads = clientQuery.mock.calls.filter((c) =>
              String(c[0]).includes('FROM approval_requests WHERE id ='),
            ).length;
            return Promise.resolve({ rows: [{ ...pendingRow, status: reads > 1 ? 'approved' : 'pending' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      const result = await svc.decideApprovalRequest(
        'appr-1',
        { decision: 'approved', note: 'Onaylandı' },
        'user-approver',
        'tenant-1',
      );

      const update = clientQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE approval_requests'));
      expect(update).toBeTruthy();
      // Yarış durumunda ikinci kararın yazılmaması için WHERE status='pending' koruması
      expect(String(update?.[0])).toContain("status = 'pending'");
      expect((update?.[1] as unknown[])[1]).toBe('approved');
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO notifications'))).toBe(true);
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO activities'))).toBe(true);
      expect(result?.status).toBe('approved');
    });

    it('kararı veren kişi talep eden ise kendine bildirim gitmez (activity koşar)', async () => {
      const selfRow = { ...pendingRow, requested_by: 'user-approver' };
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) return Promise.resolve({ rows: [selfRow] });
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      await svc.decideApprovalRequest('appr-1', { decision: 'approved' }, 'user-approver', 'tenant-1');

      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO notifications'))).toBe(false);
      expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO activities'))).toBe(true);
    });
  });

  describe('countPending', () => {
    it('bekleyen sayısını Number olarak döner (string → number)', async () => {
      const { pool } = makeMockPool(
        base((sql) => {
          if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '7' }] });
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      const total = await svc.countPending('tenant-1');
      expect(total).toBe(7);
      expect(typeof total).toBe('number');
    });
  });

  describe('tenant izolasyonu', () => {
    it('BEGIN + set_config(tenantId) kurulur, COMMIT kapatır', async () => {
      const { pool, clientQuery } = makeMockPool(
        base((sql) => {
          if (sql.includes('FROM approval_requests WHERE id =')) return Promise.resolve({ rows: [pendingRow] });
          return Promise.resolve({ rows: [] });
        }),
      );
      const svc = new ApprovalService({ pool });

      await svc.getApprovalRequest('appr-1', 'tenant-abc');

      const setConfig = clientQuery.mock.calls.find((c) => String(c[0]).includes('set_config'));
      expect(setConfig).toBeTruthy();
      expect((setConfig?.[1] as unknown[])[0]).toBe('tenant-abc');
      expect(clientQuery.mock.calls.some((c) => c[0] === 'BEGIN')).toBe(true);
      expect(clientQuery.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(true);
    });
  });
});