import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getPool } from '@kuleplus/db';
import { ChequeService, type JournalPort, type ChequeJournalContext } from '../src/modules/cheque/service';

const sharedMockQuery = vi.fn();
const sharedMockClient = { query: sharedMockQuery, release: vi.fn() };
const sharedMockPool = {
  query: sharedMockQuery,
  connect: vi.fn().mockResolvedValue(sharedMockClient),
};

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

/**
 * Faz 6.6 — Çek/Senet servis testleri.
 *
 * currency.test.ts ile aynı desen: `pool.query` ile `client.query` aynı mock
 * referansına bağlanır; kontrol sorguları (BEGIN/COMMIT/ROLLBACK/set_config)
 * otomatik `{ rows: [] }` döner. Muhasebe portu sahte implementasyonla
 * enjekte edilir (JournalPort — DIP, SPEC §29.3).
 */
function useSharedPool() {
  vi.mocked(getPool).mockReturnValue(sharedMockPool as never);
  sharedMockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql).trim();
    if (
      s === 'BEGIN' ||
      s === 'COMMIT' ||
      s === 'ROLLBACK' ||
      s.includes('set_config') ||
      s.includes('current_tenant_id')
    ) {
      return Promise.resolve({ rows: [] });
    }
    return undefined;
  });
  return { mockQuery: sharedMockQuery, mockClient: sharedMockClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedMockQuery.mockReset();
  sharedMockClient.query.mockReset();
  sharedMockClient.release.mockReset();
  sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
  useSharedPool();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ======================= Sabitler =======================

const baseRow: Record<string, unknown> = {
  id: 'c1',
  cheque_type: 'cheque',
  direction: 'incoming',
  serial_no: 'A-1',
  cheque_no: '12345',
  bank_name: 'Ziraat',
  branch: 'Ankara Merkez',
  account_no: 'TR11 0000',
  drawer_name: 'Acme A.Ş.',
  endorser_name: null,
  issue_date: new Date('2026-10-01'),
  due_date: new Date('2026-10-30'),
  amount: '1000.00',
  currency: 'TRY',
  status: 'portfolio',
  portfolio_holder: 'own',
  contact_id: null,
  cash_bank_account_id: null,
  description: null,
  cancelled_reason: null,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
};

function buildService(port?: JournalPort): ChequeService {
  const service = new ChequeService({ pool: sharedMockPool as never });
  return port ? service.withJournalPort(port) : service;
}

/** Sahte muhasebe portu — test çağrılarını kaydeder, fiş id döner. */
function fakeJournal(active: boolean): JournalPort & { calls: ChequeJournalContext[] } {
  const calls: ChequeJournalContext[] = [];
  return {
    calls,
    isAccountingActive: vi.fn().mockResolvedValue(active),
    postCollected: vi.fn(async (ctx: ChequeJournalContext) => {
      calls.push({ ...ctx, userId: ctx.userId });
      return 'entry-collected';
    }),
    postBounced: vi.fn(async (ctx: ChequeJournalContext) => {
      calls.push({ ...ctx, userId: ctx.userId });
      return 'entry-bounced';
    }),
  };
}

/** getChequeById dönüş satırı (mapChequeRow bekler). */
function chequeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...baseRow, ...overrides };
}

/** Tekillik kontrolü + insert/update sorgularını yakalayan ortak mock kurulumu. */
function commonCreationalMocks(overrides: Record<string, unknown> = {}) {
  sharedMockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    const s = String(sql).trim();
    if (s.startsWith('SELECT id FROM cheques')) {
      return Promise.resolve({ rows: [] });
    }
    if (
      s.startsWith('INSERT INTO cheques') ||
      s.startsWith('INSERT INTO cheque_portfolio') ||
      s.startsWith('INSERT INTO cheque_transactions') ||
      s.startsWith('UPDATE cheque_portfolio') ||
      s.startsWith('UPDATE cheques') ||
      s.startsWith('DELETE FROM cheques')
    ) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (
      s.includes('SELECT * FROM cheques WHERE id = $1') ||
      s.includes('SELECT status FROM cheques')
    ) {
      return Promise.resolve({ rows: [chequeRow(overrides)] });
    }
    void params;
    return Promise.resolve({ rows: [] });
  });
}

// ======================= Kart CRUD =======================

