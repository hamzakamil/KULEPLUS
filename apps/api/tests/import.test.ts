import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseCsv,
  suggestMapping,
  ContactImportService,
  IMPORT_LIMIT_KEY,
  IMPORT_SYNC_MAX_ROWS,
} from '../src/modules/contacts/import.service';
import { getPool } from '@kuleplus/db';
import { checkLimit, incrementUsage } from '../src/modules/entitlement/service';
import { AppError } from '@kuleplus/shared';
import { ContactService } from '../src/modules/contacts/service.js';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock('../src/modules/entitlement/service', () => ({
  checkLimit: vi.fn(),
  incrementUsage: vi.fn(),
}));

describe('parseCsv', () => {
  it("UTF-8 BOM'u atlar", () => {
    const { headers, rows } = parseCsv('﻿contact_type,company_name\r\ncompany,ABC Ltd.\r\n');
    expect(headers).toEqual(['contact_type', 'company_name']);
    expect(rows).toEqual([['company', 'ABC Ltd.']]);
  });

  it('noktalı virgül ayırıcısını tespit eder', () => {
    const { headers, rows } = parseCsv('ad;soyad\nAli;Yılmaz\n');
    expect(headers).toEqual(['ad', 'soyad']);
    expect(rows).toEqual([['Ali', 'Yılmaz']]);
  });

  it('tırnaklı alanları ve "" escape\'i işler', () => {
    const { rows } = parseCsv('name,note\n"ABC, Ltd.","Merhaba ""dünya"""\n');
    expect(rows).toEqual([['ABC, Ltd.', 'Merhaba "dünya"']]);
  });

  it('boş dosya için VALIDATION_ERROR fırlatır', () => {
    expect(() => parseCsv('')).toThrow(AppError);
    expect(() => parseCsv('   ')).toThrow('CSV dosyası boş');
  });

  it('yalnızca başlık satırı varsa hata fırlatır', () => {
    expect(() => parseCsv('contact_type,company_name\n')).toThrow('en az bir başlık satırı');
  });
});

describe('suggestMapping', () => {
  it('İngilizce başlıkları eşler', () => {
    const m = suggestMapping(['contact_type', 'company_name', 'tax_number', 'phone']);
    expect(m.contact_type).toBe('contact_type');
    expect(m.company_name).toBe('company_name');
    expect(m.tax_number).toBe('tax_number');
    expect(m.phone).toBe('phone');
  });

  it('Türkçe takma adları eşler', () => {
    const m = suggestMapping(['Unvan', 'VKN', 'Telefon', 'İl']);
    expect(m.Unvan).toBe('company_name');
    expect(m.VKN).toBe('tax_number');
    expect(m.Telefon).toBe('phone');
    expect(m['İl']).toBe('city');
  });

  it('bilinmeyen başlık null döner', () => {
    const m = suggestMapping(['aciklama']);
    expect(m.aciklama).toBeNull();
  });
});

