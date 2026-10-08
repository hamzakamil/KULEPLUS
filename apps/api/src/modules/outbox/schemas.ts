import { z } from 'zod';

export const outboxListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending', 'sent', 'failed']).optional(),
  }),
});

export const outboxParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const outboxEnqueueSchema = z.object({
  body: z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    html: z.string().min(1),
    text: z.string().optional(),
  }),
});

export type OutboxListQuery = z.infer<typeof outboxListQuerySchema>['query'];
export type OutboxParams = z.infer<typeof outboxParamsSchema>['params'];
export type OutboxEnqueueInput = z.infer<typeof outboxEnqueueSchema>['body'];
