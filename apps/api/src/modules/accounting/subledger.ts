import type { PoolClient } from 'pg';
import { AppError, newId } from '@kuleplus/shared';
import { ensureChartOfAccountsOn } from './chart';

/**
 * Alt hesap (yardımcı hesap) altyapısı — Faz 7-1.
 *
 * Kod biçimi noktalıdır: `<ana hesap>.<sıra>` (ör. 102.01, 770.03). Sıra iki hanelidir,
 * 99'u geçerse doğal olarak üç haneye çıkar (102.100). Alt hesap `parent_id` ile ana
 * hesaba bağlanır ve şablon hesabı değildir (`is_tdphp = false`; kullanıcı yönetebilir).
 *
 * Kasa/banka hesapları (100.xx / 102.xx) ve şirket kredi kartları (309.xx) kendi alt
 * hesaplarıyla eşlenir; bağlantı `cash_bank_accounts.accounting_account_id` /
 * `credit_cards.accounting_account_id` kolonundadır. Bağlantı yoksa ilk fişte otomatik
 * açılır (lazy) — mevcut kayıtlar 202610540000 migration'ıyla toplu bağlanmıştır.
 */

/** Ana hesap altında sıradaki alt hesabı açar ve id'sini döndürür. */
export async function createSubAccount(
  client: PoolClient,
  parentCode: string,
  name: string,
): Promise<string> {
  // Aynı ana hesap altında eşzamanlı iki açılış aynı sırayı almasın.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('subaccount:' || COALESCE(current_setting('app.tenant_id', true), '') || ':' || $1))",
    [parentCode],
  );
  let parent = await client.query(
    'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [parentCode],
  );
  if (parent.rows.length === 0) {
    await ensureChartOfAccountsOn(client);
    parent = await client.query(
      'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
      [parentCode],
    );
    if (parent.rows.length === 0) {
      throw new AppError('VALIDATION_ERROR', `Ana hesap bulunamadı: ${parentCode}`);
    }
  }
  const next = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(code, '.', 2), '')::int), 0) + 1 AS n
       FROM accounting_accounts
      WHERE tenant_id = current_tenant_id()
        AND code LIKE $1 || '.%'
        AND split_part(code, '.', 2) ~ '^[0-9]+$'
        AND split_part(code, '.', 3) = ''`,
    [parentCode],
  );
  const code = `${parentCode}.${String(Number(next.rows[0].n)).padStart(2, '0')}`;
  const id = newId();
  await client.query(
    `INSERT INTO accounting_accounts (id, tenant_id, code, name, type, parent_id, is_tdphp)
     VALUES ($1, current_tenant_id(), $2, $3, 'detail', $4, false)`,
    [id, code, name, parent.rows[0].id],
  );
  return id;
}

/** Bağlı hesap hâlâ var mı? (hesap silinmiş/başka tenant'a ait ise yeniden açılır) */
async function linkedAccountExists(client: PoolClient, accountId: string | null) {
  if (!accountId) return false;
  const r = await client.query(
    'SELECT 1 FROM accounting_accounts WHERE id = $1 AND tenant_id = current_tenant_id()',
    [accountId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Kasa/banka kartının muhasebe alt hesabı (kasa → 100.xx, banka → 102.xx).
 * Bağlantı yoksa açılır ve karta yazılır. Kart bulunamazsa null.
 */
export async function cashBankLedgerAccount(
  client: PoolClient,
  cashBankAccountId: string,
): Promise<string | null> {
  const r = await client.query(
    `SELECT account_type, account_name, accounting_account_id
       FROM cash_bank_accounts
      WHERE id = $1 AND tenant_id = current_tenant_id()
      FOR UPDATE`,
    [cashBankAccountId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (await linkedAccountExists(client, row.accounting_account_id)) {
    return String(row.accounting_account_id);
  }
  const parentCode = row.account_type === 'bank' ? '102' : '100';
  const id = await createSubAccount(client, parentCode, String(row.account_name));
  await client.query(
    'UPDATE cash_bank_accounts SET accounting_account_id = $1 WHERE id = $2 AND tenant_id = current_tenant_id()',
    [id, cashBankAccountId],
  );
  return id;
}

/** Şirket kredi kartının muhasebe alt hesabı (309.xx Diğer Mali Borçlar). */
export async function creditCardLedgerAccount(
  client: PoolClient,
  creditCardId: string,
): Promise<string | null> {
  const r = await client.query(
    `SELECT card_label, card_number_last4, accounting_account_id
       FROM credit_cards
      WHERE id = $1 AND tenant_id = current_tenant_id()
      FOR UPDATE`,
    [creditCardId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (await linkedAccountExists(client, row.accounting_account_id)) {
    return String(row.accounting_account_id);
  }
  const label = row.card_number_last4
    ? `${row.card_label} (*${row.card_number_last4})`
    : String(row.card_label);
  const id = await createSubAccount(client, '309', `Kredi Kartı ${label}`);
  await client.query(
    'UPDATE credit_cards SET accounting_account_id = $1 WHERE id = $2 AND tenant_id = current_tenant_id()',
    [id, creditCardId],
  );
  return id;
}

/**
 * Bağlantısı olmayan tüm kasa/banka ve kredi kartlarını alt hesaplarıyla eşler.
 * Hesap planı kurulumu (POST /accounting/bootstrap) sonrasında çağrılır; idempotenttir.
 */
export async function linkAllSubledgers(client: PoolClient): Promise<number> {
  let linked = 0;
  const cards = await client.query(
    `SELECT id FROM cash_bank_accounts
      WHERE tenant_id = current_tenant_id() AND accounting_account_id IS NULL
      ORDER BY created_at, id`,
  );
  for (const r of cards.rows) {
    if (await cashBankLedgerAccount(client, String(r.id))) linked++;
  }
  const credit = await client.query(
    `SELECT id FROM credit_cards
      WHERE tenant_id = current_tenant_id() AND accounting_account_id IS NULL
      ORDER BY created_at, id`,
  );
  for (const r of credit.rows) {
    if (await creditCardLedgerAccount(client, String(r.id))) linked++;
  }
  return linked;
}

/**
 * Gider kategorisinin muhasebe hesabı (Faz 7-2). Kategoriye hesap bağlıysa o (kullanıcı
 * 760/740 altına taşımış olabilir); değilse 770 Genel Yönetim Giderleri altında kategori
 * adıyla alt hesap açılır ve bağlanır. Kategori bulunamazsa null.
 */
export async function expenseCategoryLedgerAccount(
  client: PoolClient,
  categoryId: string,
): Promise<string | null> {
  const r = await client.query(
    `SELECT name, account_id FROM expense_categories
      WHERE id = $1 AND tenant_id = current_tenant_id()
      FOR UPDATE`,
    [categoryId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (await linkedAccountExists(client, row.account_id)) return String(row.account_id);
  const id = await createSubAccount(client, '770', String(row.name));
  await client.query(
    'UPDATE expense_categories SET account_id = $1 WHERE id = $2 AND tenant_id = current_tenant_id()',
    [id, categoryId],
  );
  return id;
}

/**
 * Belirli kodlu hesabı bulur; yoksa `parentCode` altına açar (sabit kodlu alt hesaplar için,
 * ör. 360.01 Sorumlu Sıfatıyla Ödenecek KDV, 360.01.301 Yapım İşleri). Kod kullanıcı
 * tarafından başka amaçla açılmışsa mevcut hesap kullanılır.
 */
export async function ensureAccountByCode(
  client: PoolClient,
  code: string,
  name: string,
  parentCode: string,
): Promise<string> {
  const found = await client.query(
    'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [code],
  );
  if (found.rows[0]) return String(found.rows[0].id);
  const parent = await client.query(
    'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [parentCode],
  );
  if (!parent.rows[0])
    throw new AppError('VALIDATION_ERROR', `Ana hesap bulunamadı: ${parentCode}`);
  const id = newId();
  await client.query(
    `INSERT INTO accounting_accounts (id, tenant_id, code, name, type, parent_id, is_tdphp)
     VALUES ($1, current_tenant_id(), $2, $3, 'detail', $4, false)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [id, code, name, parent.rows[0].id],
  );
  const again = await client.query(
    'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [code],
  );
  return String(again.rows[0].id);
}
