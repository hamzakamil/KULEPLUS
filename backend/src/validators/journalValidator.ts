import Joi from 'joi';

const entryLineSchema = Joi.object({
  hareketId: Joi.string().optional(),
  hesapKodu: Joi.string().required().messages({
    'any.required': 'Hesap kodu zorunludur',
  }),
  hesapAdi: Joi.string().optional(),
  tutar: Joi.number().positive().required().messages({
    'number.positive': 'Tutar pozitif olmalıdır',
    'any.required': 'Tutar zorunludur',
  }),
  yon: Joi.number().valid(1, -1).required().messages({
    'any.only': 'Yön 1 (borç) veya -1 (alacak) olmalıdır',
    'any.required': 'Yön zorunludur',
  }),
  dovizKodu: Joi.string().default('TRY'),
  dovizTutar: Joi.number().optional().allow(null),
  dovizKur: Joi.number().optional().allow(null),
  aciklama: Joi.string().optional().allow(null, ''),
});

export const createJournalEntrySchema = Joi.object({
  fisNo: Joi.string().optional(), // Otomatik atanabilir
  tarih: Joi.date().required().messages({
    'any.required': 'Tarih zorunludur',
  }),
  aciklama: Joi.string().required().min(3).messages({
    'any.required': 'Açıklama zorunludur',
  }),
  fisTipi: Joi.string()
    .valid('mahsup', 'tahsil', 'tediye', 'acilis', 'kapanis', 'diger')
    .default('mahsup'),
  hareketler: Joi.array().items(entryLineSchema).min(2).required().messages({
    'array.min': 'En az 2 hareket satırı girilmelidir',
    'any.required': 'Hareket satırları zorunludur',
  }),
  kullaniciId: Joi.string().optional().allow(null),
  kaynakEntegrasyon: Joi.string().optional().allow(null),
  kaynakBelgeNo: Joi.string().optional().allow(null),
  durum: Joi.string().valid('taslak', 'onaylandi').default('taslak'),
});
