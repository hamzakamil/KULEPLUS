-- Faz 7: Yonetim Paketi (management) — Gorev/Takvim/Randevu/Not/Bildirim cekirdegi
-- Kapsam: ROADMAP Faz 7, SPEC §16 (gorev, takvim, randevu, hatirlatici, not, aktivite)
--   ve SPEC §17 (bildirim domaini).
-- Tablolar (GOVERNANCE §2 management satiri):
--   tasks, reminders, calendars, calendar_events, appointments, notes, activities,
--   notifications, user_devices, notification_deliveries, notification_preferences.
-- Notlar:
--   * UUID v7 kurali (SPEC §0.1): id uygulama tarafinda newId() ile uretilir; DB default YOK.
--   * Tarih standardi (SPEC §16.4): anlik olay TIMESTAMPTZ, belge/tum-gun yerel tarih DATE,
--     tekrar yerel saat + IANA timezone + RRULE (timezone ayri kolon).
--   * notification_type merkezi enum'a bagli (SPEC §17.1); serbest string YOK.

-- ======================= Gorev =======================
CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'todo'
        CHECK (status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'waiting'::text, 'completed'::text, 'cancelled'::text])),
    priority text NOT NULL DEFAULT 'normal'
        CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
    assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
    due_at timestamptz,
    completed_at timestamptz,
    source text NOT NULL DEFAULT 'manual',            -- manual | invoice | contact | appointment | ...
    related_entity_type text,                         -- allowlist: invoice|expense|contact|product|appointment
    related_entity_id uuid,
    parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,   -- alt gorev
    rrule text,                                       -- RRULE (tekrarlayan gorev)
    tags text[] NOT NULL DEFAULT '{}',
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Hatirlatici =======================
CREATE TABLE IF NOT EXISTS reminders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
    event_id uuid,                                    -- calendar_events FK asagida eklenir (ileri referans)
    remind_at timestamptz NOT NULL,
    channel text NOT NULL DEFAULT 'in_app'
        CHECK (channel = ANY (ARRAY['push'::text, 'in_app'::text, 'email'::text, 'whatsapp'::text, 'sms'::text])),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])),
    snoozed_until timestamptz,
    quiet_hours_respected boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
);

-- ======================= Takvim =======================
CREATE TABLE IF NOT EXISTS calendars (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    calendar_type text NOT NULL DEFAULT 'personal'
        CHECK (calendar_type = ANY (ARRAY['personal'::text, 'company'::text, 'personnel'::text])),
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    color text,
    visibility text NOT NULL DEFAULT 'company'
        CHECK (visibility = ANY (ARRAY['private'::text, 'company'::text, 'shared'::text])),
    is_default boolean NOT NULL DEFAULT false,
    timezone text NOT NULL DEFAULT 'Europe/Istanbul',   -- IANA (SPEC §16.4)
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Takvim Etkinligi =======================
CREATE TABLE IF NOT EXISTS calendar_events (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    event_type text NOT NULL DEFAULT 'event',
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL,                   -- anlik olay (SPEC §16.4)
    ends_at timestamptz,
    all_day boolean NOT NULL DEFAULT false,
    local_start_date date,                            -- tum-gun yerel tarih araligi
    local_end_date date,
    timezone text NOT NULL DEFAULT 'Europe/Istanbul', -- tekrar icin ayri IANA kolon (SPEC §16.4)
    rrule text,                                       -- RRULE
    location text,
    visibility text NOT NULL DEFAULT 'company'
        CHECK (visibility = ANY (ARRAY['private'::text, 'company'::text, 'shared'::text])),
    status text NOT NULL DEFAULT 'scheduled'
        CHECK (status = ANY (ARRAY['scheduled'::text, 'cancelled'::text])),
    related_entity_type text,
    related_entity_id uuid,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- reminders.event_id artik calendar_events'e baglanabilir.
ALTER TABLE reminders
    ADD CONSTRAINT reminders_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

-- ======================= Randevu =======================
CREATE TABLE IF NOT EXISTS appointments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title text NOT NULL,
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    calendar_event_id uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])),
    location text,
    notes text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Not =======================
CREATE TABLE IF NOT EXISTS notes (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title text,
    body text,
    related_entity_type text,
    related_entity_id uuid,
    pinned boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Aktivite Akisi =======================
-- activities kullaniciya isletme akisini ozetler; audit_logs guvenlik/degisiklik
-- takibi icindir (SPEC §16.5) — ayridir. Append-only (updated_at yok).
CREATE TABLE IF NOT EXISTS activities (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    activity_type text NOT NULL,
    entity_type text,
    entity_id uuid,
    summary text NOT NULL,
    metadata jsonb,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Bildirim =======================
CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type text NOT NULL
        CHECK (notification_type = ANY (ARRAY[
            'task.assigned'::text, 'task.due_soon'::text, 'task.overdue'::text,
            'appointment.upcoming'::text, 'appointment.created'::text,
            'whatsapp.message_received'::text,
            'invoice.due_soon'::text, 'invoice.overdue'::text, 'payment.received'::text,
            'cash.low_balance'::text, 'stock.critical'::text, 'user.mentioned'::text,
            'subscription.payment_failed'::text, 'subscription.expiring'::text,
            'system.security_alert'::text, 'system.announcement'::text
        ])),
    title text NOT NULL,
    body text,
    entity_type text,
    entity_id uuid,
    payload jsonb,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'read'::text])),
    read_at timestamptz,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Kullanici Cihazi =======================
CREATE TABLE IF NOT EXISTS user_devices (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token text NOT NULL,
    platform text NOT NULL DEFAULT 'web'
        CHECK (platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])),
    device_name text,
    is_active boolean NOT NULL DEFAULT true,
    last_active_at timestamptz,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, device_token)
);

