# ADR-0013: OpenAPI Zod'dan otomatik üretilir

**Tarih:** 5 Ekim 2026
**Durum:** Kabul

## Bağlam
SPEC §22 OpenAPI sözleşmesini zorunlu kılıyordu ama Zod zaten tek validation kaynağı (SPEC §29.6). Çift bakım riski.

## Karar
- Zod şemaları (`packages/shared`) tek doğruluk kaynağıdır.
- `docs/api/openapi.yaml` **Zod'dan üretilir** (`zod-to-openapi` benzeri).
- CI'da `npm run openapi:generate` kontrolü: üretilen dosya commit'lendi mi?
- Web/mobil/entegrasyon ekipleri için sözleşme buradan okunur.

## Alternatifler
- Manuel OpenAPI: çift bakım, tutarsızlık riski.
- Ayrı sözleşme dosyası: Zod ile senkronize edilmeli.

## Sonuç
Kod değişince doküman otomatik güncellenir; drift yok.

## Kapanış Kriteri
Faz 0'da auth + tenants endpoint'leri Zod'dan üretilir; CI kontrolü yeşil.