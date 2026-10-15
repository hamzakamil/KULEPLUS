import { randomBytes, createHash, randomUUID } from 'node:crypto';
import argon2 from '@node-rs/argon2';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { appUrl, queueEmailTemplate } from '../../services/email-templates.js';
import {
  createGoogleCredentialVerifier,
  type GoogleCredentialVerifier,
  type GoogleClaims,
} from './google.js';

/** JWT secret'ler */
const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
const REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET!);

/** Token süreleri */
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
/** "Beni hatırla" kapalıysa sunucu oturumu bu kadar yaşar (çerez de oturum çerezi olur) */
const SHORT_SESSION_EXPIRY_DAYS = 1;

/** Argon2id parametreleri (OWASP önerisi) */
const ARGON2_CONFIG = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Kilitleme eşikleri */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export type UserRow = {
  id: string;
  email: string;
  /**
   * Google ile açılmış hesaplarda NULL (ADR-0023) — parola girişi bu hesaplarda
   * yapılamaz, kullanıcı "Şifremi unuttum" ile parola edinebilir.
   */
  password_hash: string | null;
  /** Kayıt formunda veya Google profilinde gelen ad (ADR-0023). */
  display_name: string | null;
  email_verified_at: Date | null;
  password_changed_at: Date;
  failed_login_attempts: number;
  locked_until: Date | null;
  totp_secret: string | null;
  recovery_codes: string[];
  status: string;
  created_at: Date;
  updated_at: Date;
  version: number;
};

/**
 * Oturum kurmak için gereken asgari kullanıcı alanları (ADR-0023).
 *
 * Giriş/yenileme yolunda tam satır çekmek yerine bu demet taşınır; `status` ve
 * `totp_secret` oturum kapıları için zorunludur.
 */
export type SessionUser = Pick<UserRow, 'id' | 'email' | 'display_name' | 'totp_secret' | 'status'>;

/**
 * Oturum sözleşmesi — parola ile giriş, kendi kendine kayıt ve Google girişi
 * BİREBİR aynı çıktıyı üretir (ADR-0023). Rotanın çerez kuralları da tek yerde.
 */
export type LoginSession = {
  accessToken: string;
  refreshToken: string;
  /** Refresh çerezi için max-age (ms). rememberMe=false ise undefined → oturum çerezi */
  refreshCookieMaxAgeMs: number | undefined;
  user: { id: string; email: string; name: string; totpEnabled: boolean };
  tenantId: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
};

export type TenantRow = {
  id: string;
  name: string;
  trade_name: string | null;
  tax_office: string | null;
  tax_number: string | null;
  currency: string;
  fiscal_year_start: number;
  timezone: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  version: number;
};

