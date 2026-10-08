# ADR-0016: Audit Log — Değişmez Kayıt + RLS

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §27.3 · ROADMAP Faz 1

## Bağlam
Her veri değişikliği (kim, ne zaman, ne değiştirdi) izlenebilir olmalı; KVKK, denetim ve güvenlik için şart.

## Karar
- **`audit_logs` tablosu** tek kayıt kaynağıdır; her `INSERT/UPDATE/DELETE` sonrası tetiklenir.
- Kolonlar: `id`, `tenant_id` (nullable — platform olayları için), `user_id`, `action`, `entity_type`, `entity_id`, `old_values` (jsonb), `new_values` (jsonb), `ip_address`, `user_agent`, `request_id`, `created_at`.
- **RLS politikası**: `tenant_id = current_tenant_id()` — platform kullanıcıları (RLS bypass) hariç herkes kendi tenant'ını görür.
- **Yazma yetkisi**: `app_user` INSERT yapabilir; UPDATE/DELETE **yasak** (trigger ile engellenir). Sadece `app_migrator` (migration) veya `app_platform` (platform audit temizliği) silebilir.
- **WAL arşivi** (PostgreSQL WAL) + günlük `pg_basebackup` ile 7 yıl saklama (VUK/TTK).
- **İçerik**: `old_values`/`new_values` sadece değişen alanları içerir (PII maskelemesi: TCKN/VKN/IBAN son 4 hane).

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Sadece `updated_at` + `updated_by` | Değişen alan belli olmaz; eski değer kaybolur |
| Harici log servisi (ELK, Loki) | Ek altyapı maliyeti; PostgreSQL JSONB yeterli |

## Sonuçlar
- ➕ Tam izlenebilirlik, KVKK uyumu
- ➕ RLS ile tenant izolasyonu otomatik
- ➖ Yazma hacmi yüksek (her UPDATE'te 1 satır) — partitioning (aylık) planlı

## Kapanış Kriteri
- `UPDATE contacts SET name='X' WHERE id=...` → `audit_logs` 1 satır eklenir
- `tenant_A` kullanıcısı `tenant_B` audit logunu okuyamaz (RLS testi yeşil)
- `DELETE FROM audit_logs` → hata (trigger engeller)