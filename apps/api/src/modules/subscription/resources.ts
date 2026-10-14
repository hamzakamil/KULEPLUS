/**
 * Subscription kayınak tanımları — tek kaynak (single source of truth).
 *
 * Aynı tanım iki yeri besler:
 *  1. `service.ts` tablo sürücüsü (SELECT sütunları + yazma whitelist'i),
 *  2. `schemas.ts` zod şemaları (create/update doğrulaması).
 * Böylece rota ↔ servis ↔ şema üçlüsü birbirinden ayrışamaz (SPEC §29.2).
 */

export type ColumnKind = 'uuid' | 'text' | 'numeric' | 'boolean' | 'timestamptz';

export interface ColumnSpec {
  name: string;
  kind: ColumnKind;
  /** POST gövdesinde zorunlu. */
  required?: boolean;
  maxLength?: number;
  enum?: readonly string[];
}

export interface ResourceDef {
  key: string;
  table: string;
  /** SELECT sütunları (tablodaki gerçek kolonlar). */
  columns: string[];
  /** Yazılabilir alanlar (INSERT/UPDATE whitelist'i). */
  writable: ColumnSpec[];
  /** tenant_id kolonu yok → platform geneli katalog (RLS kapsamı dışı). */
  global?: boolean;
  /** Alt kaynak: üst kaydın kolonu (rota `:param` değerinden doldurulur). */
  parentColumn?: string;
}

// ===== Durum sözlükleri (migration CHECK'leriyle birebir) =====
export const SUBSCRIPTION_STATUSES = [
  'pending_activation',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'expired',
] as const;
export const CHANGE_TYPES = ['create', 'upgrade', 'downgrade', 'cancel', 'reactivate'] as const;
export const CHANGE_STATUSES = ['scheduled', 'applied', 'cancelled'] as const;
export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded'] as const;
export const PAYMENT_METHODS = ['card', 'bank_transfer'] as const;
export const PAYMENT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'partially_refunded',
  'refunded',
  'disputed',
] as const;
export const BILLING_PAYMENT_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'cancelled'] as const;
export const DISCOUNT_TYPES = ['percent', 'amount'] as const;
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const;

