import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  addReferral,
  createPartner,
  listCommissions,
  listPartners,
  setCommissionStatus,
  updatePartner,
} from '../src/modules/platform/partners.service';

/**
 * Ortak (SMMM) programı platform servisi — çapraz tenant okuma/yazma `migrator`
 * (RLS bypass) havuzuyla yapılır; her sorgu bu mock üzerinden geçer.
 */
const { migratorQuery } = vi.hoisted(() => ({ migratorQuery: vi.fn() }));

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: migratorQuery })),
}));

const sqlOf = (call: unknown[]): string => String(call[0]);

describe('Ortak programı — platform servisi', () => {
  beforeEach(() => {
    migratorQuery.mockReset();
    migratorQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('listPartners: ortak başına atıf sayısı ve durum bazlı komisyon toplamlarını döner', async () => {
    migratorQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'p1',
          code: 'smmm-ali',
          name: 'Ali SMMM',
          commission_rate: '20.00',
          is_active: true,
          created_at: '2026-10-01T09:00:00.000Z',
          referral_count: 3,
          pending_amount: '59.80',
          approved_amount: '0',
          paid_amount: '119.60',
        },
      ],
    });

    const partners = await listPartners();

    expect(partners).toEqual([
      {
        id: 'p1',
        code: 'smmm-ali',
        name: 'Ali SMMM',
        commissionRate: '20.00',
        isActive: true,
        createdAt: '2026-10-01T09:00:00.000Z',
        referralCount: 3,
        pendingAmount: '59.80',
        approvedAmount: '0',
        paidAmount: '119.60',
      },
    ]);
    // Atıf sayısı alt sorguyla alınır: komisyon JOIN'i satırı çoğaltıp sayıyı şişirmemeli.
    expect(sqlOf(migratorQuery.mock.calls[0])).toContain(
      'SELECT COUNT(*)::int FROM partner_referrals',
    );
  });

  it('createPartner: yinelenen kod → CONFLICT', async () => {
    migratorQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    await expect(
      createPartner({ code: 'smmm-ali', name: 'Ali SMMM', commissionRate: 20 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('createPartner: kayıt oluşturur ve id döner', async () => {
    const result = await createPartner({ code: 'smmm-ali', name: 'Ali SMMM', commissionRate: 15 });

    expect(result.id).toBeTruthy();
    const [sql, params] = migratorQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO partners');
    expect(params.slice(1)).toEqual(['smmm-ali', 'Ali SMMM', 15]);
  });

  it('updatePartner: boş yama VALIDATION_ERROR, bilinmeyen ortak NOT_FOUND', async () => {
    await expect(updatePartner('p1', {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(migratorQuery).not.toHaveBeenCalled();

    migratorQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(updatePartner('p1', { isActive: false })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('updatePartner: yalnızca gönderilen alanları günceller', async () => {
    migratorQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await updatePartner('p1', { commissionRate: 25, isActive: false });

    const [sql, params] = migratorQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('commission_rate = $2');
    expect(sql).toContain('is_active = $3');
    expect(sql).not.toContain('name =');
    expect(params).toEqual(['p1', 25, false]);
  });

  it('listCommissions: durum filtresi parametreyle uygulanır', async () => {
    await listCommissions('p1', 'pending');
    const [sql, params] = migratorQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('AND c.status = $2');
    expect(params).toEqual(['p1', 'pending']);

    migratorQuery.mockClear();
    await listCommissions('p1');
    const [sql2, params2] = migratorQuery.mock.calls[0] as [string, unknown[]];
    expect(sql2).not.toContain('c.status =');
    expect(params2).toEqual(['p1']);
  });

  describe('setCommissionStatus (pending → approved → paid; pending/approved → cancelled)', () => {
    it("'approved' yalnızca 'pending'den; geçişte denetim izi yazılır", async () => {
      migratorQuery.mockResolvedValueOnce({
        rows: [{ tenant_id: 't1', status: 'approved' }],
        rowCount: 1,
      });

      await setCommissionStatus('c1', 'approved', 'u1');

      const update = migratorQuery.mock.calls[0] as [string, unknown[]];
      expect(update[1]).toEqual(['c1', 'approved', ['pending']]);
      const audit = migratorQuery.mock.calls[1] as [string, unknown[]];
      expect(sqlOf(audit)).toContain('INSERT INTO audit_logs');
      expect(sqlOf(audit)).toContain('partner_commission.status_changed');
      expect(audit[1]).toContain('t1');
      expect(audit[1]).toContain('u1');
      expect(audit[1]).toContain('c1');
      expect(audit[1]).toContain(JSON.stringify({ status: 'approved' }));
    });

    it("'paid' yalnızca 'approved'den; 'cancelled' pending veya approved'den", async () => {
      migratorQuery.mockResolvedValue({
        rows: [{ tenant_id: 't1', status: 'x' }],
        rowCount: 1,
      });

      await setCommissionStatus('c1', 'paid', 'u1');
      await setCommissionStatus('c1', 'cancelled', 'u1');

      const updates = migratorQuery.mock.calls.filter((c) =>
        sqlOf(c).includes('UPDATE partner_commissions'),
      ) as Array<[string, unknown[]]>;
      expect(updates[0][1]).toEqual(['c1', 'paid', ['approved']]);
      expect(updates[1][1]).toEqual(['c1', 'cancelled', ['pending', 'approved']]);
    });

    it("'pending'e geri dönüş yok → VALIDATION_ERROR (veritabanına gitmez)", async () => {
      await expect(setCommissionStatus('c1', 'pending', 'u1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(migratorQuery).not.toHaveBeenCalled();
    });

    it('kayıt yoksa NOT_FOUND', async () => {
      migratorQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(setCommissionStatus('c1', 'approved', 'u1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('sondaki durumdan (paid) geçiş reddedilir ve denetim izi YAZILMAZ', async () => {
      migratorQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // koşullu UPDATE eşleşmedi
        .mockResolvedValueOnce({ rows: [{ status: 'paid' }], rowCount: 1 }); // mevcut durum

      await expect(setCommissionStatus('c1', 'cancelled', 'u1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining("'paid'"),
      });
      const sqls = migratorQuery.mock.calls.map((c) => sqlOf(c));
      expect(sqls.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(false);
    });
  });

  describe('addReferral (şirket tek ortağa bağlanır)', () => {
    it('ortak yoksa NOT_FOUND', async () => {
      migratorQuery.mockResolvedValueOnce({ rows: [] });
      await expect(addReferral('p1', 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('şirket yoksa NOT_FOUND', async () => {
      migratorQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce({
        rows: [],
      });
      await expect(addReferral('p1', 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('şirket zaten bir ortağa bağlıysa CONFLICT', async () => {
      migratorQuery
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(addReferral('p1', 't1')).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('bağlı değilse atıf yazar', async () => {
      migratorQuery
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await addReferral('p1', 't1');

      expect(result.id).toBeTruthy();
      const insert = migratorQuery.mock.calls[2] as [string, unknown[]];
      expect(sqlOf(insert)).toContain('WHERE NOT EXISTS');
      expect(insert[1]).toEqual([result.id, 't1', 'p1']);
    });
  });
});
