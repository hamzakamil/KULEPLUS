import Joi from 'joi';

export const createAccountSchema = Joi.object({
  hesapKodu: Joi.string()
    .required()
    .pattern(/^[1-9]\d{2,}$/)
    .messages({
      'string.pattern.base': 'Hesap kodu en az 3 haneli ve 1-9 ile başlamalıdır',
      'any.required': 'Hesap kodu zorunludur',
    }),
  hesapAdi: Joi.string().required().min(2).max(200).messages({
    'any.required': 'Hesap adı zorunludur',
  }),
  normalBakiye: Joi.number().valid(1, -1).optional(),
  duzenleyiciHesapMi: Joi.boolean().optional(),
  duzenleyiciHesapTuru: Joi.string()
    .valid('aktif_duzenleyici', 'pasif_duzenleyici', null)
    .optional(),
  ilgiliHesapKodu: Joi.string().optional().allow(null),
  dovizKodu: Joi.string().default('TRY').max(5),
  miktarBirimi: Joi.string().optional().allow(null),
  onMuhasebeBaglantiKodu: Joi.string().optional().allow(null),
  ozelKod: Joi.string().optional().allow(null),
  aktif: Joi.boolean().default(true),
});

export const updateAccountSchema = Joi.object({
  hesapAdi: Joi.string().min(2).max(200).optional(),
  duzenleyiciHesapMi: Joi.boolean().optional(),
  duzenleyiciHesapTuru: Joi.string()
    .valid('aktif_duzenleyici', 'pasif_duzenleyici', null)
    .optional(),
  ilgiliHesapKodu: Joi.string().optional().allow(null),
  dovizKodu: Joi.string().max(5).optional(),
  miktarBirimi: Joi.string().optional().allow(null),
  onMuhasebeBaglantiKodu: Joi.string().optional().allow(null),
  ozelKod: Joi.string().optional().allow(null),
  aktif: Joi.boolean().optional(),
});
