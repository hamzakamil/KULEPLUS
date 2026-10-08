# Hata Kodu Kataloğu

**Durum:** İskelet — Faz 1'de doldurulacak
**Tek kaynak:** `packages/shared/errors/codes.ts`

## Format
| Kod | HTTP | Modül | Mesaj | Açıklama |
|-----|------|-------|-------|----------|
| `PERIOD_LOCKED` | 409 | accounting | "Bu dönem işlem girişine kapalıdır." | Kapalı döneme kayıt denemesi |
| `MODULE_NOT_ENTITLED` | 403 | subscription | "Bu modül paketinizde yok." | Entitlement kontrolü başarısız |
| `LIMIT_EXCEEDED` | 409 | subscription | "Kota aşıldı." | Plan limiti |
| `VERSION_MISMATCH` | 409 | core | "Kayıt başkası tarafından güncellendi." | Optimistic lock |
| `CONFLICT` | 409 | core | "Bu kayıt zaten mevcut." | Benzersizlik çakışması (e-posta, bekleyen davet/başvuru) |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | core | "Bu istek daha önce işlendi." | Idempotency |
| `TENANT_FORBIDDEN` | 403 | core | "Bu tenant'a erişim yetkiniz yok." | RLS/üyelik |
| `SUPPORT_ACCESS_REQUIRED` | 403 | platform | "Destek erişim grantı gerekli." | Çapraz tenant |
| `NOT_FOUND` | 404 | core | "İstenen kaynak bulunamadı." | Bulunamayan rota/kayıt |
| `INTERNAL_ERROR` | 500 | core | "Beklenmeyen bir hata oluştu." | Beklenmeyen sunucu hatası (stack yalnızca log'da) |
| ... | ... | ... | ... | ... |