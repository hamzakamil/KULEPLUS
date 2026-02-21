import { connectMongoDB } from '../config/database';
import { AccountModel } from '../models/mongoose/Account';
import { UserModel } from '../models/mongoose/User';
import { tdhpHesapPlani } from './tdhp-hesap-plani';
import { logger } from '../utils/logger';

/**
 * TDHP Hesap Planı ve varsayılan verileri yükle
 */
async function runSeed(): Promise<void> {
  try {
    await connectMongoDB();
    logger.info('Seed işlemi başlatılıyor...');

    // Mevcut hesapları kontrol et
    const existingCount = await AccountModel.countDocuments();
    if (existingCount > 0) {
      logger.info(`Veritabanında ${existingCount} hesap mevcut. Seed atlanıyor.`);
      logger.info('Zorla yüklemek için: FORCE_SEED=true npm run seed');

      if (process.env.FORCE_SEED !== 'true') {
        process.exit(0);
      }
      logger.info('FORCE_SEED=true: Mevcut hesaplar siliniyor...');
      await AccountModel.deleteMany({});
    }

    // TDHP hesap planını yükle
    const hesaplar = tdhpHesapPlani.map((h) => ({
      ...h,
      hesapSinifi: parseInt(h.hesapKodu.charAt(0), 10),
      anaHesapMi: true, // Seed'deki tüm hesaplar ana hesap
      dovizKodu: 'TRY',
      aktif: true,
      duzenleyiciHesapMi: h.duzenleyiciHesapMi || false,
      duzenleyiciHesapTuru: h.duzenleyiciHesapTuru || null,
    }));

    await AccountModel.insertMany(hesaplar);
    logger.info(`${hesaplar.length} adet TDHP hesabı yüklendi.`);

    // Varsayılan admin kullanıcı
    const adminExists = await UserModel.findOne({ email: 'admin@muhasebe.dev' });
    if (!adminExists) {
      await UserModel.create({
        email: 'admin@muhasebe.dev',
        password: 'Admin123!',
        ad: 'Sistem',
        soyad: 'Yöneticisi',
        rol: 'admin',
        aktif: true,
      });
      logger.info('Varsayılan admin kullanıcı oluşturuldu (admin@muhasebe.dev / Admin123!)');
    }

    logger.info('Seed işlemi tamamlandı.');
    process.exit(0);
  } catch (error) {
    logger.error('Seed hatası:', error);
    process.exit(1);
  }
}

runSeed();
