import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegrationConfig extends Document {
  programAdi: string; // 'parasut', 'logo', 'mikro', 'luca', 'bizimhesap', 'efatura', 'custom'
  programGorunenAd: string;
  apiUrl: string;
  apiKey: string | null;
  apiSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  ekAyarlar: Record<string, unknown>;
  hesapEslestirmeleri: IHesapEslestirme[];
  aktif: boolean;
  sonSenkronizasyon: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IHesapEslestirme {
  kaynakKod: string; // Fatura programındaki kod
  hedefHesapKodu: string; // TDHP hesap kodu
  aciklama: string | null;
}

const HesapEslestirmeSchema = new Schema<IHesapEslestirme>(
  {
    kaynakKod: { type: String, required: true },
    hedefHesapKodu: { type: String, required: true },
    aciklama: { type: String, default: null },
  },
  { _id: false }
);

const IntegrationConfigSchema = new Schema<IIntegrationConfig>(
  {
    programAdi: {
      type: String,
      required: true,
      enum: ['parasut', 'logo', 'mikro', 'luca', 'bizimhesap', 'efatura', 'kolaybi', 'custom'],
      unique: true,
    },
    programGorunenAd: {
      type: String,
      required: true,
    },
    apiUrl: {
      type: String,
      required: true,
    },
    apiKey: { type: String, default: null },
    apiSecret: { type: String, default: null },
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    tokenExpiry: { type: Date, default: null },
    ekAyarlar: {
      type: Schema.Types.Mixed,
      default: {},
    },
    hesapEslestirmeleri: {
      type: [HesapEslestirmeSchema],
      default: [],
    },
    aktif: {
      type: Boolean,
      default: false,
    },
    sonSenkronizasyon: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'integration_configs',
  }
);

export const IntegrationConfigModel = mongoose.model<IIntegrationConfig>(
  'IntegrationConfig',
  IntegrationConfigSchema
);
