import type { Logger } from 'pino';
import type { Job } from 'bullmq';
import type * as pg from 'pg';
import webpush, { type PushSubscription } from 'web-push';
const { sendNotification, setVapidDetails } = webpush;
import { getPool, withTenant } from '@kuleplus/db';
import {
  buildDashboardSummary,
  buildPushPayload,
  claimDueDunningRow,
  applyDunningOutcome,
  formatDigestSummary,
  isWithinQuietHours,
  newId,
  renderEmailTemplate,
  type DigestPeriod,
  type PaymentProvider,
  type RowQuery,
} from '@kuleplus/shared';

/**
 * Worker job handler tanımları — Faz 1 (SPEC §19.1, §29.1, ROADMAP Faz 1 Altyapı).
 *
 * Kural: handler'lar idempotent olmalı (SPEC §27.1, ADR-0020 — at-least-once delivery).
 * Aynı job iki kez çalışsa da yan etki bir kez oluşur.
 */

/** E-posta gönderim job'ı — outbox dispatch veya doğrudan kuyruk girdisi. */
export interface EmailSendJob {
  /** `email_outbox.id` — idempotency anahtarı. */
  outboxId: string;
  to: string;
  subject: string;
  html: string;
  text?: string | null;
}

/** Outbox dispatch job'ı — bekleyen kayıtları email kuyruğuna taşır. */
export interface OutboxDispatchJob {
  /** İşlenecek outbox kaydı; boşsa bekleyenler toplu çekilir. */
  outboxId?: string;
  batchSize?: number;
}

/** Döviz kuru içe aktarma job'ı — TCMB günlük kurları çekip exchange_rates'a yazar. */
export interface CurrencyImportJob {
  /** İşlenecek tenant'lar; boşsa tüm aktif tenant'lar. */
  tenantIds?: string[];
  /** İşlenecek tarih; boşsa bugün. */
  rateDate?: string;
  /** İşlemi yapan kullanıcı (sistem kullanıcısı). */
  userId?: string;
}

/** e-Dönüşüm outbox job'ı — bekleyen gönderimleri işler (SPEC §21.2). */
export interface EInvoiceOutboxJob {
  /** İşlenecek outbox kaydı; boşsa bekleyenler toplu çekilir. */
  outboxId?: string;
  batchSize?: number;
}

