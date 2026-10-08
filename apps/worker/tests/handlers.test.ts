import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';
import {
  createEmailSendHandler,
  createOutboxDispatchHandler,
  type WorkerEmailPort,
  type WorkerOutboxRepository,
} from '../src/handlers';

/**
 * Worker handler testleri (SPEC §19.1, ADR-0020).
 * Idempotency ve hata/deneme davranışı doğrulanır.
 */

const logger = pino({ level: 'silent' });

function fakeJob<T>(data: T, id = 'job-1') {
  return { id, data } as unknown as Job<T>;
}

function makeEmail(overrides: Partial<WorkerEmailPort> = {}): WorkerEmailPort {
  return {
    send: vi.fn(async () => ({ providerRef: 'prov-1', status: 'sent' as const })),
    ...overrides,
  };
}

function makeOutbox(overrides: Partial<WorkerOutboxRepository> = {}): WorkerOutboxRepository {
  return {
    claimPending: vi.fn(async () => []),
    markAsSent: vi.fn(async () => {}),
    markAsFailed: vi.fn(async () => {}),
    recordAttempt: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createEmailSendHandler', () => {
  it('başarılı gönderimde markAsSent çağırır', async () => {
    const email = makeEmail();
    const outbox = makeOutbox();
    const handler = createEmailSendHandler({ logger, email, outbox });

    await handler(fakeJob({ outboxId: 'ob-1', to: 'a@b.com', subject: 'S', html: '<p>H</p>' }));

    expect(email.send).toHaveBeenCalledOnce();
    expect(outbox.markAsSent).toHaveBeenCalledWith('ob-1', 'prov-1', 'ok');
    expect(outbox.markAsFailed).not.toHaveBeenCalled();
  });

  it('hata durumunda deneme kaydeder, failed işaretler ve hatayı yeniden fırlatır (retry)', async () => {
    const email = makeEmail({
      send: vi.fn(async () => {
        throw new Error('SMTP kapalı');
      }),
    });
    const outbox = makeOutbox();
    const handler = createEmailSendHandler({ logger, email, outbox });

    await expect(
      handler(fakeJob({ outboxId: 'ob-2', to: 'a@b.com', subject: 'S', html: 'H' })),
    ).rejects.toThrow('SMTP kapalı');

    expect(outbox.recordAttempt).toHaveBeenCalledWith('ob-2');
    expect(outbox.markAsFailed).toHaveBeenCalledWith('ob-2', 'SMTP kapalı');
    expect(outbox.markAsSent).not.toHaveBeenCalled();
  });
});

describe('createOutboxDispatchHandler', () => {
  it('bekleyen kayıtları email kuyruğuna aktarır', async () => {
    const outbox = makeOutbox({
      claimPending: vi.fn(async () => [
        { id: 'ob-1', to: 'a@b.com', subject: 'A', html: 'HA', text: null },
        { id: 'ob-2', to: 'c@d.com', subject: 'B', html: 'HB', text: 'TB' },
      ]),
    });
    const enqueue = vi.fn(async () => {});
    const handler = createOutboxDispatchHandler({ logger, email: makeEmail(), outbox }, enqueue);

    await handler(fakeJob({ batchSize: 10 }));

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'ob-1', to: 'a@b.com' }),
    );
  });

  it('batchSize üst sınırı 200 ile sınırlanır', async () => {
    const claimPending = vi.fn(async () => []);
    const outbox = makeOutbox({ claimPending });
    const handler = createOutboxDispatchHandler(
      { logger, email: makeEmail(), outbox },
      vi.fn(async () => {}),
    );

    await handler(fakeJob({ batchSize: 9999 }));
    expect(claimPending).toHaveBeenCalledWith(200);
  });

  it('bekleyen yoksa kuyruğa bir şey eklemez', async () => {
    const enqueue = vi.fn(async () => {});
    const outbox = makeOutbox({ claimPending: vi.fn(async () => []) });
    const handler = createOutboxDispatchHandler({ logger, email: makeEmail(), outbox }, enqueue);

    await handler(fakeJob({}));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
