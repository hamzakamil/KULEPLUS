import { repositoryFactory } from '../repositories/RepositoryFactory';
import { EntryLineData } from '../repositories/interfaces/IJournalRepository';
import { logger } from '../utils/logger';

/**
 * Bakiye ve Raporlama Servisi
 * Mizan, bilanço, gelir tablosu, hesap ekstresi hesaplamaları
 */
export class BalanceService {
  private journalRepo = repositoryFactory.getJournalRepository();
  private accountRepo = repositoryFactory.getAccountRepository();

  /**
   * Tek bir hesabın bakiyesini hesapla
   */
  async getHesapBakiye(
    hesapKodu: string,
    tarihBitis?: Date
  ): Promise<HesapBakiye> {
    const hesap = await this.accountRepo.findByKod(hesapKodu);
    if (!hesap) {
      throw new Error(`Hesap bulunamadı: ${hesapKodu}`);
    }

    const { borc, alacak } = await this.journalRepo.getHesapToplam(
      hesapKodu,
      tarihBitis
    );
    const bakiye = borc - alacak;
    const bakiyeYonu = bakiye >= 0 ? 'borc' : 'alacak';

    // Ters bakiye kontrolü
    const beklenenYon = hesap.normalBakiye === 1 ? 'borc' : 'alacak';
    const tersBakiye = bakiyeYonu !== beklenenYon && Math.abs(bakiye) > 0;

    return {
      hesapKodu: hesap.hesapKodu,
      hesapAdi: hesap.hesapAdi,
      borcToplam: borc,
      alacakToplam: alacak,
      bakiye: Math.abs(bakiye),
      bakiyeYonu,
      tersBakiye,
      tersBakiyeUyari: tersBakiye
        ? `UYARI: ${hesap.hesapKodu} ${hesap.hesapAdi} hesabı ters bakiye veriyor!`
        : null,
    };
  }

  /**
   * Mizan raporu oluştur
   * Tüm hesapların borç-alacak toplamları ve bakiyeleri
   */
  async getMizan(
    tarihBaslangic?: Date,
    tarihBitis?: Date,
    hesapSinifi?: number
  ): Promise<MizanRapor> {
    let accounts = hesapSinifi
      ? await this.accountRepo.findBySinif(hesapSinifi)
      : await this.accountRepo.findAll({ aktif: true });

    const satirlar: MizanSatir[] = [];
    let genelBorcToplam = 0;
    let genelAlacakToplam = 0;

    for (const hesap of accounts) {
      const { borc, alacak } = await this.journalRepo.getHesapToplam(
        hesap.hesapKodu,
        tarihBitis
      );

      // Sıfır bakiyeli hesapları atla (opsiyonel)
      if (borc === 0 && alacak === 0) continue;

      const bakiye = borc - alacak;
      const borcBakiye = bakiye > 0 ? bakiye : 0;
      const alacakBakiye = bakiye < 0 ? Math.abs(bakiye) : 0;

      satirlar.push({
        hesapKodu: hesap.hesapKodu,
        hesapAdi: hesap.hesapAdi,
        borcToplam: borc,
        alacakToplam: alacak,
        borcBakiye,
        alacakBakiye,
      });

      genelBorcToplam += borc;
      genelAlacakToplam += alacak;
    }

    return {
      tarihBaslangic: tarihBaslangic || null,
      tarihBitis: tarihBitis || new Date(),
      satirlar,
      genelBorcToplam,
      genelAlacakToplam,
      genelBorcBakiye:
        genelBorcToplam > genelAlacakToplam
          ? genelBorcToplam - genelAlacakToplam
          : 0,
      genelAlacakBakiye:
        genelAlacakToplam > genelBorcToplam
          ? genelAlacakToplam - genelBorcToplam
          : 0,
      denklikDurumu: Math.abs(genelBorcToplam - genelAlacakToplam) < 0.01,
    };
  }

