-- Faz 7 (T-7.5) geri alma (SPEC §30.7).
DROP TABLE IF EXISTS management_rule_settings;
DELETE FROM permissions WHERE code IN ('management.rule.read', 'management.rule.manage');
