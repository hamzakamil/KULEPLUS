/**
 * Hesap Repository Arayüzü
 * Veritabanı bağımsız hesap işlemleri
 */
export interface AccountData {
  hesapKodu: string;
  hesapAdi: string;
  anaHesapMi?: boolean;
  hesapSinifi?: number;
  normalBakiye: number;
  duzenleyiciHesapMi?: boolean;
  duzenleyiciHesapTuru?: 'aktif_duzenleyici' | 'pasif_duzenleyici' | null;
  ilgiliHesapKodu?: string | null;
  ustHesapKodu?: string | null;
  dovizKodu?: string;
  miktarBirimi?: string | null;
  onMuhasebeBaglantiKodu?: string | null;
  ozelKod?: string | null;
  aktif?: boolean;
}

export interface AccountResult extends AccountData {
  _id?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAccountRepository {
  create(data: AccountData): Promise<AccountResult>;
  findByKod(hesapKodu: string): Promise<AccountResult | null>;
  findAll(filter?: Partial<AccountData>): Promise<AccountResult[]>;
  findBySinif(sinif: number): Promise<AccountResult[]>;
  findByUstHesap(ustHesapKodu: string): Promise<AccountResult[]>;
  findByBaglantiKodu(baglantiKodu: string): Promise<AccountResult | null>;
  update(hesapKodu: string, data: Partial<AccountData>): Promise<AccountResult | null>;
  delete(hesapKodu: string): Promise<boolean>;
  search(query: string): Promise<AccountResult[]>;
  count(filter?: Partial<AccountData>): Promise<number>;
}
