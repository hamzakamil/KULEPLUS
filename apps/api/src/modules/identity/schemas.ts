import { z } from 'zod';

/** Kayıt isteği */
export const registerSchema = z.object({
  email: z.string().email('Geçersiz e-posta'),
  password: z.string().min(12, 'Parola en az 12 karakter').max(128),
  name: z.string().min(2).max(100),
  companyName: z.string().min(2).max(200).optional(),
  startingModule: z.enum(['contacts', 'stock']).optional(),
  // KVKK aydınlatma kabulü zorunludur (ADR-0011, SPEC §27.2)
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'KVKK aydınlatma metni kabul edilmelidir' }),
  }),
});

/** Giriş isteği */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().length(6).optional(), // 2FA kodu
  // Beni hatırla: false ise oturum çerezi (tarayıcı kapanınca silinir) + kısa sunucu oturumu
  rememberMe: z.boolean().optional().default(true),
});

/** Şifre sıfırlama talebi */
export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

/** Şifre sıfırlama onayı */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12).max(128),
});

/** Parola değiştirme (oturumlu kullanıcı) */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut parola gerekli'),
  newPassword: z.string().min(12, 'Yeni parola en az 12 karakter').max(128),
});

/** 2FA kurulum yanıtı */
export const twoFactorSetupSchema = z.object({
  secret: z.string(),
  qrCode: z.string(), // base64 PNG
  backupCodes: z.array(z.string().length(8)),
});

/** 2FA doğrulama */
export const verifyTwoFactorSchema = z.object({
  totpCode: z.string().length(6),
  backupCode: z.string().length(8).optional(),
});

/** 2FA devre dışı bırakma */
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1),
  totpCode: z.string().length(6).optional(),
  backupCode: z.string().length(8).optional(),
});

/** Token yenileme (refresh token body'de gelmez; cookie'den okunur) */
export const refreshSchema = z.object({});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