  /**
   * Bilanço raporu oluştur (TDHP formatı)
   * Aktif (1,2) - Pasif (3,4,5) tarafları
   * Düzenleyici hesaplar netleştirilir
   */
  async getBilanco(tarihBitis?: Date): Promise<BilancoRapor> {
    const aktifHesaplar = [
      ...(await this.accountRepo.findBySinif(1)),
      ...(await this.accountRepo.findBySinif(2)),
    ];
    const pasifHesaplar = [
      ...(await this.accountRepo.findBySinif(3)),
      ...(await this.accountRepo.findBySinif(4)),
      ...(await this.accountRepo.findBySinif(5)),
    ];

    const aktifSatirlari: BilancoSatir[] = [];
    const pasifSatirlari: BilancoSatir[] = [];
    let aktifToplam = 0;
    let pasifToplam = 0;

    // Aktif taraf
    for (const hesap of aktifHesaplar) {
      const { borc, alacak } = await this.journalRepo.getHesapToplam(
        hesap.hesapKodu,
        tarihBitis
      );
      const bakiye = borc - alacak;
      if (Math.abs(bakiye) < 0.01) continue;

      const netTutar = hesap.duzenleyiciHesapMi ? -Math.abs(bakiye) : bakiye;

      aktifSatirlari.push({
        hesapKodu: hesap.hesapKodu,
        hesapAdi: hesap.hesapAdi,
        tutar: Math.abs(bakiye),
        duzenleyici: hesap.duzenleyiciHesapMi || false,
        netTutar,
      });
      aktifToplam += netTutar;
    }

    // Pasif taraf
    for (const hesap of pasifHesaplar) {
      const { borc, alacak } = await this.journalRepo.getHesapToplam(
        hesap.hesapKodu,
        tarihBitis
      );
      const bakiye = alacak - borc; // Pasif hesaplarda alacak bakiyesi normal
      if (Math.abs(bakiye) < 0.01) continue;

      const netTutar = hesap.duzenleyiciHesapMi ? -Math.abs(bakiye) : bakiye;

      pasifSatirlari.push({
        hesapKodu: hesap.hesapKodu,
        hesapAdi: hesap.hesapAdi,
        tutar: Math.abs(bakiye),
        duzenleyici: hesap.duzenleyiciHesapMi || false,
        netTutar,
      });
      pasifToplam += netTutar;
    }

    return {
      tarih: tarihBitis || new Date(),
      aktif: {
        satirlar: aktifSatirlari,
        toplam: aktifToplam,
      },
      pasif: {
        satirlar: pasifSatirlari,
        toplam: pasifToplam,
      },
      denklikDurumu: Math.abs(aktifToplam - pasifToplam) < 0.01,
    };
  }

  /**
   * Gelir tablosu raporu (6. ve 7. sınıf hesaplar)
   */
  async getGelirTablosu(
    tarihBaslangic?: Date,
    tarihBitis?: Date
  ): Promise<GelirTablosuRapor> {
    const gelirGiderHesaplari = [
      ...(await this.accountRepo.findBySinif(6)),
      ...(await this.accountRepo.findBySinif(7)),
    ];

    const satirlar: GelirTablosuSatir[] = [];
    let toplamGelir = 0;
    let toplamGider = 0;

    for (const hesap of gelirGiderHesaplari) {
      const { borc, alacak } = await this.journalRepo.getHesapToplam(
        hesap.hesapKodu,
        tarihBitis
      );
      const bakiye = borc - alacak;
      if (Math.abs(bakiye) < 0.01) continue;

      const isGelir = alacak > borc; // Gelir hesapları alacak bakiyesi verir

      satirlar.push({
        hesapKodu: hesap.hesapKodu,
        hesapAdi: hesap.hesapAdi,
        borcToplam: borc,
        alacakToplam: alacak,
        tutar: Math.abs(bakiye),
        tur: isGelir ? 'gelir' : 'gider',
      });

      if (isGelir) {
        toplamGelir += Math.abs(bakiye);
      } else {
        toplamGider += Math.abs(bakiye);
      }
    }

    return {
      tarihBaslangic: tarihBaslangic || null,
      tarihBitis: tarihBitis || new Date(),
      satirlar,
      toplamGelir,
      toplamGider,
      donemKarZarar: toplamGelir - toplamGider,
      karMi: toplamGelir > toplamGider,
    };
  }

