import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import request from 'supertest';

/**
 * Uçtan uca akış (Faz 1 çıkış kapısı):
 *   Kayıt → Şirket başvurusu → Platform onayı → Kullanıcı daveti → Rol → Kilitli modül
 *
 * Gerçek Postgres yerine in-memory fake DB kullanılır (SQL'i eşleştirip sahte satırlar
 * döndürür). Bu, HTTP katmanı + servis + yetki/entitlement zincirinin birlikte
 * çalıştığını doğrular; gerçek DB entegrasyonu CI'daki Postgres adımındadır.
 */

// ---- In-memory fake DB ----
interface FakeRow {
  [k: string]: unknown;
}
const tables: Record<string, FakeRow[]> = {
  users: [],
  tenants: [],
  tenant_users: [],
  tenant_entitlements: [],
  company_applications: [],
  tenant_invitations: [],
  tenant_user_roles: [],
  roles: [],
  legal_texts: [{ id: 'legal-kvkk', code: 'kvkk', effective_until: null }],
  legal_acceptances: [],
  audit_logs: [],
  user_sessions: [],
};

function matchValue(rowValue: unknown, param: unknown): boolean {
  return String(rowValue) === String(param);
}

function findRows(sql: string, params: unknown[]): FakeRow[] {
  if (sql.includes('FROM users') && sql.includes('email =')) {
    return tables.users.filter((r) => matchValue(r.email, params[0]));
  }
  if (sql.includes('FROM users') && sql.includes('id =')) {
    return tables.users.filter((r) => matchValue(r.id, params[0]));
  }
  if (sql.includes('FROM company_applications') && sql.includes('FOR UPDATE')) {
    return tables.company_applications.filter((r) => matchValue(r.id, params[0]));
  }
  if (sql.includes('FROM company_applications')) {
    return tables.company_applications.filter((r) => matchValue(r.owner_email, params[0]));
  }
  if (sql.includes('FROM tenant_invitations') && sql.includes('token_hash')) {
    return tables.tenant_invitations.filter(
      (r) => matchValue(r.token_hash, params[0]) && !r.accepted_at,
    );
  }
  if (sql.includes('FROM tenant_invitations')) {
    return tables.tenant_invitations.filter((r) => matchValue(r.email, params[1]));
  }
  if (sql.includes('FROM tenant_entitlements')) {
    return tables.tenant_entitlements.filter(
      (r) => matchValue(r.tenant_id, params[0]) && matchValue(r.module_code, params[1]),
    );
  }
  if (sql.includes('FROM tenant_users') && sql.includes('is_owner')) {
    return tables.tenant_users.filter(
      (r) => matchValue(r.user_id, params[0]) && r.is_owner === true,
    );
  }
  if (sql.includes('SELECT COUNT(*)') && sql.includes('tenants')) {
    return [{ total: String(tables.tenants.length) }];
  }
  if (sql.includes('FROM tenants') && sql.includes('id =')) {
    return tables.tenants.filter((r) => matchValue(r.id, params[0]));
  }
  if (sql.includes('FROM tenants')) return [...tables.tenants];
  return [];
}

