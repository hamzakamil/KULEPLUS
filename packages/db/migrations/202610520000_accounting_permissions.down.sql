-- Down migration for 202610520000_accounting_permissions.sql (SPEC §30.7: down zorunlu)
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN (
  'accounting.account.read',
  'accounting.account.manage',
  'accounting.period.read',
  'accounting.period.manage',
  'accounting.period.close',
  'accounting.mapping.read',
  'accounting.mapping.manage',
  'accounting.report.read'
));
DELETE FROM permissions WHERE code IN (
  'accounting.account.read',
  'accounting.account.manage',
  'accounting.period.read',
  'accounting.period.manage',
  'accounting.period.close',
  'accounting.mapping.read',
  'accounting.mapping.manage',
  'accounting.report.read'
);
