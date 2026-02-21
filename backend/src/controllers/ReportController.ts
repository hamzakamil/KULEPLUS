import { Request, Response, NextFunction } from 'express';
import { BalanceService } from '../services/BalanceService';
import { sendSuccess, sendError } from '../utils/api-response';

const balanceService = new BalanceService();

export class ReportController {
  /** Hesap bakiyesi */
  static async getHesapBakiye(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { hesapKodu } = req.params;
      const { tarih } = req.query;
      const bakiye = await balanceService.getHesapBakiye(
        hesapKodu,
        tarih ? new Date(tarih as string) : undefined
      );
      sendSuccess(res, bakiye);
    } catch (error) {
      next(error);
    }
  }

  /** Mizan raporu */
  static async getMizan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tarihBaslangic, tarihBitis, sinif } = req.query;
      const mizan = await balanceService.getMizan(
        tarihBaslangic ? new Date(tarihBaslangic as string) : undefined,
        tarihBitis ? new Date(tarihBitis as string) : undefined,
        sinif ? Number(sinif) : undefined
      );
      sendSuccess(res, mizan);
    } catch (error) {
      next(error);
    }
  }

  /** Bilanço raporu */
  static async getBilanco(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tarih } = req.query;
      const bilanco = await balanceService.getBilanco(
        tarih ? new Date(tarih as string) : undefined
      );
      sendSuccess(res, bilanco);
    } catch (error) {
      next(error);
    }
  }

  /** Gelir tablosu */
  static async getGelirTablosu(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { tarihBaslangic, tarihBitis } = req.query;
      const gelirTablosu = await balanceService.getGelirTablosu(
        tarihBaslangic ? new Date(tarihBaslangic as string) : undefined,
        tarihBitis ? new Date(tarihBitis as string) : undefined
      );
      sendSuccess(res, gelirTablosu);
    } catch (error) {
      next(error);
    }
  }

  /** Hesap ekstresi */
  static async getHesapEkstresi(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { hesapKodu } = req.params;
      const { tarihBaslangic, tarihBitis } = req.query;

      const ekstre = await balanceService.getHesapEkstresi(
        hesapKodu,
        tarihBaslangic ? new Date(tarihBaslangic as string) : undefined,
        tarihBitis ? new Date(tarihBitis as string) : undefined
      );
      sendSuccess(res, ekstre);
    } catch (error) {
      next(error);
    }
  }
}
