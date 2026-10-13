import { z } from 'zod';
import { isRuleKey } from '@kuleplus/shared';

/**
 * API tarafı kural yardımcıları.
 *
 * Saf kural tanımları (RULE_KEYS, RULE_DEFINITIONS, isRuleKey, mergeRuleParams) ve
 * değerlendirme paylaşılan kernel'dedir (@kuleplus/shared) — worker günlük/haftalık
 * özeti ile dashboard tek kaynaktan beslenir (ADR-0020). Burada yalnızca HTTP gövde
 * doğrulama (Zod) şemaları ve tip çıkarımı kalır.
 */

export { RULE_KEYS, RULE_DEFINITIONS, isRuleKey, mergeRuleParams } from '@kuleplus/shared';
export type { RuleKey, RuleParamSpec, RuleDefinition } from '@kuleplus/shared';

/** Parametre override şeması (/rules/:key gövdesi). */
export const ruleUpsertSchema = z.object({
  enabled: z.boolean().optional(),
  params: z.record(z.number().finite()).optional(),
});

export const ruleKeyParamSchema = z.string().refine(isRuleKey, 'Geçersiz kural anahtarı');

export type RuleUpsertInput = z.infer<typeof ruleUpsertSchema>;