/** Bekleyen e-Dönüşüm outbox kaydı (einvoice_outbox). */
export interface PendingEInvoiceOutbox {
  id: string;
  tenant_id: string;
  entity_id: string;
  event_type: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

/** e-Dönüşüm sağlayıcı portu (DIP, SPEC §21.1/§29.1) — dev'de mock, gerçek sağlayıcı ADR ile değişir. */
export interface WorkerEInvoicePort {
  /** Belge gönderimi. Idempotent — aynı documentId ikinci kez çağrılırsa önceki sonucu döner. */
  sendDocument(
    documentId: string,
    payload: unknown,
  ): Promise<{
    success: boolean;
    external_invoice_id?: string;
    status?: string;
    provider_response?: string;
    message?: string;
  }>;
}

/** Web Push sonucu — 404/410 abonelik geçersiz (cihaz pasifleştirilir). */
export interface PushSendResult {
  ok: boolean;
  statusCode?: number;
  gone?: boolean;
  error?: string;
}

/** Web Push sağlayıcı portu (DIP, SPEC §29.1) — gerçek `web-push`, yoksa log mock'u. */
export interface WorkerPushPort {
  send(subscription: PushSubscription, payload: string): Promise<PushSendResult>;
}

/** E-posta portu — worker, apps/api'ye bağımlı olmadan bu sözleşmeyi bekler (DIP, SPEC §29.1). */
export interface WorkerEmailPort {
  send(message: {
    to: string;
    subject: string;
    html: string;
    text?: string | null;
  }): Promise<{ providerRef: string; status: 'sent' | 'failed' }>;
}

/** Outbox deposu portu — email_outbox tablosu erişimi (Repository sınırı). */
export interface WorkerOutboxRepository {
  /** Gönderilmeye hazır bekleyen kayıtları getir (status=pending, next_attempt_at <= now). */
  claimPending(
    limit: number,
  ): Promise<Array<{ id: string; to: string; subject: string; html: string; text: string | null }>>;
  markAsSent(id: string, providerRef: string, response: string): Promise<void>;
  markAsFailed(id: string, reason?: string): Promise<void>;
  /** Deneme sayısını artır; max aşıldıysa failed işaretle. */
  recordAttempt(id: string): Promise<void>;
}

export interface WorkerHandlerDeps {
  logger: Logger;
  email?: WorkerEmailPort;
  outbox?: WorkerOutboxRepository;
  einvoice?: WorkerEInvoicePort;
  push?: WorkerPushPort;
  /** Ödeme sağlayıcısı — dunning yeniden tahsilatı için (K-08). Verilmezse dunning atlanır. */
  payment?: PaymentProvider;
}

/**
 * e-Dönüşüm sağlayıcı mock'u — `WorkerEInvoicePort` sözleşmesini uygular (SPEC §29.1).
 * Idempotent: aynı documentId ikinci kez gönderilirse kayıtlı sonucu döner.
 * Gerçek GİB entegratörü (K-07 kararı sonrası) aynı arayüzü implement eder; dev'de bu mock kullanılır.
 */
export function createEInvoiceMockProvider(): WorkerEInvoicePort {
  const sent = new Map<
    string,
    {
      success: boolean;
      external_invoice_id?: string;
      status?: string;
      provider_response?: string;
      message?: string;
    }
  >();
  let counter = 0;

  return {
    async sendDocument(documentId, _payload) {
      const existing = sent.get(documentId);
      if (existing) return existing; // idempotent
      counter += 1;
      const ref = `MOCK-${String(counter).padStart(6, '0')}`;
      const result = {
        success: true,
        external_invoice_id: ref,
        status: 'sent',
        message: 'Gönderim başarılı (mock)',
        provider_response: JSON.stringify({ documentId, ref, sentAt: new Date().toISOString() }),
      };
      sent.set(documentId, result);
      return result;
    },
  };
}

/**
 * E-posta gönderim handler'ı.
 * Idempotency: aynı outboxId için gönderim başarılıysa tekrar gönderilmez
 * (markAsSent + claimPending filtresi ile korunur).
 */
export function createEmailSendHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<EmailSendJob>): Promise<void> => {
    const { logger, email, outbox } = deps;
    if (!email || !outbox) {
      throw new Error('WorkerEmailPort ve WorkerOutboxRepository bağımlılıkları eksik');
    }
    const { outboxId, to, subject, html, text } = job.data;
    logger.info({ queue: 'email-send', jobId: job.id, outboxId }, 'E-posta gönderiliyor');
    try {
      const result = await email.send({ to, subject, html, text });
      await outbox.markAsSent(outboxId, result.providerRef, 'ok');
      logger.info({ outboxId, providerRef: result.providerRef }, 'E-posta gönderildi');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await outbox.recordAttempt(outboxId);
      await outbox.markAsFailed(outboxId, reason);
      logger.error({ outboxId, err: reason }, 'E-posta gönderilemedi');
      throw error; // BullMQ retry politikasına bırakılır
    }
  };
}

/**
 * Outbox dispatch handler'ı — bekleyen kayıtları email kuyruğuna aktarır.
 * Bu handler job'ı email kuyruğuna ekler; gönderim ayrı handler'da yapılır (tek sorumluluk).
 */
