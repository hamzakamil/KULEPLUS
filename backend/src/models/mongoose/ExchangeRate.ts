import mongoose, { Schema, Document } from 'mongoose';

export interface IExchangeRate extends Document {
  dovizKodu: string;
  tarih: Date;
  alisCur: number;
  satisCur: number;
  efektifAlis: number | null;
  efektifSatis: number | null;
  kaynak: string; // 'TCMB', 'manual', vb.
  createdAt: Date;
}

const ExchangeRateSchema = new Schema<IExchangeRate>(
  {
    dovizKodu: {
      type: String,
      required: true,
      index: true,
    },
    tarih: {
      type: Date,
      required: true,
      index: true,
    },
    alisCur: {
      type: Number,
      required: true,
    },
    satisCur: {
      type: Number,
      required: true,
    },
    efektifAlis: {
      type: Number,
      default: null,
    },
    efektifSatis: {
      type: Number,
      default: null,
    },
    kaynak: {
      type: String,
      default: 'manual',
    },
  },
  {
    timestamps: true,
    collection: 'exchange_rates',
  }
);

// Aynı döviz kodu ve tarih için tekil
ExchangeRateSchema.index({ dovizKodu: 1, tarih: 1 }, { unique: true });

export const ExchangeRateModel = mongoose.model<IExchangeRate>(
  'ExchangeRate',
  ExchangeRateSchema
);
