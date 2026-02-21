/**
 * Döviz Kuru Repository Arayüzü
 */
export interface ExchangeRateData {
  dovizKodu: string;
  tarih: Date;
  alisCur: number;
  satisCur: number;
  efektifAlis?: number | null;
  efektifSatis?: number | null;
  kaynak?: string;
}

export interface ExchangeRateResult extends ExchangeRateData {
  _id?: string;
  createdAt: Date;
}

export interface IExchangeRateRepository {
  create(data: ExchangeRateData): Promise<ExchangeRateResult>;
  upsert(data: ExchangeRateData): Promise<ExchangeRateResult>;
  findByKodVeTarih(dovizKodu: string, tarih: Date): Promise<ExchangeRateResult | null>;
  findLatestByKod(dovizKodu: string): Promise<ExchangeRateResult | null>;
  findAllByTarih(tarih: Date): Promise<ExchangeRateResult[]>;
  findKodTarihAraligi(
    dovizKodu: string,
    baslangic: Date,
    bitis: Date
  ): Promise<ExchangeRateResult[]>;
}