export const RESOURCES: Record<string, ResourceDef> = {
  subscriptions: {
    key: 'subscriptions',
    table: 'subscriptions',
    columns: [
      'id',
      'tenant_id',
      'plan_version_id',
      'status',
      'started_at',
      'current_period_start',
      'current_period_end',
      'cancel_at_period_end',
      'cancelled_at',
      'created_at',
      'updated_at',
    ],
    writable: [
      { name: 'plan_version_id', kind: 'uuid', required: true },
      { name: 'status', kind: 'text', enum: SUBSCRIPTION_STATUSES },
      { name: 'current_period_end', kind: 'timestamptz' },
      { name: 'cancel_at_period_end', kind: 'boolean' },
    ],
  },
  subscriptionItems: {
    key: 'subscriptionItems',
    table: 'subscription_items',
    columns: ['id', 'tenant_id', 'subscription_id', 'module_code', 'quantity', 'created_at'],
    parentColumn: 'subscription_id',
    writable: [
      { name: 'module_code', kind: 'text', required: true, maxLength: 50 },
      { name: 'quantity', kind: 'numeric' },
    ],
  },
  subscriptionChanges: {
    key: 'subscriptionChanges',
    table: 'subscription_changes',
    columns: [
      'id',
      'tenant_id',
      'subscription_id',
      'change_type',
      'from_plan_version_id',
      'to_plan_version_id',
      'effective_at',
      'status',
      'created_at',
    ],
    parentColumn: 'subscription_id',
    writable: [
      { name: 'change_type', kind: 'text', required: true, enum: CHANGE_TYPES },
      { name: 'from_plan_version_id', kind: 'uuid' },
      { name: 'to_plan_version_id', kind: 'uuid' },
      { name: 'effective_at', kind: 'timestamptz' },
      { name: 'status', kind: 'text', enum: CHANGE_STATUSES },
    ],
  },
  commercialOrders: {
    key: 'commercialOrders',
    table: 'commercial_orders',
    columns: [
      'id',
      'tenant_id',
      'order_no',
      'plan_version_id',
      'amount',
      'currency',
      'payment_method',
      'status',
      'created_at',
      'updated_at',
    ],
    writable: [
      { name: 'order_no', kind: 'text', required: true, maxLength: 40 },
      { name: 'plan_version_id', kind: 'uuid', required: true },
      { name: 'amount', kind: 'numeric', required: true },
      { name: 'currency', kind: 'text', maxLength: 3 },
      { name: 'payment_method', kind: 'text', enum: PAYMENT_METHODS },
      { name: 'status', kind: 'text', enum: ORDER_STATUSES },
    ],
  },
  commercialOrderItems: {
    key: 'commercialOrderItems',
    table: 'commercial_order_items',
    columns: ['id', 'tenant_id', 'order_id', 'module_code', 'amount', 'created_at'],
    parentColumn: 'order_id',
    writable: [
      { name: 'module_code', kind: 'text', required: true, maxLength: 50 },
      { name: 'amount', kind: 'numeric' },
    ],
  },
  paymentAttempts: {
    key: 'paymentAttempts',
    table: 'payment_attempts',
    columns: [
      'id',
      'tenant_id',
      'order_id',
      'provider',
      'provider_ref',
      'idempotency_key',
      'amount',
      'currency',
      'status',
      'detail',
      'created_at',
    ],
    writable: [
      { name: 'order_id', kind: 'uuid', required: true },
      { name: 'provider', kind: 'text', required: true, maxLength: 40 },
      { name: 'provider_ref', kind: 'text', maxLength: 120 },
      { name: 'idempotency_key', kind: 'text', required: true, maxLength: 160 },
      { name: 'amount', kind: 'numeric', required: true },
      { name: 'currency', kind: 'text', maxLength: 3 },
      { name: 'status', kind: 'text', required: true, enum: PAYMENT_STATUSES },
      { name: 'detail', kind: 'text', maxLength: 500 },
    ],
  },
  billingPayments: {
    key: 'billingPayments',
    table: 'billing_payments',
    columns: [
      'id',
      'tenant_id',
      'order_id',
      'amount',
      'currency',
      'status',
      'provider_ref',
      'paid_at',
      'created_at',
    ],
    writable: [
      { name: 'order_id', kind: 'uuid', required: true },
      { name: 'amount', kind: 'numeric', required: true },
      { name: 'currency', kind: 'text', maxLength: 3 },
      { name: 'status', kind: 'text', enum: BILLING_PAYMENT_STATUSES },
      { name: 'provider_ref', kind: 'text', maxLength: 120 },
      { name: 'paid_at', kind: 'timestamptz' },
    ],
  },
  billingRefunds: {
    key: 'billingRefunds',
    table: 'billing_refunds',
    columns: [
      'id',
      'tenant_id',
      'payment_id',
      'order_id',
      'provider_ref',
      'amount',
      'currency',
      'status',
      'reason',
      'refunded_at',
      'created_at',
    ],
    parentColumn: 'payment_id',
    writable: [
      { name: 'order_id', kind: 'uuid', required: true },
      { name: 'provider_ref', kind: 'text', maxLength: 120 },
      { name: 'amount', kind: 'numeric', required: true },
      { name: 'currency', kind: 'text', maxLength: 3 },
      { name: 'status', kind: 'text', enum: REFUND_STATUSES },
      { name: 'reason', kind: 'text', maxLength: 500 },
      { name: 'refunded_at', kind: 'timestamptz' },
    ],
  },
  billingAllocations: {
    key: 'billingAllocations',
    table: 'billing_allocations',
    columns: [
      'id',
      'tenant_id',
      'payment_id',
      'invoice_id',
      'amount',
      'allocated_at',
      'created_at',
    ],
    parentColumn: 'payment_id',
    writable: [
      { name: 'invoice_id', kind: 'uuid', required: true },
      { name: 'amount', kind: 'numeric', required: true },
      { name: 'allocated_at', kind: 'timestamptz' },
    ],
  },
  billingInvoices: {
    key: 'billingInvoices',
    table: 'billing_invoices',
    columns: [
      'id',
      'tenant_id',
      'order_id',
      'number',
      'subtotal',
      'vat_total',
      'total',
      'currency',
      'status',
      'issued_at',
      'created_at',
    ],
    writable: [
      { name: 'order_id', kind: 'uuid', required: true },
      { name: 'number', kind: 'text', required: true, maxLength: 40 },
      { name: 'subtotal', kind: 'numeric' },
      { name: 'vat_total', kind: 'numeric' },
      { name: 'total', kind: 'numeric' },
      { name: 'currency', kind: 'text', maxLength: 3 },
      { name: 'status', kind: 'text', enum: INVOICE_STATUSES },
      { name: 'issued_at', kind: 'timestamptz' },
    ],
  },
  billingInvoiceLines: {
    key: 'billingInvoiceLines',
    table: 'billing_invoice_lines',
    columns: [
      'id',
      'tenant_id',
      'invoice_id',
      'description',
      'amount',
      'vat_rate',
      'vat_amount',
      'total',
      'created_at',
    ],
    parentColumn: 'invoice_id',
    writable: [
      { name: 'description', kind: 'text', required: true, maxLength: 255 },
      { name: 'amount', kind: 'numeric' },
      { name: 'vat_rate', kind: 'numeric' },
      { name: 'vat_amount', kind: 'numeric' },
      { name: 'total', kind: 'numeric' },
    ],
  },
  coupons: {
    key: 'coupons',
    table: 'coupons',
    columns: [
      'id',
      'code',
      'discount_type',
      'discount_value',
      'valid_from',
      'valid_until',
      'is_active',
      'created_at',
    ],
    global: true,
    writable: [
      { name: 'code', kind: 'text', required: true, maxLength: 60 },
      { name: 'discount_type', kind: 'text', required: true, enum: DISCOUNT_TYPES },
      { name: 'discount_value', kind: 'numeric', required: true },
      { name: 'valid_from', kind: 'timestamptz' },
      { name: 'valid_until', kind: 'timestamptz' },
      { name: 'is_active', kind: 'boolean' },
    ],
  },

  couponRedemptions: {
    key: 'couponRedemptions',
    table: 'coupon_redemptions',
    columns: ['id', 'tenant_id', 'coupon_id', 'order_id', 'redeemed_at'],
    parentColumn: 'coupon_id',
    writable: [{ name: 'order_id', kind: 'uuid', required: true }],
  },
  partners: {
    key: 'partners',
    table: 'partners',
    columns: ['id', 'code', 'name', 'commission_rate', 'is_active', 'created_at'],
    global: true,
    writable: [
      { name: 'code', kind: 'text', required: true, maxLength: 60 },
      { name: 'name', kind: 'text', required: true, maxLength: 255 },
      { name: 'commission_rate', kind: 'numeric' },
      { name: 'is_active', kind: 'boolean' },
    ],
  },
  partnerReferrals: {
    key: 'partnerReferrals',
    table: 'partner_referrals',
    columns: ['id', 'tenant_id', 'partner_id', 'referred_at'],
    parentColumn: 'partner_id',
    writable: [{ name: 'referred_at', kind: 'timestamptz' }],
  },
  partnerCommissions: {
    key: 'partnerCommissions',
    table: 'partner_commissions',
    columns: ['id', 'tenant_id', 'partner_id', 'order_id', 'amount', 'status', 'created_at'],
    parentColumn: 'partner_id',
    writable: [
      { name: 'order_id', kind: 'uuid', required: true },
      { name: 'amount', kind: 'numeric' },
      { name: 'status', kind: 'text', enum: COMMISSION_STATUSES },
    ],
  },
} as const;
