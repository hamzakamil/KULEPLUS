import mongoose, { Schema, Document } from 'mongoose';

export interface IAccount extends Document {
  hesapKodu: string;
  hesapAdi: string;
  anaHesapMi: boolean;
  hesapSinifi: number; // 1-9
  normalBakiye: number; // 1 = borç, -1 = alacak
  duzenleyiciHesapMi: boolean;
  duzenleyiciHesapTuru: 'aktif_duzenleyici' | 'pasif_duzenleyici' | null;
  ilgiliHesapKodu: string | null;
  ustHesapKodu: string | null;
  dovizKodu: string;
  miktarBirimi: string | null;
  onMuhasebeBaglantiKodu: string | null;
  ozelKod: string | null;
  aktif: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    hesapKodu: {
      type: String,
      required: [true, 'Hesap kodu zorunludur'],
      unique: true,
      trim: true,
      index: true,
    },
    hesapAdi: {
      type: String,
      required: [true, 'Hesap adı zorunludur'],
      trim: true,
    },
    anaHesapMi: {
      type: Boolean,
      default: false,
    },
    hesapSinifi: {
      type: Number,
      required: true,
      min: 1,
      max: 9,
    },
    normalBakiye: {
      type: Number,
      required: true,
      enum: [1, -1], // 1 = borç, -1 = alacak
    },
    duzenleyiciHesapMi: {
      type: Boolean,
      default: false,
    },
    duzenleyiciHesapTuru: {
      type: String,
      enum: ['aktif_duzenleyici', 'pasif_duzenleyici', null],
      default: null,
    },
    ilgiliHesapKodu: {
      type: String,
      default: null,
    },
    ustHesapKodu: {
      type: String,
      default: null,
      index: true,
    },
    dovizKodu: {
      type: String,
      default: 'TRY',
    },
    miktarBirimi: {
      type: String,
      default: null,
    },
    onMuhasebeBaglantiKodu: {
      type: String,
      default: null,
      index: true,
    },
    ozelKod: {
      type: String,
      default: null,
    },
    aktif: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'accounts',
  }
);

// Hesap kodu ile hesap sınıfını otomatik belirle
AccountSchema.pre('save', function (next) {
  if (this.hesapKodu) {
    this.hesapSinifi = parseInt(this.hesapKodu.charAt(0), 10);
  }
  next();
});

export const AccountModel = mongoose.model<IAccount>('Account', AccountSchema);
