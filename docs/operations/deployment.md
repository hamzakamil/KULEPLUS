# Üretim Dağıtımı — Docker + tsx (VPS)

> **Karar (2026-10):** API ve worker **derleme yapmadan**, TypeScript'i `tsx` ile
> doğrudan çalıştırarak üretime alınır. Vercel build boru hattı bu repo için uygun
> DEĞİLDİR; dokümante edilen hedef TR VPS'tir (bkz. `docs/ROADMAP.md` K-12,
> `docs/operations/pending-decisions.md` B2).

---

## 1. Neden derleme yok? (ölçülmüş gerekçe)

`tsconfig.base.json` → `apps/*/tsconfig.json` zinciri `moduleResolution: "bundler"`
kullanır ve `@kuleplus/db` / `@kuleplus/shared` `exports` alanından **ham `.ts`**
dışa aktarır. Bu repoda `tsc` ile `dist` üretmek **iki** yönde de kırıktır (canlı ölçüldü):

| Yaklaşım | Derleme | Çalışma anı (Node ESM) |
|---|---|---|
| `tsc` + `bundler` → dist | ✅ (yanıltıcı, exit 0) | ❌ `ERR_MODULE_NOT_FOUND …dist/src/client` — `tsc` uzantısız bağıl importları JS'e AYNEN taşır |
| `tsc` + `nodenext` → dist | ❌ TS2835 seli (`./tenant.js` ister), `db`+`shared` arası yayılır | — (JS üretebilmemiş) |
| **`tsx` ile doğrudan çalıştır** | — | ✅ `HTTP 200`; 25 uzantısız statik import + `metrics.service` dinamik import çözülür |

Ek olarak tsconfig `include: ["src","tests","vitest.config.ts"]` olduğundan çıktı
`dist/src/` altına düşer; `main: "./dist/index.js"` vaatleri var olmayan bir dosyaya
işaret eder.

**Sonuç:** Build'siz model tsconfig'de hiçbir değişiklik gerektirmez ve geliştirme ile
üretim arasında davranış farkı yaratmaz.

## 2. Mimari

```
             internet (443)
                    │
        edge: Caddy — TLS sonlandırma, HTTP→HTTPS 308
                    │ kuleplus-prod_default ağı (web:80)
                    ▼
        web: nginx — statik SPA + `/api` ters vekili
                    │  api:3000 (Docker DNS, her istekte yeniden çözülür)
                    ▼
        api: Express (tsx)          worker: BullMQ runner
                    │                     │
        postgres:5432 ◄───────────────────► redis:6379
             (port yayımlamaz — yalnızca container ağı)

  migrate: bir kez çalışır, 0 ile çıkar → api/worker ondan sonra yükselir.
```

**Tek origin kuralı:** Caddy API'ye doğrudan yön vermez; `/api` ters vekili
`docker/web/nginx.conf` içindedir. SPA API'yi göreli `/api`'den çağırır
(`VITE_API_URL=/api`) → CORS gerekmez, `SameSite=Lax` refresh çerezi çalışır.

Üç uygulama servisi **aynı imajı** paylaşır (`kuleplus:prod`), yalnızca komutları
farklıdır: `migrate up`, `server.ts`, `runner.ts`. Yerel modüller
(`@node-rs/argon2`) nedeniyle **Debian** tabanlı `node:22-slim` kullanılır; Alpine
kullanılmaz (musl uyumluluk riski).

## 3. Kurulum

```bash
cp .env.production.example .env.production   # gerçek değerleri doldur
chmod 600 .env.production                     # sır dosyası

npm run prod:build    # db/shared/api/worker üretim bağımlılıkları
npm run prod:up       # postgres+redis sağlıklı → migrate (bir kez) → api + worker
npm run prod:status   # durum
npm run prod:logs     # api + worker logları
```

`.env.production` hem `--env-file` (compose interpolasyonu) hem `env_file` (konteyner
ortamı) için kullanılır. `--env-file` unutulup doğrudan
`docker compose -f docker-compose.prod.yml up` çağrılırsa compose, `:?` ile işaretli
değişken yüzünden **fail-fast** verir — sessiz yanlış başlatma mümkün değildir.
`npm run prod:*` script'leri bu bayrağı zaten içerir.

## 4. Migration'lar

`migrate` servisi `api`/`worker` tarafından `depends_on` →
`service_completed_successfully` ile ön koşul olarak beklenir; **0 ile çıkınca**
uygulamalar yükselir. `packages/db/src/migrate.ts` yolları `import.meta.url` ile
çözer, çalışma dizininden bağımsızdır. Elle tekrar: `npm run prod:migrate`.
## 5. Sırlar ve güvenlik

- `.env.production`, `.gitignore` ile dışlanır (`.env.production` kalıbı) ve
  `.dockerignore` ile **imaja girmez** — imaj yalnızca `.env.example` taşır (doğrulandı).