describe('ContactImportService', () => {
  let service: ContactImportService;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  const CSV_VALID =
    'contact_type,company_name,first_name,last_name,phone\n' +
    'company,"ABC Ltd.",,,05551234567\n' +
    'person,,Ali,Yılmaz,05559876543\n';

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
    vi.mocked(getPool).mockReturnValue(mockPool as never);
    vi.mocked(checkLimit).mockResolvedValue({
      tenantId: 't1',
      limitKey: IMPORT_LIMIT_KEY,
      allowed: true,
      current: 0,
      limit: 100,
      remaining: 100,
      resetAt: new Date('2026-11-01'),
    });
    vi.mocked(incrementUsage).mockResolvedValue(undefined);
    service = new ContactImportService(mockPool as never);
  });

  /** current_tenant_id() + DB mükerrer taraması + kod seq sorgularını karşıla */
  function primeQueries(opts?: {
    dbTax?: string[];
    dbPhones?: { name: string; number: string }[];
    maxCode?: string | null;
  }) {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('current_tenant_id() AS tenant_id')) {
        return Promise.resolve({ rows: [{ tenant_id: 'tenant-1' }] });
      }
      if (sql.includes('tax_number IS NOT NULL')) {
        return Promise.resolve({ rows: (opts?.dbTax ?? []).map((t) => ({ tax_number: t })) });
      }
      if (sql.includes('contact_phones')) {
        return Promise.resolve({ rows: opts?.dbPhones ?? [] });
      }
      if (sql.includes('MAX(code)')) {
        return Promise.resolve({ rows: [{ max_code: opts?.maxCode ?? null }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  describe('dryRun', () => {
    it('geçerli satırları raporlar, yazma yapmaz', async () => {
      primeQueries();
      const report = await service.dryRun(CSV_VALID);

      expect(report.summary.total).toBe(2);
      expect(report.summary.valid).toBe(2);
      expect(report.summary.duplicates).toBe(0);
      expect(report.summary.invalid).toBe(0);
      expect(report.rows.every((r) => r.status === 'valid')).toBe(true);
      const writes = mockQuery.mock.calls.filter((call: unknown[]) =>
        /INSERT|UPDATE|DELETE/i.test(String(call[0])),
      );
      expect(writes).toHaveLength(0);
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it('geçersiz VKN için satır hatası üretir', async () => {
      primeQueries();
      const csv = 'contact_type,company_name,tax_number\ncompany,ABC,123\n';
      const report = await service.dryRun(csv);

      expect(report.summary.invalid).toBe(1);
      expect(report.rows[0].status).toBe('invalid');
      expect(report.rows[0].issues.some((i) => i.field === 'tax_number')).toBe(true);
    });

    it('company türünde company_name zorunluluğunu denetler', async () => {
      primeQueries();
      const csv = 'contact_type,first_name\ncompany,Ali\n';
      const report = await service.dryRun(csv);
      expect(report.rows[0].issues.some((i) => i.field === 'company_name')).toBe(true);
    });

    it("DB'de aynı VKN varsa mükerrer işaretler", async () => {
      primeQueries({ dbTax: ['1234567890'] });
      const csv = 'contact_type,company_name,tax_number\ncompany,ABC,1234567890\n';
      const report = await service.dryRun(csv);

      expect(report.rows[0].status).toBe('duplicate');
      expect(report.rows[0].duplicateOf).toContain('VKN 1234567890');
      expect(report.summary.toImport).toBe(0);
    });

    it("dosya içi mükerrer VKN'yi işaretler", async () => {
      primeQueries();
      const csv =
        'contact_type,company_name,tax_number\n' +
        'company,ABC,1234567890\n' +
        'company,ABC Tekrar,1234567890\n';
      const report = await service.dryRun(csv);
      expect(report.rows[1].status).toBe('duplicate');
      expect(report.rows[1].duplicateOf).toContain('dosya içi 1. satır');
    });

    it('geçersiz telefon için satır hatası üretir', async () => {
      primeQueries();
      const csv = 'contact_type,company_name,phone\ncompany,ABC,12345\n';
      const report = await service.dryRun(csv);
      expect(report.rows[0].issues.some((i) => i.field === 'phone')).toBe(true);
    });

    it('kota bilgisini rapora dahil eder', async () => {
      primeQueries();
      const report = await service.dryRun(CSV_VALID);
      expect(report.limit).toEqual({
        current: 0,
        limit: 100,
        remaining: 100,
        resetAt: '2026-11-01T00:00:00.000Z',
      });
    });

    it('bilinmeyen hedef alan için VALIDATION_ERROR fırlatır', async () => {
      primeQueries();
      await expect(service.dryRun(CSV_VALID, { contact_type: 'bogus' } as never)).rejects.toThrow(
        'Bilinmeyen hedef alan',
      );
    });

    it('tekrarlanan hedef alan için VALIDATION_ERROR fırlatır', async () => {
      primeQueries();
      await expect(
        service.dryRun(CSV_VALID, { contact_type: 'phone', company_name: 'phone' }),
      ).rejects.toThrow('birden fazla kolona');
    });
  });

  describe('commit', () => {
    it('geçerli satırları oluşturur, IMP kod serisini sürdürür, sayacı artırır', async () => {
      primeQueries({ maxCode: 'IMP-000041' });
      const createSpy = vi
        .spyOn(ContactService.prototype, 'createContact')
        .mockImplementation(
          async (input) => ({ id: `id-${input.code}`, code: input.code }) as never,
        );
      try {
        const result = await service.commit(CSV_VALID);

        expect(result.summary).toEqual({ total: 2, created: 2, duplicates: 0, failed: 0 });
        expect(createSpy).toHaveBeenCalledTimes(2);
        expect(createSpy.mock.calls[0][0].code).toBe('IMP-000042');
        expect(createSpy.mock.calls[1][0].code).toBe('IMP-000043');
        expect(result.rows.every((r) => r.status === 'created')).toBe(true);
        expect(vi.mocked(incrementUsage)).toHaveBeenCalledWith(
          'tenant-1',
          IMPORT_LIMIT_KEY,
          undefined,
          2,
        );
      } finally {
        createSpy.mockRestore();
      }
    });

    it('mükerrer satırları atlar, sayaç yalnızca başarılılar için artar', async () => {
      primeQueries();
      const createSpy = vi
        .spyOn(ContactService.prototype, 'createContact')
        .mockImplementation(
          async (input) => ({ id: `id-${input.code}`, code: input.code }) as never,
        );
      try {
        const csv =
          'contact_type,company_name,tax_number\n' +
          'company,ABC,1234567890\n' +
          'company,ABC Tekrar,1234567890\n';
        const result = await service.commit(csv);

        expect(result.summary.created).toBe(1);
        expect(result.summary.duplicates).toBe(1);
        expect(vi.mocked(incrementUsage)).toHaveBeenCalledWith(
          'tenant-1',
          IMPORT_LIMIT_KEY,
          undefined,
          1,
        );
      } finally {
        createSpy.mockRestore();
      }
    });

    it('kota yetersizse yazmadan LIMIT_EXCEEDED fırlatır', async () => {
      primeQueries();
      vi.mocked(checkLimit).mockResolvedValue({
        tenantId: 't1',
        limitKey: IMPORT_LIMIT_KEY,
        allowed: false,
        current: 99,
        limit: 100,
        remaining: 1,
        resetAt: new Date('2026-11-01'),
      });
      const createSpy = vi.spyOn(ContactService.prototype, 'createContact');
      try {
        const err = await service.commit(CSV_VALID).catch((e) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err.code).toBe('LIMIT_EXCEEDED');
        expect(createSpy).not.toHaveBeenCalled();
        expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
      }
    });

    it('1000 satır üstünde kuyruk mesajı verir', async () => {
      primeQueries();
      const bigCsv =
        'contact_type,company_name\n' +
        Array.from({ length: IMPORT_SYNC_MAX_ROWS + 1 }, (_, i) => `company,Firma ${i}`).join(
          '\n',
        ) +
        '\n';
      await expect(service.commit(bigCsv)).rejects.toThrow('kuyruğa');
    });

    it('kayıt hatasında satırı failed sayar, sayaç artmaz', async () => {
      primeQueries();
      const createSpy = vi
        .spyOn(ContactService.prototype, 'createContact')
        .mockRejectedValue(new AppError('VALIDATION_ERROR', 'Kod çakıştı'));
      try {
        const result = await service.commit('contact_type,company_name\ncompany,ABC\n');

        expect(result.summary.created).toBe(0);
        expect(result.summary.failed).toBe(1);
        expect(result.rows[0].status).toBe('failed');
        expect(vi.mocked(incrementUsage)).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
      }
    });
  });

  describe('exportCsv', () => {
    it('BOM + başlık + RFC4180 kaçış üretir', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            code: 'IMP-000001',
            name: 'ABC, Ltd.',
            type: 'customer',
            tax_number: null,
            tax_office: null,
            phone: null,
            email: null,
            address_line1: null,
            city: null,
            district: null,
          },
        ],
      });

      const csv = await service.exportCsv();

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(
        'code,name,type,tax_number,tax_office,phone,email,address_line1,city,district',
      );
      expect(csv).toContain('"ABC, Ltd."');
    });

    it('boş listede yalnızca başlık döner', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const csv = await service.exportCsv();

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toBe(
        '﻿code,name,type,tax_number,tax_office,phone,email,address_line1,city,district\r\n',
      );
    });
  });
});