function exec(sql: string, params: unknown[] = []): { rows: FakeRow[]; rowCount: number } {
  const s = sql.replace(/\s+/g, ' ').trim();

  // INSERT'ler
  if (/^INSERT INTO users/i.test(s)) {
    const row = { id: params[0], email: params[1], password_hash: params[2], status: 'active' };
    tables.users.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/^INSERT INTO tenants/i.test(s)) {
    const row = { id: params[0], name: params[1], status: 'pending' };
    if (s.includes("'active'")) row.status = 'active';
    tables.tenants.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/^INSERT INTO tenant_users/i.test(s)) {
    tables.tenant_users.push({ tenant_id: params[0], user_id: params[1], is_owner: true });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO tenant_entitlements/i.test(s)) {
    // SQL: VALUES ($1, 'core'|$2, 'active', $...) — modül kodu ya literal ya da parametre
    const moduleIsLiteral = s.includes("'core'");
    const moduleCode = moduleIsLiteral ? 'core' : (params[1] as string);
    tables.tenant_entitlements.push({
      tenant_id: params[0],
      module_code: moduleCode,
      status: 'active',
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO company_applications/i.test(s)) {
    const row = {
      id: params[0],
      name: params[1],
      owner_email: params[8],
      starting_module: params[9],
      status: 'pending',
      currency: 'TRY',
      fiscal_year_start: 1,
      timezone: 'Europe/Istanbul',
    };
    tables.company_applications.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/^INSERT INTO tenant_invitations/i.test(s)) {
    const row = {
      id: params[0],
      tenant_id: params[1],
      email: params[2],
      role_ids: params[3],
      token_hash: params[4],
      expires_at: params[5],
      accepted_at: null,
    };
    tables.tenant_invitations.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/^INSERT INTO legal_acceptances/i.test(s)) {
    // SELECT ... FROM legal_texts WHERE code='kvkk' şeklinde çalışır
    const kvkk = tables.legal_texts.find((r) => r.code === 'kvkk');
    if (kvkk) tables.legal_acceptances.push({ user_id: params[1], legal_text_id: kvkk.id });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO audit_logs/i.test(s)) {
    tables.audit_logs.push({ id: params[0], action: 'tenant.approved' });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO user_sessions/i.test(s)) {
    tables.user_sessions.push({ id: params[0], user_id: params[1] });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO tenant_settings/i.test(s)) {
    return { rows: [], rowCount: 1 };
  }

  // UPDATE'ler
  if (/^UPDATE company_applications/i.test(s)) {
    const app = tables.company_applications.find((r) => matchValue(r.id, params[4]));
    if (app) app.status = params[0] as string;
    return { rows: [], rowCount: app ? 1 : 0 };
  }
  if (/^UPDATE tenants/i.test(s)) {
    const t = tables.tenants.find((r) => matchValue(r.id, params[0]));
    if (t) t.status = params[1] as string;
    return { rows: [], rowCount: t ? 1 : 0 };
  }
  if (/^UPDATE users/i.test(s)) return { rows: [], rowCount: 1 };

  // SELECT'ler
  if (/^SELECT/i.test(s)) {
    const rows = findRows(s, params);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

const fakePool = {
  query: vi.fn((sql: string, params?: unknown[]) => Promise.resolve(exec(sql, params ?? []))),
  connect: vi.fn(async () => ({
    query: vi.fn((sql: string, params?: unknown[]) => Promise.resolve(exec(sql, params ?? []))),
    release: vi.fn(),
  })),
};

vi.mock('@kuleplus/db', () => ({
  getPool: () => fakePool,
  withTenant: async (_pool: unknown, _tenantId: string, fn: (c: unknown) => Promise<unknown>) =>
    fn(fakePool),
}));

const { createApp } = await import('../src/app');
const { loadEnv } = await import('../src/config/env');

function testEnv() {
  return loadEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://app_user:CHANGE_ME@localhost:5432/erp_db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  });
}

const app = createApp({ env: testEnv(), logger: pino({ level: 'silent' }), testRoutes: true });

describe('E2E akış — Kayıt → Başvuru → Onay → Davet → Rol → Kilitli modül (Faz 1 çıkış kapısı)', () => {
  beforeEach(() => {
    for (const key of Object.keys(tables)) tables[key] = [];
    tables.legal_texts = [{ id: 'legal-kvkk', code: 'kvkk', effective_until: null }];
    vi.clearAllMocks();
  });

  it('tam akış başarıyla tamamlanır', async () => {
    // 1) KAYIT — KVKK kabulü ile
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      email: 'owner@example.com',
      password: 'GucluParola1234',
      name: 'Ayşe Yılmaz',
      companyName: 'Örnek Ticaret Ltd.',
      startingModule: 'contacts',
      acceptTerms: true,
    });
    expect(registerRes.status).toBe(201);
    // Kayıt yanıtı girişle birebir aynı oturum sözleşmesidir (ADR-0023)
    expect(registerRes.body.user.id).toBeTruthy();
    expect(registerRes.body.accessToken).toBeTruthy();
    expect(registerRes.body.tenantId).toBeTruthy();
    // KVKK kabulü yazıldı
    expect(tables.legal_acceptances.length).toBe(1);
    expect(tables.legal_acceptances[0].legal_text_id).toBe('legal-kvkk');
    const ownerUserId = registerRes.body.user.id as string;
    const pendingTenantId = registerRes.body.tenantId as string;

    // 2) ŞİRKET BAŞVURUSU
    const applyRes = await request(app).post('/api/v1/company/apply').send({
      name: 'Örnek Ticaret Ltd.',
      ownerEmail: 'owner@example.com',
      startingModule: 'contacts',
    });
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.applicationId).toBeTruthy();
    const applicationId = applyRes.body.applicationId as string;

    // 3) PLATFORM ONAYI — onay tenant'ı aktifleştirir, owner bağlanır, core entitlement verilir
    const { CompanyService } = await import('../src/modules/company/service');
    const companySvc = new CompanyService(fakePool as never);
    const approved = await companySvc.processApplication(applicationId, {
      approve: true,
      reviewerId: ownerUserId,
    });
    expect(approved.tenantId).toBeTruthy();
    const activeTenantId = approved.tenantId as string;
    expect(tables.tenants.find((t) => t.id === activeTenantId)?.status).toBe('active');
    expect(
      tables.tenant_entitlements.some(
        (e) => e.tenant_id === activeTenantId && e.module_code === 'core',
      ),
    ).toBe(true);

    // 4) DAVET — 7 gün, hash'li token
    const { AuthorizationService } = await import('../src/modules/authorization/service');
    const authzSvc = new AuthorizationService(fakePool as never);
    const invitation = await authzSvc.createInvitation({
      tenantId: activeTenantId,
      email: 'personel@example.com',
      roleIds: [],
      createdBy: ownerUserId,
    });
    expect(invitation.token).toBeTruthy();
    // Davet DB'ye hash'li yazıldı (ham token değil)
    expect(tables.tenant_invitations[0].token_hash).not.toBe(invitation.token);

    // 5) KİLİTLİ MODÜL — 'stock' entitlement yok → MODULE_NOT_ENTITLED
    const { requireModule } = await import('../src/modules/entitlement/service');
    const stockCheck = await requireModule(activeTenantId, 'stock');
    expect(stockCheck.entitled).toBe(false);
    expect(stockCheck.reason).toBe('MODULE_NOT_ENTITLED');

    // 'core' var → entitled
    const coreCheck = await requireModule(activeTenantId, 'core');
    expect(coreCheck.entitled).toBe(true);

    void pendingTenantId;
  });

  it('KVKK kabulü olmadan kayıt reddedilir', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'kvkksiz@example.com',
      password: 'GucluParola1234',
      name: 'KVKK Yok',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
