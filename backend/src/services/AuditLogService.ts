import { v4 as uuidv4 } from 'uuid';
import { repositoryFactory } from '../repositories/RepositoryFactory';
import {
  AuditLogData,
  AuditLogResult,
  AuditLogFilter,
} from '../repositories/interfaces/IAuditLogRepository';

/**
 * Denetim Kaydı Servisi
 * Tüm kritik işlemlerin loglanması ve sorgulanması
 */
export class AuditLogService {
  private auditLogRepo = repositoryFactory.getAuditLogRepository();

  /**
   * Log kaydı oluştur
   */
  async log(data: Omit<AuditLogData, 'logId'>): Promise<AuditLogResult> {
    return this.auditLogRepo.create({
      ...data,
      logId: uuidv4(),
      tarih: new Date(),
    });
  }

  /**
   * Log kayıtlarını getir (filtreleme destekli)
   */
  async getLogs(filter?: AuditLogFilter): Promise<AuditLogResult[]> {
    return this.auditLogRepo.findAll(filter);
  }

  /**
   * Belirli bir kaydın değişiklik geçmişini getir
   */
  async getKayitGecmisi(ilgiliKayitId: string): Promise<AuditLogResult[]> {
    return this.auditLogRepo.findByKayitId(ilgiliKayitId);
  }

  /**
   * Log sayısını getir
   */
  async getLogCount(filter?: AuditLogFilter): Promise<number> {
    return this.auditLogRepo.count(filter);
  }
}