export function createOutboxDispatchHandler(
  deps: WorkerHandlerDeps,
  enqueueEmail: (job: EmailSendJob) => Promise<void>,
) {
  return async (job: Job<OutboxDispatchJob>): Promise<void> => {
    const { logger, outbox } = deps;
    if (!outbox) {
      throw new Error('WorkerOutboxRepository bağımlılığı eksik');
    }
    const batchSize = Math.min(job.data.batchSize ?? 50, 200);
    const pending = await outbox.claimPending(batchSize);
    logger.info({ queue: 'outbox-dispatch', count: pending.length }, 'Bekleyen outbox kaydı');

    for (const item of pending) {
      await enqueueEmail({
        outboxId: item.id,
        to: item.to,
        subject: item.subject,
        html: item.html,
        text: item.text,
      });
    }
  };
}

/**
 * Döviz kuru içe aktarma handler'ı — TCMB günlük kurlarını çeker.
 * Repeatable job (cron) olarak her gün 16:30'da çalışır (TCMB yayını sonrası).
 * Idempotency: exchange_rates UNIQUE constraint (tenant_id, rate_date, base, target, source)
 * aynı tarihi ikinci kez yazmaz.
 */
export function createCurrencyImportHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<CurrencyImportJob>): Promise<void> => {
    const { tenantIds, rateDate, userId } = job.data;
    deps.logger.info(
      { queue: 'currency-import', jobId: job.id, tenantIds, rateDate },
      'TCMB kur içe aktarma başlıyor',
    );

    try {
      // 1) TCMB'ten kurları çek
      const { fetchTCMBRates, upsertRates } = await import('@kuleplus/shared');
      const rates = await fetchTCMBRates(rateDate);

      if (rates.length === 0) {
        deps.logger.warn({ rateDate }, "TCMB'den kur çekilemedi (boş sonuç)");
        return;
      }

      // 2) Tenant listesi
      const pool = getPool('app');
      let targets: string[];
      if (tenantIds && tenantIds.length > 0) {
        targets = tenantIds;
      } else {
        // Tüm aktif tenant'lar (platform Users'tan tenant_users)
        const res = await pool.query<{ tenant_id: string }>(
          'SELECT DISTINCT tenant_id FROM tenant_users WHERE tenant_id IS NOT NULL',
        );
        targets = res.rows.map((r) => r.tenant_id);
      }

      // 3) Her tenant için upsert
      let totalInserted = 0;
      let totalUpdated = 0;
      for (const tid of targets) {
        const result = await upsertRates(pool, tid, rates, { userId: userId ?? 'system' });
        totalInserted += result.inserted;
        totalUpdated += result.updated;
      }

      deps.logger.info(
        { inserted: totalInserted, updated: totalUpdated, tenantCount: targets.length },
        'TCMB kur içe aktarma tamamlandı',
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.logger.error({ err: reason }, 'TCMB kur içe aktarma başarısız');
      throw error;
    }
  };
}

