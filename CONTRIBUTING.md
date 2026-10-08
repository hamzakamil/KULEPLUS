# Katılım / Geliştirme Kuralları

Bu depo **özel/ticari lisanslıdır** (MIT değil — README §17). Kaynak kodun kopyalanması,
satılması veya türev çalışma üretilmesi yazılı izne tabidir.

## Commit mesajları (Conventional Commits)

```
feat: ...    yeni özellik
fix: ...     hata düzeltmesi
docs: ...    yalnızca doküman
test: ...    yalnızca test
chore: ...   altyapı/bağımlılık
refactor: ... kod davranışı değişmeden yeniden düzenleme
```

## Pull Request kuralları

1. **GOVERNANCE §7:** Çelişki tespit edilirse önce ADR (`docs/adr/NNNN-<slug>.md`) yazılır,
   etkilenen dokümanlar aynı PR'da güncellenir.
2. **SPEC §29 tamamlanma zinciri:** migration → şema doğrulama → service → API → yetki →
   entitlement → denetim → test → dokümantasyon. Bir iş; çalışır + SOLID + DRY + test edilmiş
   + yetki/denetim/paket kontrolü tamam olduğunda biter.
3. **CI kapısı:** `npm run governance:check` · `npm run typecheck` · `npm test` ·
   `npm run build:site` · `npm run bundle:budget` — hepsi yeşil olmadan merge yok.
4. **UTF-8 / mojibake yasak** (SPEC §3): `npm run docs:fix-encoding` ile kontrol edilebilir.
5. **Para için `number`/`float` yasak** (SPEC §0.3): yalnızca `packages/shared/money`
   (decimal.js) kullanılır; finansal alanlarda `FLOAT`/`DOUBLE` tanımlanamaz.
6. **Yeni tablo / yeni permission:** yalnızca GOVERNANCE §2'ye satır eklenerek eklenir
   (`scripts/governance-check.mjs` CI'da bunu zorlar).

## Komutlar

| Komut | Açıklık |
|-------|---------|
| `npm run dev:site` | Pazarlama sitesi (Astro) |
| `npm test` | Tüm workspace testleri (Vitest) |
| `npm run typecheck` | TypeScript kontrolü |
| `npm run governance:check` | GOVERNANCE kural kontrolü |
| `npm run bundle:budget` | JS gzip bütçesi (250 KB / 100 KB) |
| `docker compose up -d` | PostgreSQL 16, Redis, MinIO, Mailpit |