- Üretim parolaları `docker/postgres/init/01-roles.sql` içindeki `CHANGE_ME` ile AYNI
  olmalıdır. Üç rol (`app_migrator`, `app_user`, `app_platform`) `NOBYPASSRLS` kurulur
  (doğrulandı: `rolbypassrls = f`) — SPEC §7.1 RLS güvencesi korunur.
- JWT/şifreleme anahtarları en az 32 karakter; üret:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
- Üretimde `PAYMENT_PROVIDER=manual` vb. **mock bırakılmamalı** — mock sahte sonuç üretir.

## 6. Bildirilmiş ölçümlü doğrulamalar (bu repo, Windows + Docker 29)

`docker-compose.prod.yml` ilk kez **uçtan uca kurulup çalıştırıldı**:

- `migrate` çıkış kodu **0**; prod DB'ye dev ile birebir **143 tablo / 54 migration** uygulandı.
- `/healthz` → **HTTP 200** `{"status":"ok"}`; konteyner HEALTHCHECK'i `healthy`.
- `@kuleplus/db` (ham `.ts` dışa aktaran paket) üretim konteynerinden gerçek Postgres'e
  sorgu çalıştırdı → `rows=1`.
- `worker`: 9 kuyruk gerçek Redis'e kayıtlı; Redis kapalıyken bile çökmeden retry yapar.
- `tsx 4.23.15` imaja **`--omit=dev`** ile kuruldu — `apps/api` ve `apps/worker` içinde
  `dependency`'dir (`devDependency` değil; aksi halde imaja girmez, konteyner anında çözerdi).
- Proje `name: kuleplus-prod` sayesinde dev `docker-compose.yml`'den **izole**dir:
  volume'ler `kuleplus-prod_*`, dev'ler `muhasebe_*`.

## 7. İlk kurulumda öğrenilen tuzaklar

1. **Proje adı çakışması:** `name:` verilmezse prod komutu dev stack'i "recreate" edip
   `pgdata` volume'ünü paylaşıyordu (ölçüldü). `name: kuleplus-prod` bunu ayırır.
2. **Portlar:** prod Postgres/Redis varsayılan olarak port yayımlamaz; hem çakışmayı hem
   dışa maruziyeti kaldırır. API konteyner içi `PORT=3000`, host eşlemesi `${API_PORT}`.
3. **`--omit=dev` + tsx:** tsx runtime bağımlılığına taşınmazsa build yeşil kalır ama
   konteyner "tsx bulunamadı" ile ölürdü.
4. **Yerel imaj çekme:** MinIO/Mailpit imajları bu makineden çekilemedi (registry/erişim).
   Bunlar yalnızca geliştirme stack'idir, üretim compose'unda yer almazlar.

## 8. Sınırlamalar / henüz yapılmadı

- `apps/site` (Astro) üretim dağıtımı burada kapsanmaz (ayrı build, ayrı süreç).
  `apps/web` (Vue SPA) artık kapsanıyor: `Dockerfile.web` + `docker/web/nginx.conf`.
- Yedek/restore: bu compose `pgdata` volume'ünün düzenli yedeklenmesini varsayar;
  prosedür `docs/operations/restore-drill-template.md` ile ilişkilidir.

## 9. Veri izolasyonu denetimi (2026-10-15, ölçüldü — hiçbir DB işlemi yapılmadı)

Amaç: prod yapılandırmasının **mevcut veritabanına dokunmadığını** kanıtlamak.

| Katman | DEV (mevcut — korunacak) | PROD compose (henüz **yok**) |
|---|---|---|
| Konteyner | `kuleplus-postgres` | `kuleplus-pg-prod` |
| Compose projesi | `muhasebe` (dizinden türetilir, `name:` yok) | `kuleplus-prod` (`name:` ile sabit) |
| Volume | `muhasebe_pgdata` (label `project=muhasebe`) | `kuleplus-prod_pgdata` |
| Ağ | `muhasebe_default` | `kuleplus-prod_default` |
| Host portu | `5434 → 5432` yayında | **yok** (yalnızca container ağı) |
| Uygulama bağlantısı | `.env` → `…@localhost:5434/erp_db` | `.env.production` → `…@postgres:5432/erp_db` |

**Dev DB anlık görüntü (baz alınmıştır):** 143 tablo · 54 migration · 18 MB
· ~871 canlı satır (`n_live_tup`) · son migration `2026-10-15 08:02:22Z`.

Doğrulanan izolasyon gerçekleri:

1. `kuleplus-prod_pgdata` volume'ü, `kuleplus-prod_default` ağı ve `kuleplus-pg-prod`
   konteyneri **hiçvar** (`docker volume/network/ps` süzüldü, boş döndü).
2. `docker/postgres/init/*.sql` yalnızca **boş** data dizininde çalışır (entrypoint
   davranışı) ve yalnız `kuleplus-pg-prod`'a mount edilir → dolu dev volume'üne işlemez.
