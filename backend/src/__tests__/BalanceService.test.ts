import { BalanceService } from '../services/BalanceService';
import { repositoryFactory } from '../repositories/RepositoryFactory';

jest.mock('../repositories/RepositoryFactory', () => {
  const mockJournalRepo = {
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
  };
  const mockAccountRepo = {
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
  };
  return {
    repositoryFactory: {
      getJournalRepository: () => mockJournalRepo,
      getAccountRepository: () => mockAccountRepo,
      getAuditLogRepository: () => ({
        create: jest.fn(),
        findAll: jest.fn(),
        count: jest.fn(),
      }),
      getExchangeRateRepository: jest.fn(),
    },
  };
});

const journalRepo = repositoryFactory.getJournalRepository();
const accountRepo = repositoryFactory.getAccountRepository();

describe('BalanceService', () => {
  let service: BalanceService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new BalanceService();
  });

  describe('getHesapBakiye', () => {
    it('hesap bakiyesini doğru hesaplamalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
        normalBakiye: 1,
      });
      (journalRepo.getHesapToplam as jest.Mock).mockResolvedValue({
        borc: 15000,
        alacak: 5000,
      });

      const bakiye = await service.getHesapBakiye('100');

      expect(bakiye.hesapKodu).toBe('100');
      expect(bakiye.borcToplam).toBe(15000);
      expect(bakiye.alacakToplam).toBe(5000);
      expect(bakiye.bakiye).toBe(10000);
      expect(bakiye.bakiyeYonu).toBe('borc');
      expect(bakiye.tersBakiye).toBe(false);
    });

    it('ters bakiye uyarısı vermeli', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
        normalBakiye: 1, // Borç bakiyesi bekleniyor
      });
      (journalRepo.getHesapToplam as jest.Mock).mockResolvedValue({
        borc: 3000,
        alacak: 8000, // Alacak bakiyesi veriyor -> Ters bakiye!
      });

      const bakiye = await service.getHesapBakiye('100');

      expect(bakiye.bakiyeYonu).toBe('alacak');
      expect(bakiye.tersBakiye).toBe(true);
      expect(bakiye.tersBakiyeUyari).toContain('ters bakiye');
    });

    it('bulunamayan hesap için hata fırlatmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);

      await expect(service.getHesapBakiye('999')).rejects.toThrow('Hesap bulunamadı: 999');
    });
  });

  describe('getMizan', () => {
    it('tüm hesapların mizan raporunu oluşturmalı', async () => {
      (accountRepo.findAll as jest.Mock).mockResolvedValue([
        { hesapKodu: '100', hesapAdi: 'Kasa', aktif: true },
        { hesapKodu: '320', hesapAdi: 'Satıcılar', aktif: true },
        { hesapKodu: '600', hesapAdi: 'Satışlar', aktif: true },
      ]);
      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 10000, alacak: 3000 })  // 100 - Kasa
        .mockResolvedValueOnce({ borc: 2000, alacak: 8000 })   // 320 - Satıcılar
        .mockResolvedValueOnce({ borc: 0, alacak: 1000 });     // 600 - Satışlar

      const mizan = await service.getMizan();

      expect(mizan.satirlar).toHaveLength(3);
      expect(mizan.genelBorcToplam).toBe(12000);
      expect(mizan.genelAlacakToplam).toBe(12000);
      expect(mizan.denklikDurumu).toBe(true);

      // Kasa: borç bakiye
      const kasaSatir = mizan.satirlar.find(s => s.hesapKodu === '100');
      expect(kasaSatir?.borcBakiye).toBe(7000);
      expect(kasaSatir?.alacakBakiye).toBe(0);

      // Satıcılar: alacak bakiye
      const saticiSatir = mizan.satirlar.find(s => s.hesapKodu === '320');
      expect(saticiSatir?.borcBakiye).toBe(0);
      expect(saticiSatir?.alacakBakiye).toBe(6000);
    });

    it('sıfır bakiyeli hesapları atlayıp denklik sağlamalı', async () => {
      (accountRepo.findAll as jest.Mock).mockResolvedValue([
        { hesapKodu: '100', hesapAdi: 'Kasa', aktif: true },
        { hesapKodu: '101', hesapAdi: 'Alınan Çekler', aktif: true },
      ]);
      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 5000, alacak: 2000 })
        .mockResolvedValueOnce({ borc: 0, alacak: 0 }); // Sıfır bakiye

      const mizan = await service.getMizan();

      expect(mizan.satirlar).toHaveLength(1); // Sıfır bakiyeli atlanmalı
      expect(mizan.satirlar[0].hesapKodu).toBe('100');
    });

    it('belirli hesap sınıfı ile filtrelemeli', async () => {
      (accountRepo.findBySinif as jest.Mock).mockResolvedValue([
        { hesapKodu: '100', hesapAdi: 'Kasa', aktif: true },
      ]);
      (journalRepo.getHesapToplam as jest.Mock).mockResolvedValue({ borc: 5000, alacak: 1000 });

      const mizan = await service.getMizan(undefined, undefined, 1);

      expect(accountRepo.findBySinif).toHaveBeenCalledWith(1);
      expect(mizan.satirlar).toHaveLength(1);
    });
  });

  describe('getBilanco', () => {
    it('aktif ve pasif tarafları doğru hesaplamalı', async () => {
      // Aktif: Sınıf 1, 2
      (accountRepo.findBySinif as jest.Mock)
        .mockResolvedValueOnce([
          { hesapKodu: '100', hesapAdi: 'Kasa', normalBakiye: 1, duzenleyiciHesapMi: false },
        ]) // Sınıf 1
        .mockResolvedValueOnce([
          { hesapKodu: '253', hesapAdi: 'Makine', normalBakiye: 1, duzenleyiciHesapMi: false },
        ]) // Sınıf 2
        .mockResolvedValueOnce([
          { hesapKodu: '320', hesapAdi: 'Satıcılar', normalBakiye: -1, duzenleyiciHesapMi: false },
        ]) // Sınıf 3
        .mockResolvedValueOnce([]) // Sınıf 4
        .mockResolvedValueOnce([
          { hesapKodu: '500', hesapAdi: 'Sermaye', normalBakiye: -1, duzenleyiciHesapMi: false },
        ]); // Sınıf 5

      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 10000, alacak: 3000 }) // 100
        .mockResolvedValueOnce({ borc: 50000, alacak: 0 })    // 253
        .mockResolvedValueOnce({ borc: 2000, alacak: 7000 })  // 320
        .mockResolvedValueOnce({ borc: 0, alacak: 50000 });   // 500

      const bilanco = await service.getBilanco();

      expect(bilanco.aktif.satirlar).toHaveLength(2);
      expect(bilanco.pasif.satirlar).toHaveLength(2);
      expect(bilanco.aktif.toplam).toBe(57000); // 7000 + 50000
      expect(bilanco.pasif.toplam).toBe(55000); // 5000 + 50000
    });

    it('düzenleyici hesapları netleştirmeli', async () => {
      (accountRepo.findBySinif as jest.Mock)
        .mockResolvedValueOnce([
          { hesapKodu: '253', hesapAdi: 'Makine', normalBakiye: 1, duzenleyiciHesapMi: false },
          { hesapKodu: '257', hesapAdi: 'Birikmiş Amortisman', normalBakiye: -1, duzenleyiciHesapMi: true },
        ]) // Sınıf 2 (1de hiç yok)
        .mockResolvedValueOnce([]) // Sınıf 1
        .mockResolvedValueOnce([]) // Sınıf 3
        .mockResolvedValueOnce([]) // Sınıf 4
        .mockResolvedValueOnce([]); // Sınıf 5

      // findBySinif sırasını ayarla - bilançoda 1, 2 sonra 3, 4, 5
      // Aslında kod 1 sonra 2 çağırıyor
      jest.resetAllMocks();
      (accountRepo.findBySinif as jest.Mock)
        .mockResolvedValueOnce([]) // Sınıf 1
        .mockResolvedValueOnce([
          { hesapKodu: '253', hesapAdi: 'Makine', normalBakiye: 1, duzenleyiciHesapMi: false },
          { hesapKodu: '257', hesapAdi: 'Birikmiş Amortisman', normalBakiye: -1, duzenleyiciHesapMi: true },
        ]) // Sınıf 2
        .mockResolvedValueOnce([]) // Sınıf 3
        .mockResolvedValueOnce([]) // Sınıf 4
        .mockResolvedValueOnce([]); // Sınıf 5

      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 100000, alacak: 0 })    // 253 Makine
        .mockResolvedValueOnce({ borc: 0, alacak: 30000 });    // 257 Amortisman (negatif bakiye verir)

      const bilanco = await service.getBilanco();

      // 253: bakiye = 100000, netTutar = 100000
      // 257: bakiye = -30000, düzenleyici olduğu için netTutar = -30000
      const makineSatir = bilanco.aktif.satirlar.find(s => s.hesapKodu === '253');
      const amortismanSatir = bilanco.aktif.satirlar.find(s => s.hesapKodu === '257');

      expect(makineSatir?.netTutar).toBe(100000);
      expect(amortismanSatir?.duzenleyici).toBe(true);
      expect(amortismanSatir?.netTutar).toBe(-30000);
      // Toplam: 100000 - 30000 = 70000
      expect(bilanco.aktif.toplam).toBe(70000);
    });
  });

  describe('getGelirTablosu', () => {
    it('gelir ve giderleri doğru ayırmalı', async () => {
      (accountRepo.findBySinif as jest.Mock)
        .mockResolvedValueOnce([
          { hesapKodu: '600', hesapAdi: 'Yurtiçi Satışlar' },
          { hesapKodu: '621', hesapAdi: 'STMM' },
        ]) // Sınıf 6
        .mockResolvedValueOnce([
          { hesapKodu: '770', hesapAdi: 'Genel Yönetim Giderleri' },
        ]); // Sınıf 7

      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 0, alacak: 100000 })   // 600 - Gelir (alacak bakiye)
        .mockResolvedValueOnce({ borc: 60000, alacak: 0 })    // 621 - Gider (borç bakiye)
        .mockResolvedValueOnce({ borc: 20000, alacak: 0 });   // 770 - Gider

      const rapor = await service.getGelirTablosu();

      expect(rapor.toplamGelir).toBe(100000);
      expect(rapor.toplamGider).toBe(80000);
      expect(rapor.donemKarZarar).toBe(20000);
      expect(rapor.karMi).toBe(true);

      const gelirSatir = rapor.satirlar.find(s => s.tur === 'gelir');
      expect(gelirSatir?.hesapKodu).toBe('600');

      const giderSatirlari = rapor.satirlar.filter(s => s.tur === 'gider');
      expect(giderSatirlari).toHaveLength(2);
    });

    it('zarar durumunu doğru göstermeli', async () => {
      (accountRepo.findBySinif as jest.Mock)
        .mockResolvedValueOnce([
          { hesapKodu: '600', hesapAdi: 'Satışlar' },
        ])
        .mockResolvedValueOnce([
          { hesapKodu: '770', hesapAdi: 'Giderler' },
        ]);

      (journalRepo.getHesapToplam as jest.Mock)
        .mockResolvedValueOnce({ borc: 0, alacak: 50000 })  // Gelir
        .mockResolvedValueOnce({ borc: 80000, alacak: 0 }); // Gider

      const rapor = await service.getGelirTablosu();

      expect(rapor.donemKarZarar).toBe(-30000);
      expect(rapor.karMi).toBe(false);
    });
  });

  describe('getHesapEkstresi', () => {
    it('hesap ekstresini kalan bakiye ile oluşturmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
      });

      // Başlangıç öncesi bakiye
      (journalRepo.getHesapToplam as jest.Mock).mockResolvedValue({
        borc: 5000,
        alacak: 2000,
      });

      // Hareketler
      (journalRepo.getHesapHareketleri as jest.Mock).mockResolvedValue([
        { hareketId: '1', hesapKodu: '100', tutar: 1000, yon: 1 },
        { hareketId: '2', hesapKodu: '100', tutar: 500, yon: -1 },
        { hareketId: '3', hesapKodu: '100', tutar: 2000, yon: 1 },
      ]);

      const ekstre = await service.getHesapEkstresi('100', new Date('2024-01-01'), new Date('2024-01-31'));

      expect(ekstre.baslangicBakiye).toBe(3000); // 5000 - 2000
      expect(ekstre.hareketler).toHaveLength(3);

      // Kalan bakiyeler:
      // Başlangıç: 3000
      // +1000 (borç): 4000
      // -500 (alacak): 3500
      // +2000 (borç): 5500
      expect(ekstre.hareketler[0].kalan).toBe(4000);
      expect(ekstre.hareketler[1].kalan).toBe(3500);
      expect(ekstre.hareketler[2].kalan).toBe(5500);
      expect(ekstre.bitisBakiye).toBe(5500);
    });

    it('başlangıç tarihi olmadan bakiyeyi sıfırdan başlatmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
      });
      (journalRepo.getHesapHareketleri as jest.Mock).mockResolvedValue([
        { hareketId: '1', hesapKodu: '100', tutar: 3000, yon: 1 },
      ]);

      const ekstre = await service.getHesapEkstresi('100');

      expect(ekstre.baslangicBakiye).toBe(0);
      expect(ekstre.hareketler[0].kalan).toBe(3000);
    });
  });
});
