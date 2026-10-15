<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/lib/api';

/**
 * Şifre sıfırlama — iki mod tek ekran:
 *  1) e-postadan gelen `?token=` ile yeni belirleme,
 *  2) token yoksa sıfırlama bağlantısı talep etme (LoginView'dan gelir).
 */
const route = useRoute();
const router = useRouter();

const token = computed(() => (route.query.token as string | undefined) ?? '');
const isResetMode = computed(() => token.value.length > 0);

const email = ref('');
const password = ref('');
const passwordConfirm = ref('');
const busy = ref(false);
const info = ref<string | null>(null);
const error = ref<string | null>(null);

async function requestLink() {
  busy.value = true;
  error.value = null;
  info.value = null;
  try {
    const res = await api.post('/v1/auth/password/reset', {
      email: email.value.trim().toLowerCase(),
    });
    info.value =
      res.data?.token && import.meta.env.DEV
        ? `Geliştirme ortamı: ${import.meta.env.VITE_APP_URL ?? 'http://localhost:5173'}/reset-password?token=${res.data.token}`
        : 'E-posta adresiniz kayıtlıysa sıfırlama bağlantısı gönderildi.';
  } catch (err) {
    error.value =
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
      'Bağlantı oluşturulamadı. Lütfen tekrar deneyin.';
  } finally {
    busy.value = false;
  }
}

async function setNewPassword() {
  if (password.value !== passwordConfirm.value) {
    error.value = 'Yeni şifreler eşleşmiyor.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await api.post('/v1/auth/password/reset/confirm', {
      token: token.value,
      password: password.value,
    });
    info.value = 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.';
    setTimeout(() => void router.replace('/login'), 1200);
  } catch (err) {
    error.value =
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
      'Şifre güncellenemedi. Bağlantı süresi dolmuş olabilir.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <section class="panel" :aria-busy="busy">
      <h1>{{ isResetMode ? 'Yeni şifrenizi belirleyin' : 'Şifrenizi mi unuttunuz?' }}</h1>

      <p v-if="!isResetMode" class="lede">
        E-posta adresinize bir sıfırlama bağlantısı gönderelim. Bağlantı 24 saat geçerlidir.
      </p>

      <form v-if="!isResetMode" class="form" @submit.prevent="requestLink">
        <label for="reset-email">E-posta</label>
        <input
          id="reset-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          placeholder="ornek@sirket.com"
        />
        <button class="btn btn-primary" type="submit" :disabled="busy">
          {{ busy ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder' }}
        </button>
      </form>

      <form v-else class="form" @submit.prevent="setNewPassword">
        <label for="new-password">Yeni şifre</label>
        <input
          id="new-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
        />
        <label for="new-password-confirm">Yeni şifre (tekrar)</label>
        <input
          id="new-password-confirm"
          v-model="passwordConfirm"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
        />
        <button class="btn btn-primary" type="submit" :disabled="busy">
          {{ busy ? 'Kaydediliyor…' : 'Şifremi güncelle' }}
        </button>
      </form>

      <p v-if="info" class="info">{{ info }}</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>

      <p class="foot"><RouterLink to="/login">← Giriş ekranına dön</RouterLink></p>
    </section>
  </main>
</template>

<style scoped>
.auth {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 1.5rem;
  background: #f8fafc;
}
.panel {
  width: 100%;
  max-width: 26rem;
  padding: 1.75rem;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.75rem;
  background: #fff;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.lede {
  margin: 0 0 1.25rem;
  color: #475569;
  font-size: 0.9375rem;
}
.form {
  display: grid;
  gap: 0.5rem;
}
label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
}
input {
  padding: 0.5625rem 0.75rem;
  border: 1px solid var(--c-border, #cbd5e1);
  border-radius: 0.5rem;
  font: inherit;
}
input:focus-visible {
  outline: 2px solid var(--c-primary, #1d4ed8);
  outline-offset: 1px;
}
.btn {
  margin-top: 0.75rem;
  padding: 0.625rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--c-primary, #1d4ed8);
  color: #fff;
}
.btn:disabled {
  opacity: 0.65;
  cursor: progress;
}
.info {
  margin: 1rem 0 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: #ecfdf5;
  color: #065f46;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.error {
  margin: 1rem 0 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.875rem;
}
.foot {
  margin: 1.25rem 0 0;
  font-size: 0.875rem;
}
</style>
