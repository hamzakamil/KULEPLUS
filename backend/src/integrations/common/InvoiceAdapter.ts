/**
 * Fatura Programı Adapter Arayüzü (Interface)
 * Tüm fatura programı entegrasyonları bu arayüzü implemente eder.
 *
 * Desteklenen işlemler:
 * - Fatura verisi çekme (pull)
 * - Fatura verisi gönderme (push)
 * - Otomatik muhasebe fişi oluşturma
 * - Bağlantı testi
 * - Token yenileme
 */

/** Fatura tipi */
export type FaturaTipi = 'satis' | 'alis' | 'iade_satis' | 'iade_alis' | 'proforma';

/** Fatura durumu */
export type FaturaDurumu = 'taslak' | 'onaylandi' | 'iptal' | 'gonderildi';

/** Standardize edilmiş fatura verisi */
export interface StandartFatura {
  faturaNo: string;
  faturaTipi: FaturaTipi;
  tarih: Date;
  vadeTarih?: Date;
  cariKod?: string; // Müşteri/Tedarikçi kodu
  cariAd: string;
  cariVkn?: string; // Vergi kimlik no
  dovizKodu: string;
  dovizKur?: number;
  durum: FaturaDurumu;
  kalemler: FaturaKalem[];
  araToplam: number;
  kdvToplam: number;
  tevkifatToplam?: number;
  genelToplam: number;
  aciklama?: string;
  kaynakId?: string; // Fatura programındaki orijinal ID
}

/** Fatura kalemi */
export interface FaturaKalem {
  siraNo: number;
  urunKod?: string;
  urunAd: string;
  miktar: number;
  birim: string;
  birimFiyat: number;
  tutar: number; // miktar * birimFiyat
  iskontoOran?: number;
  iskontoTutar?: number;
  kdvOran: number;
  kdvTutar: number;
  tevkifatOran?: number;
  tevkifatTutar?: number;
  toplamTutar: number;
}

/** Muhasebeleştirme kuralı */
export interface MuhasebeleştirmeKurali {
  faturaTipi: FaturaTipi;
  borcHesaplari: { hesapKodu: string; aciklama: string }[];
  alacakHesaplari: { hesapKodu: string; aciklama: string }[];
  kdvHesapKodu: string;
  tevkifatHesapKodu?: string;
}

/** Senkronizasyon sonucu */
export interface SenkronizasyonSonucu {
  basarili: number;
  basarisiz: number;
  hatalar: { faturaNo: string; hata: string }[];
  sonSenkronizasyon: Date;
}

/** Adapter bağlantı bilgisi */
export interface AdapterConfig {
  apiUrl: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  ekAyarlar?: Record<string, unknown>;
}

/**
 * Ana Fatura Adapter Arayüzü
 * Tüm fatura programı adapterleri bunu implemente eder
 */
export interface IInvoiceAdapter {
  /** Adapter adı (parasut, logo, mikro vb.) */
  readonly adapterAdi: string;

  /** Görünen ad */
  readonly gorunenAd: string;

  /** Bağlantıyı başlat */
  connect(config: AdapterConfig): Promise<void>;

  /** Bağlantıyı test et */
  testConnection(): Promise<boolean>;

  /** Token yenile (OAuth2 kullanan sistemler için) */
  refreshAccessToken?(): Promise<string>;

  /** Faturaları çek (tarih aralığına göre) */
  getFaturalar(
    baslangic: Date,
    bitis: Date,
    tip?: FaturaTipi
  ): Promise<StandartFatura[]>;

  /** Tek bir fatura getir */
  getFatura(faturaNo: string): Promise<StandartFatura | null>;

  /** Fatura gönder (opsiyonel - her program desteklemeyebilir) */
  sendFatura?(fatura: StandartFatura): Promise<{ basarili: boolean; mesaj: string }>;

  /** Faturayı muhasebe fişine dönüştür */
  faturaToFis(fatura: StandartFatura): FisDonusumSonucu;

  /** Toplu senkronizasyon */
  senkronize(baslangic: Date, bitis: Date): Promise<SenkronizasyonSonucu>;
}

/** Fiş dönüşüm sonucu */
export interface FisDonusumSonucu {
  aciklama: string;
  fisTipi: 'mahsup' | 'tahsil' | 'tediye';
  hareketler: {
    hesapKodu: string;
    hesapAdi?: string;
    tutar: number;
    yon: number; // 1=borç, -1=alacak
    dovizKodu?: string;
    dovizTutar?: number;
    dovizKur?: number;
    aciklama?: string;
  }[];
}
