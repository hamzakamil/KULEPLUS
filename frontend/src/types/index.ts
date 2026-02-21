/** API standart yanıt formatı */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

/** Hesap */
export interface Account {
  _id?: string;
  hesapKodu: string;
  hesapAdi: string;
  anaHesapMi: boolean;
  hesapSinifi: number;
  normalBakiye: number;
  duzenleyiciHesapMi: boolean;
  duzenleyiciHesapTuru: 'aktif_duzenleyici' | 'pasif_duzenleyici' | null;
  ilgiliHesapKodu: string | null;
  ustHesapKodu: string | null;
  dovizKodu: string;
  miktarBirimi: string | null;
  onMuhasebeBaglantiKodu: string | null;
  ozelKod: string | null;
  aktif: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Account[];
}

/** Fiş Hareket Satırı */
export interface EntryLine {
  hareketId?: string;
  hesapKodu: string;
  hesapAdi?: string;
  tutar: number;
  yon: number; // 1=borç, -1=alacak
  dovizKodu?: string;
  dovizTutar?: number | null;
  dovizKur?: number | null;
  aciklama?: string | null;
}

/** Yevmiye Fişi */
export interface JournalEntry {
  _id?: string;
  fisNo: string;
  tarih: string;
  aciklama: string;
  fisTipi: 'mahsup' | 'tahsil' | 'tediye' | 'acilis' | 'kapanis' | 'diger';
  hareketler: EntryLine[];
  toplamBorc: number;
  toplamAlacak: number;
  kullaniciId: string | null;
  kaynakEntegrasyon: string | null;
  kaynakBelgeNo: string | null;
  durum: 'taslak' | 'onaylandi' | 'iptal';
  createdAt: string;
  updatedAt: string;
}

/** Hesap Bakiye */
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

/** Mizan Satırı */
export interface MizanSatir {
  hesapKodu: string;
  hesapAdi: string;
  borcToplam: number;
  alacakToplam: number;
  borcBakiye: number;
  alacakBakiye: number;
}

/** Mizan Raporu */
export interface MizanRapor {
  tarihBaslangic: string | null;
  tarihBitis: string;
  satirlar: MizanSatir[];
  genelBorcToplam: number;
  genelAlacakToplam: number;
  genelBorcBakiye: number;
  genelAlacakBakiye: number;
  denklikDurumu: boolean;
}

/** Entegrasyon Konfigürasyonu */
export interface IntegrationConfig {
  _id?: string;
  programAdi: string;
  programGorunenAd: string;
  apiUrl: string;
  aktif: boolean;
  sonSenkronizasyon: string | null;
  hesapEslestirmeleri: { kaynakKod: string; hedefHesapKodu: string; aciklama: string | null }[];
}

/** Senkronizasyon Sonucu */
export interface SyncResult {
  basarili: number;
  basarisiz: number;
  hatalar: { faturaNo: string; hata: string }[];
  sonSenkronizasyon: string;
}
