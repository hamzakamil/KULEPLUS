/**
 * Denetim Kaydı Repository Arayüzü
 */
export interface AuditLogData {
  logId: string;
  kullaniciId?: string | null;
  islemTipi: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'INTEGRATION';
  ilgiliTablo: string;
  ilgiliKayitId?: string | null;
  eskiDeger?: Record<string, unknown> | null;
  yeniDeger?: Record<string, unknown> | null;
  ipAdresi?: string | null;
  aciklama?: string | null;
  tarih?: Date;
}

export interface AuditLogResult extends AuditLogData {
  tarih: Date;
}

export interface AuditLogFilter {
  kullaniciId?: string;
  islemTipi?: string;
  ilgiliTablo?: string;
  ilgiliKayitId?: string;
  tarihBaslangic?: Date;
  tarihBitis?: Date;
  page?: number;
  limit?: number;
}

export interface IAuditLogRepository {
  create(data: AuditLogData): Promise<AuditLogResult>;
  findAll(filter?: AuditLogFilter): Promise<AuditLogResult[]>;
  findByKayitId(ilgiliKayitId: string): Promise<AuditLogResult[]>;
  count(filter?: AuditLogFilter): Promise<number>;
}
