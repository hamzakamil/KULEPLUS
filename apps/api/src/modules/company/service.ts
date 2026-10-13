import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { appUrl, queueEmailTemplate } from '../../services/email-templates.js';

export type CompanyApplicationRow = {
  id: string;
  name: string;
  trade_name: string | null;
  tax_office: string | null;
  tax_number: string | null;
  currency: string;
  fiscal_year_start: number;
  timezone: string;
  owner_email: string;
  starting_module: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
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

export type TenantSettingsRow = {
  tenant_id: string;
  onboarding_mode: string;
  settings: Record<string, unknown>;
  updated_at: Date;
};

export class CompanyService {
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

  /** Şirket başvurusu oluştur (public) */
  async createApplication(input: {
    name: string;
    tradeName?: string;
    taxOffice?: string;
    taxNumber?: string;
    currency?: string;
    fiscalYearStart?: number;
    timezone?: string;
    ownerEmail: string;
    startingModule?: 'contacts' | 'stock';
  }): Promise<{ applicationId: string; tenantId: string | null }> {
    const now = new Date();
    const applicationId = newId();

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(`SELECT id FROM users WHERE email = $1`, [
        input.ownerEmail.toLowerCase(),
      ]);

      if (userResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı. Önce kayıt olun.');
      }

      const existingResult = await client.query(
        `SELECT id FROM company_applications WHERE owner_email = $1 AND status = 'pending'`,
        [input.ownerEmail.toLowerCase()],
      );

      if (existingResult.rows.length > 0) {
        throw new AppError('CONFLICT', 'Zaten bekleyen bir başvurunuz var.');
      }

      await client.query(
        `INSERT INTO company_applications (
          id, name, trade_name, tax_office, tax_number, currency,
          fiscal_year_start, timezone, owner_email, starting_module, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $11)`,
        [
          applicationId,
          input.name,
          input.tradeName ?? null,
          input.taxOffice ?? null,
          input.taxNumber ?? null,
          input.currency ?? 'TRY',
          input.fiscalYearStart ?? 1,
          input.timezone ?? 'Europe/Istanbul',
          input.ownerEmail.toLowerCase(),
          input.startingModule ?? null,
          now,
        ],
      );

      await client.query('COMMIT');
      return { applicationId, tenantId: null };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Başvuru durumunu getir (public - owner email ile) */
  async getApplicationStatus(ownerEmail: string): Promise<CompanyApplicationRow | null> {
    const result = await this.getPoolInstance().query<CompanyApplicationRow>(
      `SELECT * FROM company_applications WHERE owner_email = $1 ORDER BY created_at DESC LIMIT 1`,
      [ownerEmail.toLowerCase()],
    );
    return result.rows[0] ?? null;
  }

  /** Tüm bekleyen başvuruları listele (platform admin) */
  async listPendingApplications(): Promise<CompanyApplicationRow[]> {
    const result = await this.getPoolInstance().query<CompanyApplicationRow>(
      `SELECT * FROM company_applications WHERE status = 'pending' ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  /** Başvuruyu onayla/reddet (platform admin) - Tek transaction */
  async processApplication(
    applicationId: string,
    input: { approve: boolean; rejectionReason?: string; reviewerId: string },
  ): Promise<{ tenantId: string | null }> {
    const now = new Date();

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      const appResult = await client.query<CompanyApplicationRow>(
        `SELECT * FROM company_applications WHERE id = $1 FOR UPDATE`,
        [applicationId],
      );

      if (appResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Başvuru bulunamadı');
      }

      const application = appResult.rows[0];

      if (application.status !== 'pending') {
        throw new AppError('CONFLICT', 'Bu başvuru zaten işlenmiş');
      }

      let tenantId: string | null = null;

      if (input.approve) {
        tenantId = newId();

        await client.query(
          `INSERT INTO tenants (id, name, trade_name, tax_office, tax_number, currency, fiscal_year_start, timezone, status, created_at, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9, 1)`,
          [
            tenantId,
            application.name,
            application.trade_name,
            application.tax_office,
            application.tax_number,
            application.currency,
            application.fiscal_year_start,
            application.timezone,
            now,
          ],
        );

        const userResult = await client.query(`SELECT id FROM users WHERE email = $1`, [
          application.owner_email,
        ]);

        if (userResult.rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Başvuru sahibi kullanıcı bulunamadı');
        }

        const userId = userResult.rows[0].id;

        await client.query(
          `INSERT INTO tenant_users (tenant_id, user_id, is_owner, created_at)
           VALUES ($1, $2, true, $3)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET is_owner = true`,
          [tenantId, userId, now],
        );

        await client.query(
          `INSERT INTO tenant_entitlements (tenant_id, module_code, status, granted_at)
           VALUES ($1, 'core', 'active', $2)
           ON CONFLICT (tenant_id, module_code) DO NOTHING`,
          [tenantId, now],
        );

        if (application.starting_module) {
          await client.query(
            `INSERT INTO tenant_entitlements (tenant_id, module_code, status, granted_at)
             VALUES ($1, $2, 'active', $3)
             ON CONFLICT (tenant_id, module_code) DO NOTHING`,
            [tenantId, application.starting_module, now],
          );
        }

        await client.query(
          `INSERT INTO tenant_settings (tenant_id, key, value, locked, updated_at)
           VALUES ($1, 'onboarding_mode', '"manual"'::jsonb, true, $2)
           ON CONFLICT (tenant_id, key) DO NOTHING`,
          [tenantId, now],
        );

        await client.query(
          `INSERT INTO tenant_settings (tenant_id, key, value, locked, updated_at)
           VALUES ($1, 'company_profile', '{}'::jsonb, false, $2)
           ON CONFLICT (tenant_id, key) DO NOTHING`,
          [tenantId, now],
        );

        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
           VALUES ($1, $2, $3, 'company_approved', 'tenant', $2, $4, $5)`,
          [newId(), tenantId, input.reviewerId, JSON.stringify({ applicationId }), now],
        );

        // Onay e-postası outbox'a yazılır — TRANSACTION İÇİNDE (SPEC §4.3, §19.1).
        // E-posta servisi kapalı olsa da onay yarım kalmaz; gönderim worker'a bırakılır.
        await queueEmailTemplate(
          'core.tenant_approved',
          application.owner_email,
          {
            user_name: application.owner_email.split('@')[0] ?? '',
            tenant_name: application.name,
          },
          client,
        );
      } else {
        // Red bildirimi de aynı outbox deseniyle (Faz 1 e-posta envanteri: core.tenant_rejected).
        await queueEmailTemplate(
          'core.tenant_rejected',
          application.owner_email,
          {
            user_name: application.owner_email.split('@')[0] ?? '',
            reason: input.rejectionReason ?? 'Gerekçe belirtilmedi',
          },
          client,
        );
      }

      await client.query(
        `UPDATE company_applications 
         SET status = $1, rejection_reason = $2, reviewed_at = $3, reviewed_by = $4, updated_at = $3
         WHERE id = $5`,
        [
          input.approve ? 'approved' : 'rejected',
          input.rejectionReason ?? null,
          now,
          input.reviewerId,
          applicationId,
        ],
      );

      await client.query('COMMIT');
      return { tenantId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** Şirket (tenant) ayarlarını getir */
  async getSettings(
    tenantId: string,
  ): Promise<{ tenant: TenantRow; settings: TenantSettingsRow } | null> {
    const tenantResult = await this.getPoolInstance().query<TenantRow>(
      `SELECT * FROM tenants WHERE id = $1`,
      [tenantId],
    );

    if (tenantResult.rows.length === 0) {
      return null;
    }

    const settingsResult = await this.getPoolInstance().query<TenantSettingsRow>(
      `SELECT * FROM tenant_settings WHERE tenant_id = $1 AND key = 'company_profile'`,
      [tenantId],
    );

    return {
      tenant: tenantResult.rows[0],
      settings: settingsResult.rows[0] ?? {
        tenant_id: tenantId,
        key: 'company_profile',
        onboarding_mode: 'manual',
        settings: {},
        updated_at: new Date(),
      },
    };
  }

  /** Şirket ayarlarını güncelle (owner/admin) */
  async updateSettings(
    tenantId: string,
    input: {
      name?: string;
      tradeName?: string | null;
      taxOffice?: string | null;
      taxNumber?: string | null;
      currency?: string;
      fiscalYearStart?: number;
      timezone?: string;
      settings?: Record<string, unknown>;
    },
  ): Promise<TenantRow> {
    const now = new Date();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.tradeName !== undefined) {
      updates.push(`trade_name = $${paramIndex++}`);
      values.push(input.tradeName);
    }
    if (input.taxOffice !== undefined) {
      updates.push(`tax_office = $${paramIndex++}`);
      values.push(input.taxOffice);
    }
    if (input.taxNumber !== undefined) {
      updates.push(`tax_number = $${paramIndex++}`);
      values.push(input.taxNumber);
    }
    if (input.currency !== undefined) {
      updates.push(`currency = $${paramIndex++}`);
      values.push(input.currency);
    }
    if (input.fiscalYearStart !== undefined) {
      updates.push(`fiscal_year_start = $${paramIndex++}`);
      values.push(input.fiscalYearStart);
    }
    if (input.timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      values.push(input.timezone);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = $${paramIndex++}`);
      updates.push(`version = version + 1`);
      values.push(now);
      values.push(tenantId);

      await this.getPoolInstance().query(
        `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values,
      );
    }

    if (input.settings !== undefined) {
      await this.getPoolInstance().query(
        `INSERT INTO tenant_settings (tenant_id, key, onboarding_mode, settings, updated_at)
         VALUES ($1, 'company_profile', 'manual', $2, $3)
         ON CONFLICT (tenant_id, key) DO UPDATE SET settings = $2, updated_at = $3`,
        [tenantId, input.settings, now],
      );
    }

    const result = await this.getPoolInstance().query<TenantRow>(
      `SELECT * FROM tenants WHERE id = $1`,
      [tenantId],
    );

    return result.rows[0];
  }

  /** Şirket durumunu güncelle (platform admin) */
  async updateStatus(tenantId: string, status: string): Promise<TenantRow> {
    const now = new Date();
    await this.getPoolInstance().query(
      `UPDATE tenants SET status = $1, updated_at = $2, version = version + 1 WHERE id = $3`,
      [status, now, tenantId],
    );

    const result = await this.getPoolInstance().query<TenantRow>(
      `SELECT * FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const tenant = result.rows[0];

    // Aktive edilen şirkete hoş geldin e-postası (envanter: core.welcome, SPEC §19.1 outbox).
    if (status === 'active' && tenant?.status === 'active') {
      const owner = await this.getPoolInstance().query<{ email: string }>(
        `SELECT u.email FROM users u
         JOIN tenant_users tu ON tu.user_id = u.id
         WHERE tu.tenant_id = $1 AND tu.is_owner = true
         LIMIT 1`,
        [tenantId],
      );
      const ownerEmail = owner.rows[0]?.email;
      if (ownerEmail) {
        await queueEmailTemplate('core.welcome', ownerEmail, {
          user_name: ownerEmail.split('@')[0] ?? '',
          tenant_name: tenant.name,
          checklist_url: `${appUrl()}/dashboard`,
        });
      }
    }

    return tenant;
  }

  /** Kullanıcının şirketlerini listele */
  async listUserCompanies(userId: string): Promise<Array<TenantRow & { isOwner: boolean }>> {
    const result = await this.getPoolInstance().query<{
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
      is_owner: boolean;
    }>(
      `SELECT t.*, tu.is_owner FROM tenants t
       JOIN tenant_users tu ON tu.tenant_id = t.id
       WHERE tu.user_id = $1 AND t.status != 'archived'
       ORDER BY tu.is_owner DESC, t.created_at DESC`,
      [userId],
    );

    return result.rows.map((r) => ({ ...r, isOwner: r.is_owner }));
  }

  /** Şirket değiştir (tenant context switching) */
  async switchCompany(
    userId: string,
    tenantId: string,
  ): Promise<{ tenantId: string; isOwner: boolean }> {
    const result = await this.getPoolInstance().query(
      `SELECT is_owner FROM tenant_users WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );

    if (result.rows.length === 0) {
      throw new AppError('TENANT_FORBIDDEN', 'Bu şirkete erişim yetkiniz yok');
    }

    const tenantResult = await this.getPoolInstance().query(
      `SELECT status FROM tenants WHERE id = $1`,
      [tenantId],
    );

    if (tenantResult.rows.length === 0 || tenantResult.rows[0].status !== 'active') {
      throw new AppError('TENANT_FORBIDDEN', 'Şirket aktif değil');
    }

    return { tenantId, isOwner: result.rows[0].is_owner };
  }
}
