import { ExchangeRateModel } from '../../models/mongoose/ExchangeRate';
import {
  IExchangeRateRepository,
  ExchangeRateData,
  ExchangeRateResult,
} from '../interfaces/IExchangeRateRepository';

export class MongoExchangeRateRepository implements IExchangeRateRepository {
  async create(data: ExchangeRateData): Promise<ExchangeRateResult> {
    const rate = new ExchangeRateModel(data);
    const saved = await rate.save();
    return saved.toObject() as unknown as ExchangeRateResult;
  }

  async upsert(data: ExchangeRateData): Promise<ExchangeRateResult> {
    const result = await ExchangeRateModel.findOneAndUpdate(
      { dovizKodu: data.dovizKodu, tarih: data.tarih },
      { $set: data },
      { new: true, upsert: true }
    ).lean();
    return result as unknown as ExchangeRateResult;
  }

  async findByKodVeTarih(
    dovizKodu: string,
    tarih: Date
  ): Promise<ExchangeRateResult | null> {
    // Günün başlangıcı ve sonu arasında arama
    const startOfDay = new Date(tarih);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(tarih);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await ExchangeRateModel.findOne({
      dovizKodu,
      tarih: { $gte: startOfDay, $lte: endOfDay },
    }).lean();
    return result as unknown as ExchangeRateResult | null;
  }

  async findLatestByKod(dovizKodu: string): Promise<ExchangeRateResult | null> {
    const result = await ExchangeRateModel.findOne({ dovizKodu })
      .sort({ tarih: -1 })
      .lean();
    return result as unknown as ExchangeRateResult | null;
  }

  async findAllByTarih(tarih: Date): Promise<ExchangeRateResult[]> {
    const startOfDay = new Date(tarih);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(tarih);
    endOfDay.setHours(23, 59, 59, 999);

    return ExchangeRateModel.find({
      tarih: { $gte: startOfDay, $lte: endOfDay },
    })
      .sort({ dovizKodu: 1 })
      .lean() as unknown as Promise<ExchangeRateResult[]>;
  }

  async findKodTarihAraligi(
    dovizKodu: string,
    baslangic: Date,
    bitis: Date
  ): Promise<ExchangeRateResult[]> {
    return ExchangeRateModel.find({
      dovizKodu,
      tarih: { $gte: baslangic, $lte: bitis },
    })
      .sort({ tarih: 1 })
      .lean() as unknown as Promise<ExchangeRateResult[]>;
  }
}
