/**
 * Yevmiye Fişi Repository Arayüzü
 */
export interface EntryLineData {
  hareketId: string;
  hesapKodu: string;
  hesapAdi?: string;
  tutar: number;
  yon: number; // 1 = borç, -1 = alacak
  dovizKodu?: string;
  dovizTutar?: number | null;
  dovizKur?: number | null;
  aciklama?: string | null;
}

export interface JournalEntryData {
  fisNo: string;
  tarih: Date;
  aciklama: string;
  fisTipi?: 'mahsup' | 'tahsil' | 'tediye' | 'acilis' | 'kapanis' | 'diger';
  hareketler: EntryLineData[];
  kullaniciId?: string | null;
  kaynakEntegrasyon?: string | null;
  kaynakBelgeNo?: string | null;
  durum?: 'taslak' | 'onaylandi' | 'iptal';
}

export interface JournalEntryResult extends JournalEntryData {
  _id?: string;
  toplamBorc: number;
  toplamAlacak: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalFilter {
  tarihBaslangic?: Date;
  tarihBitis?: Date;
  hesapKodu?: string;
  fisTipi?: string;
  durum?: string;
  kaynakEntegrasyon?: string;
  page?: number;
  limit?: number;
}

export interface IJournalRepository {
  create(data: JournalEntryData): Promise<JournalEntryResult>;
  findByFisNo(fisNo: string): Promise<JournalEntryResult | null>;
  findAll(filter?: JournalFilter): Promise<JournalEntryResult[]>;
  findByHesapKodu(hesapKodu: string, filter?: JournalFilter): Promise<JournalEntryResult[]>;
  update(fisNo: string, data: Partial<JournalEntryData>): Promise<JournalEntryResult | null>;
  delete(fisNo: string): Promise<boolean>;
  getNextFisNo(): Promise<string>;
  count(filter?: JournalFilter): Promise<number>;

  // Bakiye hesaplama sorguları
  getHesapToplam(
    hesapKodu: string,
    tarihBitis?: Date
  ): Promise<{ borc: number; alacak: number }>;

  getHesapHareketleri(
    hesapKodu: string,
    tarihBaslangic?: Date,
    tarihBitis?: Date
  ): Promise<EntryLineData[]>;
}
