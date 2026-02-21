import { config } from '../config';
import { IAccountRepository } from './interfaces/IAccountRepository';
import { IJournalRepository } from './interfaces/IJournalRepository';
import { IAuditLogRepository } from './interfaces/IAuditLogRepository';
import { IExchangeRateRepository } from './interfaces/IExchangeRateRepository';
import { MongoAccountRepository } from './mongodb/MongoAccountRepository';
import { MongoJournalRepository } from './mongodb/MongoJournalRepository';
import { MongoAuditLogRepository } from './mongodb/MongoAuditLogRepository';
import { MongoExchangeRateRepository } from './mongodb/MongoExchangeRateRepository';

/**
 * Repository Factory
 * Konfigürasyona göre doğru veritabanı implementasyonunu döner.
 * MongoDB → PostgreSQL geçişinde sadece bu factory güncellenir.
 */
class RepositoryFactory {
  private accountRepo: IAccountRepository | null = null;
  private journalRepo: IJournalRepository | null = null;
  private auditLogRepo: IAuditLogRepository | null = null;
  private exchangeRateRepo: IExchangeRateRepository | null = null;

  getAccountRepository(): IAccountRepository {
    if (!this.accountRepo) {
      if (config.dbType === 'mongodb') {
        this.accountRepo = new MongoAccountRepository();
      } else {
        // PostgreSQL implementasyonu eklendiğinde:
        // this.accountRepo = new PgAccountRepository();
        throw new Error('PostgreSQL implementasyonu henüz hazır değil');
      }
    }
    return this.accountRepo;
  }

  getJournalRepository(): IJournalRepository {
    if (!this.journalRepo) {
      if (config.dbType === 'mongodb') {
        this.journalRepo = new MongoJournalRepository();
      } else {
        throw new Error('PostgreSQL implementasyonu henüz hazır değil');
      }
    }
    return this.journalRepo;
  }

  getAuditLogRepository(): IAuditLogRepository {
    if (!this.auditLogRepo) {
      if (config.dbType === 'mongodb') {
        this.auditLogRepo = new MongoAuditLogRepository();
      } else {
        throw new Error('PostgreSQL implementasyonu henüz hazır değil');
      }
    }
    return this.auditLogRepo;
  }

  getExchangeRateRepository(): IExchangeRateRepository {
    if (!this.exchangeRateRepo) {
      if (config.dbType === 'mongodb') {
        this.exchangeRateRepo = new MongoExchangeRateRepository();
      } else {
        throw new Error('PostgreSQL implementasyonu henüz hazır değil');
      }
    }
    return this.exchangeRateRepo;
  }
}

// Singleton instance
export const repositoryFactory = new RepositoryFactory();
