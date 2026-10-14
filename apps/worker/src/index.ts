import { Queue, Worker, type Job } from 'bullmq';
import pino from 'pino';
import {
  createEmailSendHandler,
  createOutboxDispatchHandler,
  createCurrencyImportHandler,
  createEInvoiceOutboxHandler,
  createDigestHandler,
  createPushDispatchHandler,
  createDunningHandler,
  createLifecycleHandler,
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
  currencyImport: 'currency-import',
  einvoiceOutbox: 'einvoice-outbox',
  digest: 'management-digest',
  push: 'notification-push',
  billingDunning: 'billing-dunning',
  billingLifecycle: 'billing-lifecycle',
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

  // Repeatable job: TCMB kur içe aktarma — her gün 16:30 (TCMB yayını sonrası).
  // BullMQ v6: repeatable işler `upsertJobScheduler` ile kurulur (idempotent, jobId yerine scheduler key).
  await queues[QUEUE_NAMES.currencyImport].upsertJobScheduler(
    'daily-tcmb-import',
    { pattern: '30 16 * * *', tz: 'Europe/Istanbul' },
    {
      name: 'daily-tcmb-import',
      data: {},
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // Repeatable job: e-Dönüşüm outbox — bekleyen gönderimleri her dakika işler (SPEC §21.2).
  // Idempotent: einvoice_outbox attempts < max_attempts filtresi + sağlayıcı idempotent sözleşmesi.
  await queues[QUEUE_NAMES.einvoiceOutbox].upsertJobScheduler(
    'einvoice-outbox-dispatch',
    { every: 60_000, immediately: true },
    {
      name: 'dispatch-pending',
      data: {},
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // Repeatable job: Günlük özet e-postası — her gün 08:00 (T-7.3, ROADMAP §819).
  // Tenant saat dilimi varsayılanı Europe/Istanbul (tenants.timezone DEFAULT, ADR-0019).
  await queues[QUEUE_NAMES.digest].upsertJobScheduler(
    'daily-digest',
    { pattern: '0 8 * * *', tz: 'Europe/Istanbul' },
    {
      name: 'daily-digest',
      data: { period: 'daily' },
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // Repeatable job: Haftalık özet e-postası — pazartesi 08:00 (ROADMAP §819).
  await queues[QUEUE_NAMES.digest].upsertJobScheduler(
    'weekly-digest',
    { pattern: '0 8 * * 1', tz: 'Europe/Istanbul' },
    {
      name: 'weekly-digest',
      data: { period: 'weekly' },
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // Repeatable job: Web Push dağıtımı — bekleyen push teslimlerini her dakika işler
  // (SPEC §17.2, ROADMAP §812). Sessiz saatlerde bekletilir; cihaz geçersizse pasifleştirilir.
  await queues[QUEUE_NAMES.push].upsertJobScheduler(
    'push-dispatch',
    { every: 60_000, immediately: true },
    {
      name: 'dispatch-pending',
      data: {},
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // Repeatable job: Faturalama dunning — vadesi gelmiş başarısız tahsilatları yeniden dener
  // (SPEC §8.7/§8.8). Idempotent: SKIP LOCKED + processing işareti (ADR-0020). `handlers.payment`
  // yoksa handler kurulmaz ve job'lar atlanır (K-08 kapalıyken no-op).
  await queues[QUEUE_NAMES.billingDunning].upsertJobScheduler(
    'billing-dunning',
    { every: 60_000, immediately: true },
    {
      name: 'process-due',
      data: {},
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  // yaşam döngüsü taraması — grace sonrası suspend ve dönem sonu iptalleri tek yerden.
  await queues[QUEUE_NAMES.billingLifecycle].upsertJobScheduler(
    'billing-lifecycle',
    { pattern: '0 4 * * *', tz: 'Europe/Istanbul' },
    {
      name: 'process-lifecycle',
      data: {},
      opts: { removeOnComplete: 10, removeOnFail: 5 },
    },
  );

  const emailHandler =
    handlers?.email && handlers?.outbox ? createEmailSendHandler(handlers) : null;
  const outboxHandler = handlers?.outbox
    ? createOutboxDispatchHandler(handlers, async (data: EmailSendJob) => {
        await queues[QUEUE_NAMES.email].add('send', data, {
          // Idempotency: aynı outbox kaydı iki kez kuyruğa girmez (ADR-0020)
          jobId: data.outboxId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        });
      })
    : null;
  const currencyImportHandler = handlers ? createCurrencyImportHandler(handlers) : null;
  // e-Dönüşüm handler'ı her zaman kurulur (handlers varsa): `handlers.einvoice` verilmezse
  // `processEInvoiceOutboxRecord` içindeki mock fallback devreye girer (SPEC §21.2).
  const einvoiceOutboxHandler = handlers
    ? createEInvoiceOutboxHandler({ logger: log, einvoice: handlers.einvoice })
    : null;
  const digestHandler = handlers ? createDigestHandler(handlers) : null;
  const pushHandler = handlers?.push ? createPushDispatchHandler(handlers) : null;
  // Dunning handler'ı yalnız payment sağlayıcısı verildiyse kurulur (K-08). Verilmezse
  // job'lar "handler atandı değil" ile atlanır (geliştirme/iskelet davranışı).
  const dunningHandler = handlers?.payment ? createDunningHandler(handlers) : null;
  // Yaşam döngüsü handler'ı harici bağımlılık istemez — handler'lar kurulduysa bağlanır.
  const lifecycleHandler = handlers ? createLifecycleHandler(handlers) : null;

  const processor = async (name: QueueName, job: Job) => {
    if (name === QUEUE_NAMES.email && emailHandler) return emailHandler(job);
    if (name === QUEUE_NAMES.outbox && outboxHandler) return outboxHandler(job);
    if (name === QUEUE_NAMES.currencyImport && currencyImportHandler)
      return currencyImportHandler(job);
    if (name === QUEUE_NAMES.einvoiceOutbox && einvoiceOutboxHandler)
      return einvoiceOutboxHandler(job);
    if (name === QUEUE_NAMES.digest && digestHandler) return digestHandler(job);
    if (name === QUEUE_NAMES.push && pushHandler) return pushHandler(job);
    if (name === QUEUE_NAMES.billingDunning && dunningHandler) return dunningHandler(job);
    if (name === QUEUE_NAMES.billingLifecycle && lifecycleHandler) return lifecycleHandler(job);
    log.warn({ queue: name, jobId: job.id }, 'Handler atandı değil — job atlandı.');
  };

  const workers: Worker[] = (Object.values(QUEUE_NAMES) as QueueName[]).map(
    (name) => new Worker(name, (job) => processor(name, job), { connection }),
  );

  for (const [i, worker] of workers.entries()) {
    worker.on('error', (error) => log.error({ queue: Object.keys(QUEUE_NAMES)[i] }, String(error)));
  }

  const wired: string[] = [];
  if (emailHandler) wired.push('email-send');
  if (outboxHandler) wired.push('outbox-dispatch');
  if (currencyImportHandler) wired.push('currency-import');
  if (einvoiceOutboxHandler) wired.push('einvoice-outbox');
  if (digestHandler) wired.push('management-digest');
  if (pushHandler) wired.push('notification-push');
  if (dunningHandler) wired.push('billing-dunning');
  if (lifecycleHandler) wired.push('billing-lifecycle');
  log.info(
    wired.length > 0
      ? `Worker hazır — bağlı handler'lar: ${wired.join(', ')}.`
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
