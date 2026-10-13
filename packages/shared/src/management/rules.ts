/**
 * Kural motoru tanımları (T-7.5: hazır kurallar KOD + parametreler DB).
 *
 * Paylaşılan kernel (ADR-0020): hem API (dashboard + kural ayarları) hem worker
 * (günlük/haftalık özet e-postası) aynı kural tanımlarını kullanır. Böylece
 * dashboard tutarı ile özet e-postası aynı eşikleri/sorguları paylaşır.
 *
 * Her kural tek bir gösterge üretir; yapay "sağlık skoru" yoktur (SPEC §26).
 * Eşikler koda gömülü varsayılanlardan gelir, tenant `management_rule_settings`
 * tablosundaki `params` ile ezilebilir. (Zod şemaları API tarafında kalır.)
 */

export const RULE_KEYS = [
  'overdue_receivable',
  'critical_stock',
  'due_cheque',
  'unusual_expense',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface RuleParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface RuleDefinition {
  key: RuleKey;
  label: string;
  link: string;
  description: string;
  /** Varsayılan parametreler (kod). */
  defaults: Record<string, number>;
  /** Düzenlenebilir parametre tanımları (UI + doğrulama). */
  params: RuleParamSpec[];
}

export const RULE_DEFINITIONS: Record<RuleKey, RuleDefinition> = {
  overdue_receivable: {
    key: 'overdue_receivable',
    label: 'Vadesi geçen alacak',
    link: '/invoices',
    description: 'Açık satış faturalarından vadesi geçmiş alacaklar.',
    defaults: { critical_days: 30 },
    params: [
      {
        key: 'critical_days',
        label: 'Kritik gecikme (gün)',
        min: 1,
        max: 365,
        default: 30,
      },
    ],
  },
  critical_stock: {
    key: 'critical_stock',
    label: 'Kritik stok',
    link: '/stock',
    description: 'Stoğu sıfıra inmiş aktif, stok takipli ürünler.',
    defaults: { red_count: 5 },
    params: [
      {
        key: 'red_count',
        label: 'Kırmızı eşiği (ürün adedi)',
        min: 1,
        max: 1000,
        default: 5,
      },
    ],
  },
  due_cheque: {
    key: 'due_cheque',
    label: 'Çek vadesi',
    link: '/reports',
    description: 'Portföydeki verilen çeklerden vadesi yaklaşan/geçen.',
    defaults: { window_days: 7 },
    params: [
      {
        key: 'window_days',
        label: 'Yaklaşan vade penceresi (gün)',
        min: 1,
        max: 90,
        default: 7,
      },
    ],
  },
  unusual_expense: {
    key: 'unusual_expense',
    label: 'Olağandışı gider',
    link: '/expenses',
    description: 'Son dönemde ortalamanın belirgin üzerinde giderler.',
    defaults: { lookback_days: 90, recent_days: 7, multiplier: 3 },
    params: [
      {
        key: 'lookback_days',
        label: 'Ortalama penceresi (gün)',
        min: 7,
        max: 365,
        default: 90,
      },
      { key: 'recent_days', label: 'Son dönem (gün)', min: 1, max: 90, default: 7 },
      { key: 'multiplier', label: 'Kat eşiği (×)', min: 1, max: 20, default: 3 },
    ],
  },
};

export function isRuleKey(value: string): value is RuleKey {
  return (RULE_KEYS as readonly string[]).includes(value);
}

/** Bir kural için varsayılanlarla birleştirilmiş, doğrulanmış parametre üretir. */
export function mergeRuleParams(
  key: RuleKey,
  override?: Record<string, unknown> | null,
): Record<string, number> {
  const def = RULE_DEFINITIONS[key];
  const merged: Record<string, number> = { ...def.defaults };
  if (!override) return merged;
  for (const spec of def.params) {
    const raw = override[spec.key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      merged[spec.key] = Math.min(spec.max, Math.max(spec.min, raw));
    }
  }
  return merged;
}