describe('createCheque', () => {
  it('çek kartı + portföy kaydı + created durum geçmişi yazar', async () => {
    commonCreationalMocks();
    const service = buildService(fakeJournal(true));

    const out = (await service.createCheque(
      {
        cheque_type: 'cheque',
        direction: 'incoming',
        cheque_no: '12345',
        drawer_name: 'Acme A.Ş.',
        issue_date: '2026-10-01',
        due_date: '2026-10-30',
        amount: 1000,
        currency: 'TRY',
        portfolio_holder: 'own',
      },
      'u1',
      't1',
    ))!;

    expect(out.id).toBe('c1');
    expect(out.status).toBe('portfolio');
    expect(out.chequeNo).toBe('12345');
    expect(out.amount).toBe(1000);

    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.startsWith('INSERT INTO cheques'))).toBe(true);
    expect(calls.some((c) => c.startsWith('INSERT INTO cheque_portfolio'))).toBe(true);
    const trx = calls.find((c) => c.startsWith('INSERT INTO cheque_transactions'));
    expect(trx).toBeDefined();
    // created geçmişi: 'created' tipi + to_status 'portfolio'.
    const trxParams = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).startsWith('INSERT INTO cheque_transactions'),
    )?.[1] as unknown[];
    expect(trxParams).toContain('created');
    expect(trxParams).toContain('portfolio');
  });

  it('aynı seri/no kombinasyonunda çakışma hatası verir', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.startsWith('SELECT id FROM cheques')) {
        return Promise.resolve({ rows: [{ id: 'existing' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    await expect(
      service.createCheque(
        {
          cheque_type: 'cheque',
          direction: 'incoming',
          cheque_no: '12345',
          drawer_name: 'Acme A.Ş.',
          issue_date: '2026-10-01',
          due_date: '2026-10-30',
          amount: 1000,
          currency: 'TRY',
          portfolio_holder: 'own',
        },
        'u1',
        't1',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('updateCheque / deleteCheque', () => {
  it('terminal durumdaki çek güncellenemez (SPEC §10.1 — kesinleşmiş kayıt)', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.startsWith('SELECT status FROM cheques')) {
        return Promise.resolve({ rows: [chequeRow({ status: 'collected' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    await expect(
      service.updateCheque('c1', { drawer_name: 'Yeni' }, 'u1', 't1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('portföydeki çek güncellenir', async () => {
    const service = buildService(fakeJournal(true));
    commonCreationalMocks();
    const out = (await service.updateCheque('c1', { drawer_name: 'Yeni Keşideci' }, 'u1', 't1'))!;
    expect(out.drawerName).toBe('Acme A.Ş.'); // getById mock satırı — güncel kart döner.
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.startsWith('UPDATE cheques SET'))).toBe(true);
  });

  it('portföydeki çek silinebilir; işlem görmüş çek silinemez', async () => {
    const service = buildService(fakeJournal(true));
    commonCreationalMocks({ status: 'portfolio' });
    const out = await service.deleteCheque('c1', 't1');
    expect(out).toEqual({ success: true });
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.startsWith('DELETE FROM cheques'))).toBe(true);

    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.startsWith('SELECT status FROM cheques')) {
        return Promise.resolve({ rows: [{ status: 'collected' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    await expect(service.deleteCheque('c2', 't1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listCheques / getChequeById', () => {
  it('sayfalı liste döner; durum filtresi SQL koşuluna eklenir', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('COUNT(*) AS total')) {
        return Promise.resolve({ rows: [{ total: '1' }] });
      }
      if (s.includes('SELECT c.* FROM cheques')) {
        return Promise.resolve({ rows: [chequeRow()] });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    const out = await service.listCheques(
      { page: 1, limit: 20, status: 'portfolio', sortBy: 'due_date', sortOrder: 'asc' as const },
      't1',
    );

    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].chequeNo).toBe('12345');
    expect(out.items[0].dueDate).toBe('2026-10-30');
    expect(out.items[0].amount).toBe(1000);
    const selectCall = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('SELECT c.* FROM cheques'),
    );
    expect(String(selectCall?.[0])).toContain('status = $');
  });

  it('bulunamayan çek detayı null döner', async () => {
    sharedMockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const service = buildService(fakeJournal(true));
    const out = await service.getChequeById('nope', 't1');
    expect(out).toBeNull();
  });
});

// ======================= Yaşam Döngüsü =======================

/**
 * Aksiyonlar (ciro/tahsil/karşılıksız/iptal) için ortak mock:
 * ilk `SELECT * FROM cheques WHERE id = $1` loadActiveCheque (portfolio satır),
 * ikincisi getChequeById (işlem sonrası terminal satır).
 */
function actionMocks(
  finalRow: Record<string, unknown>,
  loadRow: Record<string, unknown> = chequeRow(),
) {
  let loadCount = 0;
  sharedMockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql).trim();
    if (s.startsWith('INSERT INTO') || s.startsWith('UPDATE ')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (s.includes('SELECT * FROM cheques WHERE id = $1')) {
      loadCount++;
      // 1. çağrı loadActiveCheque (portföy satırı), 2. çağrı getChequeById (terminal satır).
      return Promise.resolve({ rows: [loadCount === 1 ? loadRow : chequeRow(finalRow)] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function trxParamsFor(calls: unknown[][], prefix: string): unknown[] | undefined {
  const call = calls.find((c) => String(c[0]).startsWith(prefix));
  return call?.[1] as unknown[] | undefined;
}

describe('endorseCheque', () => {
  it('alınan çek ciro edilir: durum + portföy + durum geçmişi tek işlemde', async () => {
    actionMocks({ status: 'endorsed', portfolio_holder: 'supplier' });
    const service = buildService(fakeJournal(true));

    const out = (await service.endorseCheque(
      'c1',
      { to_holder: 'supplier', party_name: 'Tedarikçi Ltd.', transaction_date: '2026-10-15' },
      'u1',
      't1',
    ))!;

    expect(out.status).toBe('endorsed');
    const calls = sharedMockQuery.mock.calls;
    // Yeni portföy kaydı (ciro yeri) eklendi.
    expect(calls.filter((c) => String(c[0]).startsWith('INSERT INTO cheque_portfolio'))).toHaveLength(1);
    // Durum geçmişi 'endorsed' + taraf bilgisi.
    const params = trxParamsFor(calls, 'INSERT INTO cheque_transactions');
    expect(params).toContain('endorsed');
    expect(params).toContain('Tedarikçi Ltd.');
  });

  it('verilen (outgoing) çek cirolanamaz', async () => {
    actionMocks({});
    // loadActiveCheque incoming kontrolü: outgoing satırı döndür.
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('SELECT * FROM cheques WHERE id = $1')) {
        return Promise.resolve({ rows: [chequeRow({ direction: 'outgoing' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    await expect(
      service.endorseCheque(
        'c1',
        { to_holder: 'supplier', party_name: 'X', transaction_date: '2026-10-15' },
        'u1',
        't1',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('collectCheque', () => {
  it('muhasebe aktifken tahsil fişi yazar; makbuz fişi durum geçmişine bağlanır', async () => {
    actionMocks({ status: 'collected' });
    const journal = fakeJournal(true);
    const service = buildService(journal);

    const out = (await service.collectCheque(
      'c1',
      { cash_bank_account_id: 'acc-1', transaction_date: '2026-10-20' },
      'u1',
      't1',
    ))!;

    // Muhasebe portu alınan çek → borç kasa/banka, alacak 120 ile çağrıldı.
    expect(journal.calls).toHaveLength(1);
    expect(journal.calls[0].direction).toBe('incoming');
    expect(journal.calls[0].amount).toBe(1000);
    expect(journal.calls[0].chequeId).toBe('c1');

    expect(out.status).toBe('collected');
    const calls = sharedMockQuery.mock.calls;
    // Durum geçmişi 'collected' + fiş id bağlantısı.
    const params = trxParamsFor(calls, 'INSERT INTO cheque_transactions');
    expect(params).toContain('collected');
    expect(params).toContain('entry-collected');
  });

  it('muhasebe kapalıyken fiş yazılmaz; durum geçişi yine gerçekleşir', async () => {
    actionMocks({ status: 'collected' });
    const journal = fakeJournal(false);
    const service = buildService(journal);

    const out = (await service.collectCheque(
      'c1',
      { cash_bank_account_id: 'acc-1', transaction_date: '2026-10-20' },
      'u1',
      't1',
    ))!;

    expect(journal.calls).toHaveLength(0);
    expect(out.status).toBe('collected');
    const calls = sharedMockQuery.mock.calls;
    const params = trxParamsFor(calls, 'INSERT INTO cheque_transactions');
    expect(params).toContain('collected');
    // Fiş bağlantısı boş.
    expect(params).not.toContain('entry-collected');
  });
});

describe('bounceCheque', () => {
  it('bankadaki çek karşılıksız işaretlenir; ters muhasebe kaydı yazılır', async () => {
    // loadActiveCheque: bank portföyünde; getById: bounced sonucu.
    actionMocks({ status: 'bounced', portfolio_holder: 'bank' }, chequeRow({ portfolio_holder: 'bank' }));
    const journal = fakeJournal(true);
    const service = buildService(journal);

    const out = (await service.bounceCheque(
      'c1',
      { transaction_date: '2026-10-22', reason: 'Hesapta bakiye yok' },
      'u1',
      't1',
    ))!;

    expect(journal.calls).toHaveLength(1);
    expect(journal.calls[0].direction).toBe('incoming');
    expect(out.status).toBe('bounced');
    const params = trxParamsFor(sharedMockQuery.mock.calls, 'INSERT INTO cheque_transactions');
    expect(params).toContain('bounced');
    expect(params).toContain('entry-bounced');
  });

  it('yalnızca bankadaki çekler karşılıksız işaretlenebilir', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('SELECT * FROM cheques WHERE id = $1')) {
        return Promise.resolve({ rows: [chequeRow({ portfolio_holder: 'own' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    await expect(
      service.bounceCheque('c1', { transaction_date: '2026-10-22', reason: 'X' }, 'u1', 't1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('cancelCheque', () => {
  it('çek iptal edilir; neden ve durum geçmişi kaydedilir', async () => {
    actionMocks({ status: 'cancelled', cancelled_reason: 'Hatalı kayıt' });
    const service = buildService(fakeJournal(true));

    const out = (await service.cancelCheque('c1', { reason: 'Hatalı kayıt' }, 'u1', 't1'))!;

    expect(out.status).toBe('cancelled');
    expect(out.cancelledReason).toBe('Hatalı kayıt');
    const calls = sharedMockQuery.mock.calls;
    expect(
      calls.some((c) => String(c[0]).startsWith('UPDATE cheques SET') && String(c[0]).includes('cancelled_reason')),
    ).toBe(true);
    const params = trxParamsFor(calls, 'INSERT INTO cheque_transactions');
    expect(params).toContain('cancelled');
  });
});

// ======================= Portföy / Vade / Geçmiş =======================

describe('portfolioSummary', () => {
  it('portföy yeri × durum bazında adet ve toplam döner', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('GROUP BY portfolio_holder, status')) {
        return Promise.resolve({
          rows: [
            { holder: 'own', status: 'portfolio', count: '2', total: '2500.00' },
            { holder: 'bank', status: 'collected', count: '1', total: '1000.00' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    const out = await service.portfolioSummary('t1');

    expect(out.items).toHaveLength(2);
    expect(out.items[0].holder).toBe('own');
    expect(out.items[0].count).toBe(2);
    expect(out.items[0].totalAmount).toBe(2500);
  });
});

describe('dueCalendar', () => {
  it('vade takvimi: portföydeki yaklaşan vadeleri tarihe göre döner', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('due_date BETWEEN current_date')) {
        return Promise.resolve({
          rows: [
            chequeRow({ id: 'c1', due_date: new Date('2026-10-28'), amount: '500.00' }),
            chequeRow({ id: 'c2', due_date: new Date('2026-10-30'), amount: '1000.00' }),
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    const out = await service.dueCalendar('t1', 30);

    expect(out).toHaveLength(2);
    expect(out[0].dueDate).toBe('2026-10-28');
    expect(out[1].amount).toBe(1000);
  });
});

describe('listTransactions', () => {
  it('çek durum geçmişini sayfalı döner', async () => {
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('COUNT(*) AS total')) {
        return Promise.resolve({ rows: [{ total: '2' }] });
      }
      if (s.includes('SELECT t.* FROM cheque_transactions')) {
        return Promise.resolve({
          rows: [
            {
              id: 't1',
              cheque_id: 'c1',
              transaction_type: 'collected',
              from_status: 'portfolio',
              to_status: 'collected',
              transaction_date: new Date('2026-10-20'),
              amount: '1000.00',
              party_name: null,
              journal_entry_id: 'e1',
              description: 'Tahsil edildi',
              created_at: '2026-10-20T09:00:00Z',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(fakeJournal(true));
    const out = await service.listTransactions(
      { page: 1, limit: 20, transaction_type: 'collected' },
      'c1',
      't1',
    );

    expect(out.total).toBe(2);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].transactionType).toBe('collected');
    expect(out.items[0].toStatus).toBe('collected');
    expect(out.items[0].journalEntryId).toBe('e1');
    expect(out.items[0].amount).toBe(1000);
    expect(out.items[0].transactionDate).toBe('2026-10-20');
  });
});

// ======================= Varsayılan Muhasebe Portu =======================

describe('AccountingJournalPort (varsayılan)', () => {
  it('tahsil: kasa/banka ↔ 120 arasında dengeli mahsup fişi yazar; gap-free entry_no', async () => {
    // Önce yeniden kur: bu test default port kullanacak (AccountingJournalPort).
    let getCall = 0;
    sharedMockQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      const s = String(sql).trim();
      if (s.includes('set_config') || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes('SELECT status FROM tenant_entitlements')) {
        return Promise.resolve({ rows: [{ status: 'active' }] });
      }
      if (s.includes('SELECT * FROM cheques WHERE id = $1')) {
        getCall++;
        // 1. çağrı loadActiveCheque (portfolio), 2. çağrı getChequeById (collected).
        return Promise.resolve({
          rows: [
            getCall === 1
              ? chequeRow({ cash_bank_account_id: 'acc-1' })
              : chequeRow({ status: 'collected', cash_bank_account_id: 'acc-1' }),
          ],
        });
      }
      if (s.includes('FROM account_mappings am')) {
        return Promise.resolve({ rows: [] }); // eşleşme yok → TDHP fallback.
      }
      if (s.includes('SELECT account_type FROM cash_bank_accounts')) {
        return Promise.resolve({ rows: [{ account_type: 'bank' }] });
      }
      if (s.includes('FROM accounting_accounts') && s.includes('code = $1')) {
        const code = String(params?.[0] ?? '');
        const ids: Record<string, string> = { '102': 'acct-bank', '120': 'acct-120' };
        return ids[code]
          ? Promise.resolve({ rows: [{ id: ids[code] }] })
          : Promise.resolve({ rows: [] });
      }
      if (s.includes('MAX(entry_no)')) {
        return Promise.resolve({ rows: [{ next_no: '4' }] });
      }
      if (s.startsWith('INSERT INTO') || s.startsWith('UPDATE ')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService(); // default port (AccountingJournalPort)
    const out = (await service.collectCheque(
      'c1',
      { cash_bank_account_id: 'acc-1', transaction_date: '2026-10-20' },
      'u1',
      't1',
    ))!;

    expect(out.status).toBe('collected');
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    const entryInsert = calls.find((c) => c.startsWith('INSERT INTO journal_entries'));
    expect(entryInsert).toBeDefined();
    expect(entryInsert).toContain("'mahsup'");
    expect(entryInsert).toContain("'posted'");
    expect(entryInsert).toContain("'cheque'");
    expect(entryInsert).toContain('4');
    // Dengeli fiş: 2 satır (borç kasa/banka + alacak 120).
    expect(calls.filter((c) => c.startsWith('INSERT INTO journal_lines'))).toHaveLength(2);
    // Durum geçmişine fiş id bağlandı (entry id, 'entry-' değil — gerçek port newId üretir).
    const trxParams = trxParamsFor(
      sharedMockQuery.mock.calls,
      'INSERT INTO cheque_transactions',
    ) as unknown[];
    const journalEntryId = trxParams.find((v): v is string => typeof v === 'string' && v.includes('-'));
    expect(journalEntryId).toBeTruthy();
  });

  it('hesap çözümlenemezse fiş atlanır (boş bırakılabilir muhasebe kaydı)', async () => {
    let getCall = 0;
    sharedMockQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).trim();
      if (s.includes('SELECT * FROM cheques WHERE id = $1')) {
        getCall++;
        return Promise.resolve({
          rows: [
            getCall === 1
              ? chequeRow({ cash_bank_account_id: 'acc-9' })
              : chequeRow({ status: 'collected', cash_bank_account_id: 'acc-9' }),
          ],
        });
      }
      if (s.includes('SELECT status FROM tenant_entitlements')) {
        return Promise.resolve({ rows: [{ status: 'active' }] });
      }
      if (s.includes('FROM account_mappings am')) {
        return Promise.resolve({ rows: [] });
      }
      // Kasa/banka yok, TDHP 102 de yok → debit çözülemez → fiş atlanır.
      if (s.includes('account_type FROM cash_bank_accounts')) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes('FROM accounting_accounts')) {
        return Promise.resolve({ rows: [] });
      }
      if (s.startsWith('INSERT INTO') || s.startsWith('UPDATE ')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = buildService();
    const out = (await service.collectCheque(
      'c1',
      { cash_bank_account_id: 'acc-9', transaction_date: '2026-10-20' },
      'u1',
      't1',
    ))!;

    expect(out.status).toBe('collected');
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.startsWith('INSERT INTO journal_entries'))).toBe(false);
  });
});





