import { v4 as uuidv4 } from 'uuid';
import { repositoryFactory } from '../repositories/RepositoryFactory';
import {
  JournalEntryData,
  JournalEntryResult,
  JournalFilter,
  EntryLineData,
} from '../repositories/interfaces/IJournalRepository';
import { logger } from '../utils/logger';

/**
 * Yevmiye Fişi Servisi
 * Çift taraflı kayıt esaslı fiş yönetimi, döviz desteği ve muhasebe kuralları
 */
export class JournalService {
  private journalRepo = repositoryFactory.getJournalRepository();
  private accountRepo = repositoryFactory.getAccountRepository();
  private auditLogRepo = repositoryFactory.getAuditLogRepository();

  /**
   * Yeni yevmiye fişi oluştur
   * Borç = Alacak denklik kontrolü yapar
   */
  async createJournalEntry(
    data: Omit<JournalEntryData, 'fisNo'> & { fisNo?: string },
    kullaniciId?: string
  ): Promise<JournalEntryResult> {
    // Fiş numarası otomatik ata (verilmemişse)
    if (!data.fisNo) {
      data.fisNo = await this.journalRepo.getNextFisNo();
    }

    // Minimum 2 hareket satırı kontrolü
    if (!data.hareketler || data.hareketler.length < 2) {
      throw new Error('Bir yevmiye fişinde en az 2 hareket satırı olmalıdır');
    }

    // Her hareket satırına UUID ata
    for (const hareket of data.hareketler) {
      if (!hareket.hareketId) {
        hareket.hareketId = uuidv4();
      }
    }

    // Hesap kodlarının geçerliliğini kontrol et
    for (const hareket of data.hareketler) {
      const hesap = await this.accountRepo.findByKod(hareket.hesapKodu);
      if (!hesap) {
        throw new Error(`Geçersiz hesap kodu: ${hareket.hesapKodu}`);
      }
      if (!hesap.aktif) {
        throw new Error(`Pasif hesaba kayıt yapılamaz: ${hareket.hesapKodu}`);
      }
      // Hesap adını otomatik doldur
      if (!hareket.hesapAdi) {
        hareket.hesapAdi = hesap.hesapAdi;
      }

      // Düzenleyici hesap kuralı kontrolü
      if (hesap.duzenleyiciHesapMi) {
        this.validateDuzenleyiciHesapKaydi(hesap, hareket);
      }

      // Döviz tutarı hesaplama
      if (hareket.dovizTutar && hareket.dovizKur) {
        const hesaplananTutar = Math.round(hareket.dovizTutar * hareket.dovizKur * 100) / 100;
        // Kullanıcı tutarı girmemişse otomatik hesapla
        if (!hareket.tutar || hareket.tutar === 0) {
          hareket.tutar = hesaplananTutar;
        }
      }

      // Tutar pozitif olmalı
      if (hareket.tutar <= 0) {
        throw new Error(`Tutar pozitif olmalıdır. Hesap: ${hareket.hesapKodu}`);
      }
    }

    // *** ÇİFT TARAFLI KAYIT DENKLİK KONTROLÜ ***
    // ∑(tutar * yön) = 0 olmalı
    const borcToplam = data.hareketler
      .filter((h) => h.yon === 1)
      .reduce((sum, h) => sum + h.tutar, 0);
    const alacakToplam = data.hareketler
      .filter((h) => h.yon === -1)
      .reduce((sum, h) => sum + h.tutar, 0);

    // Kuruş hassasiyetinde kontrol (floating point hataları için)
    if (Math.abs(borcToplam - alacakToplam) > 0.01) {
      throw new Error(
        `Borç-Alacak dengesi tutmuyor! Borç: ${borcToplam.toFixed(2)} TL, Alacak: ${alacakToplam.toFixed(2)} TL, Fark: ${Math.abs(borcToplam - alacakToplam).toFixed(2)} TL`
      );
    }

    const entry = await this.journalRepo.create(data as JournalEntryData);

    // Audit log
    await this.auditLogRepo.create({
      logId: uuidv4(),
      kullaniciId: kullaniciId || null,
      islemTipi: 'CREATE',
      ilgiliTablo: 'journal_entries',
      ilgiliKayitId: entry.fisNo,
      yeniDeger: entry as unknown as Record<string, unknown>,
      aciklama: `Yevmiye fişi oluşturuldu: ${entry.fisNo} - ${entry.aciklama}`,
    });

    logger.info(`Yevmiye fişi oluşturuldu: ${entry.fisNo}`);
    return entry;
  }

