# ADR-0020: Mimari — Modüler Monolit, Paylaşılan Kernel

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §1.2 (Repo yapısı) · SPEC §1.3 (Teknoloji matrisi) · ROADMAP §4

## Bağlam
Mikroservis karmaşıklığı (dağıtık transaction, service discovery, network partition) erken aşamada maliyetsiz. Monolit içinde modüler sınırlar yeterli.

## Karar
- **Modüler Monolit**: Tek deploy, tek veritabanı, modül sınırları kod seviyesinde.
- **Katman Zinciri** (SPEC §1.2):
  ```
  Controller → Application Service → Domain Logic → Repository/Port → Adapter → DB / Dış API
  ```
  - Controller: HTTP, doğrulama, hata formatı — **iş kuralı YOK**
  - Application Service: Use case orkestrasyonu, transaction sınırı — **HTTP/UI bağımlılığı YOK**
  - Domain Logic: İş kuralları, invariant'lar — **tarafızdan** kullanılır
  - Repository/Port: Veri erişim arayüzü — implementasyon Adapter'da
  - Adapter: PostgreSQL (Drizzle), REST (e-Fatura/ödeme), Redis, S3
- **Modül Sınırları** = GOVERNANCE §2 `module_code` = klasör adı = permission öneki = entitlement kodu
  - `modules/core/`, `modules/contacts/`, `modules/trade/`, vb.
  - Bir modül **başka modülün repository'sini doğrudan çağırmaz**; Port veya Application Service üzerinden
- **Paylaşılan Kernel** (`packages/shared`): id, money, tr, validators, errors, ports — tüm modüllerin ortak dili
- **Dış Dünya** her zaman Adapter üzerinden (e-Fatura, ödeme, SMS, e-posta) — dev'de Mock adapter

## Veritabanı
- **Tek PostgreSQL** (PostgreSQL 16) — RLS ile tenant izolasyonu
- **Üç rol**: `app_migrator` (DDL), `app_user` (RLS, NOBYPASSRLS), `app_platform` (platform verisi)
- **Migration**: Ham SQL + Drizzle; `YYYYMMDDHHMM_<slug>.sql` + zorunlu down SQL

## Kuyruk / Async
- **Redis + BullMQ** — Outbox pattern (eventual consistency)
- `outbox_events` tablosu → BullMQ worker → Adapter çağrısı
- Idempotency key ile at-least-once delivery

## Çıkarılanlar
- Mikroservis, Kubernetes, Service Mesh (Faz 7+)
- Socket.IO (Faz 9 PWA push için)
- Kendi UBL-TR/XSD hattı — GİB onaylı entegratör REST API

## Kapanış Kriteri
- Yeni modül eklendiğinde: GOVERNANCE §2'ye satır + klasör + Port/Adapter + migration + test
- `scripts/governance-check.mjs` tablo/modül/permission tutarlılığını CI'da zorlar