/** Tek bir outbox kaydını tenant kapsamında işler (RLS, SPEC §7). */
async function processEInvoiceOutboxRecord(
  pool: pg.Pool,
  deps: Pick<WorkerHandlerDeps, 'logger' | 'einvoice'>,
  rec: PendingEInvoiceOutbox,
): Promise<void> {
  const { logger } = deps;
  try {
    let payload: unknown = {};
    try {
      payload = JSON.parse(rec.payload);
    } catch {
      payload = rec.payload;
    }

    const result = await withTenant(pool, rec.tenant_id, async (client) => {
      const doc = await client.query<{ id: string; source_type: string }>(
        'SELECT id, source_type FROM einvoice_documents WHERE id = $1 AND tenant_id = $2',
        [rec.entity_id, rec.tenant_id],
      );
      if (doc.rows.length === 0) {
        // Yetim kayıt: belge yoksa outbox'ı failed işaretle.
        await client.query(
          `UPDATE einvoice_outbox SET status = 'failed', attempts = attempts + 1, updated_at = now()
            WHERE id = $1`,
          [rec.id],
        );
        return { orphan: true };
      }

      // Deneme sayacını artır + belgeyi pending'e çek.
      await client.query(
        `UPDATE einvoice_outbox SET attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [rec.id],
      );
      await client.query(
        `UPDATE einvoice_documents
            SET status = 'pending', last_attempt_at = now(), updated_at = now()
          WHERE id = $1`,
        [rec.entity_id],
      );

      // Sağlayıcı gönderimi (idempotent, SPEC §21.2).
      const sendResult = deps.einvoice
        ? await deps.einvoice.sendDocument(rec.entity_id, payload)
        : {
            success: true,
            provider_response: JSON.stringify({ mock: true, by: 'einvoice-outbox' }),
          };

      if (!sendResult.success) {
        throw new Error(sendResult.message ?? 'Gönderim sağlayıcı tarafından reddedildi');
      }

      await client.query(
        `UPDATE einvoice_documents
            SET status = $2,
                external_invoice_id = COALESCE($3, external_invoice_id),
                provider_response = $4,
                last_attempt_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [
          rec.entity_id,
          sendResult.status ?? 'sent',
          sendResult.external_invoice_id ?? null,
          sendResult.provider_response ?? null,
        ],
      );
      await client.query(
        `UPDATE einvoice_outbox
            SET status = 'sent', provider_response = $2, delivered_at = now(), updated_at = now()
          WHERE id = $1`,
        [rec.id, sendResult.provider_response ?? null],
      );
      await client.query(
        `INSERT INTO einvoice_status_events (id, document_id, status, provider_response)
         VALUES ($1, $2, $3, $4)`,
        [newId(), rec.entity_id, sendResult.status ?? 'sent', sendResult.provider_response ?? null],
      );
      return { orphan: false };
    });

    if (!result.orphan) {
      logger.info(
        { outboxId: rec.id, documentId: rec.entity_id },
        'e-Dönüşüm gönderimi tamamlandı',
      );
    } else {
      logger.warn(
        { outboxId: rec.id, tenantId: rec.tenant_id },
        'e-Dönüşüm belgesi bulunamadı (yetim)',
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // attempts/max_attempts politikası: aşımda failed işaretle.
    await withTenant(pool, rec.tenant_id, async (client) => {
      const r = await client.query<{ attempts: number; max_attempts: number }>(
        `UPDATE einvoice_outbox SET updated_at = now() WHERE id = $1
          RETURNING attempts, max_attempts`,
        [rec.id],
      );
      const row = r.rows[0];
      if (row && row.attempts >= row.max_attempts) {
        await client.query(
          `UPDATE einvoice_outbox SET status = 'failed', updated_at = now() WHERE id = $1`,
          [rec.id],
        );
      }
    });
    logger.error({ outboxId: rec.id, err: reason }, 'e-Dönüşüm gönderimi başarısız');
    throw error; // BullMQ retry politikasına bırakılır (at-least-once, ADR-0020)
  }
}

/**
 * e-Dönüşüm outbox dispatch handler'ı — bekleyen gönderimleri işler.
 * Idempotency: einvoice_outbox attempts < max_attempts filtresi + sağlayıcı idempotent sözleşmesi
 * (aynı documentId ikinci kez işlenirse önceki kayıtlı sonuç döner, SPEC §21.2/ADR-0020).
 */
export function createEInvoiceOutboxHandler(deps: Pick<WorkerHandlerDeps, 'logger' | 'einvoice'>) {
  return async (job: Job<EInvoiceOutboxJob>): Promise<void> => {
    const batchSize = Math.min(job.data.batchSize ?? 20, 100);
    const pool = getPool('app');

    const rows = await pool.query<PendingEInvoiceOutbox>(
      job.data.outboxId
        ? `SELECT id, tenant_id, entity_id, event_type, payload, attempts, max_attempts
             FROM einvoice_outbox
            WHERE id = $1 AND status = 'pending' AND attempts < max_attempts`
        : `SELECT id, tenant_id, entity_id, event_type, payload, attempts, max_attempts
             FROM einvoice_outbox
            WHERE status = 'pending' AND attempts < max_attempts
            ORDER BY created_at ASC
            LIMIT $1`,
      job.data.outboxId ? [job.data.outboxId] : [batchSize],
    );

    deps.logger.info(
      { queue: 'einvoice-outbox', jobId: job.id, count: rows.rows.length },
      'Bekleyen e-Dönüşüm kaydı',
    );

    for (const rec of rows.rows) {
      await processEInvoiceOutboxRecord(pool, deps, rec);
    }
  };
}

// ======================= Günlük / Haftalık özet =======================

/** Günlük/haftalık özet e-postası job'ı (Faz 7 — ROADMAP §819). */
export interface DigestJob {
  /** Özet türü; boşsa 'daily'. */
  period?: DigestPeriod;
  /** Hedef tenant'lar; boşsa tüm aktif tenant'lar. */
  tenantIds?: string[];
}

/** Bir tarihi tenant saat diliminde okunabilir biçime çevirir (tr-TR). */
function formatDigestDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(at);
  }
}

