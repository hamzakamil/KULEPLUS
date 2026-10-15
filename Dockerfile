# KULEPLUS — üretim imajı (BUILD'SİZ: TypeScript, tsx ile doğrudan çalışır)
#
# Neden derleme yok?
#   tsconfig zinciri `moduleResolution: "bundler"` kullanıyor ve paketlerimiz
#   (@kuleplus/db, @kuleplus/shared) `exports` alanından HAM .ts dışa aktarıyor.
#   Bu modelde `tsc` ile dist üretmek güvenli değil: bundler modu uzantısız bağıl
#   importları JS'e AYNEN taşır ve Node ESM onları çalışma anında çözemez
#   (ör. `from './client'` -> ERR_MODULE_NOT_FOUND). nodenext'e geçmek ise tüm
#   bağıl importlara .js uzantısı zorunlu kılar. Bu yüzden üretim de geliştirme
#   gibi tsx ile çalışır; tek fark NODE_ENV=production ve dev bağımlılıklarının
#   kurulmamasıdır.
#
# Bu yüzden `tsx`, apps/api ve apps/worker içinde devDependency DEĞİL,
# dependency olarak bildirilmiştir; `npm ci --omit=dev` ile de kurulur.
#
# Derleme YAPMAMAK, tsconfig'de (`bundler`) değişiklik gerektirmez.

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# --- 1) Yalnızca manifestler: bağımlılık katmanı, kod değişiminde boşa düşmez ---
# npm workspaces monorepo'da `npm ci` TÜM workspace manifestlerini ister.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY apps/site/package.json ./apps/site/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/

# Yalnızca çalışan servislerin üretim bağımlılıkları kurulur; @types, vitest,
# playwright, eslint, vite ve vue-tsc imaja girmez.
RUN npm ci --omit=dev \
      --workspace apps/api \
      --workspace apps/worker \
      --workspace packages/db \
      --workspace packages/shared \
      --include-workspace-root \
    && npm cache clean --force

# --- 2) Kaynak kod ---
# .dockerignore node_modules/, .git/, .env*, log ve çıktı dizinlerini hariç tutar;
# bu yüzden mevcut node_modules silinmeden üstüne yazılır.
# packages/db/migrations/ bu kopyayla gelir — migrate.ts yolları import.meta.url
# ile çözdüğü için çalışma dizininden bağımsızdır.
COPY . .

USER node

EXPOSE 3000

# app.ts içindeki /healthz ucu. node:slim'de curl/wget yok; Node'un kendi fetch'i
# kullanılır. PORT varsayılanı env.ts ile hizalıdır (3000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Varsayılan: API. worker ve migrate aynı imajı farklı komutla çalıştırır.
# `--import tsx` ayrı bir npx süreci açmaz; SIGTERM doğrudan Node'a ulaşır
# (server.ts SIGTERM dinleyicisini kapatma için kaydediyor).
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
