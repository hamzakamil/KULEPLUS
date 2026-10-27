import { describe, expect, it } from 'vitest';
import {
  buildMonth,
  money,
  type BookEntry,
  type BookProfile,
} from '../src/modules/edefter/generator';
import { validateBook } from '../src/modules/edefter/validator';

/** Üretilen yevmiye ve kebir dosyaları GİB şema + schematron kurallarından (imza hariç) geçmeli. */
const profile: BookProfile = {
  vkn: '1234567808',
  title: 'Örnek Yapı Anonim Şirketi',
  nace: '41.20.01',
  phone: '03121111111',
  email: 'info@ornek.com.tr',
  website: 'www.ornek.com.tr',
  address: {
    buildingNumber: '26/4',
    street: 'Atatürk Caddesi',
    city: 'Ankara',
    postalCode: '06110',
    country: 'Türkiye',
  },
  accountants: [
    { name: 'SMMM Ayşe Kaya', engagementDescription: 'SMMM sözleşmesi, 2026-01-01, 2026/01' },
  ],
  sourceApplication: '1111111111##Entegratör A.Ş.##e-Defter Programı##1.0',
};

let line = 0;
const L = (
  main: string,
  name: string,
  dc: 'D' | 'C',
  tl: number,
  extra: Partial<BookEntry['lines'][number]> = {},
) => ({
  lineNumber: ++line,
  accountMainId: main.split('.')[0],
  accountMainDescription: name.toUpperCase(),
  accountSubId: main.includes('.') ? main : null,
  accountSubDescription: main.includes('.') ? name : null,
  debitCredit: dc,
  amountK: Math.round(tl * 100),
  ...extra,
});

function month(): BookEntry[] {
  line = 100; // önceki aylardan devam eden satır numarası
  return [
    {
      counter: 41,
      entryNumber: '000041',
      date: '2026-03-02',
      enteredBy: 'Ayşe Kaya',
      comment: 'Satış faturası ABC2026000000012',
      lines: [
        L('120.01', 'Müşteri A', 'D', 1200, {
          document: { type: 'invoice', number: 'ABC2026000000012', date: '2026-03-02' },
        }),
        L('600', 'Yurtiçi Satışlar', 'C', 1000, {
          document: { type: 'invoice', number: 'ABC2026000000012', date: '2026-03-02' },
        }),
        L('391', 'Hesaplanan KDV', 'C', 200, {
          document: { type: 'invoice', number: 'ABC2026000000012', date: '2026-03-02' },
        }),
      ],
    },
    {
      counter: 42,
      entryNumber: '000042',
      date: '2026-03-10',
      enteredBy: 'Ayşe Kaya',
      comment: 'Müşteri A çeki',
      lines: [
        L('101.01', 'Portföydeki Çekler', 'D', 1200.5, {
          document: { type: 'check', number: 'C-55', date: '2026-03-10' },
          paymentMethod: 'Çek',
        }),
        L('120.01', 'Müşteri A', 'C', 1200.5, {
          document: { type: 'check', number: 'C-55', date: '2026-03-10' },
          paymentMethod: 'Çek',
        }),
      ],
    },
    {
      counter: 43,
      entryNumber: '000043',
      date: '2026-03-31',
      enteredBy: 'Ayşe Kaya',
      comment: 'Serbest meslek makbuzu',
      lines: [
        L('770.01', 'Danışmanlık', 'D', 500, {
          document: {
            type: 'other',
            description: 'Serbest Meslek Makbuzu',
            number: 'SMM-7',
            date: '2026-03-31',
          },
        }),
        L('100.01', 'TL Kasası', 'C', 500, { paymentMethod: 'Nakit' }),
      ],
    },
  ];
}

const base = {
  profile,
  monthStart: '2026-03-01',
  monthEnd: '2026-03-31',
  fiscalYearStart: '2026-01-01',
  fiscalYearEnd: '2026-12-31',
  creationDate: '2026-04-05',
  nextUniqueSeq: 3,
};

describe('e-Defter üretici', () => {
  it('money(): GİB tutar biçimi', () => {
    expect([money(100000), money(120050), money(5), money(0)]).toEqual([
      '1000',
      '1200.50',
      '0.05',
      '0',
    ]);
  });

  it('tek parça: Y ve K GİB kurallarından geçer; dosya adı, uniqueID, satır/madde aralıkları doğru', async () => {
    const parts = buildMonth({ ...base, entries: month() });
    expect(parts.map((p) => p.fileName)).toEqual([
      '1234567808-202603-Y-000000.xml',
      '1234567808-202603-K-000000.xml',
    ]);
    expect(parts.map((p) => p.uniqueId)).toEqual(['YEV202603000003', 'KEB202603000003']);
    expect(parts[0]).toMatchObject({
      firstCounter: 41,
      lastCounter: 43,
      firstLine: 101,
      lastLine: 107,
      totalDebitK: 290050,
      totalCreditK: 290050,
    });
    for (const p of parts) {
      const r = await validateBook(p.xml, p.fileName, p.book);
      expect(r.errors, `${p.fileName}\n${r.errors.join('\n')}`).toEqual([]);
    }
  }, 120_000);

  it('parçalı: dönemler boşluksuz, ilk parça ay başı, son parça ay sonu; her parça geçerli', async () => {
    const parts = buildMonth({ ...base, entries: month(), maxBytes: 9_000 });
    const y = parts.filter((p) => p.book === 'Y');
    expect(y.length).toBeGreaterThan(1);
    expect(y.map((p) => p.fileName.slice(-10, -4))).toEqual(
      y.map((_, i) => String(i + 1).padStart(6, '0')),
    );
    expect(y[0].periodStart).toBe('2026-03-01');
    expect(y[y.length - 1].periodEnd).toBe('2026-03-31');
    for (let i = 1; i < y.length; i++) {
      const prev = new Date(`${y[i - 1].periodEnd}T00:00:00Z`).getTime();
      const cur = new Date(`${y[i].periodStart}T00:00:00Z`).getTime();
      expect(cur - prev).toBeLessThanOrEqual(86_400_000);
    }
    for (const p of parts) {
      const r = await validateBook(p.xml, p.fileName, p.book);
      expect(r.errors, `${p.fileName}\n${r.errors.join('\n')}`).toEqual([]);
    }
  }, 120_000);
});
