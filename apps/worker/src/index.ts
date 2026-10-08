import { Queue, Worker, type Job } from 'bullmq';
import pino from 'pino';
import {
  createEmailSendHandler,
  createOutboxDispatchHandler,
  type EmailSendJob,
  type WorkerHandlerDeps,
} from './handlers';

/**
 * Worker — Faz 1.
 * Outbox → BullMQ → e-posta gönderimi (SPEC §19.1, ADR-0020).
 * Handler tanımları `handlers.ts`; kuyruk adları tek yerden.
 */
export const QUEUE_NAMES = {
  outbox: 'outbox-dispatch',
  email: 'email-send',
  tenantExport: 'tenant-export',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface WorkerContext {
  redisUrl: string;
  logger?: pino.Logger;
  /**
   * Handler bağımlılıkları (SPEC §29.1 — DIP). Verilmezse kuyruklar kurulur ama
   * job'lar "handler yok" uyarısıyla atlanır (geliştirme/iskelet davranışı).
   */
  handlers?: WorkerHandlerDeps;
}

interface QueueHandles {
  queues: Record<QueueName, Queue>;
  workers: Worker[];
  close: () => Promise<void>;
}

/** Redis URL'sini host/port'a çevirir (localhost varsayılanı). */
export function parseRedisUrl(redisUrl: string): { host: string; port: number } {
  const url = new URL(redisUrl);
  return { host: url.hostname || 'localhost', port: Number(url.port) || 6379 };
}

/**
 * Worker'ları başlatır. Redis ayakta değilse BullMQ arka planda yeniden dener;
 * süreç çökmez. Handler bağımlılıkları verildiyse gerçek handler'lar bağlanır
 * (email-send, outbox-dispatch); verilmezse job'lar atlanır (SPEC §29.1).
 */
export async function startWorker({
  redisUrl,
  logger,
  handlers,
}: WorkerContext): Promise<QueueHandles> {
  const log = logger ?? pino({ level: 'info' });
  const connection = { ...parseRedisUrl(redisUrl), maxRetriesPerRequest: null };

  const queues = Object.fromEntries(
    Object.values(QUEUE_NAMES).map((name) => [name, new Queue(name, { connection })]),
  ) as Record<QueueName, Queue>;

  const emailHandler = handlers ? createEmailSendHandler(handlers) : null;
  const outboxHandler = handlers
    ? createOutboxDispatchHandler(handlers, async (data: EmailSendJob) => {
        await queues[QUEUE_NAMES.email].add('send', data, {
          // Idempotency: aynı outbox kaydı iki kez kuyruğa girmez (ADR-0020)
          jobId: data.outboxId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        });
      })
    : null;

  const processor = async (name: QueueName, job: Job) => {
    if (name === QUEUE_NAMES.email && emailHandler) return emailHandler(job);
    if (name === QUEUE_NAMES.outbox && outboxHandler) return outboxHandler(job);
    log.warn({ queue: name, jobId: job.id }, 'Handler atandı değil — job atlandı.');
  };

  const workers: Worker[] = (Object.values(QUEUE_NAMES) as QueueName[]).map(
    (name) => new Worker(name, (job) => processor(name, job), { connection }),
  );

  for (const [i, worker] of workers.entries()) {
    worker.on('error', (error) => log.error({ queue: Object.keys(QUEUE_NAMES)[i] }, String(error)));
  }

  log.info(
    handlers
      ? "Worker hazır — email-send ve outbox-dispatch handler'ları bağlı."
      : 'Worker iskelet hazır (handler bağımlılıkları verilmedi).',
  );
  return {
    queues,
    workers,
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(Object.values(queues).map((q) => q.close()));
    },
  };
}
