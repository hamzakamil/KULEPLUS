<script setup lang="ts">
/**
 * Yönetici Kokpiti — korumalı SPA ekranı + canlı veri köprüsü (Faz 1 + Faz 3).
 *
 * Neden iframe? Kokpit tek başına bir HTML belgesidir: `body`, `header`, `.card`
 * gibi SEÇECEYLE (element bazlı) global CSS ve satır içi script barındırır. Vue
 * şablonuna doğrudan gömülürse uygulama kabuğunun stillerini bozar; `innerHTML`
 * ile eklenirse <script>'leri çalışmaz. `srcdoc` same-origin iframe içinde hem
 * CSS/JS izole kalır hem script'ler çalışır.
 *
 * Güvenlik notu: kaynak dosya `public/` altından `src/cockpit/`e TAŞINDI; artık
 * statik URL ile (oturum olmadan) açılamaz. Veri burada, yetkili SPA istemcisiyle
 * (`useCockpitStore`) çekilir ve `postMessage` ile iframe'e verilir — iframe'e
 * token ENJEKTE EDİLMEZ. Yazma işlemleri (onay kararı) yine parent üzerinden,
 * yetki kontrolü backend'de olan uçlarla yapılır.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import cockpitHtml from '@/cockpit/yonetici-kokpiti.html?raw';
import { useAuthStore } from '@/stores/auth';
import { useCockpitStore } from '@/stores/cockpit';
import { useManagementStore } from '@/stores/management';

/** Otomatik yenileme aralığı — kokpit canlı bir ekrandır. */
const REFRESH_MS = 180_000;

const router = useRouter();
const auth = useAuthStore();
const cockpit = useCockpitStore();
const management = useManagementStore();

const frame = ref<HTMLIFrameElement | null>(null);
const frameReady = ref(false);

/** Kokpit belgesi sabit kalır, veri sonradan akar — iframe yeniden yüklenmez. */
const srcdoc = cockpitHtml;

const greetingName = computed(
  () => auth.roles.find((role) => role.name)?.name || auth.company?.name || 'Yönetici',
);

/** Parent → iframe bağlamı: selamlama, kurum adı ve yetki bayrağı. */
function shellContext() {
  return {
    company: auth.company?.name ?? 'KulePlus',
    user: greetingName.value,
    canDecide: cockpit.payload?.approvalsEditable ?? false,
  };
}

function post(message: Record<string, unknown>): void {
  frame.value?.contentWindow?.postMessage(
    { source: 'kuleplus-shell', ...message },
    window.location.origin,
  );
}

function pushData(): void {
  if (!frameReady.value) return;
  // JSON turu: Vue reactive proxy'sünü düz kopyaya çevirir (structured-clone güvenli).
  const payload = cockpit.payload ? JSON.parse(JSON.stringify(cockpit.payload)) : null;
  post({
    type: 'data',
    payload,
    context: shellContext(),
    error: cockpit.error,
    loadedAt: cockpit.loadedAt,
  });
}

async function refresh(): Promise<void> {
  await cockpit.load();
}

/** iframe → parent istekleri: hazırım, onay kararı, rota geçişi, yenileme. */
async function onMessage(event: MessageEvent): Promise<void> {
  if (event.origin !== window.location.origin) return;
  if (event.source !== frame.value?.contentWindow) return;
  const data = event.data as {
    source?: string;
    type?: string;
    id?: string;
    decision?: string;
    to?: string;
  };
  if (data?.source !== 'kuleplus-cockpit') return;

  if (data.type === 'ready') {
    frameReady.value = true;
    pushData();
    return;
  }
  if (data.type === 'refresh') {
    await refresh();
    return;
  }
  if (data.type === 'navigate' && data.to) {
    await router.push(data.to);
    return;
  }
  const decision = data.decision === 'approved' || data.decision === 'rejected' ? data.decision : null;
  if (data.type === 'decide' && data.id && decision) {
    try {
      await management.decideApproval(data.id, decision);
      post({ type: 'toast', text: decision === 'approved' ? 'Onaylandı' : 'Reddedildi' });
      await refresh();
    } catch (err) {
      post({
        type: 'toast',
        text:
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
          'Karar kaydedilemedi',
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  window.addEventListener('message', onMessage);
  await Promise.all([cockpit.load(), auth.fetchMe()]);
  timer = setInterval(refresh, REFRESH_MS);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  if (timer) clearInterval(timer);
});

watch(() => [cockpit.payload, cockpit.error, cockpit.loadedAt], () => pushData());
</script>

<template>
  <div class="cockpit-shell">
    <div v-if="cockpit.loading && !cockpit.payload" class="cockpit-state" role="status">
      Kokpit verisi yükleniyor…
    </div>
    <div v-else-if="cockpit.error && !cockpit.payload" class="cockpit-state error" role="alert">
      <span>{{ cockpit.error }}</span>
      <button type="button" @click="refresh">Yeniden dene</button>
    </div>
    <iframe
      ref="frame"
      class="cockpit-frame"
      :srcdoc="srcdoc"
      title="Yönetici Kokpiti"
      referrerpolicy="no-referrer"
    />
  </div>
</template>

<style scoped>
.cockpit-shell {
  position: relative;
  width: 100%;
  height: 100vh;
}

/* Kabuk: sabit sol kenar çubuğu + içerik alanı; `--erp-header-height` = 0 olduğu
   için 100vh, içerik alanının yüksekliğiyle birebir örtüşür. */
.cockpit-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0b1220;
}

/* Telefonda üst çubuk (3.5rem) sabit; kokpit kalan alanı doldurur, tek kaydırma alanı kalır. */
@media (max-width: 60rem) {
  .cockpit-shell {
    height: calc(100vh - 3.5rem);
    height: calc(100dvh - 3.5rem);
  }
}

.cockpit-state {
  position: absolute;
  inset: 12px 12px auto;
  z-index: 2;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(11, 18, 32, 0.92);
  color: #e8eefc;
  font: 500 13px/1.4 system-ui, sans-serif;
}

.cockpit-state.error {
  background: #7f1d1d;
}

.cockpit-state button {
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
