-- Faz 7 (Onay Kutusu) geri alma (SPEC §30.7).
DROP TABLE IF EXISTS approval_requests;
DELETE FROM permissions WHERE code IN (
  'management.approval.read',
  'management.approval.create',
  'management.approval.decide'
);
