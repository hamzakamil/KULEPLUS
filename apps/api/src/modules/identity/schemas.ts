import { z } from 'zod';

/** Kayıt isteği */
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Geçersiz e-posta'),
  // 8 karakter: e-posta + parola ile şirket defteri tutulan bir üründe 6 karakter
  // OWASP tabanının altında kalır (ADR-0023). Giriş tarafı `min(1)` kalır —
  // eski/uzun parolalar reddedilmez.
  password: z
    .string()
    .min(8, 'Parola en az 8 karakter olmalıdır')
    .max(128, 'Parola en fazla 128 karakter olmalıdır'),
  name: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalıdır').max(100),
  companyName: z.string().trim().min(2).max(200).optional(),
  startingModule: z.enum(['contacts', 'stock']).optional(),
  // KVKK aydınlatma kabulü zorunludur (ADR-0011, SPEC §27.2)
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'KVKK aydınlatma metni kabul edilmelidir' }),
  }),
});

/**
 * Google ile giriş isteği (ADR-0023).
 *
 * `credential`, Google Identity Services butonunun ürettiği ID token'dır (JWT).
 * Uzunluk alt sınırı rastgele metni elemek içindir; asıl denetim (imza + `aud` +
 * `email_verified`) `google.ts` içinde yapılır.
 */
export const googleLoginSchema = z.object({
  credential: z.string().min(20, 'Google kimlik belirteci geçersiz'),
  rememberMe: z.boolean().optional().default(true),
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

/** Şifre sıfırlama onayı — alt sınır kayıtla aynı (8): Google ile açılan hesabın parolası yalnızca bu akışla doğar (ADR-0023). */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  password: z
    .string()
    .min(8, 'Parola en az 8 karakter olmalıdır')
    .max(128, 'Parola en fazla 128 karakter olmalıdır'),
});

/** Parola değiştirme (oturumlu kullanıcı) */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut parola gerekli'),
  newPassword: z
    .string()
    .min(8, 'Yeni parola en az 8 karakter olmalıdır')
    .max(128, 'Yeni parola en fazla 128 karakter olmalıdır'),
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
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
