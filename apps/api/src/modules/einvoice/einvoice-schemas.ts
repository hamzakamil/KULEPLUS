/** Faz 4 — e-Dönüşüm şemaları (Zod). */

import { z } from 'zod';

export const einvoiceSendSchema = z.object({
  sourceType: z.enum([
    'invoice',
    'credit_note',
    'debit_note',
    'delivery_note',
    'original_evrak',
    'evrak_eni',
  ]),
  sourceId: z.string().uuid('Geçerli UUID gerekli'),
});

export const einvoiceStatusQuerySchema = z.object({
  status: z
    .enum(['pending', 'sent', 'delivered', 'accepted', 'rejected', 'cancelled', 'expired'])
    .optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const einvoiceCancelSchema = z.object({
  reason: z.string().min(1, 'İptal nedeni gerekli').max(500),
});

export const einvoiceDownloadQuerySchema = z.object({
  format: z.enum(['xml', 'pdf']).default('xml'),
});

export const einvoiceInboxQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