  /**
   * Hesap ekstresi
   */
  async getHesapEkstresi(
    hesapKodu: string,
    tarihBaslangic?: Date,
    tarihBitis?: Date
  ): Promise<HesapEkstresi> {
    const hesap = await this.accountRepo.findByKod(hesapKodu);
    if (!hesap) {
      throw new Error(`Hesap bulunamadı: ${hesapKodu}`);
    }

    // Başlangıç bakiyesi (tarihBaslangic öncesi)
    let baslangicBakiye = 0;
    if (tarihBaslangic) {
      const oncekiTarih = new Date(tarihBaslangic);
      oncekiTarih.setDate(oncekiTarih.getDate() - 1);
      const { borc, alacak } = await this.journalRepo.getHesapToplam(
        hesapKodu,
        oncekiTarih
      );
      baslangicBakiye = borc - alacak;
    }

    // Hareketler
    const hareketler = await this.journalRepo.getHesapHareketleri(
      hesapKodu,
      tarihBaslangic,
      tarihBitis
    );

    // Kalanlar hesapla
    let kalanBakiye = baslangicBakiye;
    const satirlar = hareketler.map((h) => {
      const tutar = h.yon === 1 ? h.tutar : -h.tutar;
      kalanBakiye += tutar;
      return {
        ...h,
        kalan: kalanBakiye,
      };
    });

    return {
      hesapKodu: hesap.hesapKodu,
      hesapAdi: hesap.hesapAdi,
      tarihBaslangic: tarihBaslangic || null,
      tarihBitis: tarihBitis || new Date(),
      baslangicBakiye,
      hareketler: satirlar,
      bitisBakiye: kalanBakiye,
    };
  }
}

// Tip tanımları
export interface HesapBakiye {
  hesapKodu: string;
  hesapAdi: string;
  borcToplam: number;
  alacakToplam: number;
  bakiye: number;
  bakiyeYonu: 'borc' | 'alacak';
  tersBakiye: boolean;
  tersBakiyeUyari: string | null;
}

export interface MizanSatir {
  hesapKodu: string;
  hesapAdi: string;
  borcToplam: number;
  alacakToplam: number;
  borcBakiye: number;
  alacakBakiye: number;
}

export interface MizanRapor {
  tarihBaslangic: Date | null;
  tarihBitis: Date;
  satirlar: MizanSatir[];
  genelBorcToplam: number;
  genelAlacakToplam: number;
  genelBorcBakiye: number;
  genelAlacakBakiye: number;
  denklikDurumu: boolean;
}

export interface BilancoSatir {
  hesapKodu: string;
  hesapAdi: string;
  tutar: number;
  duzenleyici: boolean;
  netTutar: number;
}

export interface BilancoRapor {
  tarih: Date;
  aktif: { satirlar: BilancoSatir[]; toplam: number };
  pasif: { satirlar: BilancoSatir[]; toplam: number };
  denklikDurumu: boolean;
}

export interface GelirTablosuSatir {
  hesapKodu: string;
  hesapAdi: string;
  borcToplam: number;
  alacakToplam: number;
  tutar: number;
  tur: 'gelir' | 'gider';
}

export interface GelirTablosuRapor {
  tarihBaslangic: Date | null;
  tarihBitis: Date;
  satirlar: GelirTablosuSatir[];
  toplamGelir: number;
  toplamGider: number;
  donemKarZarar: number;
  karMi: boolean;
}

export interface HesapEkstresi {
  hesapKodu: string;
  hesapAdi: string;
  tarihBaslangic: Date | null;
  tarihBitis: Date;
  baslangicBakiye: number;
  hareketler: (EntryLineData & { kalan: number })[];
  bitisBakiye: number;
}