-- ======================= Bildirim Teslimati =======================
-- Gorev tamamlandi != hatirlatici tetiklendi != bildirim teslim edildi (SPEC §17.2).
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    device_id uuid REFERENCES user_devices(id) ON DELETE SET NULL,
    channel text NOT NULL DEFAULT 'in_app'
        CHECK (channel = ANY (ARRAY['push'::text, 'in_app'::text, 'email'::text, 'whatsapp'::text, 'sms'::text])),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'read'::text])),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    delivered_at timestamptz,
    read_at timestamptz,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Bildirim Tercihi =======================
CREATE TABLE IF NOT EXISTS notification_preferences (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type text NOT NULL
        CHECK (notification_type = ANY (ARRAY[
            'task.assigned'::text, 'task.due_soon'::text, 'task.overdue'::text,
            'appointment.upcoming'::text, 'appointment.created'::text,
            'whatsapp.message_received'::text,
            'invoice.due_soon'::text, 'invoice.overdue'::text, 'payment.received'::text,
            'cash.low_balance'::text, 'stock.critical'::text, 'user.mentioned'::text,
            'subscription.payment_failed'::text, 'subscription.expiring'::text,
            'system.security_alert'::text, 'system.announcement'::text
        ])),
    channel text NOT NULL
        CHECK (channel = ANY (ARRAY['push'::text, 'in_app'::text, 'email'::text, 'whatsapp'::text, 'sms'::text])),
    enabled boolean NOT NULL DEFAULT true,
    quiet_hours_start time,
    quiet_hours_end time,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, notification_type, channel)
);

-- ======================= RLS Policies =======================
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_tenant_isolation ON tasks
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY reminders_tenant_isolation ON reminders
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY calendars_tenant_isolation ON calendars
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY calendar_events_tenant_isolation ON calendar_events
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY appointments_tenant_isolation ON appointments
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY notes_tenant_isolation ON notes
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY activities_tenant_isolation ON activities
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY notifications_tenant_isolation ON notifications
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY user_devices_tenant_isolation ON user_devices
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY notification_deliveries_tenant_isolation ON notification_deliveries
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY notification_preferences_tenant_isolation ON notification_preferences
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- ======================= Indexler =======================
CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(tenant_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(tenant_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(tenant_id, parent_task_id);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant ON reminders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(tenant_id, status, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_task ON reminders(tenant_id, task_id);

CREATE INDEX IF NOT EXISTS idx_calendars_tenant ON calendars(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(tenant_id, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_tenant ON calendar_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(tenant_id, calendar_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(tenant_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(tenant_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_notes_tenant ON notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(tenant_id, related_entity_type, related_entity_id);

CREATE INDEX IF NOT EXISTS idx_activities_tenant ON activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_devices_tenant ON user_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(tenant_id, user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_tenant ON notification_deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification ON notification_deliveries(tenant_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant ON notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(tenant_id, user_id);

-- ======================= Izinler =======================
GRANT SELECT, INSERT, UPDATE, DELETE ON
    tasks,
    reminders,
    calendars,
    calendar_events,
    appointments,
    notes,
    activities,
    notifications,
    user_devices,
    notification_deliveries,
    notification_preferences
TO app_user;

-- ======================= Permission katalog senkronu (Faz 7) =======================
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
INSERT INTO permissions (module, resource, action, code, name, delegatable, is_system_permission) VALUES
  ('management', 'task', 'read', 'management.task.read', 'Gorevleri goruntule', true, true),
  ('management', 'task', 'create', 'management.task.create', 'Gorev olustur', true, true),
  ('management', 'task', 'update', 'management.task.update', 'Gorev guncelle', true, true),
  ('management', 'task', 'delete', 'management.task.delete', 'Gorev sil', true, true),
  ('management', 'task', 'assign', 'management.task.assign', 'Gorev ata', true, true),
  ('management', 'task', 'complete', 'management.task.complete', 'Gorev tamamla', true, true),
  ('management', 'calendar', 'read', 'management.calendar.read', 'Takvimi goruntule', true, true),
  ('management', 'calendar', 'manage', 'management.calendar.manage', 'Takvim yonet', true, true),
  ('management', 'appointment', 'read', 'management.appointment.read', 'Randevulari goruntule', true, true),
  ('management', 'appointment', 'create', 'management.appointment.create', 'Randevu olustur', true, true),
  ('management', 'appointment', 'update', 'management.appointment.update', 'Randevu guncelle', true, true),
  ('management', 'appointment', 'manage', 'management.appointment.manage', 'Randevu durumu yonet (onay/iptal/no-show)', true, true),
  ('management', 'note', 'read', 'management.note.read', 'Notlari goruntule', true, true),
  ('management', 'note', 'create', 'management.note.create', 'Not olustur', true, true),
  ('management', 'note', 'update', 'management.note.update', 'Not guncelle', true, true),
  ('management', 'note', 'delete', 'management.note.delete', 'Not sil', true, true),
  ('management', 'activity', 'read', 'management.activity.read', 'Aktivite akisini goruntule', true, true),
  ('management', 'notification', 'read', 'management.notification.read', 'Bildirimleri goruntule', true, true),
  ('management', 'notification', 'send', 'management.notification.send', 'Bildirim gonder', true, true),
  ('management', 'preference', 'manage', 'management.preference.manage', 'Bildirim tercihlerini yonet', true, true),
  ('management', 'device', 'manage', 'management.device.manage', 'Bildirim cihazlarini yonet', true, true)
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
