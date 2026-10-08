import { Router, type Request, type Response, type NextFunction } from 'express';
import { IdentityService } from './service.js';
import { validate } from '../../middleware/validate.js';
import { registerSchema } from './schemas.js';
import { loginSchema } from './schemas.js';
import { AppError } from '@kuleplus/shared';

const router = Router();
const service = new IdentityService();

/** Kayıt */
router.post(
  '/register',
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = registerSchema.parse(req.body);
      const result = await service.register({
        ...input,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res
        .status(201)
        .json({ message: 'Kayıt başarılı. E-posta doğrulama bağlantısı gönderildi.', ...result });
    } catch (error) {
      next(error);
    }
  },
);

/** Giriş */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await service.login(input.email, input.password, input.totpCode);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    res.json({ accessToken: result.accessToken, user: result.user, tenantId: result.tenantId });
  } catch (error) {
    next(error);
  }
});

/** Token yenileme */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) throw new AppError('UNAUTHENTICATED', 'Refresh token eksik');

    const result = await service.refresh(refreshToken);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    res.json({ accessToken: result.accessToken });
  } catch (error) {
    next(error);
  }
});

/** Çıkış */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) await service.logout(refreshToken);

    res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
    res.json({ message: 'Başarıyla çıkış yapıldı' });
  } catch (error) {
    next(error);
  }
});

/** Şifre sıfırlama talebi */
router.post('/password/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = await service.requestPasswordReset(req.body.email);
    if (!token) {
      res.json({
        message: 'E-posta adresiniz kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir.',
      });
      return;
    }
    // Development: token'ı döndür, prod'da outbox ile e-posta gönder
    if (process.env.NODE_ENV !== 'production') {
      res.json({ message: 'Şifre sıfırlama bağlantısı oluşturuldu.', token });
      return;
    }
    res.json({
      message: 'E-posta adresiniz kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir.',
    });
  } catch (error) {
    next(error);
  }
});

/** Şifre sıfırlama onayla */
router.post('/password/reset/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await service.confirmPasswordReset(req.body.token, req.body.password);
    res.json({ message: 'Parola başarıyla güncellendi. Lütfen tekrar giriş yapın.' });
  } catch (error) {
    next(error);
  }
});

/** Parola değiştir (oturumlu kullanıcı) */
router.post('/password/change', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) throw new Error('Kimlik doğrulanmamış');
    await service.changePassword(userId, currentPassword, newPassword);
    res.json({ message: 'Parola başarıyla değiştirildi. Tekrar giriş yapmanız gerekebilir.' });
  } catch (error) {
    next(error);
  }
});

/** 2FA kurulum */
router.post('/2fa/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) throw new Error('Kimlik doğrulanmamış');
    const result = await service.setupTwoFactor(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** 2FA onayla ve etkinleştir */
router.post('/2fa/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) throw new Error('Kimlik doğrulanmamış');
    const backupCodes = await service.verifyAndEnableTwoFactor(userId, req.body.totpCode);
    res.json({ message: '2FA başarıyla etkinleştirildi', backupCodes });
  } catch (error) {
    next(error);
  }
});

/** 2FA devre dışı bırak */
router.post('/2fa/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) throw new Error('Kimlik doğrulanmamış');
    await service.disableTwoFactor(
      userId,
      req.body.password,
      req.body.totpCode,
      req.body.backupCode,
    );
    res.json({ message: '2FA başarıyla devre dışı bırakıldı' });
  } catch (error) {
    next(error);
  }
});

export default router;
