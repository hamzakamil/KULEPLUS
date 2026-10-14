import { Router, type Request, type Response, type NextFunction } from 'express';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { OutboxService } from '../outbox/service.js';

/**
 * Public (girişsiz) uçlar — pazarlama sitesinden çağrılır.
 * ROADMAP Faz 2: "İletişim formu → POST /api/v1/public/contact → outbox → e-posta".
 *
 * Kimlik/tenant kapısı YOKTUR; bu yüzden gövde katı biçimde doğrulanır ve
 * HTML çıktısı kaçışlanır (XSS/enjeksiyon önlemi).
 */
const router = Router();
const outbox = new OutboxService();

/** Sürüm bilgisi — kök package.json'dan bir kez okunur (SPEC §22 public status). */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Sağlık/durum ucu — SPEC §22: kimlik gerektirmez; `{status, uptime, version}` döner.
 * Pazarlama sitesi ve izleme için kamu bilgisi (sürüm + ayakta kalma süresi).
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: readVersion(),
  });
});

export const contactRequestSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  subject: z.string().max(200).optional(),
  message: z.string().min(10).max(5000),
  kvkkConsent: z.literal(true).optional(),
});

/** HTML özel karakterlerini kaçışlar (kullanıcı girdisi doğrudan HTML'e gömülür). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

router.post(
  '/contact',
  validate(contactRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = contactRequestSchema.parse(req.body);
      const support = process.env.SUPPORT_EMAIL ?? 'destek@kuleplus.com.tr';
      await outbox.enqueue({
        to: support,
        subject: input.subject ? `İletişim formu: ${input.subject}` : 'İletişim formu mesajı',
        html:
          `<p><b>Ad Soyad:</b> ${escapeHtml(input.name)}</p>` +
          `<p><b>E-posta:</b> ${escapeHtml(input.email)}</p>` +
          `<p><b>Konu:</b> ${escapeHtml(input.subject ?? '-')}</p>` +
          `<p>${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`,
        text: `Ad Soyad: ${input.name}\nE-posta: ${input.email}\nKonu: ${input.subject ?? '-'}\n\n${input.message}`,
      });
      res.status(202).json({ message: 'Mesajınız alındı. En kısa sürede dönüş yapacağız.' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
