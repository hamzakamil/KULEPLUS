import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';

export type RoleRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  is_system: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

export type PermissionRow = {
  id: string;
  module: string;
  resource: string;
  action: string;
  code: string;
  name: string;
  description: string | null;
  is_system_permission: boolean;
  delegatable: boolean;
  created_at: Date;
};

export type RolePermissionRow = {
  tenant_id: string;
  role_id: string;
  permission_id: string;
  scope: string;
  created_at: Date;
};

export type InvitationRow = {
  id: string;
  tenant_id: string | null;
  email: string;
  role_ids: string[];
  token_hash: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
  created_by: string | null;
};

export type DepartmentRow = {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  manager_user_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export class AuthorizationService {
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

  // === Invitation ===

  async createInvitation(input: {
    tenantId: string;
    email: string;
    roleIds: string[];
    createdBy: string;
  }): Promise<{ id: string; token: string; email: string }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const token = newId();
    const tokenHash = this.hashToken(token);

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM tenant_invitations
         WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > now()`,
        [input.tenantId, input.email.toLowerCase()],
      );
      if (existing.rows.length > 0) {
        throw new AppError('CONFLICT', 'Bu e-posta için bekleyen bir davet zaten var');
      }

      await client.query(
        `INSERT INTO tenant_invitations (id, tenant_id, email, role_ids, token_hash, expires_at, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newId(),
          input.tenantId,
          input.email.toLowerCase(),
          input.roleIds,
          tokenHash,
          expiresAt,
          now,
          input.createdBy,
        ],
      );

      await client.query('COMMIT');
      return { id: existing.rows[0]?.id ?? newId(), token, email: input.email };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptInvitation(input: {
    token: string;
    password: string;
    passwordConfirm: string;
  }): Promise<{ userId: string; tenantId: string }> {
    if (input.password !== input.passwordConfirm) {
      throw new AppError('VALIDATION_ERROR', 'Şifreler eşleşmiyor');
    }

    const tokenHash = this.hashToken(input.token);
    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      const result = await client.query<InvitationRow>(
        `SELECT * FROM tenant_invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Geçersiz veya süresi dolmuş davet');
      }

      const invitation = result.rows[0];

      const userResult = await client.query<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE email = $1`,
        [invitation.email],
      );

      if (userResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Davet edilen kullanıcı kayıtlı değil');
      }

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id, is_owner, created_at)
         VALUES ($1, $2, false, now())
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [invitation.tenant_id, user.id],
      );

      await client.query(`UPDATE tenant_invitations SET accepted_at = now() WHERE id = $1`, [
        invitation.id,
      ]);

      await client.query('COMMIT');
      return { userId: user.id, tenantId: invitation.tenant_id! };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listInvitations(
    tenantId: string,
    query: { email?: string; status?: string; page: number; limit: number },
  ) {
    const offset = (query.page - 1) * query.limit;
    let sql = `SELECT * FROM tenant_invitations WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (query.email) {
      sql += ` AND email = $${params.length + 1}`;
      params.push(query.email.toLowerCase());
    }
    if (query.status === 'pending') {
      sql += ` AND accepted_at IS NULL AND expires_at > now()`;
    } else if (query.status === 'accepted') {
      sql += ` AND accepted_at IS NOT NULL`;
    } else if (query.status === 'expired') {
      sql += ` AND expires_at <= now()`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 1}`;
    params.push(query.limit, offset);

    const result = await this.getPoolInstance().query<InvitationRow>(sql, params);
    return result.rows;
  }

  async revokeInvitation(tenantId: string, invitationId: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE tenant_invitations SET accepted_at = now() WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL`,
      [invitationId, tenantId],
    );
  }

  // === Roles ===

  async listRoles(
    tenantId: string,
    query: { includeSystem: boolean; page: number; limit: number },
  ) {
    const offset = (query.page - 1) * query.limit;
    let sql = `SELECT * FROM roles WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (!query.includeSystem) {
      sql += ` AND is_system = false`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(query.limit, offset);

    const result = await this.getPoolInstance().query<RoleRow>(sql, params);
    return result.rows;
  }

  async createRole(
    tenantId: string,
    input: {
      name: string;
      code?: string;
      isSystem?: boolean;
      isDefault?: boolean;
      permissionIds?: string[];
    },
  ): Promise<RoleRow> {
    const now = new Date();
    const roleId = newId();

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO roles (id, tenant_id, name, code, is_system, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          roleId,
          tenantId,
          input.name,
          input.code ?? null,
          !!input.isSystem,
          !!input.isDefault,
          now,
        ],
      );

      if (input.permissionIds && input.permissionIds.length > 0) {
        for (const permissionId of input.permissionIds) {
          await client.query(
            `INSERT INTO role_permissions (tenant_id, role_id, permission_id, scope)
             VALUES ($1, $2, $3, 'all')`,
            [tenantId, roleId, permissionId],
          );
        }
      }

      await client.query('COMMIT');

      return {
        id: roleId,
        tenant_id: tenantId,
        name: input.name,
        code: input.code ?? null,
        is_system: !!input.isSystem,
        is_default: !!input.isDefault,
        created_at: now,
        updated_at: now,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateRole(
    tenantId: string,
    roleId: string,
    input: { name?: string; code?: string | null; isDefault?: boolean; permissionIds?: string[] },
  ): Promise<RoleRow> {
    const now = new Date();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.code !== undefined) {
      updates.push(`code = $${paramIndex++}`);
      values.push(input.code);
    }
    if (input.isDefault !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(input.isDefault);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(roleId);
    values.push(tenantId);

    await this.getPoolInstance().query(
      `UPDATE roles SET ${updates.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}`,
      values,
    );

    if (input.permissionIds !== undefined) {
      await this.getPoolInstance().query(
        `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`,
        [tenantId, roleId],
      );
      for (const permissionId of input.permissionIds) {
        await this.getPoolInstance().query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_id, scope) VALUES ($1, $2, $3, 'all')`,
          [tenantId, roleId, permissionId],
        );
      }
    }

    const roleResult = await this.getPoolInstance().query<RoleRow>(
      `SELECT * FROM roles WHERE id = $1 AND tenant_id = $2`,
      [roleId, tenantId],
    );
    return roleResult.rows[0]!;
  }

  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    await this.getPoolInstance().query(
      `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`,
      [tenantId, roleId],
    );
    await this.getPoolInstance().query(
      `DELETE FROM tenant_user_roles WHERE tenant_id = $1 AND role_id = $2`,
      [tenantId, roleId],
    );
    await this.getPoolInstance().query(`DELETE FROM roles WHERE id = $1 AND tenant_id = $2`, [
      roleId,
      tenantId,
    ]);
  }

  async updateRolePermissionScope(
    tenantId: string,
    roleId: string,
    permissionId: string,
    scope: string,
  ): Promise<void> {
    await this.getPoolInstance().query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission_id, scope)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, role_id, permission_id) DO UPDATE SET scope = $4`,
      [tenantId, roleId, permissionId, scope],
    );
  }

  // === Permissions ===

  async listPermissions(query: { module?: string; page: number; limit: number }) {
    const offset = (query.page - 1) * query.limit;
    let sql = `SELECT * FROM permissions`;
    const params: unknown[] = [];

    if (query.module) {
      sql += ` WHERE module = $${params.length + 1}`;
      params.push(query.module);
    }

    sql += ` ORDER BY code LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(query.limit, offset);

    const result = await this.getPoolInstance().query<PermissionRow>(sql, params);
    return result.rows;
  }

  // === Role Permissions ===

  async assignPermissions(
    roleId: string,
    tenantId: string,
    permissionIds: string[],
    scope: string,
  ): Promise<void> {
    for (const permissionId of permissionIds) {
      await this.getPoolInstance().query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id, scope, created_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tenant_id, role_id, permission_id) DO UPDATE SET scope = $4`,
        [tenantId, roleId, permissionId, scope],
      );
    }
    // Yetki değişikliği oturumlarda etkili olsun (SPEC §6.4)
    await this.bumpTenantAuthVersion(tenantId);
  }

  /** Tenant yetki sürümünü artır — mevcut token'lar geçersizleşir (SPEC §6.4). */
  private async bumpTenantAuthVersion(tenantId: string): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE tenants SET auth_version = auth_version + 1, updated_at = now() WHERE id = $1`,
      [tenantId],
    );
  }

  // === User Roles ===

  async assignUserRoles(tenantId: string, userId: string, roleIds: string[]): Promise<void> {
    for (const roleId of roleIds) {
      await this.getPoolInstance().query(
        `INSERT INTO tenant_user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
         VALUES ($1, $2, $3, now(), $2)
         ON CONFLICT DO NOTHING`,
        [tenantId, userId, roleId],
      );
    }
    // Rol ataması oturumlarda etkili olsun (SPEC §6.4)
    await this.bumpTenantAuthVersion(tenantId);
  }

  async removeUserRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.getPoolInstance().query(
      `DELETE FROM tenant_user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
      [tenantId, userId, roleId],
    );
    // Rol düşürülmesi MEVCUT oturumda etkili olur (Faz 1 kabul kriteri, SPEC §6.4)
    await this.bumpTenantAuthVersion(tenantId);
  }

  // === Owner Transfer ===

  async transferOwnership(
    tenantId: string,
    input: { newOwnerUserId: string; currentPassword: string },
  ): Promise<void> {
    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE id = $1`,
        [input.newOwnerUserId],
      );
      if (userResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Yeni owner kullanıcı bulunamadı');
      }

      const result = await client.query(
        `UPDATE tenant_users SET is_owner = false WHERE tenant_id = $1 AND is_owner = true`,
        [tenantId],
      );
      if (result.rowCount === 0) {
        throw new AppError('NOT_FOUND', 'Mevcut owner bulunamadı');
      }

      await client.query(
        `UPDATE tenant_users SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, input.newOwnerUserId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // === Departments ===

  async createDepartment(
    tenantId: string,
    input: { name: string; code?: string; parentId?: string; managerUserId?: string },
  ): Promise<DepartmentRow> {
    const now = new Date();
    const id = newId();
    await this.getPoolInstance().query(
      `INSERT INTO departments (id, tenant_id, parent_id, name, code, manager_user_id, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)`,
      [
        id,
        tenantId,
        input.parentId ?? null,
        input.name,
        input.code ?? null,
        input.managerUserId ?? null,
        now,
      ],
    );
    return this.getDepartment(tenantId, id)!;
  }

  async listDepartments(
    tenantId: string,
    query: { includeInactive: boolean; page: number; limit: number },
  ) {
    const offset = (query.page - 1) * query.limit;
    let sql = `SELECT * FROM departments WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (!query.includeInactive) {
      sql += ` AND is_active = true`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(query.limit, offset);

    const result = await this.getPoolInstance().query<DepartmentRow>(sql, params);
    return result.rows;
  }

  async updateDepartment(
    tenantId: string,
    id: string,
    input: {
      name?: string;
      code?: string | null;
      parentId?: string | null;
      managerUserId?: string | null;
      isActive?: boolean;
    },
  ): Promise<DepartmentRow> {
    const now = new Date();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.code !== undefined) {
      updates.push(`code = $${paramIndex++}`);
      values.push(input.code);
    }
    if (input.parentId !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(input.parentId);
    }
    if (input.managerUserId !== undefined) {
      updates.push(`manager_user_id = $${paramIndex++}`);
      values.push(input.managerUserId);
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(id);
    values.push(tenantId);

    await this.getPoolInstance().query(
      `UPDATE departments SET ${updates.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}`,
      values,
    );

    return this.getDepartment(tenantId, id)!;
  }

  private async getDepartment(tenantId: string, id: string): Promise<DepartmentRow> {
    const result = await this.getPoolInstance().query<DepartmentRow>(
      `SELECT * FROM departments WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', 'Departman bulunamadı');
    }
    return row;
  }

  async deleteDepartment(tenantId: string, id: string): Promise<void> {
    await this.getPoolInstance().query(`DELETE FROM departments WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
  }

  async assignUserDepartments(
    tenantId: string,
    userId: string,
    departmentIds: string[],
  ): Promise<void> {
    for (const departmentId of departmentIds) {
      await this.getPoolInstance().query(
        `INSERT INTO tenant_user_departments (tenant_id, user_id, department_id, created_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT DO NOTHING`,
        [tenantId, userId, departmentId],
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
