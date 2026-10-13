-- Faz 5: Otomatik Yedekleme (Backup) Modülü
-- Platform seviyesi tablolar (tenant RLS yoktur — sistem genelindeki yedek listesi/ayarları).
-- Yedek dosyaları diskte `<backupDir>/<backupId>.sql.gz` olarak saklanır; bu tablo metadata tutar.

CREATE TABLE IF NOT EXISTS backup_jobs (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running'
        CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])),
    size_bytes bigint,
    file_name text,
    error text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_settings (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled boolean NOT NULL DEFAULT true,
    interval_minutes integer NOT NULL DEFAULT 15
        CHECK (interval_minutes BETWEEN 1 AND 1440),
    retention_count integer NOT NULL DEFAULT 20
        CHECK (retention_count BETWEEN 1 AND 100),
    next_run_at timestamptz NOT NULL DEFAULT now(),
    last_run_at timestamptz,
    last_status text,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tek satır, varsayılan 15 dakika; ilk çalıştırmaya kadar 15 dk.
INSERT INTO backup_settings (id, enabled, interval_minutes, retention_count, next_run_at)
VALUES (1, true, 15, 20, now() + interval '15 minutes')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_backup_jobs_started ON backup_jobs(started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON backup_jobs TO app_user;
GRANT SELECT, UPDATE ON backup_settings TO app_user;
