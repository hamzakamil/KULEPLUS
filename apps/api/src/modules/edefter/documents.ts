import type { PoolClient } from 'pg';
import { toIsoDate } from '../accounting/ledger';
import type { BookDocument, GibDocumentType } from './generator';

/**
 * Yevmiye maddesinin dayandığı belge (GİB belge tipi, numara, tarih) ve ödeme yöntemi.
 * Öncelik: satırda girilen > fiş başlığında girilen > kaynak belgeden (fatura, gider, çek, ödeme).
 * Uygulama Kılavuzu §18: fatura yerine geçen belgeler (SMM, gider pusulası, müstahsil…) "invoice"
 * değil "other" + belge adıdır; havale/EFT işlem adı belge adı olarak yazılmaz (dekont yazılır).
 */
export interface ResolvedDocument {
  document: BookDocument | null;
  paymentMethod: string | null;
}

export const EXPENSE_DOCUMENT_KINDS: Record<string, { type: GibDocumentType; label: string }> = {
  invoice: { type: 'invoice', label: 'Fatura' },
  e_invoice: { type: 'invoice', label: 'e-Fatura' },
  e_archive: { type: 'invoice', label: 'e-Arşiv Fatura' },
  smm: { type: 'other', label: 'Serbest Meslek Makbuzu' },
  e_smm: { type: 'other', label: 'e-Serbest Meslek Makbuzu' },
  expense_voucher: { type: 'other', label: 'Gider Pusulası' },
  producer_receipt: { type: 'other', label: 'Müstahsil Makbuzu' },
  retail_receipt: { type: 'other', label: 'Perakende Satış Fişi' },
  ticket: { type: 'other', label: 'Bilet' },
  bank_receipt: { type: 'other', label: 'Dekont' },
  other: { type: 'other', label: 'Diğer' },
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Nakit',
  bank_transfer: 'Banka',
  bank: 'Banka',
  check: 'Çek',
  credit_card: 'Kredi Kartı',
  other: 'Diğer',
};

type Row = Record<string, unknown>;
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const date = (v: unknown) => (v ? toIsoDate(v) : null);

async function byIds(client: PoolClient, sql: string, ids: string[]): Promise<Map<string, Row>> {
  if (ids.length === 0) return new Map();
  const r = await client.query(sql, [ids]);
  return new Map(r.rows.map((row) => [String(row.id), row]));
}

/** Kaynak belgelerden madde başına belge bilgisi (entry id → çözüm). */
export async function resolveSourceDocuments(
  client: PoolClient,
  entries: Array<{ id: string; source_type: string | null; source_id: string | null }>,
): Promise<Map<string, ResolvedDocument>> {
  const ids = (type: string) =>
    entries.filter((e) => e.source_type === type && e.source_id).map((e) => String(e.source_id));
  const [invoices, invPayments, expenses, expPayments, cheques] = await Promise.all([
    byIds(
      client,
      `SELECT id, type, number, supplier_document_no, issue_date FROM invoices
        WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[])`,
      ids('invoice'),
    ),
    byIds(
      client,
      `SELECT p.id, p.payment_method, p.reference, p.payment_date FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE i.tenant_id = current_tenant_id() AND p.id = ANY($1::uuid[])`,
      ids('invoice_payment'),
    ),
    byIds(
      client,
      `SELECT id, document_kind, document_kind_description, invoice_number, invoice_date, expense_date
         FROM expenses WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[])`,
      ids('expense'),
    ),
    byIds(
      client,
      `SELECT p.id, p.reference, p.transaction_date, a.account_type
         FROM expense_payments p LEFT JOIN cash_bank_accounts a ON a.id = p.account_id
        WHERE p.tenant_id = current_tenant_id() AND p.id = ANY($1::uuid[])`,
      ids('expense_payment'),
    ),
    byIds(
      client,
      `SELECT id, cheque_type, cheque_no, issue_date FROM cheques
        WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[])`,
      ids('cheque'),
    ),
  ]);

  const out = new Map<string, ResolvedDocument>();
  for (const e of entries) {
    const sid = String(e.source_id ?? '');
    let res: ResolvedDocument = { document: null, paymentMethod: null };
    if (e.source_type === 'invoice' && invoices.has(sid)) {
      const inv = invoices.get(sid)!;
      // Alış ve satıştan iade faturasında belge karşı tarafındır: onun numarası yazılır.
      const theirs = inv.type === 'purchase' || inv.type === 'credit_note';
      res.document = {
        type: 'invoice',
        number: (theirs ? str(inv.supplier_document_no) : null) ?? str(inv.number),
        date: date(inv.issue_date),
      };
    } else if (e.source_type === 'invoice_payment' && invPayments.has(sid)) {
      const p = invPayments.get(sid)!;
      const method = String(p.payment_method ?? '');
      res.paymentMethod = PAYMENT_LABELS[method] ?? null;
      const ref = str(p.reference);
      if (method === 'cash')
        res.document = { type: 'receipt', number: ref, date: date(p.payment_date) };
      else if (ref && method !== 'check')
        res.document = {
          type: 'other',
          description: 'Dekont',
          number: ref,
          date: date(p.payment_date),
        };
    } else if (e.source_type === 'expense' && expenses.has(sid)) {
      const x = expenses.get(sid)!;
      const kind =
        EXPENSE_DOCUMENT_KINDS[String(x.document_kind ?? 'invoice')] ??
        EXPENSE_DOCUMENT_KINDS.invoice;
      res.document = {
        type: kind.type,
        description:
          kind.type === 'other' ? (str(x.document_kind_description) ?? kind.label) : null,
        number: str(x.invoice_number),
        date: date(x.invoice_date ?? x.expense_date),
      };
    } else if (e.source_type === 'expense_payment' && expPayments.has(sid)) {
      const p = expPayments.get(sid)!;
      res.paymentMethod = p.account_type === 'cash' ? 'Nakit' : 'Banka';
      const ref = str(p.reference);
      if (ref && p.account_type !== 'cash') {
        res.document = {
          type: 'other',
          description: 'Dekont',
          number: ref,
          date: date(p.transaction_date),
        };
      }
    } else if (e.source_type === 'cheque' && cheques.has(sid)) {
      const c = cheques.get(sid)!;
      const promissory = c.cheque_type === 'promissory';
      res = {
        document: {
          type: promissory ? 'voucher' : 'check',
          number: str(c.cheque_no),
          date: date(c.issue_date),
        },
        paymentMethod: promissory ? 'Senet' : 'Çek',
      };
    }
    out.set(e.id, res);
  }
  return out;
}

/** Elle girilen (başlık/satır) belge alanları — doluysa kaynak belgeyi ezer. */
export function manualDocument(row: Row): ResolvedDocument | null {
  const type = str(row.document_type) as GibDocumentType | null;
  const pm = str(row.payment_method);
  if (!type && !pm) return null;
  return {
    document: type
      ? {
          type,
          description: str(row.document_type_description),
          number: str(row.document_number),
          date: date(row.document_date),
        }
      : null,
    paymentMethod: pm,
  };
}
