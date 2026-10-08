# ADR-0017: Hata Sözleşmesi — Tek Format, `code` Zorunlu

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §22.1, §22.2 · `packages/shared/src/errors/codes.ts` · `docs/api/error-codes.md`

## Bağlam
API hata yanıtları tutarsızdı; frontend hata koduna göre i18n çevirisi yapamıyordu.

## Karar
- **Tüm hata yanıtları** tek JSON formatında:
  ```json
  { "error": { "code": "MODULE_NOT_ENTITLED", "message": "Bu modül paketinizde yok." } }
  ```
- **`code` zorunludur**; frontend `t('errors.' + code)` ile çevirir (docs/product/i18n.md).
- **HTTP status** hata koduna bağlıdır (400, 401, 403, 404, 409, 422, 428, 500).
- **Hata kodu kataloğu** tek kaynaktır: `packages/shared/src/errors/codes.ts` → `docs/api/error-codes.md` (CI senkron kontrolü).
- **Frontend çevirisi**: `t('errors.' + code)` (docs/product/i18n.md).
- **Stack trace** production'da asla döndürülmez; sadece loglanır.

## Hata Kodu Formatı
`MODULE.RESOURCE.ACTION` — ör: `subscription.module.not_entitled` → `MODULE_NOT_ENTITLED`.

## HTTP Status Eşleme (SPEC §22.2)
| Kod | HTTP | Açıklama |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Zod doğrulama hatası |
| `UNAUTHENTICATED` | 401 | JWT eksik/geçersiz |
| `FORBIDDEN` | 403 | Yetki yok (RLS/permission) |
| `NOT_FOUND` | 404 | Kayıt yok |
| `MODULE_NOT_ENTITLED` | 403 | Modül pakette yok |
| `LIMIT_EXCEEDED` | 409 | Kota aşıldı |
| `VERSION_MISMATCH` | 409 | Optimistic lock çakışması |
| `CONFLICT` | 409 | Benzersizlik çakışması (kayıt zaten var) |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Tekrar eden idempotency key |
| `TENANT_FORBIDDEN` | 403 | Başka tenant verisi |
| `SUPPORT_ACCESS_REQUIRED` | 403 | Support grant gerekli |
| `PRECONDITION_REQUIRED` | 428 | `If-Match` header eksik |
| `INTERNAL_ERROR` | 500 | Beklenmeyen hata |

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Farklı endpoint'ler farklı format | Frontend karmaşıklığı, i18n imkansız |
| Sadece HTTP status | Hata nedeni frontend'de çözülemez |

## Sonuçlar
- ➕ Frontend tek `catch` bloğuyla tüm hataları yakalar
- ➕ i18n: `t('errors.MODULE_NOT_ENTITLED')` → çeviri
- ➕ CI: `scripts/governance-check.mjs` kod formatını zorlar

## Kapanış Kriteri
- Tüm endpoint'ler `AppError` fırlatır; `toJSON()` sözleşmeyi üretir
- `docs/api/error-codes.md` ile `packages/shared/src/errors/codes.ts` CI'da senkron