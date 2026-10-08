import { Router, type Request, type Response, type NextFunction } from 'express';
import type { z } from 'zod';
import { AuthorizationService } from './service.js';
import { validate } from '../../middleware/validate.js';
import {
  createInvitationSchema,
  acceptInvitationSchema,
  invitationParamsSchema,
  invitationQuerySchema,
  createRoleSchema,
  updateRoleSchema,
  roleParamsSchema,
  roleQuerySchema,
  permissionQuerySchema,
  assignPermissionsSchema,
  updateRolePermissionScopeSchema,
  assignUserRolesSchema,
  removeUserRoleSchema,
  transferOwnershipSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  departmentParamsSchema,
  departmentQuerySchema,
  assignUserDepartmentsSchema,
} from './schemas.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { AppError } from '@kuleplus/shared';

const router = Router();
const service = new AuthorizationService();

/** Express ParsedQs'u şemaya göre doğrula ve tipleyerek dışa aktar. */
function parseQuery<T>(schema: z.ZodSchema<{ query: T }>, req: Request): T {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError('VALIDATION_ERROR', messages);
  }
  return parsed.data.query;
}

// === Invitations ===

/** Public: Davet oluştur (korumalı route - sadece tenant_owner yapabilir) */
router.post(
  '/invitations',
  authenticate,
  validate(createInvitationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { tenantId, email, roleIds } = req.body;
      if (!req.user?.tenantId || req.user.tenantId !== tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Bu işlem için yetkiniz yok');
      }
      const result = await service.createInvitation({
        tenantId,
        email,
        roleIds,
        createdBy: req.user.sub,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Public: Davet kabul et */
router.post(
  '/invitations/:id/accept',
  validate(acceptInvitationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.acceptInvitation(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Davetleri listele */
router.get(
  '/invitations',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const query = parseQuery(invitationQuerySchema, req);
      const invitations = await service.listInvitations(tenantId, {
        ...query,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      });
      res.json(invitations);
    } catch (error) {
      next(error);
    }
  },
);

/** Daveti iptal et */
router.post(
  '/invitations/:id/revoke',
  authenticate,
  validate(invitationParamsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      await service.revokeInvitation(tenantId, req.params.id);
      res.json({ message: 'Davet iptal edildi' });
    } catch (error) {
      next(error);
    }
  },
);

// === Roles ===

/** Rollerı listele */
router.get(
  '/roles',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const query = parseQuery(roleQuerySchema, req);
      const roles = await service.listRoles(tenantId, {
        ...query,
        includeSystem: query.includeSystem ?? false,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      });
      res.json(roles);
    } catch (error) {
      next(error);
    }
  },
);

/** Rol oluştur */
router.post(
  '/roles',
  authenticate,
  validate(createRoleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const role = await service.createRole(tenantId, req.body);
      res.status(201).json(role);
    } catch (error) {
      next(error);
    }
  },
);

/** Rol güncelle */
router.patch(
  '/roles/:id',
  authenticate,
  validate(updateRoleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const role = await service.updateRole(tenantId, req.params.id, req.body);
      res.json(role);
    } catch (error) {
      next(error);
    }
  },
);

/** Rol sil */
router.delete(
  '/roles/:id',
  authenticate,
  validate(roleParamsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      await service.deleteRole(tenantId, req.params.id);
      res.json({ message: 'Rol silindi' });
    } catch (error) {
      next(error);
    }
  },
);

// === Permissions ===

/** İzinleri listele */
router.get(
  '/permissions',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseQuery(permissionQuerySchema, _req);
      const permissions = await service.listPermissions({
        ...query,
        page: query.page ?? 1,
        limit: query.limit ?? 50,
      });
      res.json(permissions);
    } catch (error) {
      next(error);
    }
  },
);

// === Role İzinleri ===

/** Role izin ata */
router.post(
  '/roles/:roleId/permissions',
  authenticate,
  validate(assignPermissionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      await service.assignPermissions(
        req.params.roleId,
        tenantId,
        req.body.permissionIds,
        req.body.scope,
      );
      res.json({ message: 'İzinler rolüne eklendi' });
    } catch (error) {
      next(error);
    }
  },
);

/** Role izin kapsamını güncelle */
router.patch(
  '/roles/:roleId/permissions/:permissionId',
  authenticate,
  validate(updateRolePermissionScopeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      await service.updateRolePermissionScope(
        tenantId,
        req.params.roleId,
        req.params.permissionId,
        req.body.scope,
      );
      res.json({ message: 'İzin kapsamı güncellendi' });
    } catch (error) {
      next(error);
    }
  },
);

// === Kullanıcı Rolleri ===

/** Kullanıcıya rol ata */
router.post(
  '/tenants/:tenantId/users/:userId/roles',
  authenticate,
  validate(assignUserRolesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.tenantId !== req.params.tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Bu işlem için yetkiniz yok');
      }
      await service.assignUserRoles(req.params.tenantId, req.params.userId, req.body.roleIds);
      res.json({ message: 'Roller kullanıcıya atandı' });
    } catch (error) {
      next(error);
    }
  },
);

/** Kullanıcıdan rol kaldır */
router.delete(
  '/tenants/:tenantId/users/:userId/roles/:roleId',
  authenticate,
  validate(removeUserRoleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.tenantId !== req.params.tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Bu işlem için yetkiniz yok');
      }
      await service.removeUserRole(req.params.tenantId, req.params.userId, req.params.roleId);
      res.json({ message: 'Kullanıcıdan rol kaldırıldı' });
    } catch (error) {
      next(error);
    }
  },
);

// === Owner Transfer ===

/** Owner transferi */
router.post(
  '/tenants/:tenantId/transfer-ownership',
  authenticate,
  validate(transferOwnershipSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.tenantId !== req.params.tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Bu işlem için yetkiniz yok');
      }
      await service.transferOwnership(req.params.tenantId, req.body);
      res.json({ message: 'Owner transferi yapıldı' });
    } catch (error) {
      next(error);
    }
  },
);

// === Departmanlar ===

/** Departman oluştur */
router.post(
  '/departments',
  authenticate,
  validate(createDepartmentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const department = await service.createDepartment(tenantId, req.body);
      res.status(201).json(department);
    } catch (error) {
      next(error);
    }
  },
);

/** Departmanları listele */
router.get(
  '/departments',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const query = parseQuery(departmentQuerySchema, req);
      const departments = await service.listDepartments(tenantId, {
        includeInactive: query.includeInactive ?? false,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      });
      res.json(departments);
    } catch (error) {
      next(error);
    }
  },
);

/** Departman güncelle */
router.patch(
  '/departments/:id',
  authenticate,
  validate(updateDepartmentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      const department = await service.updateDepartment(tenantId, req.params.id, req.body);
      res.json(department);
    } catch (error) {
      next(error);
    }
  },
);

/** Departman sil */
router.delete(
  '/departments/:id',
  authenticate,
  validate(departmentParamsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      await service.deleteDepartment(tenantId, req.params.id);
      res.json({ message: 'Departman silindi' });
    } catch (error) {
      next(error);
    }
  },
);

// === Kullanıcı Departmanları ===

/** Kullanıcıya departman ata */
router.post(
  '/tenants/:tenantId/users/:userId/departments',
  authenticate,
  validate(assignUserDepartmentsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.tenantId !== req.params.tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Bu işlem için yetkiniz yok');
      }
      await service.assignUserDepartments(
        req.params.tenantId,
        req.params.userId,
        req.body.departmentIds,
      );
      res.json({ message: 'Departmanlar kullanıcıya atandı' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
