import mongoose, { Schema, Document } from 'mongoose';

export interface IEntryLine {
  hareketId: string;
  hesapKodu: string;
  hesapAdi?: string;
  tutar: number; // Her zaman pozitif
  yon: number; // 1 = borç, -1 = alacak
  dovizKodu: string;
  dovizTutar: number | null;
  dovizKur: number | null;
  aciklama: string | null;
}

export interface IJournalEntry extends Document {
  fisNo: string;
  tarih: Date;
  aciklama: string;
  fisTipi: 'mahsup' | 'tahsil' | 'tediye' | 'acilis' | 'kapanis' | 'diger';
  hareketler: IEntryLine[];
  toplamBorc: number;
  toplamAlacak: number;
  kullaniciId: string | null;
  kaynakEntegrasyon: string | null; // Hangi fatura programından geldiği
  kaynakBelgeNo: string | null; // Fatura numarası vb.
  durum: 'taslak' | 'onaylandi' | 'iptal';
  createdAt: Date;
  updatedAt: Date;
}

const EntryLineSchema = new Schema<IEntryLine>(
  {
    hareketId: {
      type: String,
      required: true,
    },
    hesapKodu: {
      type: String,
      required: [true, 'Hesap kodu zorunludur'],
      index: true,
    },
    hesapAdi: {
      type: String,
    },
    tutar: {
      type: Number,
      required: [true, 'Tutar zorunludur'],
      min: [0, 'Tutar negatif olamaz'],
    },
    yon: {
      type: Number,
      required: true,
      enum: [1, -1], // 1 = borç, -1 = alacak
    },
    dovizKodu: {
      type: String,
      default: 'TRY',
    },
    dovizTutar: {
      type: Number,
      default: null,
    },
    dovizKur: {
      type: Number,
      default: null,
    },
    aciklama: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const JournalEntrySchema = new Schema<IJournalEntry>(
  {
    fisNo: {
      type: String,
      required: [true, 'Fiş numarası zorunludur'],
      unique: true,
      index: true,
    },
    tarih: {
      type: Date,
      required: [true, 'Tarih zorunludur'],
      index: true,
    },
    aciklama: {
      type: String,
      required: [true, 'Açıklama zorunludur'],
    },
    fisTipi: {
      type: String,
      enum: ['mahsup', 'tahsil', 'tediye', 'acilis', 'kapanis', 'diger'],
      default: 'mahsup',
    },
    hareketler: {
      type: [EntryLineSchema],
      validate: {
        validator: function (lines: IEntryLine[]) {
          return lines.length >= 2;
        },
        message: 'Bir fişte en az 2 hareket satırı olmalıdır',
      },
    },
    toplamBorc: {
      type: Number,
      default: 0,
    },
    toplamAlacak: {
      type: Number,
      default: 0,
    },
    kullaniciId: {
      type: String,
      default: null,
    },
    kaynakEntegrasyon: {
      type: String,
      default: null,
      index: true,
    },
    kaynakBelgeNo: {
      type: String,
      default: null,
    },
    durum: {
      type: String,
      enum: ['taslak', 'onaylandi', 'iptal'],
      default: 'taslak',
    },
  },
  {
    timestamps: true,
    collection: 'journal_entries',
  }
);

// Borç-alacak toplamlarını otomatik hesapla
JournalEntrySchema.pre('save', function (next) {
  const lines = this.hareketler;
  this.toplamBorc = lines
    .filter((l) => l.yon === 1)
    .reduce((sum, l) => sum + l.tutar, 0);
  this.toplamAlacak = lines
    .filter((l) => l.yon === -1)
    .reduce((sum, l) => sum + l.tutar, 0);
  next();
});

export const JournalEntryModel = mongoose.model<IJournalEntry>(
  'JournalEntry',
  JournalEntrySchema
);
