import type { Logger } from 'pino';
import type { Job } from 'bullmq';

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
  email: WorkerEmailPort;
  outbox: WorkerOutboxRepository;
}

/**
 * E-posta gönderim handler'ı.
 * Idempotency: aynı outboxId için gönderim başarılıysa tekrar gönderilmez
 * (markAsSent + claimPending filtresi ile korunur).
 */
export function createEmailSendHandler(deps: WorkerHandlerDeps) {
  return async (job: Job<EmailSendJob>): Promise<void> => {
    const { outboxId, to, subject, html, text } = job.data;
    deps.logger.info({ queue: 'email-send', jobId: job.id, outboxId }, 'E-posta gönderiliyor');
    try {
      const result = await deps.email.send({ to, subject, html, text });
      await deps.outbox.markAsSent(outboxId, result.providerRef, 'ok');
      deps.logger.info({ outboxId, providerRef: result.providerRef }, 'E-posta gönderildi');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await deps.outbox.recordAttempt(outboxId);
      await deps.outbox.markAsFailed(outboxId, reason);
      deps.logger.error({ outboxId, err: reason }, 'E-posta gönderilemedi');
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
    const batchSize = Math.min(job.data.batchSize ?? 50, 200);
    const pending = await deps.outbox.claimPending(batchSize);
    deps.logger.info({ queue: 'outbox-dispatch', count: pending.length }, 'Bekleyen outbox kaydı');

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
