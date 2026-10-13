-- Faz 7 (T-7.2) geri alma: sessiz saat varsayılanlarını kaldır (SPEC §30.7).
ALTER TABLE notification_preferences
    ALTER COLUMN quiet_hours_start DROP DEFAULT,
    ALTER COLUMN quiet_hours_end DROP DEFAULT;
