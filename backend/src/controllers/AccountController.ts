import { Request, Response, NextFunction } from 'express';
import { AccountService } from '../services/AccountService';
import { sendSuccess, sendError, sendPaginated } from '../utils/api-response';
import { createAccountSchema, updateAccountSchema } from '../validators/accountValidator';
import { AuthRequest } from '../middlewares/auth';

const accountService = new AccountService();

export class AccountController {
  /** Tüm hesapları listele */
  static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sinif, aktif, dovizKodu } = req.query;
      const filter: Record<string, unknown> = {};
      if (sinif) filter.hesapSinifi = Number(sinif);
      if (aktif !== undefined) filter.aktif = aktif === 'true';
      if (dovizKodu) filter.dovizKodu = dovizKodu;

      const accounts = await accountService.getAllAccounts(filter as any);
      sendSuccess(res, accounts, `${accounts.length} hesap listelendi`);
    } catch (error) {
      next(error);
    }
  }

  /** Hesap ağacını getir (hiyerarşik) */
  static async getTree(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tree = await accountService.getAccountTree();
      sendSuccess(res, tree);
    } catch (error) {
      next(error);
    }
  }

  /** Hesap koduna göre getir */
  static async getByKod(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { kod } = req.params;
      const account = await accountService.getAccountByKod(kod);
      if (!account) {
        sendError(res, `Hesap bulunamadı: ${kod}`, 404);
        return;
      }
      sendSuccess(res, account);
    } catch (error) {
      next(error);
    }
  }

  /** Yeni hesap oluştur */
  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { error, value } = createAccountSchema.validate(req.body);
      if (error) {
        sendError(res, error.details[0].message, 400);
        return;
      }

      const account = await accountService.createAccount(value, req.userId);
      sendSuccess(res, account, 'Hesap başarıyla oluşturuldu', 201);
    } catch (err) {
      next(err);
    }
  }

  /** Hesap güncelle */
  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { kod } = req.params;
      const { error, value } = updateAccountSchema.validate(req.body);
      if (error) {
        sendError(res, error.details[0].message, 400);
        return;
      }

      const updated = await accountService.updateAccount(kod, value, req.userId);
      sendSuccess(res, updated, 'Hesap başarıyla güncellendi');
    } catch (err) {
      next(err);
    }
  }

  /** Hesap sil (pasifleştir) */
  static async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { kod } = req.params;
      await accountService.deleteAccount(kod, req.userId);
      sendSuccess(res, null, 'Hesap başarıyla silindi');
    } catch (err) {
      next(err);
    }
  }

  /** Hesap arama */
  static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        sendError(res, 'Arama terimi (q) zorunludur', 400);
        return;
      }
      const results = await accountService.searchAccounts(q);
      sendSuccess(res, results, `${results.length} sonuç bulundu`);
    } catch (error) {
      next(error);
    }
  }
}
