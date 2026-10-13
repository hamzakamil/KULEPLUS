import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';

export type OutboxItemRow = {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string | null;
  provider_ref: string | null;
  response: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  status: 'pending' | 'sent' | 'failed' | 'retrying';
  created_at: Date;
  sent_at: Date | null;
};

export type OutboxFilters = {
  status?: 'pending' | 'sent' | 'failed';
  limit?: number;
};

export class OutboxService {
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

  /** Outbox öğesini ekle */
  async enqueue(input: {
    to: string;
    subject: string;
    html: string;
    text?: string | null;
  }): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID() as string;

    await this.getPoolInstance().query(
      `INSERT INTO email_outbox (id, "to", subject, html, text, provider_ref, response, attempts, max_attempts, next_attempt_at, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 3, now(), 'pending', $8, NULL)`,
      // provider_ref NOT NULL: gönderim öncesi boş string ("") yazılır; gönderimde
      // gerçek sağlayıcı referansı `markAsSent` ile güncellenir.
      [id, input.to, input.subject, input.html, input.text ?? null, '', null, now],
    );

    return { id };
  }

  /** Bekleyen mesajları listele */
  async list(
    filters: OutboxFilters & { page?: number; limit?: number },
  ): Promise<{ items: OutboxItemRow[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: unknown[] = [];

    if (filters.status) {
      whereClause = `WHERE status = $${params.length + 1}`;
      params.push(filters.status);
    }

    const totalResult = await this.getPoolInstance().query(
      `SELECT COUNT(*)::bigint AS total FROM email_outbox ${whereClause}`,
      params,
    );

    const listResult = await this.getPoolInstance().query<OutboxItemRow>(
      `SELECT id, "to", subject, html, text, provider_ref, response, attempts, max_attempts, next_attempt_at, status, created_at, sent_at
       FROM email_outbox ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      items: listResult.rows,
      total: parseInt(totalResult.rows[0].total, 10),
    };
  }

  /** Outbox öğesini işle (gönder) */
  async processItem(id: string): Promise<void> {
    const result = await this.getPoolInstance().query<OutboxItemRow>(
      `SELECT * FROM email_outbox WHERE id = $1 FOR UPDATE`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Outbox öğesi bulunamadı');
    }

    const item = result.rows[0];

    if (item.status === 'sent') {
      return;
    }

    if (item.attempts >= item.max_attempts) {
      await this.getPoolInstance().query(
        `UPDATE email_outbox SET status = 'failed', updated_at = now() WHERE id = $1`,
        [id],
      );
      return;
    }

    await this.incrementAttempt(id);
  }

  /** İstek artırma */
  private async incrementAttempt(id: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE email_outbox SET attempts = attempts + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  /** Tamamlandı işaretle */
  async markAsSent(id: string, providerRef: string, response: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE email_outbox SET status = 'sent', provider_ref = $2, response = $3, sent_at = now(), updated_at = now() WHERE id = $1`,
      [id, providerRef, response],
    );
  }

  /** Başarısız işaretle */
  async markAsFailed(id: string, reason?: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE email_outbox SET status = 'failed', response = COALESCE($2, response), updated_at = now() WHERE id = $1`,
      [id, reason?.slice(0, 1000) ?? null],
    );
  }

  /** Temizle (sadece admin) */
  async cleanup(
    status: 'sent' | 'failed' | 'pending',
    olderThanHours: number = 24,
  ): Promise<number> {
    const result = await this.getPoolInstance().query(
      `DELETE FROM email_outbox WHERE status = $1 AND created_at < now() - interval '${Math.min(olderThanHours, 720)} hours'`,
      [status],
    );
    return result.rowCount ?? 0;
  }
}

export default OutboxService;
