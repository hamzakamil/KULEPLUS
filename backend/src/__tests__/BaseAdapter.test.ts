import { StandartFatura, FisDonusumSonucu, FaturaTipi, AdapterConfig } from '../integrations/common/InvoiceAdapter';

// Mock services before importing BaseAdapter
jest.mock('../repositories/RepositoryFactory', () => ({
  repositoryFactory: {
    getAccountRepository: () => ({
      findByKod: jest.fn(),
      findAll: jest.fn(),
      findBySinif: jest.fn(),
      findByUstHesap: jest.fn(),
      findByBaglantiKodu: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      search: jest.fn(),
      count: jest.fn(),
    }),
    getJournalRepository: () => ({
      create: jest.fn(),
      findByFisNo: jest.fn(),
      findAll: jest.fn(),
      findByHesapKodu: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getNextFisNo: jest.fn(),
      count: jest.fn(),
      getHesapToplam: jest.fn(),
      getHesapHareketleri: jest.fn(),
    }),
    getAuditLogRepository: () => ({
      create: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
    }),
    getExchangeRateRepository: jest.fn(),
  },
}));

import { BaseAdapter } from '../integrations/common/BaseAdapter';

// Concrete test adapter
class TestAdapter extends BaseAdapter {
  readonly adapterAdi = 'test';
  readonly gorunenAd = 'Test Adapter';

  async testConnection(): Promise<boolean> {
    return true;
  }

  async getFaturalar(): Promise<StandartFatura[]> {
    return [];
  }

  async getFatura(): Promise<StandartFatura | null> {
    return null;
  }

  // Expose protected methods for testing
  public testFaturaToFis(fatura: StandartFatura): FisDonusumSonucu {
    return this.faturaToFis(fatura);
  }
}

