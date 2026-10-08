# ADR-0015: Optimistic Lock — `version` Kolonu + `If-Match` Header

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §0.5 · SPEC §22.2 (VERSION_MISMATCH)

## Bağlam
Çok kullanıcılı düzenleme senaryolarında (cari kart, fatura taslağı, stok kartı) kayıt çakışması olmamalıdır.
Pessimistic lock (SELECT FOR UPDATE) ölçeklenmez; optimistic lock tercih edilir.

## Karar
- Tüm **kart/ana veri tablolarında** (`users`, `tenants`, `contacts`, `products`, `roles`, `branches`, `departments`, vb.) **`version integer NOT NULL DEFAULT 1`** kolonu zorunludur.
- `UPDATE` sorgusunda `WHERE id = $1 AND version = $2` koşulu eklenir; `SET version = version + 1`.
- Etkilenen satır sayısı 0 ise `VERSION_MISMATCH` (HTTP 409) döner.
- API isteğinde **`If-Match: <version>`** header zorunludur (GET yanıtında `ETag: <version>` döner).
- **Finansal hareket tabloları** (`stock_movements`, `cash_transactions`, `journal_entries` vb.) **güncellenemez**; ters kayıt ile düzeltilir (ADR-0010).

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Pessimistic lock (SELECT FOR UPDATE) | Bağlantı havuzu tüketimi, deadlock riski |
| Timestamp tabanlı (`updated_at`) | Yarış koşullarında çakışma (milisaniye hassasiyeti) |
| Version olmadan `updated_at` karşılaştırması | Aynı saniyede iki güncelleme kaybedilir |

## Sonuçlar
- ➕ Kullanıcı deneyimi: "Kayıt başkası tarafından güncellendi, lütfen yenileyin" mesajı
- ➕ Kilitlenme yok, ölçeklenebilir
- ➖ İstemci tarafında version/ETag yönetimi gerekir

## Kapanış Kriteri
- Eşzamanlı iki `PUT /contacts/{id}` isteği: biri 200, diğeri 409 VERSION_MISMATCH
- `If-Match` header olmadan `PUT` → 428 Precondition Required