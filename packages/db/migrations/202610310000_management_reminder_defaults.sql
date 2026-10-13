-- Faz 7 (T-7.2): Bildirim tercihleri varsayılan sessiz saatler 22:00–08:00.
-- Kaynak: ROADMAP T-7.2 (AI önerisi, kullanıcı onayı alındı).
-- Yeni tercih satırı sessiz saat belirtmezse bu aralık uygulanır; mevcut satırlar etkilenmez.
ALTER TABLE notification_preferences
    ALTER COLUMN quiet_hours_start SET DEFAULT '22:00',
    ALTER COLUMN quiet_hours_end SET DEFAULT '08:00';