/** PoolClient.query'yi paylaşılan `RowQuery` sözleşmesine bağlar. */
function digestQueryOf(client: pg.PoolClient): RowQuery {
  return (text, params) => client.query(text, params as never);
}

/**
 * Günlük/haftalık özet e-postası handler'ı.
 *
 * Her aktif tenant'ın sahibine (is_owner) özet gönderir. Gövde, dashboard ile aynı
 * kural motorundan (`buildDashboardSummary` — paylaşılan kernel) üretilir; e-posta
 * `email_outbox`'a yazılır ve mevcut outbox→email akışıyla gönderilir (SPEC §19.1).
 * Böylece "dashboard tutarı ile özet aynı kuralları kullanır" (ROADMAP kabul kriteri).
 *
 * Idempotency: aynı dönem için (günlük: aynı gün, haftalık: aynı hafta) aynı alıcıya
 * aynı konuyla kayıt varsa tekrar kuyruğa yazılmaz (ADR-0020 — at-least-once delivery).
 */
export function createDigestHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<DigestJob>): Promise<void> => {
    const period: DigestPeriod = job.data.period ?? 'daily';
    const tenantIds = job.data.tenantIds ?? null;
    const pool = getPool('app');

    const recipients = await pool.query<{
      tenant_id: string;
      timezone: string;
      email: string;
    }>(
      `SELECT t.id AS tenant_id, t.timezone, u.email
         FROM tenants t
         JOIN tenant_users tu ON tu.tenant_id = t.id AND tu.is_owner = true
         JOIN users u ON u.id = tu.user_id AND u.status = 'active'
        WHERE t.status = 'active'
          ${tenantIds ? 'AND t.id = ANY($1::uuid[])' : ''}
        ORDER BY t.id, u.email`,
      tenantIds ? [tenantIds] : [],
    );

    deps.logger.info(
      { queue: 'management-digest', jobId: job.id, period, count: recipients.rows.length },
      'Özet e-postası hazırlanıyor',
    );

    let queued = 0;
    let skipped = 0;
    for (const rec of recipients.rows) {
      const summary = await withTenant(pool, rec.tenant_id, (client) =>
        buildDashboardSummary(digestQueryOf(client)),
      );
      const userName = rec.email.split('@')[0] ?? '';
      const rendered =
        period === 'daily'
          ? renderEmailTemplate('management.daily_digest', {
              user_name: userName,
              date: formatDigestDate(new Date(), rec.timezone),
              summary: formatDigestSummary(summary, 'daily'),
            })
          : renderEmailTemplate('management.weekly_digest', {
              user_name: userName,
              week_summary: formatDigestSummary(summary, 'weekly'),
            });

      const duplicate = await pool.query(
        period === 'daily'
          ? `SELECT 1 FROM email_outbox
              WHERE "to" = $1 AND subject = $2 AND created_at::date = CURRENT_DATE LIMIT 1`
          : `SELECT 1 FROM email_outbox
              WHERE "to" = $1 AND subject = $2 AND created_at >= date_trunc('week', now()) LIMIT 1`,
        [rec.email, rendered.subject],
      );
      if (duplicate.rows.length > 0) {
        skipped += 1;
        continue;
      }

      await pool.query(
        `INSERT INTO email_outbox (id, "to", subject, html, text, provider_ref, response, attempts, max_attempts, next_attempt_at, status, created_at, sent_at)
         VALUES ($1, $2, $3, $4, $5, '', NULL, 0, 3, now(), 'pending', now(), NULL)`,
        [newId(), rec.email, rendered.subject, rendered.html, rendered.text],
      );
      queued += 1;
      deps.logger.info(
        { tenantId: rec.tenant_id, to: rec.email, period },
        'Özet e-postası kuyruğa alındı',
      );
    }

    deps.logger.info({ period, queued, skipped }, 'Özet e-postası tamamlandı');
  };
}

