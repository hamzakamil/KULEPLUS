import { Request, Response, NextFunction } from 'express';
import { IntegrationService } from '../integrations/IntegrationService';
import { IntegrationConfigModel } from '../models/mongoose/IntegrationConfig';
import { sendSuccess, sendError } from '../utils/api-response';
import { AuthRequest } from '../middlewares/auth';

const integrationService = new IntegrationService();

export class IntegrationController {
  /** Desteklenen entegrasyonları listele */
  static async getSupportedIntegrations(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const integrations = IntegrationService.getSupportedIntegrations();
      sendSuccess(res, integrations);
    } catch (error) {
      next(error);
    }
  }

  /** Konfigüre edilmiş entegrasyonları listele */
  static async getConfiguredIntegrations(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const configs = await IntegrationConfigModel.find()
        .select('-apiKey -apiSecret -accessToken -refreshToken')
        .lean();
      sendSuccess(res, configs);
    } catch (error) {
      next(error);
    }
  }

  /** Entegrasyon konfigürasyonu oluştur/güncelle */
  static async upsertConfig(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { programAdi } = req.params;
      const data = req.body;

      const config = await IntegrationConfigModel.findOneAndUpdate(
        { programAdi },
        { $set: { ...data, programAdi } },
        { new: true, upsert: true }
      );

      sendSuccess(res, config, `${programAdi} entegrasyonu kaydedildi`);
    } catch (error) {
      next(error);
    }
  }

  /** Bağlantı testi */
  static async testConnection(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { programAdi } = req.params;
      const basarili = await integrationService.testConnection(programAdi);

      if (basarili) {
        sendSuccess(res, { connected: true }, 'Bağlantı başarılı');
      } else {
        sendError(res, 'Bağlantı başarısız', 503);
      }
    } catch (error) {
      next(error);
    }
  }

  /** Senkronizasyon başlat */
  static async senkronize(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { programAdi } = req.params;
      const { baslangic, bitis } = req.body;

      if (!baslangic || !bitis) {
        sendError(res, 'Başlangıç ve bitiş tarihleri zorunludur', 400);
        return;
      }

      const sonuc = await integrationService.senkronize(
        programAdi,
        new Date(baslangic),
        new Date(bitis)
      );

      sendSuccess(res, sonuc, `Senkronizasyon tamamlandı: ${sonuc.basarili} başarılı`);
    } catch (error) {
      next(error);
    }
  }

  /** Tüm aktif entegrasyonları senkronize et */
  static async senkronizeTumu(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { baslangic, bitis } = req.body;

      if (!baslangic || !bitis) {
        sendError(res, 'Başlangıç ve bitiş tarihleri zorunludur', 400);
        return;
      }

      const sonuclar = await integrationService.senkronizeTumu(
        new Date(baslangic),
        new Date(bitis)
      );

      sendSuccess(res, sonuclar, 'Tüm senkronizasyonlar tamamlandı');
    } catch (error) {
      next(error);
    }
  }

  /** Hesap eşleştirmelerini güncelle */
  static async updateHesapEslestirmeleri(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { programAdi } = req.params;
      const { eslestirmeler } = req.body;

      const config = await IntegrationConfigModel.findOneAndUpdate(
        { programAdi },
        { $set: { hesapEslestirmeleri: eslestirmeler } },
        { new: true }
      );

      if (!config) {
        sendError(res, `Entegrasyon bulunamadı: ${programAdi}`, 404);
        return;
      }

      sendSuccess(res, config, 'Hesap eşleştirmeleri güncellendi');
    } catch (error) {
      next(error);
    }
  }
}
