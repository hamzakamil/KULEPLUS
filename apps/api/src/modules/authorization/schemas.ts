import { z } from 'zod';

// ===== Invitation Schemas =====

export const createInvitationSchema = z.object({
  body: z.object({
    email: z.string().email('Geçerli bir e-posta adresi giriniz'),
    roleIds: z.array(z.string().uuid('Geçerli bir rol ID giriniz')).min(1, 'En az bir rol seçiniz'),
  }),
});

export const acceptInvitationSchema = z.object({
  body: z
    .object({
      token: z.string().min(1, 'Davet tokenı zorunludur'),
      password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır'),
      passwordConfirm: z.string(),
    })
    .refine((data) => data.password === data.passwordConfirm, {
      message: 'Şifreler eşleşmiyor',
      path: ['passwordConfirm'],
    }),
});

export const invitationParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Geçerli bir davet ID giriniz'),
  }),
});

export const invitationQuerySchema = z.object({
  query: z.object({
    email: z.string().email('Geçerli bir e-posta adresi giriniz').optional(),
    status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

// ===== Role Schemas =====

export const createRoleSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Rol adı zorunludur')
      .max(100, 'Rol adı en fazla 100 karakter olabilir'),
    code: z.string().max(50, 'Rol kodu en fazla 50 karakter olabilir').optional(),
    isSystem: z.boolean().default(false),
    isDefault: z.boolean().default(false),
    permissionIds: z.array(z.string().uuid('Geçerli bir permission ID giriniz')).optional(),
  }),
});

export const updateRoleSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Rol adı zorunludur')
      .max(100, 'Rol adı en fazla 100 karakter olabilir')
      .optional(),
    code: z.string().max(50, 'Rol kodu en fazla 50 karakter olabilir').optional(),
    isDefault: z.boolean().optional(),
    permissionIds: z.array(z.string().uuid('Geçerli bir permission ID giriniz')).optional(),
  }),
  params: z.object({
    id: z.string().uuid('Geçerli bir rol ID giriniz'),
  }),
});

export const roleParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Geçerli bir rol ID giriniz'),
  }),
});

export const roleQuerySchema = z.object({
  query: z.object({
    includeSystem: z.coerce.boolean().default(false),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});
// ===== Permission Schemas =====

export const permissionQuerySchema = z.object({
  query: z.object({
    module: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

// ===== Role Permission Assignment Schemas =====

export const assignPermissionsSchema = z.object({
  body: z.object({
    permissionIds: z
      .array(z.string().uuid('Geçerli bir permission ID giriniz'))
      .min(1, 'En az bir permission seçiniz'),
    scope: z
      .enum(['all', 'own_branch', 'own_department', 'assigned_only', 'created_by_me', 'self'])
      .default('all'),
  }),
  params: z.object({
    roleId: z.string().uuid('Geçerli bir rol ID giriniz'),
  }),
});

export const updateRolePermissionScopeSchema = z.object({
  body: z.object({
    scope: z.enum([
      'all',
      'own_branch',
      'own_department',
      'assigned_only',
      'created_by_me',
      'self',
    ]),
  }),
  params: z.object({
    roleId: z.string().uuid('Geçerli bir rol ID giriniz'),
    permissionId: z.string().uuid('Geçerli bir permission ID giriniz'),
  }),
});

// ===== User Role Assignment Schemas =====

export const assignUserRolesSchema = z.object({
  body: z.object({
    userId: z.string().uuid('Geçerli bir kullanıcı ID giriniz'),
    roleIds: z.array(z.string().uuid('Geçerli bir rol ID giriniz')).min(1, 'En az bir rol seçiniz'),
  }),
  params: z.object({
    tenantId: z.string().uuid('Geçerli bir tenant ID giriniz'),
  }),
});

export const removeUserRoleSchema = z.object({
  params: z.object({
    tenantId: z.string().uuid('Geçerli bir tenant ID giriniz'),
    userId: z.string().uuid('Geçerli bir kullanıcı ID giriniz'),
    roleId: z.string().uuid('Geçerli bir rol ID giriniz'),
  }),
});

// ===== Owner Transfer Schema =====

export const transferOwnershipSchema = z.object({
  body: z.object({
    newOwnerUserId: z.string().uuid('Geçerli bir kullanıcı ID giriniz'),
    currentPassword: z.string().min(1, 'Mevcut şifre zorunludur'),
  }),
  params: z.object({
    tenantId: z.string().uuid('Geçerli bir tenant ID giriniz'),
  }),
});

// ===== Department Schemas =====

export const createDepartmentSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Departman adı zorunludur')
      .max(100, 'Departman adı en fazla 100 karakter olabilir'),
    code: z.string().max(50, 'Departman kodu en fazla 50 karakter olabilir').optional(),
    parentId: z.string().uuid('Geçerli bir üst departman ID giriniz').optional(),
    managerUserId: z.string().uuid('Geçerli bir yönetici kullanıcı ID giriniz').optional(),
  }),
});

export const updateDepartmentSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Departman adı zorunludur')
      .max(100, 'Departman adı en fazla 100 karakter olabilir')
      .optional(),
    code: z.string().max(50, 'Departman kodu en fazla 50 karakter olabilir').optional(),
    parentId: z.string().uuid('Geçerli bir üst departman ID giriniz').optional(),
    managerUserId: z.string().uuid('Geçerli bir yönetici kullanıcı ID giriniz').optional(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().uuid('Geçerli bir departman ID giriniz'),
  }),
});

export const departmentParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Geçerli bir departman ID giriniz'),
  }),
});

export const departmentQuerySchema = z.object({
  query: z.object({
    includeInactive: z.coerce.boolean().default(false),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

// ===== User Department Assignment =====

export const assignUserDepartmentsSchema = z.object({
  body: z.object({
    userId: z.string().uuid('Geçerli bir kullanıcı ID giriniz'),
    departmentIds: z
      .array(z.string().uuid('Geçerli bir departman ID giriniz'))
      .min(1, 'En az bir departman seçiniz'),
  }),
  params: z.object({
    tenantId: z.string().uuid('Geçerli bir tenant ID giriniz'),
  }),
});

// Type exports
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>['body'];
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>['body'];
export type InvitationParams = z.infer<typeof invitationParamsSchema>['params'];
export type InvitationQuery = z.infer<typeof invitationQuerySchema>['query'];

export type CreateRoleInput = z.infer<typeof createRoleSchema>['body'];
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>['body'];
export type RoleParams = z.infer<typeof roleParamsSchema>['params'];
export type RoleQuery = z.infer<typeof roleQuerySchema>['query'];

export type PermissionQuery = z.infer<typeof permissionQuerySchema>['query'];

export type AssignPermissionsInput = z.infer<typeof assignPermissionsSchema>['body'];
export type UpdateRolePermissionScopeInput = z.infer<
  typeof updateRolePermissionScopeSchema
>['body'];

export type AssignUserRolesInput = z.infer<typeof assignUserRolesSchema>['body'];
export type RemoveUserRoleParams = z.infer<typeof removeUserRoleSchema>['params'];

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>['body'];
export type TransferOwnershipParams = z.infer<typeof transferOwnershipSchema>['params'];

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>['body'];
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>['body'];
export type DepartmentParams = z.infer<typeof departmentParamsSchema>['params'];
export type DepartmentQuery = z.infer<typeof departmentQuerySchema>['query'];

export type AssignUserDepartmentsInput = z.infer<typeof assignUserDepartmentsSchema>['body'];
