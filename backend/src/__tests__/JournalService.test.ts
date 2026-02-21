import { JournalService } from '../services/JournalService';
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
  const mockAuditLogRepo = {
    create: jest.fn(),
    findAll: jest.fn(),
    count: jest.fn(),
  };
  return {
    repositoryFactory: {
      getJournalRepository: () => mockJournalRepo,
      getAccountRepository: () => mockAccountRepo,
      getAuditLogRepository: () => mockAuditLogRepo,
      getExchangeRateRepository: jest.fn(),
    },
  };
});

const journalRepo = repositoryFactory.getJournalRepository();
const accountRepo = repositoryFactory.getAccountRepository();
const auditLogRepo = repositoryFactory.getAuditLogRepository();

describe('JournalService', () => {
  let service: JournalService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new JournalService();
  });

  const mockKasaHesap = {
    hesapKodu: '100',
    hesapAdi: 'Kasa',
    aktif: true,
    normalBakiye: 1,
    duzenleyiciHesapMi: false,
  };

  const mockSaticilarHesap = {
    hesapKodu: '320',
    hesapAdi: 'Satıcılar',
    aktif: true,
    normalBakiye: -1,
    duzenleyiciHesapMi: false,
  };

  describe('createJournalEntry', () => {
    it('dengeli yevmiye fişi oluşturmalı (borç = alacak)', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);
      (journalRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        toplamBorc: 1000,
        toplamAlacak: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const entry = await service.createJournalEntry({
        tarih: new Date('2024-01-15'),
        aciklama: 'Kasa ödemesi',
        fisTipi: 'tediye',
        hareketler: [
          { hareketId: '', hesapKodu: '100', tutar: 1000, yon: 1 },
          { hareketId: '', hesapKodu: '320', tutar: 1000, yon: -1 },
        ],
      });

      expect(entry.toplamBorc).toBe(1000);
      expect(entry.toplamAlacak).toBe(1000);
      expect(journalRepo.create).toHaveBeenCalled();
      expect(auditLogRepo.create).toHaveBeenCalled();
    });

    it('fiş numarasını otomatik atamalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);
      (journalRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        toplamBorc: 500,
        toplamAlacak: 500,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.createJournalEntry({
        tarih: new Date(),
        aciklama: 'Test',
        hareketler: [
          { hareketId: '', hesapKodu: '100', tutar: 500, yon: 1 },
          { hareketId: '', hesapKodu: '320', tutar: 500, yon: -1 },
        ],
      });

      expect(journalRepo.getNextFisNo).toHaveBeenCalled();
      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ fisNo: 'YMM-2024-0001' })
      );
    });

    it('borç-alacak dengesi tutmazsa hata fırlatmalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);

      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Dengesiz fiş',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 1000, yon: 1 },
            { hareketId: '', hesapKodu: '320', tutar: 500, yon: -1 },
          ],
        })
      ).rejects.toThrow('Borç-Alacak dengesi tutmuyor!');
    });

    it('2den az hareket satırı olursa hata fırlatmalı', async () => {
      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Tek satır',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 1000, yon: 1 },
          ],
        })
      ).rejects.toThrow('en az 2 hareket satırı');
    });

    it('geçersiz hesap kodu için hata fırlatmalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Geçersiz hesap',
          hareketler: [
            { hareketId: '', hesapKodu: '999', tutar: 1000, yon: 1 },
            { hareketId: '', hesapKodu: '998', tutar: 1000, yon: -1 },
          ],
        })
      ).rejects.toThrow('Geçersiz hesap kodu: 999');
    });

    it('pasif hesaba kayıt yapılmamalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        ...mockKasaHesap,
        aktif: false,
      });

      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Pasif hesap',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 1000, yon: 1 },
            { hareketId: '', hesapKodu: '320', tutar: 1000, yon: -1 },
          ],
        })
      ).rejects.toThrow('Pasif hesaba kayıt yapılamaz');
    });

    it('negatif veya sıfır tutar reddedilmeli', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(mockKasaHesap);

      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Sıfır tutar',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 0, yon: 1 },
            { hareketId: '', hesapKodu: '320', tutar: 0, yon: -1 },
          ],
        })
      ).rejects.toThrow('Tutar pozitif olmalıdır');
    });

    it('döviz tutarı ve kur verildiğinde TL tutarını otomatik hesaplamalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);
      (journalRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        toplamBorc: 28500,
        toplamAlacak: 28500,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.createJournalEntry({
        tarih: new Date(),
        aciklama: 'Döviz ödeme',
        hareketler: [
          { hareketId: '', hesapKodu: '100', tutar: 0, yon: 1, dovizKodu: 'USD', dovizTutar: 1000, dovizKur: 28.50 },
          { hareketId: '', hesapKodu: '320', tutar: 28500, yon: -1 },
        ],
      });

      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hareketler: expect.arrayContaining([
            expect.objectContaining({ tutar: 28500, dovizTutar: 1000, dovizKur: 28.50 }),
          ]),
        })
      );
    });

    it('aktif düzenleyici hesaba sadece alacak kaydı yapılabilmeli', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '120',
        hesapAdi: 'Alıcılar',
        aktif: true,
        normalBakiye: -1,
        duzenleyiciHesapMi: true,
        duzenleyiciHesapTuru: 'aktif_duzenleyici',
      });

      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Düzenleyici test',
          hareketler: [
            { hareketId: '', hesapKodu: '120', tutar: 1000, yon: 1 }, // borç - hatalı
            { hareketId: '', hesapKodu: '320', tutar: 1000, yon: -1 },
          ],
        })
      ).rejects.toThrow('sadece alacak kaydı yapılabilir');
    });

    it('kuruş hassasiyetinde denklik sağlamalı (0.01 tolerans)', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);
      (journalRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        toplamBorc: 100,
        toplamAlacak: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // 0.005 fark (tolerans içinde)
      await expect(
        service.createJournalEntry({
          tarih: new Date(),
          aciklama: 'Kuruş farkı',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 100.005, yon: 1 },
            { hareketId: '', hesapKodu: '320', tutar: 100, yon: -1 },
          ],
        })
      ).resolves.toBeDefined();
    });
  });

  describe('approveJournalEntry', () => {
    it('taslak fişi onaylamalı', async () => {
      (journalRepo.findByFisNo as jest.Mock).mockResolvedValue({
        fisNo: 'YMM-2024-0001',
        durum: 'taslak',
      });
      (journalRepo.update as jest.Mock).mockResolvedValue({
        fisNo: 'YMM-2024-0001',
        durum: 'onaylandi',
      });

      const result = await service.approveJournalEntry('YMM-2024-0001');
      expect(result?.durum).toBe('onaylandi');
      expect(journalRepo.update).toHaveBeenCalledWith('YMM-2024-0001', { durum: 'onaylandi' });
    });

    it('taslak olmayan fiş onaylanamamalı', async () => {
      (journalRepo.findByFisNo as jest.Mock).mockResolvedValue({
        fisNo: 'YMM-2024-0001',
        durum: 'onaylandi',
      });

      await expect(
        service.approveJournalEntry('YMM-2024-0001')
      ).rejects.toThrow('Sadece taslak durumdaki fişler onaylanabilir');
    });

    it('bulunamayan fiş için hata fırlatmalı', async () => {
      (journalRepo.findByFisNo as jest.Mock).mockResolvedValue(null);

      await expect(
        service.approveJournalEntry('OLMAYAN')
      ).rejects.toThrow('Fiş bulunamadı: OLMAYAN');
    });
  });

  describe('cancelJournalEntry', () => {
    it('fişi iptal etmeli', async () => {
      (journalRepo.findByFisNo as jest.Mock).mockResolvedValue({
        fisNo: 'YMM-2024-0001',
        durum: 'taslak',
      });
      (journalRepo.update as jest.Mock).mockResolvedValue({
        fisNo: 'YMM-2024-0001',
        durum: 'iptal',
      });

      const result = await service.cancelJournalEntry('YMM-2024-0001');
      expect(result?.durum).toBe('iptal');
    });
  });

  describe('createFromIntegration', () => {
    it('entegrasyon kaynak bilgisi ile fiş oluşturmalı', async () => {
      (journalRepo.getNextFisNo as jest.Mock).mockResolvedValue('YMM-2024-0001');
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(mockKasaHesap)
        .mockResolvedValueOnce(mockSaticilarHesap);
      (journalRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        toplamBorc: 1000,
        toplamAlacak: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.createFromIntegration(
        {
          tarih: new Date(),
          aciklama: 'Paraşüt faturası',
          fisTipi: 'mahsup',
          hareketler: [
            { hareketId: '', hesapKodu: '100', tutar: 1000, yon: 1 },
            { hareketId: '', hesapKodu: '320', tutar: 1000, yon: -1 },
          ],
        },
        'parasut',
        'FTR-001',
        'user1'
      );

      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kaynakEntegrasyon: 'parasut',
          kaynakBelgeNo: 'FTR-001',
        })
      );
    });
  });
});
