import { IInvoiceAdapter, SenkronizasyonSonucu } from './common/InvoiceAdapter';
import { ParasutAdapter } from './adapters/ParasutAdapter';
import { EFaturaAdapter } from './adapters/EFaturaAdapter';
import { CustomAdapter } from './adapters/CustomAdapter';
import { IntegrationConfigModel } from '../models/mongoose/IntegrationConfig';
import { logger } from '../utils/logger';

/**
 * Entegrasyon Yönetim Servisi
 * Tüm fatura programı adapterleri burada yönetilir.
 * Yeni adapter eklemek için:
 *  1. adapters/ klasöründe yeni adapter oluştur
 *  2. Bu servisteki registry'ye ekle
 */
export class IntegrationService {
  /** Kayıtlı adapter'lar */
  private static adapterRegistry: Record<string, () => IInvoiceAdapter> = {
    parasut: () => new ParasutAdapter(),
    efatura: () => new EFaturaAdapter(),
    custom: () => new CustomAdapter(),
    // Yeni adapterler buraya eklenir:
    // logo: () => new LogoAdapter(),
    // mikro: () => new MikroAdapter(),
    // luca: () => new LucaAdapter(),
    // bizimhesap: () => new BizimHesapAdapter(),
    // kolaybi: () => new KolaybiAdapter(),
  };

  /**
   * Desteklenen entegrasyon listesini getir
   */
  static getSupportedIntegrations(): { id: string; ad: string }[] {
    return [
      { id: 'parasut', ad: 'Paraşüt' },
      { id: 'efatura', ad: 'GİB e-Fatura / e-Arşiv' },
      { id: 'logo', ad: 'Logo Yazılım' },
      { id: 'mikro', ad: 'Mikro Yazılım' },
      { id: 'luca', ad: 'Luca' },
      { id: 'bizimhesap', ad: 'BizimHesap' },
      { id: 'kolaybi', ad: 'Kolaybi' },
      { id: 'custom', ad: 'Özel Entegrasyon' },
    ];
  }

  /**
   * Belirli bir adapter'ı oluştur ve konfigüre et
   */
  async getAdapter(programAdi: string): Promise<IInvoiceAdapter> {
    const factory = IntegrationService.adapterRegistry[programAdi];
    if (!factory) {
      throw new Error(
        `Desteklenmeyen entegrasyon: ${programAdi}. Desteklenen: ${Object.keys(IntegrationService.adapterRegistry).join(', ')}`
      );
    }

    // DB'den konfigürasyon çek
    const config = await IntegrationConfigModel.findOne({ programAdi, aktif: true });
    if (!config) {
      throw new Error(
        `${programAdi} entegrasyonu konfigüre edilmemiş veya aktif değil`
      );
    }

    const adapter = factory();
    await adapter.connect({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey || undefined,
      apiSecret: config.apiSecret || undefined,
      accessToken: config.accessToken || undefined,
      refreshToken: config.refreshToken || undefined,
      ekAyarlar: config.ekAyarlar,
    });

    return adapter;
  }

  /**
   * Bağlantıyı test et
   */
  async testConnection(programAdi: string): Promise<boolean> {
    try {
      const adapter = await this.getAdapter(programAdi);
      return adapter.testConnection();
    } catch (error) {
      logger.error(`Bağlantı testi başarısız (${programAdi}):`, error);
      return false;
    }
  }

  /**
   * Belirli bir program için senkronizasyon başlat
   */
  async senkronize(
    programAdi: string,
    baslangic: Date,
    bitis: Date
  ): Promise<SenkronizasyonSonucu> {
    const adapter = await this.getAdapter(programAdi);
    const sonuc = await adapter.senkronize(baslangic, bitis);

    // Son senkronizasyon tarihini güncelle
    await IntegrationConfigModel.findOneAndUpdate(
      { programAdi },
      { $set: { sonSenkronizasyon: new Date() } }
    );

    logger.info(
      `Senkronizasyon tamamlandı (${programAdi}): ${sonuc.basarili} başarılı, ${sonuc.basarisiz} başarısız`
    );

    return sonuc;
  }

  /**
   * Tüm aktif entegrasyonları senkronize et
   */
  async senkronizeTumu(
    baslangic: Date,
    bitis: Date
  ): Promise<Record<string, SenkronizasyonSonucu>> {
    const aktifConfigs = await IntegrationConfigModel.find({ aktif: true });
    const sonuclar: Record<string, SenkronizasyonSonucu> = {};

    for (const config of aktifConfigs) {
      try {
        sonuclar[config.programAdi] = await this.senkronize(
          config.programAdi,
          baslangic,
          bitis
        );
      } catch (error) {
        logger.error(`Senkronizasyon hatası (${config.programAdi}):`, error);
        sonuclar[config.programAdi] = {
          basarili: 0,
          basarisiz: 0,
          hatalar: [
            {
              faturaNo: '-',
              hata: error instanceof Error ? error.message : 'Bilinmeyen hata',
            },
          ],
          sonSenkronizasyon: new Date(),
        };
      }
    }

    return sonuclar;
  }
}
