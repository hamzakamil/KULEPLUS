import { Router, type Request, type Response, type NextFunction } from 'express';
import { IdentityService } from './service.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  verifyTwoFactorSchema,
  disableTwoFactorSchema,
} from './schemas.js';
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

/** Refresh çerezi: rememberMe=false ise maxAge yok → oturum çerezi (tarayıcı kapanınca silinir) */
function refreshCookieOptions(maxAgeMs: number | undefined) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
    path: '/api/v1/auth/refresh',
  };
}

/** Giriş */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await service.login(
      input.email,
      input.password,
      input.totpCode,
      undefined,
      undefined,
      input.rememberMe,
    );

    res.cookie(
      'refreshToken',
      result.refreshToken,
      refreshCookieOptions(result.refreshCookieMaxAgeMs),
    );

    res.json({
      accessToken: result.accessToken,
      user: result.user,
      tenantId: result.tenantId,
      rememberMe: input.rememberMe,
    });
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

    res.cookie(
      'refreshToken',
      result.refreshToken,
      refreshCookieOptions(result.refreshCookieMaxAgeMs),
    );

    res.json({ accessToken: result.accessToken });
  } catch (error) {
    next(error);
  }
});

/** Çıkış */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) await service.logout(refreshToken);

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

/** Parola değiştir (oturumlu kullanıcı) — JWT zorunludur (P0: req.user yoksa 401). */
router.post(
  '/password/change',
  authenticate,
  validate(changePasswordSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      await service.changePassword(userId, currentPassword, newPassword);
      res.json({ message: 'Parola başarıyla değiştirildi. Tekrar giriş yapmanız gerekebilir.' });
    } catch (error) {
      next(error);
    }
  },
);

/** 2FA kurulum — JWT zorunludur. */
router.post(
  '/2fa/setup',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await service.setupTwoFactor(userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** 2FA onayla ve etkinleştir — JWT zorunludur. Yedek kodlar YALNIZCA burada döner. */
router.post(
  '/2fa/verify',
  authenticate,
  validate(verifyTwoFactorSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const backupCodes = await service.verifyAndEnableTwoFactor(userId, req.body.totpCode);
      res.json({ message: '2FA başarıyla etkinleştirildi', backupCodes });
    } catch (error) {
      next(error);
    }
  },
);

/** 2FA devre dışı bırak — JWT zorunludur. */
router.post(
  '/2fa/disable',
  authenticate,
  validate(disableTwoFactorSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const { password, totpCode, backupCode } = disableTwoFactorSchema.parse(req.body);
      await service.disableTwoFactor(userId, password, totpCode, backupCode);
      res.json({ message: '2FA başarıyla devre dışı bırakıldı' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
