import { z } from 'zod';

/** Yedek ayarlarını güncelleme isteği. Hepsi opsiyoneldir (kısmi güncelleme). */
export const updateBackupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z
    .number()
    .int('Sıklık tam sayı olmalıdır')
    .min(1, 'En az 1 dakika')
    .max(1440, 'En fazla 1440 dakika (24 saat)')
    .optional(),
  retentionCount: z
    .number()
    .int('Saklama adedi tam sayı olmalıdır')
    .min(1, 'En az 1 yedek saklanmalıdır')
    .max(100, 'En fazla 100 yedek saklanabilir')
    .optional(),
});

/** `validate(..., 'params')` ile kullanılır. */
export const backupParamsSchema = z.object({
  id: z.string().uuid('Geçerli bir yedek ID giriniz'),
});

export type UpdateBackupSettingsInput = z.infer<typeof updateBackupSettingsSchema>;
export type BackupParams = z.infer<typeof backupParamsSchema>;