export class IdentityService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  /** Parola hash'ler (Argon2id) */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_CONFIG);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /** Tenant'ın güncel yetki sürümü (SPEC §6.4). */
  async getTenantAuthVersion(tenantId: string): Promise<number> {
    const result = await this.getPoolInstance().query<{ auth_version: number }>(
      `SELECT auth_version FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return result.rows[0]?.auth_version ?? 1;
  }

  /**
   * Yetki sürümünü artır — rol/izin/üyelik değişikliğinde çağrılır (SPEC §6.4).
   * Mevcut tüm access token'lar bu tenant için geçersiz olur; kullanıcı yeniden giriş yapar.
   */
  async bumpTenantAuthVersion(tenantId: string): Promise<number> {
    const result = await this.getPoolInstance().query<{ auth_version: number }>(
      `UPDATE tenants SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1 RETURNING auth_version`,
      [tenantId],
    );
    return result.rows[0]?.auth_version ?? 1;
  }

  /** JWT access token üret */
  async generateAccessToken(payload: JWTPayload): Promise<string> {
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXPIRY)
      .sign(ACCESS_SECRET);
  }

  /** JWT refresh token üret */
  async generateRefreshToken(userId: string): Promise<string> {
    const jti = randomUUID();
    return new SignJWT({ sub: userId, jti, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_EXPIRY_DAYS}d`)
      .sign(REFRESH_SECRET);
  }

  /** Access token doğrula */
  async verifyAccessToken(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, ACCESS_SECRET);
      return payload;
    } catch {
      return null;
    }
  }

  /** Refresh token doğrula ve payload döndür */
  async verifyRefreshToken(token: string): Promise<{ sub: string; jti: string } | null> {
    try {
      const { payload } = await jwtVerify(token, REFRESH_SECRET);
      if (payload.type !== 'refresh') return null;
      return { sub: payload.sub as string, jti: payload.jti as string };
    } catch {
      return null;
    }
  }

  /** Refresh token hash'le (DB'de saklamak için) */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Kendi kendine kayıt (self-servis) — ADR-0023.
   *
   * Kullanıcı, şirketi (tenant) ve owner üyeliği TEK transaction'da doğar; şirket
   * `active` açılır ve oturum hemen verilir. Onay kuyruğu YOK (ürün kararı) —
   * `company_applications` akışı yalnızca platformun işlediği özel başvurular içindir.
   *
   * Oturum commit SONRASI açılır: rollback olan bir hesap için geçerli token üretilmez.
   */
  async register(input: {
    email: string;
    password: string;
    name: string;
    companyName?: string;
    startingModule?: 'contacts' | 'stock';
    acceptTerms?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ userId: string; tenantId: string; session: LoginSession }> {
    const email = input.email.toLowerCase();
    const displayName = input.name.trim();
    const tenantName = input.companyName?.trim() || displayName;
    const passwordHash = await this.hashPassword(input.password);

    const { userId, tenantId } = await this.persistSignup({
      email,
      displayName,
      tenantName,
      passwordHash,
      startingModule: input.startingModule,
      acceptTerms: input.acceptTerms,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    // Oturum, kayıtta üretilen kullanıcıyla kurulur — kullanıcı az önce yazıldı,
    // yeniden okumaya gerek yok (2FA yeni hesapta yoktur).
    const session = await this.issueSessionForUser(
      {
        id: userId,
        email,
        display_name: displayName,
        totp_secret: null,
        status: 'active',
      },
      {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    );

    return { userId, tenantId, session };
  }

  /**
   * Kaydın yazım kısmı: kullanıcı + şirket + KVKK kabulü tek transaction'da.
   * Oturum token üretimi bilinçli olarak DIŞARIDA (bkz. `register`).
   */
  private async persistSignup(input: {
    email: string;
    displayName: string;
    tenantName: string;
    passwordHash: string;
    startingModule?: 'contacts' | 'stock';
    acceptTerms?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ userId: string; tenantId: string }> {
    const now = new Date();
    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      // Kullanıcı oluştur
      const userId = newId();
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, password_changed_at, status, created_at, updated_at, version)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, 1)`,
        [userId, input.email, input.passwordHash, input.displayName, now, now],
      );

      // Şirket + owner üyeliği + ücretsiz yetkiler + varsayılan ayarlar
      const tenantId = await this.bootstrapTenant(client, {
        userId,
        email: input.email,
        displayName: input.displayName,
        tenantName: input.tenantName,
        startingModule: input.startingModule,
        now,
      });

      // KVKK aydınlatma kabulü kaydı — user bazlı, global (ADR-0011, SPEC §27.2)
      if (input.acceptTerms) {
        await client.query(
          `INSERT INTO legal_acceptances (id, user_id, legal_text_id, accepted_at, ip_address, user_agent)
           SELECT $1, $2, lt.id, $3, $4, $5
           FROM legal_texts lt
           WHERE lt.code = 'kvkk' AND lt.effective_until IS NULL
           ORDER BY lt.effective_from DESC
           LIMIT 1
           ON CONFLICT (user_id, legal_text_id) DO NOTHING`,
          [newId(), userId, now, input.ipAddress ?? null, input.userAgent ?? null],
        );
      }

      await client.query('COMMIT');
      return { userId, tenantId };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message.includes('users_email_unique')) {
        throw new AppError('CONFLICT', 'Bu e-posta adresi zaten kayıtlı');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Şirketin doğum anı (ADR-0023): tenant + owner üyeliği + ücretsiz çekirdek
   * yetkileri + varsayılan `tenant_settings` + karşılama e-postası.
   *
   * Neden ortak metot? Kendi kendine kayıt ve sosyal giriş, platform onayının
   * (`company/service.ts` → `processApplication`) tohumlamasıyla aynı şemayı
   * üretmeli. Eski `register()` `tenant_settings` yazmıyordu; kendi kendine açılan
   * hesaplarda Ayarlar ekranı eksik anahtarlarla doğuyordu.
   *
   * Şirket `active` açılır (self-servis ürün kararı). E-posta, iş transaction'ı
   * içinde yalnızca `email_outbox` satırı olarak yazılır (SPEC §19.1); gönderim
   * worker'dadır — outbox yazılamazsa kayıt da rollback olur.
   */
  private async bootstrapTenant(
    client: PoolClient,
    opts: {
      userId: string;
      email: string;
      displayName?: string | null;
      tenantName: string;
      startingModule?: 'contacts' | 'stock';
      now: Date;
    },
  ): Promise<string> {
    const tenantId = newId();

    await client.query(
      `INSERT INTO tenants (id, name, status, created_at, updated_at, version)
       VALUES ($1, $2, 'active', $3, $3, 1)`,
      [tenantId, opts.tenantName, opts.now],
    );

    // Kaydı yapan kişi şirketin sahibidir (SPEC §6.6 — owner tüm izinlere sahiptir)
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, is_owner, created_at)
       VALUES ($1, $2, true, $3)`,
      [tenantId, opts.userId, opts.now],
    );

    // Ücretsiz çekirdek herkes için (SPEC §6.5); seçilen başlangıç modülü de eklenir
    const moduleCodes = ['core', ...(opts.startingModule ? [opts.startingModule] : [])];
    for (const moduleCode of moduleCodes) {
      await client.query(
        `INSERT INTO tenant_entitlements (tenant_id, module_code, status, granted_at)
         VALUES ($1, $2, 'active', $3)
         ON CONFLICT (tenant_id, module_code) DO NOTHING`,
        [tenantId, moduleCode, opts.now],
      );
    }

    // Onay akışının tohumladığı varsayılan ayarlar — eksikleri Ayarlar'ı bozar
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, locked, updated_at)
       VALUES ($1, 'onboarding_mode', '"manual"'::jsonb, true, $2)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, opts.now],
    );
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, locked, updated_at)
       VALUES ($1, 'company_profile', '{}'::jsonb, false, $2)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, opts.now],
    );

    await queueEmailTemplate(
      'core.welcome',
      opts.email,
      {
        user_name: opts.displayName || opts.email.split('@')[0] || '',
        tenant_name: opts.tenantName,
        checklist_url: `${appUrl()}/settings?group=company`,
      },
      client,
    );

    return tenantId;
  }

  /**
   * Yeni access token üretir — şirket seçici (Faz 2) tenant bağlamı değişince
   * istemci eski token'ı kullanamaz; SPEC §6.4 auth_version bu token'a gömülür.
   */
  async issueAccessTokenForTenant(userId: string, tenantId: string): Promise<string> {
    const user = await this.getUserById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı');
    const authVersion = await this.getTenantAuthVersion(tenantId);
    return this.generateAccessToken({ sub: user.id, email: user.email, tenantId, authVersion });
  }

  /** Giriş */
  async login(
    email: string,
    password: string,
    totpCode?: string,
    userAgent?: string,
    ipAddress?: string,
    rememberMe = true,
  ): Promise<LoginSession> {
    const user = await this.getUserByEmail(email.toLowerCase());
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Geçersiz e-posta veya parola');
    }

    // Hesap kilitli mi?
    if (user.locked_until && user.locked_until > new Date()) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Hesap geçici olarak kilitli. Daha sonra tekrar deneyin.',
      );
    }

    // Parola taşımayan hesap (yalnızca Google ile açılmış — ADR-0023): argon2
    // doğrulaması yapılamaz; kullanıcı "Şifremi unuttum" akışıyla parola edinebilir.
    if (!user.password_hash) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Bu hesap Google ile oluşturulmuş. Parola belirlemek için "Şifremi unuttum" bağlantısını kullanın.',
      );
    }

    // Parola doğrula
    const valid = await this.verifyPassword(password, user.password_hash);
    if (!valid) {
      await this.incrementFailedLogin(user.id);
      throw new AppError('UNAUTHENTICATED', 'Geçersiz e-posta veya parola');
    }

    // 2FA kontrolü
    if (user.totp_secret) {
      if (!totpCode) {
        throw new AppError('UNAUTHENTICATED', 'İki faktörlü doğrulama kodu gerekli');
      }
      // TOTP doğrulama (otplib ile)
      const { authenticator } = await import('otplib');
      const isValid = authenticator.check(totpCode, user.totp_secret);
      if (!isValid) {
        await this.incrementFailedLogin(user.id);
        throw new AppError('UNAUTHENTICATED', 'Geçersiz 2FA kodu');
      }
    }

    // Başarılı giriş - failed attempts sıfırla
    await this.resetFailedLogin(user.id);

    return this.issueSessionForUser(user, { rememberMe, userAgent, ipAddress });
  }

  /**
   * Oturum sözleşmesi (ADR-0023): tenant'ı çözer, access + refresh üretir ve
   * `user_sessions` satırı yazar.
   *
   * Parola / 2FA / Google doğrulaması BİTTİKTEN sonra çağrılır — parola ile giriş,
   * kendi kendine kayıt ve sosyal giriş BİREBİR aynı oturumu üretir. Tek kapı
   * olmasaydı sosyal giriş, hesabın askıda olup olmadığına bakmayan ayrı bir token
   * üretim yolu kazanırdı.
   *
   * Kullanıcı satırı PARAMETRE olarak alınır: çağıranlar (login/register/google)
   * kullanıcıyı zaten doğrulamıştır; burada yeniden okumak sıcak yolda (her girişte)
   * gereksiz bir sorgu demekti. `status` denetimi yine burada yapılır — hangi yoldan
   * gelirse gelsin askıdaki hesap oturum alamaz.
   */
  async issueSessionForUser(
    user: SessionUser,
    opts: { rememberMe?: boolean; userAgent?: string; ipAddress?: string } = {},
  ): Promise<LoginSession> {
    const rememberMe = opts.rememberMe ?? true;

    // Askıya alınmış / silinmiş hesap oturum alamaz (SPEC §4.5 yaşam döngüsü)
    if (user.status !== 'active') {
      throw new AppError(
        'FORBIDDEN',
        'Hesabınız devre dışı bırakılmış. Lütfen destek ile iletişime geçin.',
      );
    }

    // Kullanıcının tenant'ını bul (owner olduğu tenant)
    const tenantResult = await this.getPoolInstance().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenant_users WHERE user_id = $1 AND is_owner = true LIMIT 1`,
      [user.id],
    );
    if (tenantResult.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Kullanıcının erişimi olan tenant bulunamadı');
    }
    const tenantId = tenantResult.rows[0].tenant_id;

    // Yetki sürümü (SPEC §6.4): token'a gömülür; rol/izin değişince eski token geçersizleşir
    const authVersion = await this.getTenantAuthVersion(tenantId);

    // Token'ları üret
    const accessToken = await this.generateAccessToken({
      sub: user.id,
      email: user.email,
      tenantId,
      authVersion,
    });
    const refreshToken = await this.generateRefreshToken(user.id);

    // Session kaydet ("beni hatırla" kapalıysa kısa ömürlü)
    const sessionDays = rememberMe ? REFRESH_TOKEN_EXPIRY_DAYS : SHORT_SESSION_EXPIRY_DAYS;
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
    await this.getPoolInstance().query(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId(),
        user.id,
        refreshTokenHash,
        opts.userAgent ?? null,
        opts.ipAddress ?? null,
        expiresAt,
      ],
    );

    return {
      accessToken,
      refreshToken,
      refreshCookieMaxAgeMs: rememberMe ? sessionDays * 24 * 60 * 60 * 1000 : undefined,
      user: {
        id: user.id,
        email: user.email,
        // `display_name` ADR-0023 ile eklendi; ondan önce açılan hesaplarda boştur.
        name: user.display_name || user.email.split('@')[0],
        totpEnabled: !!user.totp_secret,
      },
      tenantId,
    };
  }

  /** Token yenileme (rotating refresh token) */
  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    /** Refresh çerezi için max-age (ms). Kısa oturumlarda undefined → oturum çerezi */
    refreshCookieMaxAgeMs: number | undefined;
  }> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new AppError('UNAUTHENTICATED', 'Geçersiz veya süresi dolmuş refresh token');
    }

    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    // Session'ı bul ve geçerli mi kontrol et
    const sessionResult = await this.getPoolInstance().query(
      `SELECT id, user_id, expires_at, created_at, revoked_at FROM user_sessions WHERE refresh_token_hash = $1`,
      [refreshTokenHash],
    );

    if (sessionResult.rows.length === 0) {
      throw new AppError('UNAUTHENTICATED', 'Geçersiz refresh token');
    }

    const session = sessionResult.rows[0];
    if (session.revoked_at || new Date(session.expires_at) < new Date()) {
      throw new AppError('UNAUTHENTICATED', 'Refresh token süresi dolmuş veya iptal edilmiş');
    }

    // Eski session'ı iptal et (rotation)
    await this.getPoolInstance().query(
      `UPDATE user_sessions SET revoked_at = now() WHERE id = $1`,
      [session.id],
    );

    // Oturum karakterini koru: kısa ("beni hatırla" kapalı) oturum refresh ile uzatılamaz
    const sessionDurationMs =
      new Date(session.expires_at).getTime() - new Date(session.created_at).getTime();
    const shortLived = sessionDurationMs <= SHORT_SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    // Yeni token'lar üret
    const tenantResult = await this.getPoolInstance().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenant_users WHERE user_id = $1 AND is_owner = true LIMIT 1`,
      [session.user_id],
    );
    const tenantId = tenantResult.rows[0]?.tenant_id as string | undefined;
    const authVersion = tenantId ? await this.getTenantAuthVersion(tenantId) : undefined;

    const accessToken = await this.generateAccessToken({
      sub: session.user_id,
      tenantId,
      authVersion,
    });
    const newRefreshToken = await this.generateRefreshToken(session.user_id);
    const newRefreshTokenHash = this.hashRefreshToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + sessionDurationMs);

    // Yeni session kaydet
    await this.getPoolInstance().query(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [newId(), session.user_id, newRefreshTokenHash, newExpiresAt],
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      refreshCookieMaxAgeMs: shortLived ? undefined : sessionDurationMs,
    };
  }

  /** Çıkış (tek session) */
  async logout(refreshToken: string): Promise<void> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    await this.getPoolInstance().query(
      `UPDATE user_sessions SET revoked_at = now() WHERE refresh_token_hash = $1`,
      [refreshTokenHash],
    );
  }

  /** Tüm session'ları iptal et */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  /** 2FA kurulum */
  async setupTwoFactor(
    userId: string,
  ): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    const { authenticator } = await import('otplib');
    const secret = authenticator.generateSecret();
    const qrCode = await import('qrcode').then((m) =>
      m.default.toDataURL(authenticator.keyuri(`user_${userId}`, 'Kuleplus', secret)),
    );

    const backupCodes = Array.from({ length: 8 }, () => this.generateRecoveryCode());
    const hashedBackupCodes = backupCodes.map((c) => this.hashRecoveryCode(c));

    await this.getPoolInstance().query(
      `UPDATE users SET totp_secret = $1, recovery_codes = $2, updated_at = now(), version = version + 1 WHERE id = $3`,
      [secret, hashedBackupCodes, userId],
    );

    return { secret, qrCode, backupCodes };
  }

  /** 2FA onayla ve etkinleştir */
  async verifyAndEnableTwoFactor(userId: string, totpCode: string): Promise<string[]> {
    const user = await this.getUserById(userId);
    if (!user || !user.totp_secret) {
      throw new AppError('NOT_FOUND', '2FA kurulumu bulunamadı');
    }

    const { authenticator } = await import('otplib');
    const isValid = authenticator.check(totpCode, user.totp_secret);
    if (!isValid) {
      throw new AppError('UNAUTHENTICATED', 'Geçersiz 2FA kodu');
    }

    // P0 #6: Yedek kodlar düz metin olarak YALNIZCA etkinleştirme anında üretilir ve
    // kullanıcıya BİR KEZ gösterilir. DB'ye yalnızca sha256 hash'leri yazılır; böylece
    // önceki hali (`user.recovery_codes` hash'lerini döndürmek) düz metin sızdırmaz ve
    // kullanıcı gerçekten kaydedebileceği kodları görür.
    const backupCodes = Array.from({ length: 8 }, () => this.generateRecoveryCode());
    const hashedBackupCodes = backupCodes.map((c) => this.hashRecoveryCode(c));
    await this.getPoolInstance().query(
      `UPDATE users SET recovery_codes = $1, updated_at = now(), version = version + 1 WHERE id = $2`,
      [hashedBackupCodes, userId],
    );

    return backupCodes;
  }

  /** 2FA devre dışı bırak */
  async disableTwoFactor(
    userId: string,
    password: string,
    totpCode?: string,
    backupCode?: string,
  ): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı');
    }

    // Parola doğrula — parolasız (Google ile açılmış) hesapta bu deneme anlamsızdır
    if (!user.password_hash) {
      throw new AppError('UNAUTHENTICATED', 'Bu hesapta parola tanımlı değil.');
    }
    const validPassword = await this.verifyPassword(password, user.password_hash);
    if (!validPassword) {
      throw new AppError('UNAUTHENTICATED', 'Geçersiz parola');
    }

    // 2FA kodu veya backup kodu doğrula
    if (user.totp_secret) {
      const { authenticator } = await import('otplib');
      let isValid = false;

      if (totpCode) {
        isValid = authenticator.check(totpCode, user.totp_secret);
      } else if (backupCode && user.recovery_codes) {
        const hashedBackupCode = this.hashRecoveryCode(backupCode);
        const index = user.recovery_codes.indexOf(hashedBackupCode);
        if (index !== -1) {
          isValid = true;
          // Kullanılan backup code'u sil
          await this.removeRecoveryCode(userId, index);
        }
      }

      if (!isValid) {
        throw new AppError('UNAUTHENTICATED', 'Geçersiz 2FA kodu veya yedek kod');
      }
    }

    // 2FA'yı devre dışı bırak
    await this.getPoolInstance().query(
      `UPDATE users SET totp_secret = NULL, recovery_codes = '{}', updated_at = now(), version = version + 1 WHERE id = $1`,
      [userId],
    );
  }

  /**
   * Google ile giriş (ADR-0023) — doğrulanmış ID token'dan oturum.
   *
   * Karar sırası (hesap çoğaltmamak için):
   *   1) `(google, sub)` kayıtlı mı? → aynı kullanıcı. Kimliği e-posta DEĞİL `sub`
   *      taşır; Google tarafında e-posta değişse de aynı hesaba düşer.
   *   2) Kimlik kaydı yok ama Google'ın DOĞRULANMIŞ e-postası mevcut hesapla
   *      eşleşiyor → kimliği o hesaba BAĞLA (ikinci hesap açılmaz).
   *   3) Hiçbiri yok → yeni kullanıcı + şirket (kendi kendine kayıtla aynı tohumlama).
   *
   * Güvenlik: e-posta eşleştirmesi YALNIZCA Google'ın `email_verified = true`
   * dediği claim'lerle yapılır (`mapGoogleClaims`). Aksi halde doğrulanmamış bir
   * e-posta ile başkasının hesabı devralınabilirdi.
   */
  async loginWithGoogle(
    credential: string,
    opts: { rememberMe?: boolean; userAgent?: string; ipAddress?: string } = {},
    verifier: GoogleCredentialVerifier = createGoogleCredentialVerifier(),
  ): Promise<{ session: LoginSession; isNewUser: boolean }> {
    const claims = await verifier.verify(credential);
    const { user, isNewUser } = await this.resolveGoogleIdentity(claims);

    // 2FA açık hesapta Google TEK faktördür: sosyal giriş, kullanıcının bilerek
    // açtığı ikinci faktör kapısını baypas edemez. Kod `login()`'de parola ile
    // birlikte istendiği için burada tek faktörlük kalır → yönlendir.
    if (user.totp_secret) {
      throw new AppError(
        'FORBIDDEN',
        'Bu hesapta iki faktörlü doğrulama açık. Lütfen e-posta + parola ile giriş yapın.',
      );
    }

    // Oturum commit SONRASI kurulur: rollback olan hesap için geçerli token üretilmez.
    // Askıdaki hesap denetimi `issueSessionForUser`'dadır — her yol için tek kapı.
    const session = await this.issueSessionForUser(user, opts);
    return { session, isNewUser };
  }

  /** `loginWithGoogle`'ın yazım kısmı — tek transaction. */
  private async resolveGoogleIdentity(
    claims: GoogleClaims,
  ): Promise<{ user: SessionUser; isNewUser: boolean }> {
    const now = new Date();
    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      // Oturum alanları (status/totp_secret) JOIN ile birlikte okunur: ayrı bir
      // `SELECT users` daha atmak her sosyal girişte fazladan gidiş-dönüş demek.
      const identityResult = await client.query<SessionUser>(
        `SELECT u.id, u.email, u.display_name, u.totp_secret, u.status
           FROM user_identities ui
           JOIN users u ON u.id = ui.user_id
          WHERE ui.provider = 'google' AND ui.provider_account_id = $1`,
        [claims.providerAccountId],
      );

      if (identityResult.rows.length > 0) {
        const user = identityResult.rows[0];
        // Profil alanları değişebilir (isim, fotoğraf, e-posta) — tazele
        await client.query(
          `UPDATE user_identities
              SET email = $1, display_name = $2, avatar_url = $3, updated_at = now()
            WHERE provider = 'google' AND provider_account_id = $4`,
          [claims.email, claims.displayName, claims.avatarUrl, claims.providerAccountId],
        );

        await client.query('COMMIT');
        return { user, isNewUser: false };
      }

      // Kimlik kaydı yok: Google'ın DOĞRULANMIŞ e-postası mevcut bir hesabla
      // eşleşiyorsa kimlik O hesaba bağlanır (ikinci hesap açılmaz).
      const existingUser = await client.query<SessionUser>(
        `SELECT id, email, display_name, totp_secret, status FROM users WHERE email = $1`,
        [claims.email],
      );

      let user: SessionUser;
      let isNewUser = false;

      if (existingUser.rows.length > 0) {
        user = existingUser.rows[0];
      } else {
        const userId = newId();
        isNewUser = true;

        // Parolasız hesap: `password_hash` NULL (ADR-0023 migration'ı bu yüzden gerekli)
        await client.query(
          `INSERT INTO users (id, email, password_hash, display_name, email_verified_at, password_changed_at, status, created_at, updated_at, version)
           VALUES ($1, $2, NULL, $3, $4, $4, 'active', $4, $4, 1)`,
          [userId, claims.email, claims.displayName, now],
        );

        await this.bootstrapTenant(client, {
          userId,
          email: claims.email,
          displayName: claims.displayName,
          // Şirket adı Google profilinden ödünç alınır — sosyal kayıtta şirket adı
          // sorulmaz; kullanıcı Ayarlar → Firma Profilinden değiştirebilir.
          tenantName: claims.displayName || claims.email.split('@')[0],
          now,
        });

        user = {
          id: userId,
          email: claims.email,
          display_name: claims.displayName,
          totp_secret: null,
          status: 'active',
        };
      }

      await client.query(
        `INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, 'google', $3, $4, $5, $6, $7, $7)
         ON CONFLICT (provider, provider_account_id) DO NOTHING`,
        [
          newId(),
          user.id,
          claims.providerAccountId,
          claims.email,
          claims.displayName,
          claims.avatarUrl,
          now,
        ],
      );

      await client.query('COMMIT');
      return { user, isNewUser };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Şifre sıfırlama talebi */
  async requestPasswordReset(email: string): Promise<{ token: string }> {
    const user = await this.getUserByEmail(email.toLowerCase());
    if (!user) {
      return { token: '' };
    }

    const { randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [newId(), user.id, tokenHash, expiresAt],
      );

      // Şifre sıfırlama e-postası — outbox'a transaction içinde (SPEC §19.1, envanter: auth.reset_password).
      await queueEmailTemplate(
        'auth.reset_password',
        user.email,
        {
          user_name: user.email.split('@')[0] ?? '',
          reset_url: `${appUrl()}/reset-password?token=${token}`,
        },
        client,
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { token };
  }

  /** Şifre sıfırlama onayla */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token);

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      // Token'ı bul, kullanılmamış ve süresi dolmamış olmalı
      const tokenResult = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
      }>(
        `SELECT id, user_id, expires_at FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );

      if (tokenResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Geçersiz veya süresi dolmuş şifre sıfırlama bağlantısı');
      }

      const tokenRow = tokenResult.rows[0];

      // Yeni parolayı hash'le ve kullanıcının parolasını güncelle
      const newHash = await this.hashPassword(newPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $1, password_changed_at = now(), updated_at = now(), version = version + 1
         WHERE id = $2`,
        [newHash, tokenRow.user_id],
      );

      // Token'ı kullanıldık olarak işaretle
      await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [
        tokenRow.id,
      ]);

      // Güvenlik: ilgili session'ları iptal et
      await this.revokeAllUserSessions(tokenRow.user_id);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Parola değiştir (oturumlu kullanıcı) */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı');
    }

    // Parolasız hesap (Google ile açılmış) mevcut parola doğrulayamaz — kullanıcı
    // "Şifremi unuttum" akışıyla ilk parolasını belirler (ADR-0023).
    if (!user.password_hash) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Bu hesapta parola tanımlı değil. "Şifremi unuttum" bağlantısıyla parola belirleyin.',
      );
    }

    const valid = await this.verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      throw new AppError('UNAUTHENTICATED', 'Mevcut parola yanlış');
    }

    const newHash = await this.hashPassword(newPassword);
    await this.getPoolInstance().query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now(), version = version + 1 WHERE id = $2`,
      [newHash, userId],
    );

    // Tüm session'ları iptal et (güvenlik)
    await this.revokeAllUserSessions(userId);
  }

  // --- Yardımcı metotlar ---

  private async getUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.getPoolInstance().query<UserRow>(
      `SELECT * FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  private async getUserById(id: string): Promise<UserRow | null> {
    const result = await this.getPoolInstance().query<UserRow>(
      `SELECT * FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async incrementFailedLogin(userId: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE users
       SET failed_login_attempts = failed_login_attempts + 1,
           locked_until = CASE
             WHEN failed_login_attempts + 1 >= $1 THEN now() + interval '${LOCKOUT_DURATION_MINUTES} minutes'
             ELSE locked_until
           END,
           updated_at = now(),
           version = version + 1
       WHERE id = $2`,
      [MAX_FAILED_ATTEMPTS, userId],
    );
  }

  private async resetFailedLogin(userId: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now(), version = version + 1 WHERE id = $1`,
      [userId],
    );
  }

  private generateRecoveryCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  private hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private async removeRecoveryCode(userId: string, index: number): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user || !user.recovery_codes) return;
    const newCodes = user.recovery_codes.filter((_, i) => i !== index);
    await this.getPoolInstance().query(
      `UPDATE users SET recovery_codes = $1, updated_at = now(), version = version + 1 WHERE id = $2`,
      [newCodes, userId],
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
