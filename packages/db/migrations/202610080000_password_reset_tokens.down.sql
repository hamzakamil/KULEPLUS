-- Down migration for password reset tokens
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
