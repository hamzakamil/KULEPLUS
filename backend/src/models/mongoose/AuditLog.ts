import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  logId: string;
  kullaniciId: string | null;
  islemTipi: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'INTEGRATION';
  ilgiliTablo: string;
  ilgiliKayitId: string | null;
  eskiDeger: Record<string, unknown> | null;
  yeniDeger: Record<string, unknown> | null;
  ipAdresi: string | null;
  aciklama: string | null;
  tarih: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    logId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    kullaniciId: {
      type: String,
      default: null,
      index: true,
    },
    islemTipi: {
      type: String,
      required: true,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'INTEGRATION'],
      index: true,
    },
    ilgiliTablo: {
      type: String,
      required: true,
    },
    ilgiliKayitId: {
      type: String,
      default: null,
    },
    eskiDeger: {
      type: Schema.Types.Mixed,
      default: null,
    },
    yeniDeger: {
      type: Schema.Types.Mixed,
      default: null,
    },
    ipAdresi: {
      type: String,
      default: null,
    },
    aciklama: {
      type: String,
      default: null,
    },
    tarih: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    collection: 'audit_logs',
  }
);

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
