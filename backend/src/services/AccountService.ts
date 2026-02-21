import { v4 as uuidv4 } from 'uuid';
import { repositoryFactory } from '../repositories/RepositoryFactory';
import { AccountData, AccountResult } from '../repositories/interfaces/IAccountRepository';
import { logger } from '../utils/logger';

/**
 * Hesap Servisi
 * TDHP hesap planı yönetimi, hesap CRUD işlemleri ve hiyerarşi yönetimi
 */
export class AccountService {
  private accountRepo = repositoryFactory.getAccountRepository();
  private auditLogRepo = repositoryFactory.getAuditLogRepository();

  /**
   * Yeni hesap oluştur
   */
  async createAccount(data: AccountData, kullaniciId?: string): Promise<AccountResult> {
    // Hesap kodu benzersizlik kontrolü
    const existing = await this.accountRepo.findByKod(data.hesapKodu);
    if (existing) {
      throw new Error(`Bu hesap kodu zaten mevcut: ${data.hesapKodu}`);
    }

    // Hesap sınıfını hesap kodundan otomatik belirle
    data.hesapSinifi = parseInt(data.hesapKodu.charAt(0), 10);

    // Normal bakiye yönünü hesap sınıfına göre belirle (kullanıcı belirtmemişse)
    if (!data.normalBakiye) {
      data.normalBakiye = this.getNormalBakiyeByClass(data.hesapSinifi);
    }

    // Üst hesap kodunu belirle
    if (!data.ustHesapKodu && data.hesapKodu.length > 3) {
      data.ustHesapKodu = data.hesapKodu.substring(0, data.hesapKodu.length - 1);
    }

    // Ana hesap mı kontrolü (3 haneli kodlar ana hesaptır)
    if (data.hesapKodu.length === 3) {
      data.anaHesapMi = true;
    }

    // Düzenleyici hesap kontrolü
    if (data.duzenleyiciHesapMi && data.ilgiliHesapKodu) {
      const ilgiliHesap = await this.accountRepo.findByKod(data.ilgiliHesapKodu);
      if (!ilgiliHesap) {
        throw new Error(
          `Düzenleyici hesabın ilgili hesabı bulunamadı: ${data.ilgiliHesapKodu}`
        );
      }
    }

    const account = await this.accountRepo.create(data);

    // Audit log
    await this.auditLogRepo.create({
      logId: uuidv4(),
      kullaniciId: kullaniciId || null,
      islemTipi: 'CREATE',
      ilgiliTablo: 'accounts',
      ilgiliKayitId: account.hesapKodu,
      yeniDeger: account as unknown as Record<string, unknown>,
      aciklama: `Hesap oluşturuldu: ${account.hesapKodu} - ${account.hesapAdi}`,
    });

    logger.info(`Hesap oluşturuldu: ${account.hesapKodu} - ${account.hesapAdi}`);
    return account;
  }

  /**
   * Hesap koduna göre getir
   */
  async getAccountByKod(hesapKodu: string): Promise<AccountResult | null> {
    return this.accountRepo.findByKod(hesapKodu);
  }

  /**
   * Tüm hesapları getir (filtreleme destekli)
   */
  async getAllAccounts(filter?: Partial<AccountData>): Promise<AccountResult[]> {
    return this.accountRepo.findAll(filter);
  }

  /**
   * Hesap sınıfına göre getir
   */
  async getAccountsBySinif(sinif: number): Promise<AccountResult[]> {
    return this.accountRepo.findBySinif(sinif);
  }

  /**
   * Hesap ağacını getir (hiyerarşik)
   */
  async getAccountTree(): Promise<AccountTreeNode[]> {
    const allAccounts = await this.accountRepo.findAll({ aktif: true });
    return this.buildTree(allAccounts);
  }

  /**
   * Hesap güncelle
   */
  async updateAccount(
    hesapKodu: string,
    data: Partial<AccountData>,
    kullaniciId?: string
  ): Promise<AccountResult | null> {
    const existing = await this.accountRepo.findByKod(hesapKodu);
    if (!existing) {
      throw new Error(`Hesap bulunamadı: ${hesapKodu}`);
    }

    const updated = await this.accountRepo.update(hesapKodu, data);

    if (updated) {
      await this.auditLogRepo.create({
        logId: uuidv4(),
        kullaniciId: kullaniciId || null,
        islemTipi: 'UPDATE',
        ilgiliTablo: 'accounts',
        ilgiliKayitId: hesapKodu,
        eskiDeger: existing as unknown as Record<string, unknown>,
        yeniDeger: updated as unknown as Record<string, unknown>,
        aciklama: `Hesap güncellendi: ${hesapKodu}`,
      });
    }

    return updated;
  }

  /**
   * Hesap sil (soft delete - pasifleştir)
   */
  async deleteAccount(hesapKodu: string, kullaniciId?: string): Promise<boolean> {
    const existing = await this.accountRepo.findByKod(hesapKodu);
    if (!existing) {
      throw new Error(`Hesap bulunamadı: ${hesapKodu}`);
    }

    // Alt hesapları kontrol et
    const subAccounts = await this.accountRepo.findByUstHesap(hesapKodu);
    if (subAccounts.length > 0) {
      throw new Error(
        `Bu hesabın ${subAccounts.length} adet alt hesabı var. Önce alt hesapları siliniz.`
      );
    }

    // Soft delete: aktif = false
    await this.accountRepo.update(hesapKodu, { aktif: false });

    await this.auditLogRepo.create({
      logId: uuidv4(),
      kullaniciId: kullaniciId || null,
      islemTipi: 'DELETE',
      ilgiliTablo: 'accounts',
      ilgiliKayitId: hesapKodu,
      eskiDeger: existing as unknown as Record<string, unknown>,
      aciklama: `Hesap silindi (pasifleştirildi): ${hesapKodu}`,
    });

    return true;
  }

  /**
   * Hesap arama
   */
  async searchAccounts(query: string): Promise<AccountResult[]> {
    return this.accountRepo.search(query);
  }

  /**
   * Ön muhasebe bağlantı koduna göre hesap bul
   */
  async getAccountByBaglantiKodu(baglantiKodu: string): Promise<AccountResult | null> {
    return this.accountRepo.findByBaglantiKodu(baglantiKodu);
  }

  /**
   * Hesap sınıfına göre varsayılan normal bakiye yönünü belirle
   * TDHP kurallarına göre:
   * 1,2,6,7 → Borç (1)
   * 3,4,5 → Alacak (-1)
   * 8,9 → Borç (varsayılan)
   */
  private getNormalBakiyeByClass(sinif: number): number {
    switch (sinif) {
      case 1:
      case 2:
      case 6:
      case 7:
        return 1; // Borç
      case 3:
      case 4:
      case 5:
        return -1; // Alacak
      default:
        return 1;
    }
  }

  /**
   * Hesap listesinden ağaç yapısı oluştur
   */
  private buildTree(accounts: AccountResult[]): AccountTreeNode[] {
    const map = new Map<string, AccountTreeNode>();
    const roots: AccountTreeNode[] = [];

    // Tüm hesapları map'e ekle
    for (const account of accounts) {
      map.set(account.hesapKodu, {
        ...account,
        children: [],
      });
    }

    // Ağaç yapısını kur
    for (const account of accounts) {
      const node = map.get(account.hesapKodu)!;
      if (account.ustHesapKodu && map.has(account.ustHesapKodu)) {
        map.get(account.ustHesapKodu)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}

export interface AccountTreeNode extends AccountResult {
  children: AccountTreeNode[];
}
