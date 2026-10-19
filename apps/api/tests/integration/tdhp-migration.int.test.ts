/**
 * TDHP düzeltme migration'ı (202610530000) — eski şablonla kurulmuş bir tenant üzerinde
 * kod kaydırma, hesap kimliği (id) korunumu, pasife alma, eksik hesap ekleme ve idempotans.
 * Migration SQL'i dosyadan okunup migrator havuzunda çalıştırılır (tüm tenant'ları kapsar;
 * kural gereği idempotent olduğundan geliştirme veritabanında zararsızdır).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  type TestTenant,
} from './db-harness';

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../packages/db/migrations/202610530000_tdhp_official_codes.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

// Eski şablondaki (hatalı) kod/ad çiftleri.
const OLD_ROWS: Array<[string, string, string]> = [
  ['645', 'KAMBİYO KÂRLARI', 'detail'],
  ['646', 'REESKONT FAİZ GELİRLERİ', 'detail'],
  ['655', 'KAMBİYO ZARARLARI (-)', 'detail'],
  ['656', 'REESKONT FAİZ GİDERLERİ (-)', 'detail'],
  ['362', 'ÖDENECEK SOSYAL GÜVENLİK İŞVEREN PRİMLERİ', 'detail'],
  ['368', 'ÖDENECEK DİĞER YÜKÜMLÜLÜKLER', 'detail'],
  ['137', 'DİĞER ALACAK SENETLERİ', 'detail'],
  ['138', 'DİĞER ALACAK SENETLERİ REESKONTU (-)', 'detail'],
  ['139', 'ŞÜPHELİ DİĞER ALACAKLAR', 'detail'],
  ['308', 'BANKA KREDİLERİ', 'detail'],
  ['100', 'KASA', 'detail'],
  ['600', 'YURTİÇİ SATIŞLAR', 'detail'],
];

describe.skipIf(!integrationEnabled)('TDHP migration 202610530000', () => {
  let t: TestTenant;
  const ids = new Map<string, string>();
  const row = async (code: string) => {
    const r = await getPool('migrator').query(
      'SELECT id, name, is_active FROM accounting_accounts WHERE tenant_id = $1 AND code = $2',
      [t.tenantId, code],
    );
    return r.rows[0] as { id: string; name: string; is_active: boolean } | undefined;
  };

  beforeAll(async () => {
    t = await createTestTenant();
    const m = getPool('migrator');
    // Şablonla kurulan yeni planı sil, eski (hatalı) planı kur.
    await m.query('DELETE FROM accounting_accounts WHERE tenant_id = $1', [t.tenantId]);
    for (const [code, name, type] of OLD_ROWS) {
      const id = newId();
      ids.set(code, id);
      await m.query(
        `INSERT INTO accounting_accounts (id, tenant_id, code, name, type, is_tdphp)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [id, t.tenantId, code, name, type],
      );
    }
    // Eski 645 (kambiyo kârı) hesabına bağlı onaylı bir fiş: id korunmalı, fiş bozulmamalı.
    const entryId = newId();
    await m.query('BEGIN');
    await m.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, description, total_debit, total_credit)
       VALUES ($1, $2, 1, '2026-03-15', 'posted', 'eski kambiyo', 10, 10)`,
      [entryId, t.tenantId],
    );
    await m.query(
      `INSERT INTO journal_lines (id, tenant_id, entry_id, line_no, account_id, debit, credit)
       VALUES ($1, $2, $3, 1, $4, 0, 10), ($5, $2, $3, 2, $6, 10, 0)`,
      [newId(), t.tenantId, entryId, ids.get('645'), newId(), ids.get('100')],
    );
    await m.query('COMMIT');
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  const run = () => getPool('migrator').query(migrationSql);

  it('kambiyo kodları 646/656’ya kayar, hesap kimliği korunur; reeskont 647/657 olur', async () => {
    await run();
    expect((await row('646'))?.id).toBe(ids.get('645'));
    expect((await row('646'))?.name).toBe('KAMBİYO KÂRLARI');
    expect((await row('656'))?.id).toBe(ids.get('655'));
    expect((await row('647'))?.id).toBe(ids.get('646'));
    expect((await row('657'))?.id).toBe(ids.get('656'));
    // eski kod boşaldı ve resmî anlamıyla (menkul kıymet) yeniden eklendi
    expect((await row('645'))?.name).toBe('MENKUL KIYMET SATIŞ KÂRLARI');
    expect((await row('655'))?.name).toBe('MENKUL KIYMET SATIŞ ZARARLARI (-)');
  });

  it('kambiyo hesabına bağlı fiş satırı aynı hesapta kalır (646)', async () => {
    const r = await getPool('migrator').query(
      `SELECT a.code FROM journal_lines jl JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE jl.tenant_id = $1 AND jl.credit = 10`,
      [t.tenantId],
    );
    expect(r.rows[0].code).toBe('646');
  });

  it('36x: 362 pasife alınır, 368→369 taşınır ve yeni 368 eklenir; ad düzeltmeleri uygulanır', async () => {
    expect((await row('362'))?.is_active).toBe(false);
    expect((await row('369'))?.id).toBe(ids.get('368'));
    expect((await row('368'))?.name).toMatch(/^VADESİ GEÇMİŞ/);
    expect((await row('137'))?.name).toBe('DİĞER ALACAK SENETLERİ REESKONTU (-)');
    expect((await row('138'))?.name).toBe('ŞÜPHELİ DİĞER ALACAKLAR');
    expect((await row('139'))?.name).toBe('ŞÜPHELİ DİĞER ALACAKLAR KARŞILIĞI (-)');
    expect((await row('308'))?.name).toBe('MENKUL KIYMETLER İHRAÇ FARKI (-)');
  });

  it('eksik hesaplar eklendi; ikinci çalıştırma hiçbir şeyi değiştirmez (idempotent)', async () => {
    expect(await row('372')).toBeDefined();
    expect(await row('58')).toBeDefined();
    const count = async () =>
      Number(
        (
          await getPool('migrator').query(
            'SELECT COUNT(*) AS n FROM accounting_accounts WHERE tenant_id = $1',
            [t.tenantId],
          )
        ).rows[0].n,
      );
    const before = await count();
    const k = await row('646');
    await run();
    expect(await count()).toBe(before);
    expect((await row('646'))?.id).toBe(k?.id);
    expect((await row('647'))?.id).toBe(ids.get('646'));
  });

  it('kullanıcının özelleştirdiği hesap (adı farklı) kaydırılmaz', async () => {
    const m = getPool('migrator');
    await m.query(
      `UPDATE accounting_accounts SET name = 'ÖZEL AD' WHERE tenant_id = $1 AND code = '647'`,
      [t.tenantId],
    );
    await run();
    expect((await row('647'))?.name).toBe('ÖZEL AD');
  });
});
