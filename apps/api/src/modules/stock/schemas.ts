import { z } from 'zod';

export const stockMovementTypeSchema = z.enum([
  'in',
  'out',
  'adjustment',
  'transfer',
  'count',
  'adjustment_in',
  'adjustment_out',
]);
export const stockDocumentTypeSchema = z.enum([
  'purchase',
  'sale',
  'transfer',
  'adjustment',
  'count',
]);
export const stockDocumentStatusSchema = z.enum(['draft', 'posted', 'cancelled']);
export const inventoryCountStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export const unitAbbreviationSchema = z.string().max(10);

/** Stok hareketi oluşturma */
export const createStockMovementSchema = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid().optional(),
  type: stockMovementTypeSchema,
  quantity: z.number().positive(),
  notes: z.string().optional(),
});

/** Stok bakiyesi filtreleme */
export const listStockBalancesSchema = z.object({
  product_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
});

/** Stok listesi (basit) */
export const listStockSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  product_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  status: z.enum(['low', 'normal', 'overstock']).optional(),
});

/** Stok ürün girişi */
export const createStockEntrySchema = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit_id: z.string().uuid().optional(),
  cost_price: z.number().positive().optional(),
});

/** Stok ürün çıkışı */
export const createStockOutSchema = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().max(200).optional(),
});

/** Barkkod oluşturma */
export const createBarcodeSchema = z.object({
  product_id: z.string().uuid(),
  barcode: z.string().min(1),
  type: z.enum(['ean13', 'qrcode', 'code128', 'upc']).default('ean13'),
});

/** Birim dönüşümü */
export const createUnitConversionSchema = z.object({
  from_unit_id: z.string().uuid(),
  to_unit_id: z.string().uuid(),
  conversion_factor: z.number().positive(),
});
