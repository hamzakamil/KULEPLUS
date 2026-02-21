import { JournalEntryModel } from '../../models/mongoose/JournalEntry';
import {
  IJournalRepository,
  JournalEntryData,
  JournalEntryResult,
  JournalFilter,
  EntryLineData,
} from '../interfaces/IJournalRepository';

export class MongoJournalRepository implements IJournalRepository {
  async create(data: JournalEntryData): Promise<JournalEntryResult> {
    const entry = new JournalEntryModel(data);
    const saved = await entry.save();
    return saved.toObject() as unknown as JournalEntryResult;
  }

  async findByFisNo(fisNo: string): Promise<JournalEntryResult | null> {
    const entry = await JournalEntryModel.findOne({ fisNo }).lean();
    return entry as unknown as JournalEntryResult | null;
  }

  async findAll(filter?: JournalFilter): Promise<JournalEntryResult[]> {
    const query: Record<string, unknown> = {};
    const options: { skip?: number; limit?: number } = {};

    if (filter) {
      if (filter.tarihBaslangic || filter.tarihBitis) {
        const tarihQuery: Record<string, Date> = {};
        if (filter.tarihBaslangic) tarihQuery.$gte = filter.tarihBaslangic;
        if (filter.tarihBitis) tarihQuery.$lte = filter.tarihBitis;
        query.tarih = tarihQuery;
      }
      if (filter.fisTipi) query.fisTipi = filter.fisTipi;
      if (filter.durum) query.durum = filter.durum;
      if (filter.kaynakEntegrasyon) query.kaynakEntegrasyon = filter.kaynakEntegrasyon;
      if (filter.hesapKodu) {
        query['hareketler.hesapKodu'] = filter.hesapKodu;
      }
      if (filter.page && filter.limit) {
        options.skip = (filter.page - 1) * filter.limit;
        options.limit = filter.limit;
      }
    }

    return JournalEntryModel.find(query)
      .sort({ tarih: -1, fisNo: -1 })
      .skip(options.skip || 0)
      .limit(options.limit || 100)
      .lean() as unknown as Promise<JournalEntryResult[]>;
  }

  async findByHesapKodu(
    hesapKodu: string,
    filter?: JournalFilter
  ): Promise<JournalEntryResult[]> {
    const query: Record<string, unknown> = {
      'hareketler.hesapKodu': hesapKodu,
    };

    if (filter) {
      if (filter.tarihBaslangic || filter.tarihBitis) {
        const tarihQuery: Record<string, Date> = {};
        if (filter.tarihBaslangic) tarihQuery.$gte = filter.tarihBaslangic;
        if (filter.tarihBitis) tarihQuery.$lte = filter.tarihBitis;
        query.tarih = tarihQuery;
      }
      if (filter.durum) query.durum = filter.durum;
    }

    return JournalEntryModel.find(query)
      .sort({ tarih: -1 })
      .lean() as unknown as Promise<JournalEntryResult[]>;
  }

  async update(
    fisNo: string,
    data: Partial<JournalEntryData>
  ): Promise<JournalEntryResult | null> {
    const entry = await JournalEntryModel.findOneAndUpdate(
      { fisNo },
      { $set: data },
      { new: true }
    ).lean();
    return entry as unknown as JournalEntryResult | null;
  }

  async delete(fisNo: string): Promise<boolean> {
    const result = await JournalEntryModel.deleteOne({ fisNo });
    return result.deletedCount > 0;
  }

  async getNextFisNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `YMF-${year}-`;
    const last = await JournalEntryModel.findOne({
      fisNo: { $regex: `^${prefix}` },
    })
      .sort({ fisNo: -1 })
      .lean();

    if (!last) {
      return `${prefix}000001`;
    }

    const lastNum = parseInt(last.fisNo.replace(prefix, ''), 10);
    return `${prefix}${String(lastNum + 1).padStart(6, '0')}`;
  }

  async count(filter?: JournalFilter): Promise<number> {
    const query: Record<string, unknown> = {};
    if (filter) {
      if (filter.tarihBaslangic || filter.tarihBitis) {
        const tarihQuery: Record<string, Date> = {};
        if (filter.tarihBaslangic) tarihQuery.$gte = filter.tarihBaslangic;
        if (filter.tarihBitis) tarihQuery.$lte = filter.tarihBitis;
        query.tarih = tarihQuery;
      }
      if (filter.durum) query.durum = filter.durum;
    }
    return JournalEntryModel.countDocuments(query);
  }

  async getHesapToplam(
    hesapKodu: string,
    tarihBitis?: Date
  ): Promise<{ borc: number; alacak: number }> {
    const matchStage: Record<string, unknown> = {
      durum: { $ne: 'iptal' },
    };
    if (tarihBitis) {
      matchStage.tarih = { $lte: tarihBitis };
    }

    const result = await JournalEntryModel.aggregate([
      { $match: matchStage },
      { $unwind: '$hareketler' },
      { $match: { 'hareketler.hesapKodu': hesapKodu } },
      {
        $group: {
          _id: null,
          borc: {
            $sum: {
              $cond: [{ $eq: ['$hareketler.yon', 1] }, '$hareketler.tutar', 0],
            },
          },
          alacak: {
            $sum: {
              $cond: [{ $eq: ['$hareketler.yon', -1] }, '$hareketler.tutar', 0],
            },
          },
        },
      },
    ]);

    if (result.length === 0) {
      return { borc: 0, alacak: 0 };
    }

    return { borc: result[0].borc, alacak: result[0].alacak };
  }

  async getHesapHareketleri(
    hesapKodu: string,
    tarihBaslangic?: Date,
    tarihBitis?: Date
  ): Promise<EntryLineData[]> {
    const matchStage: Record<string, unknown> = {
      'hareketler.hesapKodu': hesapKodu,
      durum: { $ne: 'iptal' },
    };

    if (tarihBaslangic || tarihBitis) {
      const tarihQuery: Record<string, Date> = {};
      if (tarihBaslangic) tarihQuery.$gte = tarihBaslangic;
      if (tarihBitis) tarihQuery.$lte = tarihBitis;
      matchStage.tarih = tarihQuery;
    }

    const result = await JournalEntryModel.aggregate([
      { $match: matchStage },
      { $unwind: '$hareketler' },
      { $match: { 'hareketler.hesapKodu': hesapKodu } },
      { $sort: { tarih: 1 } },
      {
        $project: {
          _id: 0,
          hareketId: '$hareketler.hareketId',
          hesapKodu: '$hareketler.hesapKodu',
          hesapAdi: '$hareketler.hesapAdi',
          tutar: '$hareketler.tutar',
          yon: '$hareketler.yon',
          dovizKodu: '$hareketler.dovizKodu',
          dovizTutar: '$hareketler.dovizTutar',
          dovizKur: '$hareketler.dovizKur',
          aciklama: '$hareketler.aciklama',
          fisNo: '$fisNo',
          tarih: '$tarih',
        },
      },
    ]);

    return result;
  }
}
