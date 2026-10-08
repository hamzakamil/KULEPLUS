# İlk Push — GitHub Hazırlık Rehberi

**Durum:** Repo oluşturulacak (karar: 8 Ekim 2026, `pending-decisions.md` B1)
**Amaç:** İlk push + CI'nın ilk yeşil çalıştırması (Faz 0 çıkış kapısının son kanıtı)

---

## ⚠ Push öncesi zorunlu: mevcut git durumu düzeltilmeli

`git ls-files` ile tespit edildi:

| Durum | Sayı | Sonuç |
|-------|------|-------|
| Eski `backend/` izleniyor | 61 dosya | Push edilirse **eski yapı gider** |
| Yeni `apps/*`, `packages/*` izleniyor | **0 dosya** | Push edilirse **tüm yeni iş gitmez** |

Yani şu an doğrudan push edilirse monorepo geçişi kaybolur. Doğru sıra:

```bash
# 1) Eski backend/ klasörünü git'ten çıkar (dosyalar zaten silinmiş)
git rm -r --cached backend

# 2) Yeni monorepo'yu ekle
git add apps packages docs scripts .github docker \
        package.json package-lock.json tsconfig.base.json \
        eslint.config.* .prettierrc* .gitignore README.md TODOS.md CONTRIBUTING.md \
        docker-compose.yml .env.example

# 3) Sızıntı kontrolü (aşağıdaki komutlar temiz olmalı)
git status --short | Select-String '\.env$'          # boş olmalı
git diff --cached --stat | Select-String 'secret|password'   # boş olmalı

# 4) Commit (Conventional Commits — CONTRIBUTING.md)
git commit -m "feat: Faz 0-1 monorepo, platform çekirdeği ve doküman seti"

# 5) Remote + push
git remote add origin <repo-url>
git push -u origin master
```

---

## Push öncesi kontrol listesi

- [ ] `backend/` git'ten çıkarıldı
- [ ] Yeni dizinler eklendi (`apps/*`, `packages/*`, `docs/`, `scripts/`, `.github/`)
- [ ] Gerçek `.env` **eklenmedi** (yalnızca `.env.example`)
- [ ] Sır taraması temiz (token/parola/anahtar yok)
- [ ] `node_modules/`, `dist/`, `.astro/` git'te değil (`.gitignore`)
- [ ] `packages/db/drizzle/` git'te değil (introspect çıktısı)
- [ ] Commit mesajı Conventional Commits formatında

## Secret taraması (push öncesi çalıştır)

```bash
# İzlenen dosyalarda sır benzeri içerik
git ls-files | Select-String 'secret|password|api[_-]?key|PRIVATE KEY'

# Gerçek .env dosyası izleniyor mu?
git ls-files | Select-String '\.env$'
```

---

## CI ilk çalıştırma — beklenen adımlar

`.github/workflows/ci.yml` sırası:

| # | Adım | Gereksinim | Beklenen |
|---|------|-----------|----------|
| 1 | `npm ci` | lockfile | ✅ |
| 2 | governance:check | — | ✅ 14 modül, 137 tablo |
| 3 | lint | eslint | ✅ |
| 4 | format:check | prettier | ⚠ ilk kez çalışır — format sapması olabilir |
| 5 | typecheck | tsc | ✅ |
| 6 | test | vitest | ✅ 137 test |
| 7 | tenant izolasyon | Postgres servisi | ✅ 4/4 |
| 8 | build:site | astro | ✅ 29 sayfa |
| 9 | **axe-core a11y** | Chromium | ⚠ CI'da ilk kez — Chrome kurulumu test edilecek |
| 10 | bundle:budget | — | ✅ |

**Riskli adımlar (ilk çalıştırmada sorun çıkabilir):**

1. **format:check** — yerelde hiç çalıştırılmadı. Önceden `npm run format` ile düzeltilmeli.
2. **axe-core (adım 9)** — `apt-get install chromium` başarısız olabilir; Chromium yerine
   `google-chrome` kurulumu (Google deposu) gerekebilir. İlk çalıştırmada adım atlanırsa
   (Chrome bulunamazsa script exit 0 döner) CI kırmızı olmaz; ama gerçek tarama için
   CI'da Chrome'un kurulduğu doğrulanmalı.
3. **Postgres rol kurulumu** — `docker/postgres/init/01-roles.sql` idempotent olmalı (DO $$).

---

## İlk push sonrası

1. CI loglarını oku; kırmızı adım varsa düzelt (bu Faz 0 çıkış kapısının son maddesi).
2. Yeşil olunca `TODOS.md` → "CI yeşil" maddesini işaretle.
3. Branch koruması: `master`'a doğrudan push yerine PR + required checks.
4. Sonraki: **staging deploy** (B2) ve **preview** (B3) — hesap açılınca.

---

*Bu rehber `docs/operations/pending-decisions.md` B1 kararının uygulama adımlarıdır.
Git komutlarını sen çalıştırırsın (repo erişimi sende); ajan hazırlık ve doğrulama yapar.*
