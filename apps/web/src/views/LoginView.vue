<template>
  <div class="login-page">
    <!-- Marka paneli (yalnızca geniş ekran) -->
    <aside class="brand-panel">
      <span class="brand-mark" aria-hidden="true">▲</span>
      <p class="brand-name">Kuleplus</p>
      <blockquote class="brand-headline">Patron için sade,<br />muhasebeci için derin.</blockquote>
      <p class="brand-sub">Türkiye mevzuatına uyumlu, modüler bulut ön muhasebe.</p>
      <ul class="brand-points">
        <li>e-Fatura · KDV · Tek Düzen Hesap Planı</li>
        <li>Ücretsiz çekirdek, süresiz</li>
        <li>KVKK uyumlu, verileriniz sizde</li>
      </ul>
    </aside>

    <div class="login-container">
      <div class="login-card">
        <h1 class="login-title">Giriş Yap</h1>
        <p class="login-sub">Hesabınıza güvenli giriş yapın</p>

        <form @submit.prevent="handleLogin" class="login-form" novalidate>
          <div class="field">
            <label for="login-email" class="field-label">E-posta</label>
            <input
              id="login-email"
              v-model="email"
              type="email"
              required
              class="input"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              placeholder="ornek@sirket.com"
            />
          </div>

          <div class="field">
            <label for="login-password" class="field-label">Şifre</label>
            <div class="password-wrap">
              <input
                id="login-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                minlength="6"
                class="input"
                autocomplete="current-password"
                placeholder="••••••••••••"
                @keyup="checkCapsLock"
                @blur="capsLockOn = false"
              />
              <button
                type="button"
                class="password-toggle"
                :aria-pressed="showPassword"
                :aria-label="showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? 'Gizle' : 'Göster' }}
              </button>
            </div>
            <p v-if="capsLockOn" class="caps-hint" role="status">
              Caps Lock açık görünüyor — şifrenizi kontrol edin.
            </p>
          </div>

          <div class="remember-row">
            <label class="remember">
              <input v-model="rememberMe" type="checkbox" class="remember-box" />
              Beni hatırla
              <span class="remember-info" title="Kapalıysa sekmeyi kapatınca çıkış yapılır">ⓘ</span>
            </label>
            <RouterLink to="/reset-password" class="forgot-link">Şifremi unuttum</RouterLink>
          </div>

          <div v-if="error" class="login-error" role="alert">
            {{ error }}
          </div>

          <button type="submit" class="btn btn-primary btn-block" :disabled="loading || !canSubmit">
            <span v-if="loading" class="spinner" aria-hidden="true"></span>
            {{ loading ? 'Giriş yapılıyor…' : 'Giriş Yap' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const LAST_EMAIL_KEY = 'last_email';

const authStore = useAuthStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const rememberMe = ref(true);
const capsLockOn = ref(false);
const error = ref('');
const loading = ref(false);

const canSubmit = computed(() => email.value.trim().length > 3 && password.value.length >= 1);

onMounted(() => {
  email.value = localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  rememberMe.value = authStore.rememberMe;
});

function checkCapsLock(event: KeyboardEvent) {
  capsLockOn.value = event.getModifierState?.('CapsLock') ?? false;
}

const handleLogin = async () => {
  error.value = '';
  loading.value = true;

  try {
    const response = await authStore.login(email.value, password.value, rememberMe.value);
    localStorage.setItem(LAST_EMAIL_KEY, email.value.trim().toLowerCase());

    // Check if 2FA is required (user has 2FA enabled)
    if (response.user?.totpEnabled) {
      router.push('/2fa/verify');
    } else {
      router.push('/dashboard');
    }
  } catch (err: any) {
    const status = err.response?.status;
    error.value =
      status === 423
        ? 'Hesabınız geçici olarak kilitlendi. Lütfen daha sonra tekrar deneyin.'
        : err.response?.data?.message || 'Giriş başarısız. Lütfen tekrar deneyin.';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
/* Split ekran: solda marka, sağda form. Renkler global tema token'larıyla. */
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr;
  background: var(--c-bg);
}
@media (min-width: 60rem) {
  .login-page {
    grid-template-columns: 1.05fr 1fr;
  }
}

/* === Sol: marka paneli (koyu "kule" atmosferi — site hero'suyla aynı dil) === */
.brand-panel {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem clamp(2rem, 5vw, 5rem);
  color: #f8fafc;
  background:
    radial-gradient(circle at 18% 18%, rgb(34 211 238 / 0.16), transparent 42%),
    linear-gradient(160deg, #0b1220 0%, #101a30 55%, #0b1220 100%);
}
@media (min-width: 60rem) {
  .brand-panel {
    display: flex;
  }
}
.brand-mark {
  color: var(--color-teal);
  font-size: 1.5rem;
}
.brand-name {
  margin: 0;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.brand-headline {
  margin: 1rem 0 0.5rem;
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.75rem, 3.2vw, 2.75rem);
  line-height: 1.15;
}
.brand-sub {
  margin: 0;
  color: #94a3b8;
  max-width: 26rem;
}
.brand-points {
  list-style: none;
  margin: 1.5rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.625rem;
  font-size: 0.9375rem;
  color: #cbd5e1;
}
.brand-points li::before {
  content: '✓';
  margin-right: 0.625rem;
  color: #34d399;
  font-weight: 700;
}

/* === Sağ: form alanı === */
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.login-card {
  width: 100%;
  max-width: 25rem;
}
.login-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}
.login-sub {
  margin: 0.25rem 0 1.5rem;
  color: var(--c-muted);
  font-size: 0.9375rem;
}
.login-form {
  display: grid;
  gap: 1.125rem;
}
.field-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.375rem;
}
.password-wrap {
  position: relative;
}
.password-wrap .input {
  padding-right: 4.5rem;
}
.password-toggle {
  position: absolute;
  top: 50%;
  right: 0.5rem;
  transform: translateY(-50%);
  border: 0;
  background: none;
  color: var(--c-primary);
  font: inherit;
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.password-toggle:hover {
  color: var(--c-primary-dark);
}
.caps-hint {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  color: var(--c-warning);
}
.remember {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}
.remember-box {
  width: 1rem;
  height: 1rem;
  accent-color: var(--c-primary);
}
.remember-info {
  color: var(--c-muted);
  font-size: 0.75rem;
}
.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.forgot-link {
  color: var(--c-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  text-decoration: none;
}
.forgot-link:hover {
  text-decoration: underline;
}
.forgot-link:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
.login-error {
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--c-danger-soft);
  color: #b91c1c;
  font-size: 0.875rem;
}
.btn-block {
  width: 100%;
}
.spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgb(255 255 255 / 0.4);
  border-top-color: #fff;
  border-radius: 999px;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
