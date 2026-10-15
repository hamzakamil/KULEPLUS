<template>
  <!--
    Google ile giriş butonu (ADR-0023).

    `v-show` bilinçli: `v-if` kullanılsa öğe ilk render'da DOM'da olmaz, GIS script
    hazır olduğunda basılacak yer kalmaz. Görünmez kutu boş bir alan bırakmaz
    (`.google-auth` `display:none`), böylece sosyal giriş kapalı ortamda form tek
    butonla kalır.
  -->
  <div v-show="visible" class="google-auth">
    <div class="google-divider" aria-hidden="true"><span>veya</span></div>
    <div ref="buttonRef" class="google-button" :aria-busy="loading ? 'true' : 'false'"></div>
    <p v-if="errorMessage" class="google-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useAuthStore, type SessionResponse } from '@/stores/auth';
import { mountGoogleSignInButton } from '@/lib/google-gis';

const props = withDefaults(
  defineProps<{
    /** Etiket: kayıt ekranında "signup_with", girişte "signin_with". */
    text?: 'signin_with' | 'signup_with' | 'continue_with';
    /** Oturum saklama tercihi ("beni hatırla") — çağıran formdan alınır. */
    rememberMe?: boolean;
  }>(),
  { text: 'signin_with', rememberMe: true },
);

/** Oturum kurulduğunda fırlatılır; yönlendirme ÇAĞIRANA aittir (2FA adımları farklı). */
const emit = defineEmits<{ done: [session: SessionResponse] }>();

const authStore = useAuthStore();
const buttonRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const errorMessage = ref('');

/** Yapılandırma `enabled:true` dönmeden üçüncü taraf script'i yüklenmez. */
const visible = computed(
  () => authStore.googleConfig.enabled && Boolean(authStore.googleConfig.clientId),
);

const handleCredential = async (credential: string) => {
  errorMessage.value = '';
  loading.value = true;
  try {
    const session = await authStore.loginWithGoogle(credential, props.rememberMe);
    emit('done', session);
  } catch {
    // Mesaj store'da (backend hata sözleşmesi — ADR-0017); store boşsa temele düş
    errorMessage.value = authStore.error || 'Google ile giriş başarısız oldu.';
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  const config = await authStore.fetchGoogleConfig();
  if (!config.enabled || !config.clientId) return;

  // `v-show` görünürlüğü reactive'e bağlı: ref'in DOM'a bağlanmış olması için bir tur beklenir
  await nextTick();
  if (!buttonRef.value) return;

  await mountGoogleSignInButton(buttonRef.value, {
    clientId: config.clientId,
    text: props.text,
    onCredential: (credential) => void handleCredential(credential),
    onError: (error) => {
      errorMessage.value = error.message;
    },
  });
});
</script>

<style scoped>
.google-auth {
  display: grid;
  gap: 0.75rem;
  /* Formun kendi akışından (`.login-form` / `.register-form`) sonra nefes alanı */
  margin-top: 1.25rem;
}
.google-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--c-muted);
  font-size: 0.8125rem;
}
.google-divider::before,
.google-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--c-border, #e2e8f0);
}
/* GIS butonunu kendi genişliğimize uydururuz (Google'ın ürettiği öğeye dokunulmaz) */
.google-button :deep(svg) {
  margin-right: 0.5rem;
}
.google-error {
  margin: 0;
  font-size: 0.8125rem;
  color: #b91c1c;
}
</style>