// ======================= Faturalama dunning (Faz 4 — SPEC §8.7/§8.8) =======================

/**
 * Dunning job'ı — başarısız tahsilatta yeniden deneme.
 *
 * Her aktif tenant için bekleyen ilk denemeyi kilitler (SKIP LOCKED — eşzamanlı
 * worker güvenli), `deps.payment.charge` ile yeniden tahsilat dener (harici I/O
 * **transaction DIŞINDA**), sonucu paylaşılan kernel `applyDunningOutcome` ile tek
 * transaction'da uygular. API'nin `processDueDunning`'iyle AYNI orkestrasyon (DRY —
 * `@kuleplus/shared` kernel fonksiyonları).
 *
 * Idempotency (ADR-0020): `SKIP LOCKED` + `processing` işareti aynı denemenin iki kez
 * tahsil edilmesini engeller. `deps.payment` verilmezse dunning atlanır (K-08 kapalıyken
 * no-op). `tenantIds` verilirse yalnız o tenant'lar taranar (test/manuel tetik).
 */
export interface BillingDunningJob {
  /** Hedef tenant'lar; boşsa bekleyen denemesi olan tüm aktif tenant'lar. */
  tenantIds?: string[];
}

export function createDunningHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<BillingDunningJob>): Promise<void> => {
    if (!deps.payment) {
      deps.logger.warn(
        { jobId: job.id },
        'Dunning atlandı: payment sağlayıcısı tanımlı değil (PAYMENT_PROVIDER kapalı)',
      );
      return;
    }
    const pool = getPool('app');
    const tenantIds = job.data.tenantIds ?? null;

    // Bekleyen denemesi olan aktif tenant'lar (hedef tenant filtresi varsa ona göre).
    const { rows } = await pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT da.tenant_id
         FROM dunning_attempts da
         JOIN tenants t ON t.id = da.tenant_id AND t.status = 'active'
        WHERE da.status = 'pending' AND da.scheduled_at <= now()
          ${tenantIds ? 'AND da.tenant_id = ANY($1::uuid[])' : ''}
        ORDER BY da.tenant_id`,
      tenantIds ? [tenantIds] : [],
    );

    deps.logger.info(
      { queue: 'billing-dunning', jobId: job.id, count: rows.length },
      'Dunning taraması başlıyor',
    );

    let processed = 0;
    let succeeded = 0;
    let suspended = 0;
    for (const { tenant_id: tenantId } of rows) {
      const attempt = await withTenant(pool, tenantId, (client) =>
        claimDueDunningRow(digestQueryOf(client)),
      );
      if (!attempt) continue;

      // Harici tahsilat — transaction DIŞINDA (kilitli bağlantıyı I/O'da tutmayız).
      const charge = await deps.payment.charge({
        providerCustomerRef: '',
        idempotencyKey: `${attempt.order_id}:dunning:${attempt.attempt_no}`,
        amount: attempt.amount,
        currency: attempt.currency,
        description: `Dunning — sipariş ${attempt.order_id}`,
      });

      const result = await withTenant(pool, tenantId, (client) =>
        applyDunningOutcome(digestQueryOf(client), {
          attempt,
          succeeded: charge.status === 'succeeded',
          providerRef: charge.providerRef,
          detail: charge.detail ?? null,
        }),
      );
      processed += result.processed;
      succeeded += result.succeeded;
      suspended += result.suspended;
    }

    deps.logger.info(
      { jobId: job.id, tenants: rows.length, processed, succeeded, suspended },
      'Dunning taraması tamamlandı',
    );
  };
}

// ======================= Web Push (Faz 7 — ROADMAP §812, §822) =======================

/** Web Push dağıtım job'ı — bekleyen `notification_deliveries` (channel=push) işlenir. */
export interface PushDispatchJob {
  /** İşlenecek tenant'lar; boşsa tüm aktif tenant'lar. */
  tenantIds?: string[];
  /** Tenant başına tek turda işlenecek en fazla teslim kaydı. */
  limit?: number;
}

/** VAPID anahtarlarıyla gerçek Web Push gönderen sağlayıcı (SPEC §29.1). */
export function createWebPushProvider(cfg: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): WorkerPushPort {
  setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    async send(subscription, payload) {
      try {
        const result = await sendNotification(subscription, payload);
        return { ok: true, statusCode: result.statusCode };
      } catch (error) {
        const err = error as { statusCode?: number; message?: string };
        const statusCode = err.statusCode;
        return {
          ok: false,
          statusCode,
          gone: statusCode === 404 || statusCode === 410,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Geliştirme mock'u: VAPID anahtarları yokken gerçek gönderim yerine loglar.
 * Boru hattının uçtan uca (kuyruk → işleme → durum) doğrulanmasını sağlar.
 */
export function createWebPushMockProvider(logger?: Logger): WorkerPushPort {
  return {
    async send(subscription, payload) {
      logger?.info(
        { endpoint: subscription.endpoint, payload },
        '[push-mock] Web Push gönderildi (dev)',
      );
      return { ok: true, statusCode: 201 };
    },
  };
}

interface PendingPushDelivery {
  delivery_id: string;
  tenant_id: string;
  user_id: string;
  attempts: number;
  notification_type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  pref_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

/** Teslim kaydını kalıcı hata ile işaretler. */
async function failPushDelivery(
  client: pg.PoolClient,
  deliveryId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE notification_deliveries
        SET status = 'failed', last_error = $2, updated_at = now()
      WHERE id = $1`,
    [deliveryId, reason],
  );
}

