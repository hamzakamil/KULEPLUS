-- Faz 7.6: Şantiye (saha) kayıtları — ROADMAP Faz 7 (Yönetim Paketi).
--
-- Neden ayrı tablo?
--   * Kokpitteki "Şantiyeler" kartı ile hava durumu bölümü, şantiyenin bulunduğu
--     il/ilçeye göre Meteoroloji (MGM) tahmini gösterir; bu bilgi hiçbir tabloda
--     yoktu (`project_tags` belge boyutudur, konum taşımaz).
--   * MGM `servis.mgm.gov.tr/web/merkezler?sorgu=<il|ilçe>` araması il/ilçe adıyla
--     istasyon (`merkezId`, `saatlikTahminIstNo`) çözer → il zorunlu, ilçe opsiyonel.

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  /** MGM il/ilçe çözümlemesi bu iki alandan yapılır (il zorunlu). */
  province text NOT NULL,
  district text,
  address text,
  /** İşveren / ana cari (opsiyonel, `project_tags.contact_id` deseni). */
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_status ON sites(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sites_province ON sites(tenant_id, province);

-- ===== RLS (SPEC §7 — tenant izolasyonu) =====
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_tenant_isolation ON sites;
CREATE POLICY sites_tenant_isolation ON sites
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_user;

-- ======================= Permission katalog senkronu =======================
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
-- Deterministik UUID: ADR-0002 (id = md5('permission:' || code) → tireli uuid).
INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('management', 'site', 'read', 'management.site.read', 'Santiyeleri goruntule', true, true),
  ('management', 'site', 'create', 'management.site.create', 'Santiye olustur', true, true),
  ('management', 'site', 'update', 'management.site.update', 'Santiye guncelle', true, true),
  ('management', 'site', 'delete', 'management.site.delete', 'Santiye sil', true, true)) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
