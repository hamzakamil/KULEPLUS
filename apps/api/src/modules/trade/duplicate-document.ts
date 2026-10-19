import type { PoolClient } from 'pg';
import { AppError } from '@kuleplus/shared';

/**
 * Mükerrer belge kontrolü (Faz 7-5): aynı tedarikçi belgesi hem Giderler ekranından hem alış
 * faturası olarak (ya da iki kez) kesinleştirilemez. Belge no büyük/küçük harf ve baştaki/
 * sondaki boşluk farkı gözetmeden karşılaştırılır.
 *  - Carili kayıt: aynı cari + aynı belge no (kesinleşmiş gider veya alış faturası),
 *  - Carisiz peşin gider: aynı satıcı VKN/TCKN + aynı belge no (giderler ve o VKN'li carinin
 *    alış faturaları).
 */
export async function assertNoDuplicateDocument(
  client: PoolClient,
  input: {
    documentNo: string | null | undefined;
    contactId?: string | null;
    taxNumber?: string | null;
    excludeExpenseId?: string;
    excludeInvoiceId?: string;
  },
): Promise<void> {
  const docNo = input.documentNo?.trim();
  if (!docNo) return;
  const exExpense = input.excludeExpenseId ?? null;
  const exInvoice = input.excludeInvoiceId ?? null;
  let hit: { kind: string; ref: string } | null = null;

  if (input.contactId) {
    const e = await client.query(
      `SELECT COALESCE(description, '') AS ref FROM expenses
        WHERE tenant_id = current_tenant_id() AND contact_id = $1
          AND lower(btrim(invoice_number)) = lower($2) AND status = 'posted'
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [input.contactId, docNo, exExpense],
    );
    if (e.rows[0]) hit = { kind: 'gider', ref: String(e.rows[0].ref) };
    if (!hit) {
      const i = await client.query(
        `SELECT number AS ref FROM invoices
          WHERE tenant_id = current_tenant_id() AND contact_id = $1 AND type = 'purchase'
            AND lower(btrim(supplier_document_no)) = lower($2) AND posting_status = 'posted'
            AND ($3::uuid IS NULL OR id <> $3::uuid)
          LIMIT 1`,
        [input.contactId, docNo, exInvoice],
      );
      if (i.rows[0]) hit = { kind: 'alış faturası', ref: String(i.rows[0].ref) };
    }
  } else if (input.taxNumber?.trim()) {
    const tax = input.taxNumber.trim();
    const e = await client.query(
      `SELECT COALESCE(description, '') AS ref FROM expenses
        WHERE tenant_id = current_tenant_id() AND btrim(counterparty_tax_number) = $1
          AND lower(btrim(invoice_number)) = lower($2) AND status = 'posted'
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [tax, docNo, exExpense],
    );
    if (e.rows[0]) hit = { kind: 'gider', ref: String(e.rows[0].ref) };
    if (!hit) {
      const i = await client.query(
        `SELECT i.number AS ref FROM invoices i
           JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
          WHERE i.tenant_id = current_tenant_id() AND i.type = 'purchase'
            AND btrim(c.tax_number) = $1
            AND lower(btrim(i.supplier_document_no)) = lower($2) AND i.posting_status = 'posted'
            AND ($3::uuid IS NULL OR i.id <> $3::uuid)
          LIMIT 1`,
        [tax, docNo, exInvoice],
      );
      if (i.rows[0]) hit = { kind: 'alış faturası', ref: String(i.rows[0].ref) };
    }
  }
  if (hit) {
    throw new AppError(
      'CONFLICT',
      `Bu belge (no ${docNo}) zaten ${hit.kind} olarak kayıtlı${hit.ref ? `: ${hit.ref}` : ''}.`,
    );
  }
}
