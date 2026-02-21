import axios, { AxiosInstance } from 'axios';
import {
  IInvoiceAdapter,
  AdapterConfig,
  StandartFatura,
  FaturaTipi,
  FisDonusumSonucu,
  SenkronizasyonSonucu,
} from './InvoiceAdapter';
import { JournalService } from '../../services/JournalService';
import { AccountService } from '../../services/AccountService';
import { logger } from '../../utils/logger';

/**
 * Temel Adapter Sınıfı
 * Tüm fatura programı adapterleri bu sınıfı extend eder.
 * Ortak işlevler burada tanımlanır.
 */
export abstract class BaseAdapter implements IInvoiceAdapter {
  abstract readonly adapterAdi: string;
  abstract readonly gorunenAd: string;

  protected config: AdapterConfig | null = null;
  protected httpClient: AxiosInstance | null = null;
  protected journalService = new JournalService();
  protected accountService = new AccountService();

  // Varsayılan hesap eşleştirmeleri (alt sınıflar override edebilir)
  protected defaultHesaplar = {
    satisFaturasiCari: '120',     // Alıcılar
    alisFaturasiCari: '320',      // Satıcılar
    yurtIciSatislar: '600',       // Yurtiçi Satışlar
    satisIadeleri: '610',         // Satıştan İadeler
    satinAlma: '153',             // Ticari Mallar (veya 150 İlk Madde Malzeme)
    alisIadeleri: '153',          // Alış İadeleri
    hesaplananKdv: '391',         // Hesaplanan KDV
    indirilebilirKdv: '191',     // İndirilecek KDV
    tevkifatHesabi: '360',        // Ödenecek Vergi ve Fonlar
  };

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Token varsa header'a ekle
    if (config.accessToken) {
      this.httpClient.defaults.headers.common['Authorization'] =
        `Bearer ${config.accessToken}`;
    } else if (config.apiKey) {
      this.httpClient.defaults.headers.common['X-API-Key'] = config.apiKey;
    }
  }

  abstract testConnection(): Promise<boolean>;
  abstract getFaturalar(
    baslangic: Date,
    bitis: Date,
    tip?: FaturaTipi
  ): Promise<StandartFatura[]>;
  abstract getFatura(faturaNo: string): Promise<StandartFatura | null>;

  /**
   * Faturayı yevmiye fişi formatına dönüştür
   * TDHP kurallarına göre muhasebeleştirme
   */
  faturaToFis(fatura: StandartFatura): FisDonusumSonucu {
    const hareketler: FisDonusumSonucu['hareketler'] = [];

    switch (fatura.faturaTipi) {
      case 'satis':
        return this.satisFaturasiToFis(fatura);
      case 'alis':
        return this.alisFaturasiToFis(fatura);
      case 'iade_satis':
        return this.satisIadeFaturasiToFis(fatura);
      case 'iade_alis':
        return this.alisIadeFaturasiToFis(fatura);
      default:
        throw new Error(`Desteklenmeyen fatura tipi: ${fatura.faturaTipi}`);
    }
  }

  /**
   * SATIŞ FATURASI MUHASEBELEŞTİRME
   * Borç: 120 Alıcılar (Genel Toplam)
   * Alacak: 600 Yurtiçi Satışlar (Ara Toplam)
   * Alacak: 391 Hesaplanan KDV (KDV Toplam)
   */
  protected satisFaturasiToFis(fatura: StandartFatura): FisDonusumSonucu {
    const hareketler: FisDonusumSonucu['hareketler'] = [];

    // Borç: Alıcılar
    hareketler.push({
      hesapKodu: this.defaultHesaplar.satisFaturasiCari,
      tutar: fatura.genelToplam,
      yon: 1,
      dovizKodu: fatura.dovizKodu,
      dovizTutar: fatura.dovizKodu !== 'TRY' ? fatura.genelToplam / (fatura.dovizKur || 1) : undefined,
      dovizKur: fatura.dovizKur,
      aciklama: `${fatura.cariAd} - Fatura No: ${fatura.faturaNo}`,
    });

    // Alacak: Satış geliri
    hareketler.push({
      hesapKodu: this.defaultHesaplar.yurtIciSatislar,
      tutar: fatura.araToplam,
      yon: -1,
      aciklama: `Satış - ${fatura.faturaNo}`,
    });

    // Alacak: KDV
    if (fatura.kdvToplam > 0) {
      // KDV oranlarına göre grupla
      const kdvGruplari = this.gruplaKDV(fatura);
      for (const [oran, tutar] of Object.entries(kdvGruplari)) {
        hareketler.push({
          hesapKodu: `${this.defaultHesaplar.hesaplananKdv}`,
          tutar: tutar as number,
          yon: -1,
          aciklama: `Hesaplanan KDV %${oran} - ${fatura.faturaNo}`,
        });
      }
    }

    // Tevkifat varsa (alıcı KDV'nin bir kısmını doğrudan vergi dairesine öder)
    if (fatura.tevkifatToplam && fatura.tevkifatToplam > 0) {
      hareketler.push({
        hesapKodu: this.defaultHesaplar.tevkifatHesabi,
        tutar: fatura.tevkifatToplam,
        yon: 1, // Borç: Tevkifat alacağı (vergi dairesinden mahsup)
        aciklama: `KDV Tevkifatı - ${fatura.faturaNo}`,
      });
      // Alıcılar tutarından tevkifatı düş (müşteri bu kadar az öder)
      hareketler[0].tutar -= fatura.tevkifatToplam;
    }

    return {
      aciklama: `Satış Faturası: ${fatura.faturaNo} - ${fatura.cariAd}`,
      fisTipi: 'mahsup',
      hareketler,
    };
  }

  /**
   * ALIŞ FATURASI MUHASEBELEŞTİRME
   * Borç: 153 Ticari Mallar (Ara Toplam)
   * Borç: 191 İndirilecek KDV (KDV Toplam)
   * Alacak: 320 Satıcılar (Genel Toplam)
   */
  protected alisFaturasiToFis(fatura: StandartFatura): FisDonusumSonucu {
    const hareketler: FisDonusumSonucu['hareketler'] = [];

    // Borç: Mal alışı
    hareketler.push({
      hesapKodu: this.defaultHesaplar.satinAlma,
      tutar: fatura.araToplam,
      yon: 1,
      aciklama: `Mal alışı - ${fatura.faturaNo}`,
    });

    // Borç: İndirilecek KDV
    if (fatura.kdvToplam > 0) {
      const kdvGruplari = this.gruplaKDV(fatura);
      for (const [oran, tutar] of Object.entries(kdvGruplari)) {
        hareketler.push({
          hesapKodu: this.defaultHesaplar.indirilebilirKdv,
          tutar: tutar as number,
          yon: 1,
          aciklama: `İndirilecek KDV %${oran} - ${fatura.faturaNo}`,
        });
      }
    }

    // Alacak: Satıcılar
    hareketler.push({
      hesapKodu: this.defaultHesaplar.alisFaturasiCari,
      tutar: fatura.genelToplam,
      yon: -1,
      dovizKodu: fatura.dovizKodu,
      dovizTutar: fatura.dovizKodu !== 'TRY' ? fatura.genelToplam / (fatura.dovizKur || 1) : undefined,
      dovizKur: fatura.dovizKur,
      aciklama: `${fatura.cariAd} - Fatura No: ${fatura.faturaNo}`,
    });

    return {
      aciklama: `Alış Faturası: ${fatura.faturaNo} - ${fatura.cariAd}`,
      fisTipi: 'mahsup',
      hareketler,
    };
  }

  /**
   * SATIŞ İADE FATURASI (ters kayıt)
   */
  protected satisIadeFaturasiToFis(fatura: StandartFatura): FisDonusumSonucu {
    const hareketler: FisDonusumSonucu['hareketler'] = [];

    // Borç: Satıştan İadeler
    hareketler.push({
      hesapKodu: this.defaultHesaplar.satisIadeleri,
      tutar: fatura.araToplam,
      yon: 1,
      aciklama: `Satış iadesi - ${fatura.faturaNo}`,
    });

    // Borç: Hesaplanan KDV
    if (fatura.kdvToplam > 0) {
      hareketler.push({
        hesapKodu: this.defaultHesaplar.hesaplananKdv,
        tutar: fatura.kdvToplam,
        yon: 1,
        aciklama: `KDV iadesi - ${fatura.faturaNo}`,
      });
    }

    // Alacak: Alıcılar
    hareketler.push({
      hesapKodu: this.defaultHesaplar.satisFaturasiCari,
      tutar: fatura.genelToplam,
      yon: -1,
      aciklama: `Satış iadesi - ${fatura.cariAd} - ${fatura.faturaNo}`,
    });

    return {
      aciklama: `Satış İade Faturası: ${fatura.faturaNo} - ${fatura.cariAd}`,
      fisTipi: 'mahsup',
      hareketler,
    };
  }

  /**
   * ALIŞ İADE FATURASI (ters kayıt)
   */
  protected alisIadeFaturasiToFis(fatura: StandartFatura): FisDonusumSonucu {
    const hareketler: FisDonusumSonucu['hareketler'] = [];

    // Borç: Satıcılar
    hareketler.push({
      hesapKodu: this.defaultHesaplar.alisFaturasiCari,
      tutar: fatura.genelToplam,
      yon: 1,
      aciklama: `Alış iadesi - ${fatura.cariAd} - ${fatura.faturaNo}`,
    });

    // Alacak: Mal alışı
    hareketler.push({
      hesapKodu: this.defaultHesaplar.alisIadeleri,
      tutar: fatura.araToplam,
      yon: -1,
      aciklama: `Alış iadesi - ${fatura.faturaNo}`,
    });

    // Alacak: İndirilecek KDV
    if (fatura.kdvToplam > 0) {
      hareketler.push({
        hesapKodu: this.defaultHesaplar.indirilebilirKdv,
        tutar: fatura.kdvToplam,
        yon: -1,
        aciklama: `KDV iadesi - ${fatura.faturaNo}`,
      });
    }

    return {
      aciklama: `Alış İade Faturası: ${fatura.faturaNo} - ${fatura.cariAd}`,
      fisTipi: 'mahsup',
      hareketler,
    };
  }

  /**
   * KDV oranlarına göre grupla
   */
  protected gruplaKDV(fatura: StandartFatura): Record<string, number> {
    const gruplar: Record<string, number> = {};
    for (const kalem of fatura.kalemler) {
      const oran = String(kalem.kdvOran);
      gruplar[oran] = (gruplar[oran] || 0) + kalem.kdvTutar;
    }
    return gruplar;
  }

  /**
   * Toplu senkronizasyon
   */
  async senkronize(baslangic: Date, bitis: Date): Promise<SenkronizasyonSonucu> {
    const sonuc: SenkronizasyonSonucu = {
      basarili: 0,
      basarisiz: 0,
      hatalar: [],
      sonSenkronizasyon: new Date(),
    };

    try {
      const faturalar = await this.getFaturalar(baslangic, bitis);
      logger.info(
        `${this.gorunenAd}: ${faturalar.length} adet fatura çekildi (${baslangic.toISOString()} - ${bitis.toISOString()})`
      );

      for (const fatura of faturalar) {
        try {
          const fisDonusum = this.faturaToFis(fatura);

          await this.journalService.createFromIntegration(
            {
              tarih: fatura.tarih,
              aciklama: fisDonusum.aciklama,
              fisTipi: fisDonusum.fisTipi,
              hareketler: fisDonusum.hareketler.map((h) => ({
                hareketId: '', // JournalService otomatik atar
                ...h,
              })),
            },
            this.adapterAdi,
            fatura.faturaNo
          );

          sonuc.basarili++;
        } catch (error) {
          sonuc.basarisiz++;
          sonuc.hatalar.push({
            faturaNo: fatura.faturaNo,
            hata: error instanceof Error ? error.message : 'Bilinmeyen hata',
          });
          logger.error(
            `${this.gorunenAd}: Fatura muhasebeleştirme hatası - ${fatura.faturaNo}`,
            error
          );
        }
      }
    } catch (error) {
      logger.error(`${this.gorunenAd}: Senkronizasyon hatası`, error);
      throw error;
    }

    return sonuc;
  }
}
