import type { PoolClient } from 'pg';
import { toIsoDate } from './ledger';

/**
 * Fişin kaynak belgesinin kısa özeti (muavin panelinde fişe tıklayınca gösterilir) — kullanıcı
 * başka ekrana geçmeden "bu fiş hangi faturadan / giderden / çekten geldi" sorusunu cevaplar.
 */
export interface EntrySourceSummary {
  type: string;
  label: string;
  number?: string | null;
  date?: string | null;
  contact_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  /** Belgenin kendi ekranı (isteğe bağlı, yeni sekmede açmak için). */
  link?: string | null;
}

const INVOICE_TYPES: Record<string, string> = {
  sales: 'Satış faturası',
  purchase: 'Alış faturası',
  credit_note: 'Satış iade faturası',
  debit_note: 'Alış iade faturası',
};

const FIXED_LABELS: Record<string, string> = {
  revaluation: 'Kur değerleme',
  vat_offset: 'KDV mahsubu',
  year_end_reflect: 'Yıl sonu — 7/A yansıtma',
  year_end_result: 'Yıl sonu — dönem sonucu devri',
  year_end_tax: 'Yıl sonu — vergi karşılığı',
  year_end_closing: 'Yıl sonu — kapanış',
  year_end_opening: 'Yıl sonu — açılış',
  year_end_transfer: 'Yıl sonu — sonuç virmanı',
};

export async function entrySourceOn(
  client: PoolClient,
  sourceType: string | null,
  sourceId: string | null,
): Promise<EntrySourceSummary | null> {
  if (!sourceType) return null;
  const one = async (sql: string) =>
    sourceId ? (await client.query(sql, [sourceId])).rows[0] : undefined;

  if (sourceType === 'invoice' || sourceType === 'invoice_payment') {
    const r =
      sourceType === 'invoice'
        ? await one(
            `SELECT i.id, i.type, i.number, i.issue_date AS d, i.total AS amount, i.currency, c.name AS contact
               FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id
              WHERE i.id = $1 AND i.tenant_id = current_tenant_id()`,
          )
        : await one(
            `SELECT i.id, i.type, i.number, p.payment_date AS d, p.amount, i.currency, c.name AS contact
               FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
               LEFT JOIN contacts c ON c.id = i.contact_id
              WHERE p.id = $1 AND i.tenant_id = current_tenant_id()`,
          );
    const kind = INVOICE_TYPES[String(r?.type)] ?? 'Fatura';
    return {
      type: sourceType,
      label: sourceType === 'invoice' ? kind : `${kind} ödemesi/tahsilatı`,
      number: r?.number ?? null,
      date: r?.d ? toIsoDate(r.d) : null,
      contact_name: r?.contact ?? null,
      amount: r ? Number(r.amount) : null,
      currency: r?.currency ?? null,
      link: r ? `/invoices?id=${r.id}` : null,
    };
  }
  if (sourceType === 'expense' || sourceType === 'expense_payment') {
    const r =
      sourceType === 'expense'
        ? await one(
            `SELECT e.id, e.invoice_number AS number, e.expense_date AS d, e.amount, e.currency,
                    e.description, COALESCE(c.name, e.counterparty_name) AS contact
               FROM expenses e LEFT JOIN contacts c ON c.id = e.contact_id
              WHERE e.id = $1 AND e.tenant_id = current_tenant_id()`,
          )
        : await one(
            `SELECT e.id, e.invoice_number AS number, p.transaction_date AS d, p.amount, e.currency,
                    COALESCE(p.description, e.description) AS description,
                    COALESCE(c.name, e.counterparty_name) AS contact
               FROM expense_payments p JOIN expenses e ON e.id = p.expense_id
               LEFT JOIN contacts c ON c.id = e.contact_id
              WHERE p.id = $1 AND e.tenant_id = current_tenant_id()`,
          );
    return {
      type: sourceType,
      label: sourceType === 'expense' ? 'Gider' : 'Gider ödemesi',
      number: r?.number ?? null,
      date: r?.d ? toIsoDate(r.d) : null,
      contact_name: r?.contact ?? null,
      amount: r ? Number(r.amount) : null,
      currency: r?.currency ?? null,
      description: r?.description ?? null,
      link: r ? `/expenses/${r.id}/edit` : null,
    };
  }
  if (sourceType === 'cheque') {
    const r = await one(
      `SELECT ch.id, ch.cheque_type, ch.direction, ch.cheque_no, ch.due_date AS d, ch.amount, ch.currency,
              ch.drawer_name, c.name AS contact
         FROM cheques ch LEFT JOIN contacts c ON c.id = ch.contact_id
        WHERE ch.id = $1 AND ch.tenant_id = current_tenant_id()`,
    );
    const kind = r?.cheque_type === 'promissory' ? 'senet' : 'çek';
    return {
      type: sourceType,
      label: `${r?.direction === 'outgoing' ? 'Verilen' : 'Alınan'} ${kind}`,
      number: r?.cheque_no ?? null,
      date: r?.d ? toIsoDate(r.d) : null,
      contact_name: r?.contact ?? r?.drawer_name ?? null,
      amount: r ? Number(r.amount) : null,
      currency: r?.currency ?? null,
      description: r?.d ? `Vade ${toIsoDate(r.d)}` : null,
      link: '/cheques',
    };
  }
  return { type: sourceType, label: FIXED_LABELS[sourceType] ?? sourceType };
}
