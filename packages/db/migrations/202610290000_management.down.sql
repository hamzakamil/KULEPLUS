-- Faz 7: Yonetim Paketi (management) geri alma (SPEC §30.7: down SQL zorunlu).
-- Bagimlilik sirasi: once cocuk tablolar (FK), sonra ebeveynler.
DROP TABLE IF EXISTS notification_deliveries;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS user_devices;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS calendar_events;
DROP TABLE IF EXISTS calendars;
DROP TABLE IF EXISTS tasks;

-- Permission katalog senkronunun geri alinmasi: yalnizca bu Faz 7 migration'inin
-- ekledigi management.* kodlari silinir.
DELETE FROM permissions WHERE module = 'management';
