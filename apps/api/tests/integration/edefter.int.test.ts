/**
 * e-Defter E1–E3: gerçek PostgreSQL'den aylık yevmiye + kebir üretimi, ön kontrol, GİB kurallarıyla
 * doğrulama, uniqueID sırası, ay atlama yasağı, belge eşleme, zip, gönderim işareti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gunzipSync, unzipSync, strFromU8 } from 'fflate';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { accountingService } from '../../src/modules/accounting/service';
import { ensureAccountByCode } from '../../src/modules/accounting/subledger';
import {
  downloadZip,
  generate,
  precheck,
  removeMonth,
  setDelivered,
} from '../../src/modules/edefter/service';
import { validateBook } from '../../src/modules/edefter/validator';
import {
  accountId,
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('e-Defter — yevmiye + kebir üretimi', () => {
  let t: TestTenant;
  const m = () => getPool('migrator');
  const lock = (date: string) =>
    accountingService.advanceLock(date, t.userId, 'e-Defter', t.tenantId);
  const e = (lines: Array<{ code: string; debit?: number; credit?: number }>, d: string) =>
    writeEntry(t, lines, { entry_date: d });

  beforeAll(async () => {
    t = await createTestTenant();
    await m().query(
      `UPDATE tenants SET tax_number = '1234567808', trade_name = 'Deneme Yapı Anonim Şirketi' WHERE id = $1`,
      [t.tenantId],
    );
    await m().query(
      `INSERT INTO tenant_settings (tenant_id, key, onboarding_mode, settings, value, updated_at)
       VALUES ($1, 'company_profile', 'manual', $2, '{}', now())
       ON CONFLICT (tenant_id, key) DO UPDATE SET settings = EXCLUDED.settings`,
      [
        t.tenantId,
        {
          edefter: {
            nace: '41.20.01',
            phone: '03121111111',
            email: 'info@deneme.com.tr',
            website: 'www.deneme.com.tr',
            address: {
              buildingNumber: '5',
              street: 'Atatürk Bulvarı',
              city: 'Ankara',
              postalCode: '06100',
            },
            accountants: [
              {
                name: 'SMMM Ayşe Kaya',
                contractType: 'SMMM sözleşmesi',
                contractDate: '2025-01-01',
                contractNo: '2025/7',
              },
            ],
            sourceApplication: '1111111111##Entegratör A.Ş.##e-Defter Programı##1.0',
          },
        },
      ],
    );
    await accountingService.withTenantClient(t.tenantId, (c) =>
      ensureAccountByCode(c, '100.01', 'TL Kasası', '100'),
    );
    await e(
      [
        { code: '100.01', debit: 50000 },
        { code: '500', credit: 50000 },
      ],
      '2025-01-02',
    );
    await e(
      [
        { code: '120', debit: 1200 },
        { code: '600', credit: 1000 },
        { code: '391', credit: 200 },
      ],
      '2025-01-15',
    );
    // Elle girilen fiş: başlıkta bordro (other), bir satırda fatura (satır başlığı ezer).
    await accountingService.createEntry(
      {
        entry_date: '2025-01-31',
        entry_type: 'mahsup',
        status: 'posted',
        description: 'Ocak ücret tahakkuku',
        document_type: 'other',
        document_type_description: 'Ücret Bordrosu',
        document_number: 'B-2025-01',
        document_date: '2025-01-31',
        lines: [
          { account_id: await accountId(t, '770'), debit: 900, credit: 0 },
          {
            account_id: await accountId(t, '320'),
            debit: 0,
            credit: 100,
            document_type: 'invoice',
            document_number: 'ABC2025000000001',
            document_date: '2025-01-30',
          },
          {
            account_id: await accountId(t, '100.01'),
            debit: 0,
            credit: 800,
            payment_method: 'Nakit',
          },
        ],
      } as never,
      t.userId,
      t.tenantId,
    );
    await e(
      [
        { code: '770', debit: 300 },
        { code: '100.01', credit: 300 },
      ],
      '2025-02-03',
    );
  });
  afterAll(async () => {
    await m().query('DELETE FROM edefter_parts WHERE tenant_id = $1', [t.tenantId]);
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('ön kontrol: kilitsiz ay ve eksik profil hataları anlaşılır listelenir', async () => {
    const p = await precheck('202501', t.tenantId);
    expect(p.ready).toBe(false);
    expect(p.issues.map((i) => i.code)).toContain('not_locked');
    expect(p.summary).toMatchObject({ entryCount: 3, lineCount: 8, firstEntry: 1, lastEntry: 3 });
  });

  it('ay atlanamaz; kilitli Ocak üretilir, dosyalar GİB kurallarından geçer', async () => {
    await lock('2025-03-01');
    await expect(generate('202502', t.userId, t.tenantId)).rejects.toThrow(/ay atlanamaz/);
    const jan = await generate('202501', t.userId, t.tenantId);
    expect(jan.parts.map((p) => [p.fileName, p.uniqueId])).toEqual([
      ['1234567808-202501-Y-000000.xml', 'YEV202501000001'],
      ['1234567808-202501-K-000000.xml', 'KEB202501000001'],
    ]);
    const stored = await m().query(
      `SELECT file_name, book_type, content FROM edefter_parts WHERE tenant_id = $1 AND period = '202501' AND status = 'generated'`,
      [t.tenantId],
    );
    for (const row of stored.rows) {
      const xml = strFromU8(gunzipSync(new Uint8Array(row.content)));
      if (row.book_type === 'Y') {
        expect(xml).toContain('>Ücret Bordrosu</gl-cor:documentTypeDescription>');
        expect(xml).toContain('>B-2025-01</gl-cor:documentNumber>');
        expect(xml).toContain('>ABC2025000000001</gl-cor:documentNumber>');
        expect(xml).toContain('contextRef="journal_context">Nakit</gl-bus:paymentMethod>');
      }
      const v = await validateBook(xml, row.file_name, row.book_type);
      expect(v.errors).toEqual([]);
      expect(v.signaturePending.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("Şubat: madde ve satır numarası Ocak'tan devam eder, uniqueID sırası 2", async () => {
    const feb = await generate('202502', t.userId, t.tenantId);
    expect(feb.parts[0].uniqueId).toBe('YEV202502000002');
    const row = (
      await m().query(
        `SELECT first_entry_no, first_line_no, last_line_no FROM edefter_parts
          WHERE tenant_id = $1 AND period = '202502' AND book_type = 'Y' AND status = 'generated'`,
        [t.tenantId],
      )
    ).rows[0];
    expect(row).toEqual({ first_entry_no: 4, first_line_no: 9, last_line_no: 10 });
  }, 120_000);

  it('gider belgesi: SMM numarasız ise ön kontrol hatası; numara girilince "other + Serbest Meslek Makbuzu"', async () => {
    const expenseId = newId();
    await m().query(
      `INSERT INTO expenses (id, tenant_id, expense_date, description, amount, currency, exchange_rate, status, document_kind)
       VALUES ($1, $2, '2025-03-10', 'Danışmanlık', 500, 'TRY', 1, 'posted', 'smm')`,
      [expenseId, t.tenantId],
    );
    await e(
      [
        { code: '100.01', debit: 1200 },
        { code: '120', credit: 1200 },
      ],
      '2025-03-04',
    );
    const entry = await e(
      [
        { code: '770', debit: 500 },
        { code: '100.01', credit: 500 },
      ],
      '2025-03-10',
    );
    await m().query(
      `UPDATE journal_entries SET source_type = 'expense', source_id = $2 WHERE id = $1`,
      [entry.id, expenseId],
    );
    await lock('2025-04-01');
    const p = await precheck('202503', t.tenantId);
    expect(p.issues.find((i) => i.code === 'document')?.message).toMatch(
      /Serbest Meslek Makbuzu numarası ve tarihi zorunlu/,
    );
    await m().query(
      `UPDATE expenses SET invoice_number = 'SMM-12', invoice_date = '2025-03-10' WHERE id = $1`,
      [expenseId],
    );
    const mar = await generate('202503', t.userId, t.tenantId);
    const zip = await downloadZip('202503', t.tenantId);
    const files = unzipSync(new Uint8Array(zip.body));
    expect(Object.keys(files).sort()).toEqual(
      [
        '1234567808-202503-K-000000.xml',
        '1234567808-202503-Y-000000.xml',
        'BENIOKU.txt',
        'kebir.xslt',
        'yevmiye.xslt',
      ].sort(),
    );
    const y = strFromU8(files['1234567808-202503-Y-000000.xml']);
    expect(y).toContain(
      '<gl-cor:documentTypeDescription contextRef="journal_context">Serbest Meslek Makbuzu</gl-cor:documentTypeDescription>',
    );
    expect(mar.parts[0].uniqueId).toBe('YEV202503000003');
  }, 120_000);

  it('gönderildi işareti yeniden üretimi ve silmeyi engeller; yalnız son ay silinir', async () => {
    await setDelivered('202503', true, t.userId, t.tenantId);
    await expect(generate('202503', t.userId, t.tenantId)).rejects.toThrow(/gönderildi/);
    await expect(removeMonth('202502', t.userId, t.tenantId)).rejects.toThrow(/en son ay/);
    await setDelivered('202503', false, t.userId, t.tenantId);
    expect((await removeMonth('202503', t.userId, t.tenantId)).removed).toBe(2);
  }, 120_000);
});