describe('BaseAdapter - Muhasebeleştirme', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
  });

  const baseSatisFatura: StandartFatura = {
    faturaNo: 'FTR-001',
    faturaTipi: 'satis',
    tarih: new Date('2024-01-15'),
    cariAd: 'ABC Ticaret Ltd.',
    cariVkn: '1234567890',
    dovizKodu: 'TRY',
    durum: 'onaylandi',
    kalemler: [
      {
        siraNo: 1,
        urunAd: 'Bilgisayar',
        miktar: 2,
        birim: 'adet',
        birimFiyat: 10000,
        tutar: 20000,
        kdvOran: 20,
        kdvTutar: 4000,
        toplamTutar: 24000,
      },
    ],
    araToplam: 20000,
    kdvToplam: 4000,
    genelToplam: 24000,
  };

  describe('Satış faturası muhasebeleştirme', () => {
    it('doğru hesap kodları ve tutarlarla fiş oluşturmalı', () => {
      const sonuc = adapter.testFaturaToFis(baseSatisFatura);

      expect(sonuc.fisTipi).toBe('mahsup');
      expect(sonuc.aciklama).toContain('Satış Faturası');
      expect(sonuc.aciklama).toContain('FTR-001');

      // Borç: 120 Alıcılar = 24000 (genelToplam)
      const borcHareket = sonuc.hareketler.find(h => h.yon === 1);
      expect(borcHareket?.hesapKodu).toBe('120');
      expect(borcHareket?.tutar).toBe(24000);

      // Alacak: 600 Satışlar = 20000 (araToplam)
      const satisAlacak = sonuc.hareketler.find(h => h.hesapKodu === '600');
      expect(satisAlacak?.tutar).toBe(20000);
      expect(satisAlacak?.yon).toBe(-1);

      // Alacak: 391 KDV = 4000
      const kdvAlacak = sonuc.hareketler.find(h => h.hesapKodu === '391');
      expect(kdvAlacak?.tutar).toBe(4000);
      expect(kdvAlacak?.yon).toBe(-1);

      // Denklik: Borç = Alacak
      const borcToplam = sonuc.hareketler.filter(h => h.yon === 1).reduce((s, h) => s + h.tutar, 0);
      const alacakToplam = sonuc.hareketler.filter(h => h.yon === -1).reduce((s, h) => s + h.tutar, 0);
      expect(borcToplam).toBe(alacakToplam);
    });

    it('birden fazla KDV oranını gruplamalı', () => {
      const fatura: StandartFatura = {
        ...baseSatisFatura,
        kalemler: [
          { siraNo: 1, urunAd: 'Ürün A', miktar: 1, birim: 'adet', birimFiyat: 1000, tutar: 1000, kdvOran: 20, kdvTutar: 200, toplamTutar: 1200 },
          { siraNo: 2, urunAd: 'Ürün B', miktar: 1, birim: 'adet', birimFiyat: 500, tutar: 500, kdvOran: 10, kdvTutar: 50, toplamTutar: 550 },
          { siraNo: 3, urunAd: 'Ürün C', miktar: 1, birim: 'adet', birimFiyat: 2000, tutar: 2000, kdvOran: 20, kdvTutar: 400, toplamTutar: 2400 },
        ],
        araToplam: 3500,
        kdvToplam: 650,
        genelToplam: 4150,
      };

      const sonuc = adapter.testFaturaToFis(fatura);

      // KDV hareketleri: %20 -> 600, %10 -> 50
      const kdvHareketler = sonuc.hareketler.filter(h => h.hesapKodu === '391');
      expect(kdvHareketler).toHaveLength(2);

      const kdv20 = kdvHareketler.find(h => h.aciklama?.includes('%20'));
      expect(kdv20?.tutar).toBe(600);

      const kdv10 = kdvHareketler.find(h => h.aciklama?.includes('%10'));
      expect(kdv10?.tutar).toBe(50);
    });

    it('tevkifat varsa alıcılar tutarından düşmeli', () => {
      const fatura: StandartFatura = {
        ...baseSatisFatura,
        tevkifatToplam: 2000,
      };

      const sonuc = adapter.testFaturaToFis(fatura);

      // Alıcılar = genelToplam - tevkifat = 24000 - 2000 = 22000
      const alicilar = sonuc.hareketler.find(h => h.hesapKodu === '120');
      expect(alicilar?.tutar).toBe(22000);

      // Tevkifat hesabı
      const tevkifat = sonuc.hareketler.find(h => h.hesapKodu === '360');
      expect(tevkifat?.tutar).toBe(2000);
      expect(tevkifat?.yon).toBe(1);

      // Denklik kontrolü
      const borcToplam = sonuc.hareketler.filter(h => h.yon === 1).reduce((s, h) => s + h.tutar, 0);
      const alacakToplam = sonuc.hareketler.filter(h => h.yon === -1).reduce((s, h) => s + h.tutar, 0);
      expect(borcToplam).toBe(alacakToplam);
    });
  });

  describe('Alış faturası muhasebeleştirme', () => {
    const baseAlisFatura: StandartFatura = {
      faturaNo: 'AF-001',
      faturaTipi: 'alis',
      tarih: new Date('2024-01-20'),
      cariAd: 'XYZ Tedarik A.Ş.',
      cariVkn: '9876543210',
      dovizKodu: 'TRY',
      durum: 'onaylandi',
      kalemler: [
        {
          siraNo: 1,
          urunAd: 'Hammadde',
          miktar: 100,
          birim: 'kg',
          birimFiyat: 50,
          tutar: 5000,
          kdvOran: 20,
          kdvTutar: 1000,
          toplamTutar: 6000,
        },
      ],
      araToplam: 5000,
      kdvToplam: 1000,
      genelToplam: 6000,
    };

    it('doğru hesap kodları ile muhasebeleştirmeli', () => {
      const sonuc = adapter.testFaturaToFis(baseAlisFatura);

      expect(sonuc.aciklama).toContain('Alış Faturası');

      // Borç: 153 Ticari Mallar = 5000
      const malAlis = sonuc.hareketler.find(h => h.hesapKodu === '153');
      expect(malAlis?.tutar).toBe(5000);
      expect(malAlis?.yon).toBe(1);

      // Borç: 191 İndirilecek KDV = 1000
      const kdv = sonuc.hareketler.find(h => h.hesapKodu === '191');
      expect(kdv?.tutar).toBe(1000);
      expect(kdv?.yon).toBe(1);

      // Alacak: 320 Satıcılar = 6000
      const saticilar = sonuc.hareketler.find(h => h.hesapKodu === '320');
      expect(saticilar?.tutar).toBe(6000);
      expect(saticilar?.yon).toBe(-1);

      // Denklik
      const borcToplam = sonuc.hareketler.filter(h => h.yon === 1).reduce((s, h) => s + h.tutar, 0);
      const alacakToplam = sonuc.hareketler.filter(h => h.yon === -1).reduce((s, h) => s + h.tutar, 0);
      expect(borcToplam).toBe(alacakToplam);
    });
  });

  describe('Satış iade faturası', () => {
    it('ters kayıt yapmalı (satıştan iadeler borç, alıcılar alacak)', () => {
      const iadeFatura: StandartFatura = {
        ...baseSatisFatura,
        faturaTipi: 'iade_satis',
        faturaNo: 'IFT-001',
      };

      const sonuc = adapter.testFaturaToFis(iadeFatura);

      expect(sonuc.aciklama).toContain('Satış İade');

      // Borç: 610 Satıştan İadeler
      const iade = sonuc.hareketler.find(h => h.hesapKodu === '610');
      expect(iade?.yon).toBe(1);
      expect(iade?.tutar).toBe(20000);

      // Borç: 391 Hesaplanan KDV
      const kdv = sonuc.hareketler.find(h => h.hesapKodu === '391');
      expect(kdv?.yon).toBe(1);
      expect(kdv?.tutar).toBe(4000);

      // Alacak: 120 Alıcılar
      const alicilar = sonuc.hareketler.find(h => h.hesapKodu === '120');
      expect(alicilar?.yon).toBe(-1);
      expect(alicilar?.tutar).toBe(24000);

      // Denklik
      const borcToplam = sonuc.hareketler.filter(h => h.yon === 1).reduce((s, h) => s + h.tutar, 0);
      const alacakToplam = sonuc.hareketler.filter(h => h.yon === -1).reduce((s, h) => s + h.tutar, 0);
      expect(borcToplam).toBe(alacakToplam);
    });
  });

  describe('Alış iade faturası', () => {
    it('ters kayıt yapmalı (satıcılar borç, ticari mallar + KDV alacak)', () => {
      const iadeFatura: StandartFatura = {
        faturaNo: 'AIF-001',
        faturaTipi: 'iade_alis',
        tarih: new Date('2024-02-01'),
        cariAd: 'Tedarikçi A.Ş.',
        dovizKodu: 'TRY',
        durum: 'onaylandi',
        kalemler: [
          { siraNo: 1, urunAd: 'Mal', miktar: 10, birim: 'adet', birimFiyat: 100, tutar: 1000, kdvOran: 20, kdvTutar: 200, toplamTutar: 1200 },
        ],
        araToplam: 1000,
        kdvToplam: 200,
        genelToplam: 1200,
      };

      const sonuc = adapter.testFaturaToFis(iadeFatura);

      expect(sonuc.aciklama).toContain('Alış İade');

      // Borç: 320 Satıcılar
      const saticilar = sonuc.hareketler.find(h => h.hesapKodu === '320' && h.yon === 1);
      expect(saticilar?.tutar).toBe(1200);

      // Alacak: 153 Ticari Mallar
      const mallar = sonuc.hareketler.find(h => h.hesapKodu === '153');
      expect(mallar?.yon).toBe(-1);
      expect(mallar?.tutar).toBe(1000);

      // Alacak: 191 KDV
      const kdv = sonuc.hareketler.find(h => h.hesapKodu === '191');
      expect(kdv?.yon).toBe(-1);
      expect(kdv?.tutar).toBe(200);

      // Denklik
      const borcToplam = sonuc.hareketler.filter(h => h.yon === 1).reduce((s, h) => s + h.tutar, 0);
      const alacakToplam = sonuc.hareketler.filter(h => h.yon === -1).reduce((s, h) => s + h.tutar, 0);
      expect(borcToplam).toBe(alacakToplam);
    });
  });

  describe('Dövizli fatura', () => {
    it('döviz bilgisini hareketlere eklemeli', () => {
      const dovizFatura: StandartFatura = {
        ...baseSatisFatura,
        dovizKodu: 'USD',
        dovizKur: 28.50,
      };

      const sonuc = adapter.testFaturaToFis(dovizFatura);

      const alicilar = sonuc.hareketler.find(h => h.hesapKodu === '120');
      expect(alicilar?.dovizKodu).toBe('USD');
      expect(alicilar?.dovizKur).toBe(28.50);
    });
  });

  describe('Desteklenmeyen fatura tipi', () => {
    it('hata fırlatmalı', () => {
      const fatura: StandartFatura = {
        ...baseSatisFatura,
        faturaTipi: 'proforma' as FaturaTipi,
      };

      expect(() => adapter.testFaturaToFis(fatura)).toThrow('Desteklenmeyen fatura tipi');
    });
  });
});