/**
 * Web Push dağıtım handler'ı.
 *
 * Bekleyen `notification_deliveries` (channel='push', status='pending') kayıtlarını işler:
 * kullanıcı tercihi kapalıysa gönderilmez; sessiz saatlerde bekletilir (erteleme);
 * cihaz aboneliği geçersizse (404/410) cihaz pasifleştirilir. Başarıda `sent`, kalıcı
 * hatada `failed`, geçici hatada tekrar denenir (SPEC §17.2 — teslim takibi).
 *
 * Idempotency: yalnızca `pending` kayıtlar seçilir; başarılı gönderim `sent` olur ve
 * tekrar seçilmez (ADR-0020 — at-least-once).
 */
export function createPushDispatchHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<PushDispatchJob>): Promise<void> => {
    const { logger, push } = deps;
    if (!push) {
      logger.warn({ queue: 'notification-push' }, 'Web Push sağlayıcısı yok — job atlandı.');
      return;
    }
    const pool = getPool('app');
    const limit = job.data.limit ?? 100;
    const tenantIds = job.data.tenantIds ?? null;

    const tenants = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE status = 'active'
        ${tenantIds ? 'AND id = ANY($1::uuid[])' : ''}
       ORDER BY id`,
      tenantIds ? [tenantIds] : [],
    );

    let sent = 0;
    let failed = 0;
    let deferred = 0;

    for (const tenant of tenants.rows) {
      await withTenant(pool, tenant.id, async (client) => {
        const pending = await client.query<PendingPushDelivery>(
          `SELECT d.id AS delivery_id, d.tenant_id, d.user_id, d.attempts,
                  n.notification_type, n.title, n.body, n.entity_type, n.entity_id,
                  p.enabled AS pref_enabled, p.quiet_hours_start, p.quiet_hours_end
             FROM notification_deliveries d
             JOIN notifications n ON n.id = d.notification_id AND n.tenant_id = d.tenant_id
             LEFT JOIN notification_preferences p
               ON p.tenant_id = d.tenant_id AND p.user_id = d.user_id
              AND p.notification_type = n.notification_type AND p.channel = 'push'
            WHERE d.channel = 'push' AND d.status = 'pending'
            ORDER BY d.created_at
            LIMIT $1`,
          [limit],
        );

        for (const d of pending.rows) {
          if (d.pref_enabled === false) {
            await failPushDelivery(client, d.delivery_id, 'kullanıcı tercihi kapalı');
            failed += 1;
            continue;
          }

          if (
            isWithinQuietHours(new Date(), {
              quietHoursStart: d.quiet_hours_start,
              quietHoursEnd: d.quiet_hours_end,
            })
          ) {
            deferred += 1; // sessiz saatler: bir sonraki taramada gönderilir
            continue;
          }

          const devices = await client.query<{ id: string; device_token: string }>(
            `SELECT id, device_token FROM user_devices
              WHERE user_id = $1 AND is_active = true AND platform = 'web'`,
            [d.user_id],
          );
          if (devices.rows.length === 0) {
            await failPushDelivery(client, d.delivery_id, 'aktif cihaz yok');
            failed += 1;
            continue;
          }

          const payload = JSON.stringify(
            buildPushPayload({
              title: d.title,
              body: d.body,
              notificationType: d.notification_type,
              entityType: d.entity_type,
              entityId: d.entity_id,
            }),
          );

          let anyOk = false;
          let lastError: string | null = null;
          for (const device of devices.rows) {
            let subscription: PushSubscription;
            try {
              subscription = JSON.parse(device.device_token) as PushSubscription;
            } catch {
              await client.query(`UPDATE user_devices SET is_active = false WHERE id = $1`, [
                device.id,
              ]);
              continue;
            }
            const result = await push.send(subscription, payload);
            if (result.ok) {
              anyOk = true;
            } else {
              lastError = result.error ?? `HTTP ${result.statusCode ?? '??'}`;
              if (result.gone) {
                await client.query(
                  `UPDATE user_devices SET is_active = false, updated_at = now() WHERE id = $1`,
                  [device.id],
                );
              }
            }
          }

          const attempts = Number(d.attempts) + 1;
          if (anyOk) {
            await client.query(
              `UPDATE notification_deliveries
                  SET status = 'sent', delivered_at = now(), attempts = $2,
                      last_error = NULL, updated_at = now()
                WHERE id = $1`,
              [d.delivery_id, attempts],
            );
            sent += 1;
          } else if (attempts >= 3) {
            await client.query(
              `UPDATE notification_deliveries
                  SET status = 'failed', attempts = $2, last_error = $3, updated_at = now()
                WHERE id = $1`,
              [d.delivery_id, attempts, lastError],
            );
            failed += 1;
          } else {
            await client.query(
              `UPDATE notification_deliveries
                  SET attempts = $2, last_error = $3, updated_at = now()
                WHERE id = $1`,
              [d.delivery_id, attempts, lastError],
            );
            failed += 1;
          }
        }
      });
    }

    logger.info(
      { sent, failed, deferred, tenants: tenants.rows.length },
      'Web Push dağıtımı tamamlandı',
    );
  };
}
