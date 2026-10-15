import { Router, type Request, type Response, type NextFunction } from 'express';
import { IdentityService } from './service.js';
import { isGoogleLoginEnabled } from './google.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { loadPermissionGrants } from '../../middleware/permission-grants.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  changePasswordSchema,
  verifyTwoFactorSchema,
  disableTwoFactorSchema,
} from './schemas.js';
import { AppError, PERMISSIONS } from '@kuleplus/shared';

const router = Router();
const service = new IdentityService();

/**
 * Kayıt ve sosyal giriş için pencere (ADR-0023).
 *
 * Neden yalnızca bunlar? Her başarılı KAYIT bir şirket (tenant) doğurur ve bu
 * uçlar kimlik doğrulamasızdır → bot ile toplu tenant üretimi riski. Parola
 * girişinde ise hesap kilidi (5 deneme / 15 dk) zaten brute-force'u sınırlar;
 * oraya ek limit koyup meşru çoklu oturumları (Playwright, ekip) reddetmek
 * istemeyiz. Sayaç süreç içidir — bkz. `middleware/rate-limit.ts`.
 */
const signupRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: 'auth.register' });
const googleRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, key: 'auth.google' });

/**
 * Kayıt (self-servis) — kullanıcı + şirket TEK transaction'da açılır, oturum
 * hemen verilir (ADR-0023). Karşılama e-postası kuyruğa yazılır; e-posta
 * doğrulama bağlantısı gönderilmez, bu yüzden mesaj da buna göre düzeltildi.
 */
router.post(
  '/register',
  signupRateLimit,
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = registerSchema.parse(req.body);
      // DİKKAT: spread YOK — `...input` strictNullChecks kapalı derlemede
      // (Vercel build) Zod'un optional-infer ettiği alanları taşıyıp TS2345
      // üretir. `parse` çıktısı verilir (zaten validasyonlu), üstüne
      // ipAddress/userAgent eklenir; runtime değeri değişmez.
      const { session } = await service.register({
        email: input.email,
        password: input.password,
        name: input.name,
        companyName: input.companyName,
        startingModule: input.startingModule,
        acceptTerms: input.acceptTerms,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.cookie(
        'refreshToken',
        session.refreshToken,
        refreshCookieOptions(session.refreshCookieMaxAgeMs),
      );

      res.status(201).json({
        message: 'Kayıt başarılı. Çalışma alanınız hazır.',
        accessToken: session.accessToken,
        user: session.user,
        tenantId: session.tenantId,
      });
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

/**
 * Google ile giriş yapılandırması (public) — ADR-0023.
 *
 * Frontend butonu YALNIZCA burada `enabled: true` görürse render eder; böylece
 * `GOOGLE_CLIENT_ID` tanımlı olmayan kurulumlarda (yerel geliştirme, CI) ölü bir
 * buton görünmez. `clientId` zaten public bir değerdir (tarayıcıya iner).
 */
router.get('/google/config', (_req: Request, res: Response) => {
  const enabled = isGoogleLoginEnabled();
  res.json({ enabled, clientId: enabled ? process.env.GOOGLE_CLIENT_ID : null });
});

/**
 * Google ile giriş — Google Identity Services butonunun ürettiği ID token doğrulanır
 * ve parola girişiyle BİREBİR aynı oturum kurulur (ADR-0023).
 *
 * İlk kez gelen Google hesabı yeni bir kullanıcı + şirket doğurur; yanıtta
 * `isNewUser: true` döner ki frontend "çalışma alanınız hazır" mesajını gösterebilsin.
 */
router.post(
  '/google',
  googleRateLimit,
  validate(googleLoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = googleLoginSchema.parse(req.body);
      const { session, isNewUser } = await service.loginWithGoogle(input.credential, {
        rememberMe: input.rememberMe,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      res.cookie(
        'refreshToken',
        session.refreshToken,
        refreshCookieOptions(session.refreshCookieMaxAgeMs),
      );

      res.json({
        accessToken: session.accessToken,
        user: session.user,
        tenantId: session.tenantId,
        isNewUser,
      });
    } catch (error) {
      next(error);
    }
  },
);

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

/**
 * Oturum sahibi — rol ve efektif izinler (frontend yetki kapısı için).
 *
 * Neden gerekli? JWT yalnızca `sub/email/tenantId` taşır; frontend'de "bu kullanıcı
 * yönetici mi?" sorusunu cevaplayacak hiçbir sinyaldi yoktu (rol yok). Bu uç,
 * `requirePermission` ile BİREBİR aynı çözümlemeyi kullanır (`permission-grants.ts`),
 * böylece frontend'de gizlenen menü ile backend'in verdiği 403 birbirini tutar.
 *
 * Owner (`is_owner`) → kataloğun tamamı yetkili sayılır (SPEC §6.6).
 * Yetki YALNIZCA burada bildirilir; asıl koruma her endpoint'te `requirePermission`.
 */
router.get(
  '/me',
  authenticate,
  tenantContext,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as TenantRequest;
      const grants = await loadPermissionGrants(authReq.tenantId, authReq.user?.sub, {
        withRoles: true,
      });
      const permissions = grants.isOwner
        ? PERMISSIONS.map((p) => p.code)
        : [...grants.codes].sort();

      res.json({
        user: { id: authReq.user?.sub, email: authReq.user?.email },
        tenantId: authReq.tenantId,
        isOwner: grants.isOwner,
        roles: grants.roles,
        permissions,
      });
    } catch (error) {
      next(error);
    }
  },
);

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
