import { AuditLogModel } from '../../models/mongoose/AuditLog';
import {
  IAuditLogRepository,
  AuditLogData,
  AuditLogResult,
  AuditLogFilter,
} from '../interfaces/IAuditLogRepository';

export class MongoAuditLogRepository implements IAuditLogRepository {
  async create(data: AuditLogData): Promise<AuditLogResult> {
    const log = new AuditLogModel({
      ...data,
      tarih: data.tarih || new Date(),
    });
    const saved = await log.save();
    return saved.toObject() as unknown as AuditLogResult;
  }

  async findAll(filter?: AuditLogFilter): Promise<AuditLogResult[]> {
    const query: Record<string, unknown> = {};
    let skip = 0;
    let limit = 100;

    if (filter) {
      if (filter.kullaniciId) query.kullaniciId = filter.kullaniciId;
      if (filter.islemTipi) query.islemTipi = filter.islemTipi;
      if (filter.ilgiliTablo) query.ilgiliTablo = filter.ilgiliTablo;
      if (filter.ilgiliKayitId) query.ilgiliKayitId = filter.ilgiliKayitId;
      if (filter.tarihBaslangic || filter.tarihBitis) {
        const tarihQuery: Record<string, Date> = {};
        if (filter.tarihBaslangic) tarihQuery.$gte = filter.tarihBaslangic;
        if (filter.tarihBitis) tarihQuery.$lte = filter.tarihBitis;
        query.tarih = tarihQuery;
      }
      if (filter.page && filter.limit) {
        skip = (filter.page - 1) * filter.limit;
        limit = filter.limit;
      }
    }

    return AuditLogModel.find(query)
      .sort({ tarih: -1 })
      .skip(skip)
      .limit(limit)
      .lean() as unknown as Promise<AuditLogResult[]>;
  }

  async findByKayitId(ilgiliKayitId: string): Promise<AuditLogResult[]> {
    return AuditLogModel.find({ ilgiliKayitId })
      .sort({ tarih: -1 })
      .lean() as unknown as Promise<AuditLogResult[]>;
  }

  async count(filter?: AuditLogFilter): Promise<number> {
    const query: Record<string, unknown> = {};
    if (filter) {
      if (filter.kullaniciId) query.kullaniciId = filter.kullaniciId;
      if (filter.islemTipi) query.islemTipi = filter.islemTipi;
      if (filter.ilgiliTablo) query.ilgiliTablo = filter.ilgiliTablo;
    }
    return AuditLogModel.countDocuments(query);
  }
}
