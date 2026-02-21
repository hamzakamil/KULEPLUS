import { AccountModel } from '../../models/mongoose/Account';
import {
  IAccountRepository,
  AccountData,
  AccountResult,
} from '../interfaces/IAccountRepository';

export class MongoAccountRepository implements IAccountRepository {
  async create(data: AccountData): Promise<AccountResult> {
    const account = new AccountModel(data);
    const saved = await account.save();
    return saved.toObject() as unknown as AccountResult;
  }

  async findByKod(hesapKodu: string): Promise<AccountResult | null> {
    const account = await AccountModel.findOne({ hesapKodu }).lean();
    return account as unknown as AccountResult | null;
  }

  async findAll(filter?: Partial<AccountData>): Promise<AccountResult[]> {
    const query: Record<string, unknown> = {};
    if (filter) {
      if (filter.aktif !== undefined) query.aktif = filter.aktif;
      if (filter.hesapSinifi) query.hesapSinifi = filter.hesapSinifi;
      if (filter.anaHesapMi !== undefined) query.anaHesapMi = filter.anaHesapMi;
      if (filter.duzenleyiciHesapMi !== undefined)
        query.duzenleyiciHesapMi = filter.duzenleyiciHesapMi;
      if (filter.dovizKodu) query.dovizKodu = filter.dovizKodu;
    }
    const accounts = await AccountModel.find(query).sort({ hesapKodu: 1 }).lean();
    return accounts as unknown as AccountResult[];
  }

  async findBySinif(sinif: number): Promise<AccountResult[]> {
    const accounts = await AccountModel.find({ hesapSinifi: sinif })
      .sort({ hesapKodu: 1 })
      .lean();
    return accounts as unknown as AccountResult[];
  }

  async findByUstHesap(ustHesapKodu: string): Promise<AccountResult[]> {
    const accounts = await AccountModel.find({ ustHesapKodu })
      .sort({ hesapKodu: 1 })
      .lean();
    return accounts as unknown as AccountResult[];
  }

  async findByBaglantiKodu(baglantiKodu: string): Promise<AccountResult | null> {
    const account = await AccountModel.findOne({
      onMuhasebeBaglantiKodu: baglantiKodu,
    }).lean();
    return account as unknown as AccountResult | null;
  }

  async update(
    hesapKodu: string,
    data: Partial<AccountData>
  ): Promise<AccountResult | null> {
    const account = await AccountModel.findOneAndUpdate(
      { hesapKodu },
      { $set: data },
      { new: true }
    ).lean();
    return account as unknown as AccountResult | null;
  }

  async delete(hesapKodu: string): Promise<boolean> {
    const result = await AccountModel.deleteOne({ hesapKodu });
    return result.deletedCount > 0;
  }

  async search(query: string): Promise<AccountResult[]> {
    const accounts = await AccountModel.find({
      $or: [
        { hesapKodu: { $regex: query, $options: 'i' } },
        { hesapAdi: { $regex: query, $options: 'i' } },
        { ozelKod: { $regex: query, $options: 'i' } },
      ],
    })
      .sort({ hesapKodu: 1 })
      .lean();
    return accounts as unknown as AccountResult[];
  }

  async count(filter?: Partial<AccountData>): Promise<number> {
    const query: Record<string, unknown> = {};
    if (filter) {
      if (filter.aktif !== undefined) query.aktif = filter.aktif;
      if (filter.hesapSinifi) query.hesapSinifi = filter.hesapSinifi;
    }
    return AccountModel.countDocuments(query);
  }
}
