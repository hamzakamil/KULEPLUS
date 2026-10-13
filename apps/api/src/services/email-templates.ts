import { getPool } from '@kuleplus/db';
import { newId, renderEmailTemplate } from '@kuleplus/shared';
import type { EmailTemplateKey, TemplateVars } from '@kuleplus/shared';
import type { PoolClient } from 'pg';

/**
 * E-posta kuyruğu — SPEC §19.1 outbox deseni (Faz 1/2).
 *
 * Şablon motoru (saf) paylaşılan kernel'dedir (@kuleplus/shared/email/templates) —
 * worker günlük/haftalık özeti de aynı şablonları üretir (ADR-0020). Burada yalnızca
 * DB'ye yazım (`queueEmailTemplate`) kalır: iş transaction'ı içinde yalnızca
 * `email_outbox` satırı üretilir, gerçek gönderim worker'dadır.
 */

export { EMAIL_TEMPLATES, appUrl, renderEmailTemplate } from '@kuleplus/shared';
export type { EmailTemplateKey, TemplateVars, RenderedEmail } from '@kuleplus/shared';

/**
 * Şablonu üretip `email_outbox`'a yazar (SPEC §19.1 outbox deseni).
 * `client` verilirse çağıranın transaction'ına bağlanır: iş kaydı ile e-posta
 * kuyruk satırı atomik olarak oluşur.
 */
export async function queueEmailTemplate(
  key: EmailTemplateKey,
  to: string,
  vars: TemplateVars,
  client?: PoolClient,
): Promise<{ id: string }> {
  const rendered = renderEmailTemplate(key, vars);
  const id = newId(); // SPEC §0.1 / ADR-0002 — UUID v7 uygulama tarafında üretilir

  const sql = `INSERT INTO email_outbox (id, "to", subject, html, text, provider_ref, response, attempts, max_attempts, next_attempt_at, status, created_at, sent_at)
     VALUES ($1, $2, $3, $4, $5, '', NULL, 0, 3, now(), 'pending', now(), NULL)`;
  const params = [id, to, rendered.subject, rendered.html, rendered.text];

  if (client) {
    await client.query(sql, params);
  } else {
    await getPool('app').query(sql, params);
  }
  return { id };
}
