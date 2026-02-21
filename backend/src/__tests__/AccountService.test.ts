import { AccountService } from '../services/AccountService';
import { repositoryFactory } from '../repositories/RepositoryFactory';

// Mock repository factory
jest.mock('../repositories/RepositoryFactory', () => {
  const mockAccountRepo = {
    create: jest.fn(),
    findByKod: jest.fn(),
    findAll: jest.fn(),
    findBySinif: jest.fn(),
    findByUstHesap: jest.fn(),
    findByBaglantiKodu: jest.fn(),
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
      getAccountRepository: () => mockAccountRepo,
      getAuditLogRepository: () => mockAuditLogRepo,
      getJournalRepository: jest.fn(),
      getExchangeRateRepository: jest.fn(),
    },
  };
});

const accountRepo = repositoryFactory.getAccountRepository();
const auditLogRepo = repositoryFactory.getAuditLogRepository();

describe('AccountService', () => {
  let service: AccountService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AccountService();
  });

  describe('createAccount', () => {
    it('yeni hesap oluşturmalı ve hesap sınıfını otomatik belirlemeli', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);
      (accountRepo.create as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
        hesapSinifi: 1,
        normalBakiye: 1,
        anaHesapMi: true,
        aktif: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createAccount({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
        normalBakiye: 1,
      });

      expect(result.hesapKodu).toBe('100');
      expect(result.hesapSinifi).toBe(1);
      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hesapKodu: '100',
          hesapAdi: 'Kasa',
          hesapSinifi: 1,
          normalBakiye: 1,
          anaHesapMi: true,
        })
      );
      expect(auditLogRepo.create).toHaveBeenCalled();
    });

    it('mevcut hesap kodu varsa hata fırlatmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({
        hesapKodu: '100',
        hesapAdi: 'Kasa',
      });

      await expect(
        service.createAccount({ hesapKodu: '100', hesapAdi: 'Kasa Yeni', normalBakiye: 1 })
      ).rejects.toThrow('Bu hesap kodu zaten mevcut: 100');
    });

    it('1,2,6,7 sınıfları için normalBakiye borç (1) olmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);
      (accountRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Sınıf 1 - Dönen Varlıklar
      await service.createAccount({ hesapKodu: '100', hesapAdi: 'Kasa', normalBakiye: 0 });
      expect(accountRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ normalBakiye: 1 })
      );

      jest.resetAllMocks();
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);
      (accountRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Sınıf 6 - Gelir/Gider
      await service.createAccount({ hesapKodu: '600', hesapAdi: 'Satışlar', normalBakiye: 0 });
      expect(accountRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ normalBakiye: 1 })
      );
    });

    it('3,4,5 sınıfları için normalBakiye alacak (-1) olmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);
      (accountRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Sınıf 3 - Kısa Vadeli Yabancı Kaynaklar
      await service.createAccount({ hesapKodu: '320', hesapAdi: 'Satıcılar', normalBakiye: 0 });
      expect(accountRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ normalBakiye: -1 })
      );
    });

    it('3+ haneli hesap kodları için üst hesap kodunu otomatik belirlemeli', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);
      (accountRepo.create as jest.Mock).mockImplementation((data) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.createAccount({ hesapKodu: '1001', hesapAdi: 'Kasa Alt', normalBakiye: 1 });
      expect(accountRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ ustHesapKodu: '100' })
      );
    });

    it('düzenleyici hesap için ilgili hesap kontrolü yapmalı', async () => {
      (accountRepo.findByKod as jest.Mock)
        .mockResolvedValueOnce(null)  // hesapKodu: '109' yok
        .mockResolvedValueOnce(null); // ilgiliHesapKodu: '100' bulunamadı

      await expect(
        service.createAccount({
          hesapKodu: '109',
          hesapAdi: 'Şüpheli Alacak Karşılığı',
          normalBakiye: -1,
          duzenleyiciHesapMi: true,
          ilgiliHesapKodu: '100',
        })
      ).rejects.toThrow('Düzenleyici hesabın ilgili hesabı bulunamadı: 100');
    });
  });

  describe('getAccountByKod', () => {
    it('hesap koduna göre hesap getirmeli', async () => {
      const mockAccount = { hesapKodu: '100', hesapAdi: 'Kasa' };
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(mockAccount);

      const result = await service.getAccountByKod('100');
      expect(result).toEqual(mockAccount);
    });

    it('bulunamayan hesap için null dönmeli', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);

      const result = await service.getAccountByKod('999');
      expect(result).toBeNull();
    });
  });

  describe('updateAccount', () => {
    it('mevcut hesabı güncellemeli', async () => {
      const existing = { hesapKodu: '100', hesapAdi: 'Kasa', normalBakiye: 1 };
      const updated = { ...existing, hesapAdi: 'Kasa Hesabı' };
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(existing);
      (accountRepo.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.updateAccount('100', { hesapAdi: 'Kasa Hesabı' });
      expect(result?.hesapAdi).toBe('Kasa Hesabı');
      expect(auditLogRepo.create).toHaveBeenCalled();
    });

    it('mevcut olmayan hesap için hata fırlatmalı', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateAccount('999', { hesapAdi: 'Test' })
      ).rejects.toThrow('Hesap bulunamadı: 999');
    });
  });

  describe('deleteAccount', () => {
    it('alt hesabı olmayan hesabı silmeli (soft delete)', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({ hesapKodu: '100', hesapAdi: 'Kasa' });
      (accountRepo.findByUstHesap as jest.Mock).mockResolvedValue([]);
      (accountRepo.update as jest.Mock).mockResolvedValue({ hesapKodu: '100', aktif: false });

      const result = await service.deleteAccount('100');
      expect(result).toBe(true);
      expect(accountRepo.update).toHaveBeenCalledWith('100', { aktif: false });
    });

    it('alt hesabı olan hesap silinememeli', async () => {
      (accountRepo.findByKod as jest.Mock).mockResolvedValue({ hesapKodu: '100', hesapAdi: 'Kasa' });
      (accountRepo.findByUstHesap as jest.Mock).mockResolvedValue([
        { hesapKodu: '1001', hesapAdi: 'Kasa TL' },
      ]);

      await expect(service.deleteAccount('100')).rejects.toThrow(
        'Bu hesabın 1 adet alt hesabı var'
      );
    });
  });

  describe('getAccountTree', () => {
    it('hiyerarşik ağaç yapısı oluşturmalı', async () => {
      (accountRepo.findAll as jest.Mock).mockResolvedValue([
        { hesapKodu: '100', hesapAdi: 'Kasa', ustHesapKodu: null, aktif: true },
        { hesapKodu: '1001', hesapAdi: 'Kasa TL', ustHesapKodu: '100', aktif: true },
        { hesapKodu: '1002', hesapAdi: 'Kasa USD', ustHesapKodu: '100', aktif: true },
        { hesapKodu: '120', hesapAdi: 'Alıcılar', ustHesapKodu: null, aktif: true },
      ]);

      const tree = await service.getAccountTree();
      expect(tree).toHaveLength(2); // 100 ve 120 root
      expect(tree[0].children).toHaveLength(2); // 1001, 1002
      expect(tree[1].children).toHaveLength(0); // 120 alt yok
    });
  });

  describe('searchAccounts', () => {
    it('arama sonuçlarını dönmeli', async () => {
      const results = [
        { hesapKodu: '100', hesapAdi: 'Kasa' },
        { hesapKodu: '102', hesapAdi: 'Bankalar' },
      ];
      (accountRepo.search as jest.Mock).mockResolvedValue(results);

      const found = await service.searchAccounts('kas');
      expect(found).toHaveLength(2);
      expect(accountRepo.search).toHaveBeenCalledWith('kas');
    });
  });
});
