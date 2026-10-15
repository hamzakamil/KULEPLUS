import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IdentityService } from '../src/modules/identity/service';
import { mapGoogleClaims, type GoogleClaims } from '../src/modules/identity/google';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';

/**
 * Identity servisi birim testleri (SPEC §27.1, ROADMAP Faz 1 DoD).
 * DB, sahte (mock) Pool ile değiştirilir; gerçek transaction davranışı
 * integration testinin konusudur.
 */

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => unknown): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
  client: MockClient;
} {
  const query = vi.fn(queryImpl);
  const client: MockClient = {
    query: vi.fn(queryImpl),
    release: vi.fn(),
  };
  const pool = {
    query,
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return { pool, query, client };
}

/**
 * Kayıt testleri için sahte Pool (ADR-0023).
 *
 * `register()` artık oturum da üretiyor; oturum kurulumu `tenant_users` sorgusunu
 * çalıştırır. Bu sorgu boş dönerse kayıt "tenant bulunamadı" ile patlar ve testin
 * asıl amacı (transaction içeriği) görünmez olur — yüzden şirket bağlantısı
 * tohumlanır. Yazımlar yine `executed` listesinde izlenir.
 */
function makeSignupPool(executed: string[]): { pool: Pool; client: MockClient } {
  const { pool, client } = makeMockPool((sql: string) => {
    executed.push(sql);
    if (sql.includes('FROM tenant_users')) {
      return { rows: [{ tenant_id: 'tenant-1' }] };
    }
    return { rows: [] };
  });
  return { pool, client };
}

describe('IdentityService (birim)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hashPassword / verifyPassword — Argon2id (SPEC §27.1)', () => {
    it("parolayı hash'ler ve doğru parolayı doğrular", async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);

      const hash = await svc.hashPassword('cok-gizli-parola-123');
      expect(hash).not.toBe('cok-gizli-parola-123');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(await svc.verifyPassword('cok-gizli-parola-123', hash)).toBe(true);
    });

    it('yanlış parolayı reddeder', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);
      const hash = await svc.hashPassword('dogru-parola-1234');
      expect(await svc.verifyPassword('yanlis-parola-1234', hash)).toBe(false);
    });
  });

  describe('JWT — access token (SPEC §27.1)', () => {
    it('üretilen access token doğrulanır ve payload korunur', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);

      const token = await svc.generateAccessToken({
        sub: 'user-1',
        email: 'a@b.com',
        tenantId: 'tenant-1',
      });
      const payload = await svc.verifyAccessToken(token);
      expect(payload?.sub).toBe('user-1');
      expect(payload?.tenantId).toBe('tenant-1');
    });

    it('bozuk token null döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);
      expect(await svc.verifyAccessToken('bozuk.token.degeri')).toBeNull();
    });
  });

  describe('register — tek transaction (SPEC §4.3)', () => {
    it('kullanıcı + tenant + owner bağlantısı + core entitlement oluşturur', async () => {
      const executed: string[] = [];
      const { pool, client } = makeSignupPool(executed);
      const svc = new IdentityService(pool);

      const result = await svc.register({
        email: 'Yeni@Ornek.COM',
        password: 'cok-gizli-parola-123',
        name: 'Yeni Kullanıcı',
        companyName: 'Örnek Ltd.',
        startingModule: 'contacts',
        acceptTerms: true,
      });

      expect(result.userId).toBeTruthy();
      expect(result.tenantId).toBeTruthy();
      // E-posta küçük harfe çevrilir (SPEC §3.1)
      const insertUser = client.query.mock.calls.find(([s]: unknown[]) =>
        (s as string).includes('INSERT INTO users'),
      );
      expect((insertUser?.[1] as unknown[])?.[1]).toBe('yeni@ornek.com');
      // BEGIN / COMMIT ve gerekli insert'ler
      expect(executed.some((s) => s === 'BEGIN')).toBe(true);
      expect(executed.some((s) => s.includes('INSERT INTO tenants'))).toBe(true);
      expect(executed.some((s) => s.includes('INSERT INTO tenant_users'))).toBe(true);
      expect(executed.some((s) => s.includes('tenant_entitlements'))).toBe(true);
      expect(executed.some((s) => s === 'COMMIT')).toBe(true);
      // Kayıt oturumu hemen kurar (ADR-0023): kullanıcı ikinci kez giriş yapmaz
      expect(result.session.accessToken).toBeTruthy();
      expect(result.session.user.id).toBe(result.userId);
      expect(result.session.user.name).toBe('Yeni Kullanıcı');
      expect(executed.some((s) => s.includes('INSERT INTO user_sessions'))).toBe(true);
    });

    it("acceptTerms true ise KVKK kabulü legal_acceptances'e yazılır (ADR-0011)", async () => {
      const executed: string[] = [];
      const { pool } = makeSignupPool(executed);
      const svc = new IdentityService(pool);

      await svc.register({
        email: 'kvkk@ornek.com',
        password: 'cok-gizli-parola-123',
        name: 'KVKK Test',
        acceptTerms: true,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });

      const acceptInsert = executed.find((s) => s.includes('INSERT INTO legal_acceptances'));
      expect(acceptInsert).toBeTruthy();
      expect(acceptInsert).toContain("lt.code = 'kvkk'");
    });

    it('acceptTerms verilmezse kabul kaydı yazılmaz', async () => {
      const executed: string[] = [];
      const { pool } = makeSignupPool(executed);
      const svc = new IdentityService(pool);

      await svc.register({
        email: 'nokvkk@ornek.com',
        password: 'cok-gizli-parola-123',
        name: 'KVKK Yok',
      });

      expect(executed.some((s) => s.includes('legal_acceptances'))).toBe(false);
    });

    it('e-posta çakışmasında transaction geri alınır', async () => {
      const { pool, client } = makeMockPool((sql: string) => {
        if (sql.includes('INSERT INTO users')) {
          throw new Error('duplicate key value violates unique constraint "users_email_unique"');
        }
        return { rows: [] };
      });
      const svc = new IdentityService(pool);

      await expect(
        svc.register({
          email: 'var@olan.com',
          password: 'cok-gizli-parola-123',
          name: 'Var Olan',
        }),
      ).rejects.toBeInstanceOf(AppError);
      expect(client.query.mock.calls.some(([s]: unknown[]) => s === 'ROLLBACK')).toBe(true);
    });
  });

  describe('login — kilit ve 2FA (SPEC §27.1)', () => {
    function userRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'user-1',
        email: 'a@b.com',
        password_hash: '',
        totp_secret: null,
        locked_until: null,
        status: 'active',
        ...overrides,
      };
    }

    it('olmayan kullanıcıda UNAUTHENTICATED döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);
      await expect(svc.login('yok@yok.com', 'x')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('kilitli hesapta UNAUTHENTICATED döner', async () => {
      const future = new Date(Date.now() + 60_000);
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('FROM users')) {
          return { rows: [userRow({ locked_until: future })] };
        }
        return { rows: [] };
      });
      const svc = new IdentityService(pool);
      await expect(svc.login('a@b.com', 'herhangi')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('2FA etkinse kod yoksa reddeder', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) {
          return { rows: [userRow({ totp_secret: 'SECRET' })] };
        }
        return { rows: [] };
      });
      const svc = new IdentityService(pool);
      // Parola doğrulamasını geçmek için gerçek hash üretelim
      const hash = await svc.hashPassword('cok-gizli-parola-123');
      const { pool: pool2 } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) {
          return { rows: [userRow({ totp_secret: 'SECRET', password_hash: hash })] };
        }
        return { rows: [] };
      });
      const svc2 = new IdentityService(pool2);
      await expect(svc2.login('a@b.com', 'cok-gizli-parola-123')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      void svc;
    });

    it('başarılı girişte token, kullanıcı ve tenantId döner', async () => {
      const svcHash = await new IdentityService(
        makeMockPool(() => ({ rows: [] })).pool,
      ).hashPassword('cok-gizli-parola-123');

      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) {
          return { rows: [userRow({ password_hash: svcHash })] };
        }
        if (sql.includes('FROM tenant_users')) {
          return { rows: [{ tenant_id: 'tenant-1' }] };
        }
        return { rows: [] };
      });
      const svc = new IdentityService(pool);

      const result = await svc.login(
        'a@b.com',
        'cok-gizli-parola-123',
        undefined,
        'vitest',
        '127.0.0.1',
      );
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.tenantId).toBe('tenant-1');
      expect(result.user.totpEnabled).toBe(false);
    });
  });

  describe('şifre sıfırlama akışı (SPEC §27.1)', () => {
    it('kayıtlı olmayan e-postada boş token döner (numaralandırma koruması)', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new IdentityService(pool);
      const res = await svc.requestPasswordReset('yok@yok.com');
      expect(res.token).toBe('');
    });

    it('kayıtlı kullanıcıda token üretir ve DB hash yazar', async () => {
      const { pool, client } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) {
          return { rows: [{ id: 'user-1', email: 'a@b.com' }] };
        }
        return { rows: [] };
      });
      const svc = new IdentityService(pool);
      const res = await svc.requestPasswordReset('a@b.com');
      expect(res.token).toHaveLength(64); // 32 byte hex
      expect(
        client.query.mock.calls.some(([s]: unknown[]) =>
          (s as string).includes('password_reset_tokens'),
        ),
      ).toBe(true);
    });

    it('geçersiz token ile confirm NOT_FOUND döner', async () => {
      const { pool } = makeMockPool((sql: string) => {
        // password_reset_tokens sorgusu boş döner
        if (sql.includes('password_reset_tokens')) return { rows: [] };
        return { rows: [] };
      });
      const svc = new IdentityService(pool);
      await expect(
        svc.confirmPasswordReset('gecersiz-token', 'yeni-parola-1234'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('Google ile giriş — kimlik çözümleme zinciri (ADR-0023)', () => {
    /** İmza denetimi `google.ts`'nin işi; burada doğrulanmış claim doğrudan verilir. */
    const verifierFor = (value: GoogleClaims) => ({ verify: async () => value });

    const claims: GoogleClaims = {
      providerAccountId: 'google-sub-1',
      email: 'mehmet@example.com',
      displayName: 'Mehmet Yılmaz',
      avatarUrl: 'https://example.com/avatar.png',
    };

    const activeUser = {
      id: 'user-9',
      email: 'mehmet@example.com',
      display_name: 'Mehmet Yılmaz',
      totp_secret: null,
      status: 'active',
    };

    /**
     * Kimlik zincirinin üç sorgusu sahtelenir: `user_identities` (sub), `users`
     * (e-posta) ve oturumun şirket bağlantısı (`tenant_users`).
     */
    function makeGooglePool(responses: { identity?: unknown[]; userByEmail?: unknown[] } = {}) {
      const executed: { sql: string; params: unknown[] }[] = [];
      const { pool } = makeMockPool((sql: string, params?: unknown[]) => {
        executed.push({ sql, params: params ?? [] });
        if (sql.includes('FROM user_identities ui')) {
          return { rows: responses.identity ?? [] };
        }
        if (sql.includes('FROM users WHERE email')) {
          return { rows: responses.userByEmail ?? [] };
        }
        if (sql.includes('FROM tenant_users')) {
          return { rows: [{ tenant_id: 'tenant-1' }] };
        }
        return { rows: [] };
      });
      return { pool, executed, sqls: () => executed.map((c) => c.sql) };
    }

    it('kayıtlı Google kimliği AYNI kullanıcıya düşer — yeni hesap açmaz', async () => {
      const { pool, sqls } = makeGooglePool({ identity: [activeUser] });
      const svc = new IdentityService(pool);

      const result = await svc.loginWithGoogle('credential', {}, verifierFor(claims));

      expect(result.isNewUser).toBe(false);
      expect(result.session.user.id).toBe('user-9');
      expect(sqls().some((s) => s.includes('INSERT INTO users'))).toBe(false);
      expect(sqls().some((s) => s.includes('INSERT INTO user_identities'))).toBe(false);
      // İsim/fotoğraf Google tarafında değişebilir → kimlik kaydı tazelenir
      expect(sqls().some((s) => s.includes('UPDATE user_identities'))).toBe(true);
      // Oturum normal yoldan kurulur: üç giriş yolu aynı oturumu üretir
      expect(sqls().some((s) => s.includes('INSERT INTO user_sessions'))).toBe(true);
    });

    it('doğrulanmış e-posta mevcut hesaba KİMLİK BAĞLAR — ikinci hesap açılmaz', async () => {
      const { pool, executed, sqls } = makeGooglePool({ userByEmail: [activeUser] });
      const svc = new IdentityService(pool);

      const result = await svc.loginWithGoogle('credential', {}, verifierFor(claims));

      expect(result.isNewUser).toBe(false);
      expect(result.session.user.id).toBe('user-9');
      expect(sqls().some((s) => s.includes('INSERT INTO users'))).toBe(false);
      expect(sqls().some((s) => s.includes('INSERT INTO tenants'))).toBe(false);

      const link = executed.find((c) => c.sql.includes('INSERT INTO user_identities'));
      expect(link?.params[1]).toBe('user-9'); // user_id → mevcut hesap
      expect(link?.params[2]).toBe('google-sub-1'); // provider_account_id = sub
    });

    it('hiçbir eşleşme yoksa parolasız kullanıcı + şirket açılır', async () => {
      const { pool, executed, sqls } = makeGooglePool();
      const svc = new IdentityService(pool);

      const result = await svc.loginWithGoogle('credential', {}, verifierFor(claims));

      expect(result.isNewUser).toBe(true);
      expect(result.session.user.name).toBe('Mehmet Yılmaz');

      const insertUser = executed.find((c) => c.sql.includes('INSERT INTO users'));
      // `password_hash` parametre olarak BİLE verilmez: hesap parolasız doğar
      expect(insertUser?.sql).toContain('VALUES ($1, $2, NULL');
      expect(insertUser?.params[1]).toBe('mehmet@example.com');

      // Kendi kendine kayıtla aynı tohumlama: şirket + owner + ücretsiz çekirdek
      expect(sqls().some((s) => s.includes('INSERT INTO tenants'))).toBe(true);
      expect(sqls().some((s) => s.includes('INSERT INTO tenant_users'))).toBe(true);
      expect(sqls().some((s) => s.includes('tenant_entitlements'))).toBe(true);
      // Şirket adı Google profilinden ödünç alınır
      const insertTenant = executed.find((c) => c.sql.includes('INSERT INTO tenants'));
      expect(insertTenant?.params[1]).toBe('Mehmet Yılmaz');
    });

    it('2FA açık hesapta Google girişi reddedilir — tek faktör oturum açmaz', async () => {
      const { pool, sqls } = makeGooglePool({
        identity: [{ ...activeUser, totp_secret: 'totp-secret' }],
      });
      const svc = new IdentityService(pool);

      await expect(
        svc.loginWithGoogle('credential', {}, verifierFor(claims)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(sqls().some((s) => s.includes('INSERT INTO user_sessions'))).toBe(false);
    });

    it('askıya alınmış hesap oturum alamaz', async () => {
      const { pool, sqls } = makeGooglePool({
        identity: [{ ...activeUser, status: 'suspended' }],
      });
      const svc = new IdentityService(pool);

      await expect(
        svc.loginWithGoogle('credential', {}, verifierFor(claims)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(sqls().some((s) => s.includes('INSERT INTO user_sessions'))).toBe(false);
    });
  });

  describe('mapGoogleClaims — claim denetimleri (ADR-0023)', () => {
    it('doğrulanmamış e-postayı reddeder (hesap devralma kapısı)', () => {
      expect(() =>
        mapGoogleClaims({ sub: 'sub-1', email: 'a@b.com', email_verified: false }),
      ).toThrow(AppError);
      // Bayrak hiç gelmemesi de doğrulanmamış sayılır
      expect(() => mapGoogleClaims({ sub: 'sub-1', email: 'a@b.com' })).toThrow(AppError);
    });

    it('e-postayı normalize eder, eksik profil alanlarını null yapar', () => {
      const result = mapGoogleClaims({
        sub: ' sub-1 ',
        email: ' Ali@Ornek.COM ',
        email_verified: true,
        name: '  Ali Veli ',
      });
      expect(result).toEqual({
        providerAccountId: 'sub-1',
        email: 'ali@ornek.com',
        displayName: 'Ali Veli',
        avatarUrl: null,
      });
    });

    it('kalıcı kimlik (`sub`) yoksa reddeder — e-posta tek başına anahtar olamaz', () => {
      expect(() => mapGoogleClaims({ email: 'a@b.com', email_verified: true })).toThrow(AppError);
    });
  });
});
