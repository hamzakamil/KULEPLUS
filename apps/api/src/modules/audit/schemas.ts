import { z } from 'zod';

export const auditListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().optional(),
    entityType: z.string().optional(),
    userId: z.string().uuid().optional(),
    after: z.preprocess((arg) => (arg ? new Date(arg as string) : undefined), z.date().optional()),
    before: z.preprocess((arg) => (arg ? new Date(arg as string) : undefined), z.date().optional()),
    sortBy: z.enum(['created_at', 'action', 'user_id']).default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
});

export const auditParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>['query'];
export type AuditParams = z.infer<typeof auditParamsSchema>['params'];