3. `.dockerignore` `.env` ve `.env.*` dosyalarını dışlıyor (`.env.example` hariç) →
   imajda dev ortamı yok; konteyner içinde `dotenv` dev DB adresini göremez.
4. `.env.production` git dışında (`.gitignore:9`) → sır depoya sızmaz.
5. `migrate.ts` varsayılan argümanı `status`tur; argümansız `run --rm migrate`
   hiçbir migration **uygulamaz**.

## 10. Veri kaybı riskleri — bunları yapma

| # | Komut / durum | Sonuç |
|---|---|---|
| 1 | `docker compose down -v` (`-f docker-compose.prod.yml` **OLMADAN**) | Proje `muhasebe`ye çözülür → **`muhasebe_pgdata` SİLİNİR**. Bu, mevcut veriyi kaybetmenin en olası yoludur. |
| 2 | `npm run migrate --workspace packages/db` (host'ta) | `dotenv` kök `.env`i okur → `localhost:5434` = **dev DB'ye migration uygulanır**. Dev DB zaten head'de (54), yani gereksiz; senin yasağınla da çelişir. |
| 3 | `… migrate.ts down` / `npm run migrate:down` | Son migration'ı **DROP** eder (down SQL'lerinde `DROP TABLE` var). |
| 4 | Repo dizinini taşımak/yeniden adlandırmak | `name:` olmadığı için compose proje adı değişir → **boş yeni bir DB** oluşur (veri silinmez ama uygulama boş şemaya bakar). Koruma: dev `docker-compose.yml`'e `name: muhasebe` eklemek (bugünkü davranışla birebir aynıdır, yeniden kurma tetiklemez). |
| 5 | `docker volume rm muhasebe_pgdata`, `docker compose rm -v`, `docker system prune --volumes` | Volume'ü doğrudan yok eder. |

Ayrıca `README.md` içindeki `npm run db:migrate` ifadesi **güncel değil**: kök
`package.json`da böyle bir script yok; gerçekleri `packages/db`de (`migrate`,
`migrate:down`, `migrate:status`).

## 11. VPS ilk kurulum runbook'u

> **ONAY GEREKTİREN ADİM:** 5. adım `kuleplus-prod_pgdata` volume'nü oluşturur ve
> 54 migration'ı **yalnızca o yeni volume'e** uygular. Dev DB'ye (`muhasebe_pgdata`)
> hiçbir yoldan ulaşmaz — ama bu adım veri yarattığı için açık onay bekler.

```bash
# 0) ÖNLEM (salt-okunur): yedek almadan hiçbir şey yapma
docker exec kuleplus-postgres pg_dump -U postgres -d erp_db --format=custom \
  --file=/tmp/erp_db.pre-prod.dump
docker cp kuleplus-postgres:/tmp/erp_db.pre-prod.dump ./erp_db.pre-prod.dump

# 1) VPS hazırlığı
git clone <repo> /opt/kuleplus && cd /opt/kuleplus
docker --version && docker compose version

# 2) Ortam dosyası — DB hostları `postgres` OLMALI, localhost/5434 OLMAMALI
cp .env.production.example .env.production && chmod 600 .env.production
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"  # JWT x2
#   .env.production içinde doldur: POSTGRES_SUPER_PASSWORD, üç rol parolası
#   (docker/postgres/init/01-roles.sql ile AYNI), JWT_*_, SMTP/S3, APP_URL,
#   WEB_DOMAIN=app.alanaladin.com, CADDY_EMAIL=...
grep -n 'postgres:5432' .env.production    # 3 satır görülmeli

# 3) DNS ve güvenlik grubu: WEB_DOMAIN → VPS IP; 80,443 açık (ACME HTTP-01)

# 4) İmajlar (derleme yalnız burada; DB'ye dokunmaz)
npm run prod:build

# 5) ★ ONAY SONRASI: prod DB + 54 migration + tüm servisler
npm run prod:up

# 6) Doğrulama
npm run prod:status
docker logs kuleplus-migrate --tail 20        # "↑ uygulandı" satırları, çıkış 0
docker exec kuleplus-pg-prod psql -U postgres -d erp_db -tAc \
  "select count(*) from pg_tables where schemaname='public'"   # 143 beklenir
curl -s localhost:8081/healthz                                # web nginx
curl -sk https://localhost/healthz                            # edge -> nginx
curl -sk https://localhost/api/v1/auth/login -X POST          # zincir /api

# 7) İlk platform yöneticisi
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec api node --import tsx apps/api/src/scripts/bootstrap-admin.ts
```

Günlük işlemler: `npm run prod:logs` · `npm run prod:status` · güncelleme sonrası
`git pull && npm run prod:build && npm run prod:up` (migrate yeniden çalışır,
uygulananları atlar — idempotent). Kapatma: `npm run prod:down` (**`-v` EKLEME**).

