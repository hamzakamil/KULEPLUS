import { Request, Response, NextFunction } from 'express';
import { JournalService } from '../services/JournalService';
import { sendSuccess, sendError } from '../utils/api-response';
import { createJournalEntrySchema } from '../validators/journalValidator';
import { AuthRequest } from '../middlewares/auth';

const journalService = new JournalService();

export class JournalController {
  /** Tüm yevmiye fişlerini listele */
  static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        tarihBaslangic,
        tarihBitis,
        fisTipi,
        durum,
        hesapKodu,
        kaynakEntegrasyon,
        page,
        limit,
      } = req.query;

      const filter: Record<string, unknown> = {};
      if (tarihBaslangic) filter.tarihBaslangic = new Date(tarihBaslangic as string);
      if (tarihBitis) filter.tarihBitis = new Date(tarihBitis as string);
      if (fisTipi) filter.fisTipi = fisTipi;
      if (durum) filter.durum = durum;
      if (hesapKodu) filter.hesapKodu = hesapKodu;
      if (kaynakEntegrasyon) filter.kaynakEntegrasyon = kaynakEntegrasyon;
      if (page) filter.page = Number(page);
      if (limit) filter.limit = Number(limit);

      const entries = await journalService.getAllJournalEntries(filter as any);
      sendSuccess(res, entries, `${entries.length} fiş listelendi`);
    } catch (error) {
      next(error);
    }
  }

  /** Fiş numarasına göre getir */
  static async getByFisNo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fisNo } = req.params;
      const entry = await journalService.getJournalEntry(fisNo);
      if (!entry) {
        sendError(res, `Fiş bulunamadı: ${fisNo}`, 404);
        return;
      }
      sendSuccess(res, entry);
    } catch (error) {
      next(error);
    }
  }

  /** Yeni yevmiye fişi oluştur */
  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { error, value } = createJournalEntrySchema.validate(req.body);
      if (error) {
        sendError(res, error.details[0].message, 400);
        return;
      }

      const entry = await journalService.createJournalEntry(value, req.userId);
      sendSuccess(res, entry, 'Yevmiye fişi başarıyla oluşturuldu', 201);
    } catch (err) {
      next(err);
    }
  }

  /** Fişi onayla */
  static async approve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fisNo } = req.params;
      const entry = await journalService.approveJournalEntry(fisNo, req.userId);
      sendSuccess(res, entry, 'Fiş onaylandı');
    } catch (err) {
      next(err);
    }
  }

  /** Fişi iptal et */
  static async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fisNo } = req.params;
      const entry = await journalService.cancelJournalEntry(fisNo, req.userId);
      sendSuccess(res, entry, 'Fiş iptal edildi');
    } catch (err) {
      next(err);
    }
  }

  /** Hesabın hareketlerini getir */
  static async getHesapHareketleri(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { hesapKodu } = req.params;
      const { tarihBaslangic, tarihBitis } = req.query;

      const hareketler = await journalService.getHesapHareketleri(
        hesapKodu,
        tarihBaslangic ? new Date(tarihBaslangic as string) : undefined,
        tarihBitis ? new Date(tarihBitis as string) : undefined
      );
      sendSuccess(res, hareketler, `${hareketler.length} hareket bulundu`);
    } catch (error) {
      next(error);
    }
  }
}