  /**
   * Fiş numarasına göre getir
   */
  async getJournalEntry(fisNo: string): Promise<JournalEntryResult | null> {
    return this.journalRepo.findByFisNo(fisNo);
  }

  /**
   * Tüm fişleri getir (filtreleme ve sayfalama destekli)
   */
  async getAllJournalEntries(filter?: JournalFilter): Promise<JournalEntryResult[]> {
    return this.journalRepo.findAll(filter);
  }

  /**
   * Fişi onayla
   */
  async approveJournalEntry(
    fisNo: string,
    kullaniciId?: string
  ): Promise<JournalEntryResult | null> {
    const entry = await this.journalRepo.findByFisNo(fisNo);
    if (!entry) {
      throw new Error(`Fiş bulunamadı: ${fisNo}`);
    }
    if (entry.durum !== 'taslak') {
      throw new Error(`Sadece taslak durumdaki fişler onaylanabilir. Mevcut durum: ${entry.durum}`);
    }

    const updated = await this.journalRepo.update(fisNo, { durum: 'onaylandi' });

    await this.auditLogRepo.create({
      logId: uuidv4(),
      kullaniciId: kullaniciId || null,
      islemTipi: 'UPDATE',
      ilgiliTablo: 'journal_entries',
      ilgiliKayitId: fisNo,
      eskiDeger: { durum: 'taslak' },
      yeniDeger: { durum: 'onaylandi' },
      aciklama: `Yevmiye fişi onaylandı: ${fisNo}`,
    });

    return updated;
  }

  /**
   * Fişi iptal et
   */
  async cancelJournalEntry(
    fisNo: string,
    kullaniciId?: string
  ): Promise<JournalEntryResult | null> {
    const entry = await this.journalRepo.findByFisNo(fisNo);
    if (!entry) {
      throw new Error(`Fiş bulunamadı: ${fisNo}`);
    }

    const updated = await this.journalRepo.update(fisNo, { durum: 'iptal' });

    await this.auditLogRepo.create({
      logId: uuidv4(),
      kullaniciId: kullaniciId || null,
      islemTipi: 'UPDATE',
      ilgiliTablo: 'journal_entries',
      ilgiliKayitId: fisNo,
      eskiDeger: { durum: entry.durum },
      yeniDeger: { durum: 'iptal' },
      aciklama: `Yevmiye fişi iptal edildi: ${fisNo}`,
    });

    return updated;
  }

  /**
   * Belirli bir hesabın hareket sayısını getir
   */
  async getHesapHareketleri(
    hesapKodu: string,
    tarihBaslangic?: Date,
    tarihBitis?: Date
  ): Promise<EntryLineData[]> {
    return this.journalRepo.getHesapHareketleri(hesapKodu, tarihBaslangic, tarihBitis);
  }

  /**
   * Fatura entegrasyonundan gelen fiş oluşturma
   * Kaynak entegrasyon bilgisi ile birlikte kaydeder
   */
  async createFromIntegration(
    data: Omit<JournalEntryData, 'fisNo'>,
    entegrasyonAdi: string,
    belgeNo: string,
    kullaniciId?: string
  ): Promise<JournalEntryResult> {
    return this.createJournalEntry(
      {
        ...data,
        kaynakEntegrasyon: entegrasyonAdi,
        kaynakBelgeNo: belgeNo,
      },
      kullaniciId
    );
  }

  /**
   * Düzenleyici hesap kayıt kuralını kontrol et
   * Aktif düzenleyici → sadece alacak (yon=-1)
   * Pasif düzenleyici → sadece borç (yon=1)
   */
  private validateDuzenleyiciHesapKaydi(
    hesap: { duzenleyiciHesapTuru?: string | null; normalBakiye: number; hesapKodu: string },
    hareket: EntryLineData
  ): void {
    if (hesap.duzenleyiciHesapTuru === 'aktif_duzenleyici' && hareket.yon !== -1) {
      throw new Error(
        `Aktif düzenleyici hesaba (${hesap.hesapKodu}) sadece alacak kaydı yapılabilir`
      );
    }
    if (hesap.duzenleyiciHesapTuru === 'pasif_duzenleyici' && hareket.yon !== 1) {
      throw new Error(
        `Pasif düzenleyici hesaba (${hesap.hesapKodu}) sadece borç kaydı yapılabilir`
      );
    }
  }
}
