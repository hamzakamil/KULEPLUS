# ADR-0018: Sıralama ve Filtreleme — Standart Parametreler

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §22.2, §24 · ROADMAP Faz 1

## Bağlam
Liste endpoint'lerinde tutarsız sıralama/filtreleme parametreleri frontend karmaşıklığı yaratıyordu.

## Karar
### Sıralama
- Parametre: `sort=<field>[:asc|desc]` — ör: `sort=created_at:desc`
- Çoklu: `sort=created_at:desc,name:asc`
- Varsayılan: `created_at:desc` (hareket tabloları), `name:asc` (kart listeleri)
- Geçersiz alan → 400 `VALIDATION_ERROR` (`INVALID_SORT_FIELD`)

### Filtreleme
- Parametre: `filter[field]=value` — ör: `filter[status]=active`
- Operatörler: `eq` (varsayılan), `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `nin`, `null`, `not_null`
  - Ör: `filter[created_at][gte]=2026-01-01`
- Çoklu değer: `filter[status][in]=active,pending`
- Geçersiz alan/operatör → 400 `VALIDATION_ERROR`

### Arama (Full-text / ILIKE)
- Parametre: `q=<terim>` — `pg_trgm + unaccent` ile `ILIKE` (SPEC §3.1)
- Türkçe karakter duyarsız: "İstanbul" ↔ "istanbul"

### Sayfalama (ADR-0014 ile uyumlu)
- Offset: `limit=50&offset=0` (varsayılan 50, max 200)
- Cursor: `limit=50&cursor=<uuid>` (hareket tabloları)

### Yanıt Formatı
```json
{
  "data": [...],
  "meta": {
    "total": 1234,
    "limit": 50,
    "offset": 0,
    "hasMore": true,
    "sort": "created_at:desc",
    "filters": { "status": "active" }
  }
}
```

## Arama Endpoint'leri (Özel)
- `GET /api/v1/contacts/search?q=ahmet&limit=10` → typeahead için optimize
- `GET /api/v1/products/search?sku=123&limit=5` → barkod/SKU arama

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| GraphQL | REST yeterli; ek karmaşıklık |
| OData | Çok ağır; frontend basitlik kaybeder |

## Kapanış Kriteri
- `GET /contacts?sort=name:asc&filter[status]=active&q=ahmet&limit=20` → 200 + meta
- Geçersiz `sort=invalid` → 400 `VALIDATION_ERROR`