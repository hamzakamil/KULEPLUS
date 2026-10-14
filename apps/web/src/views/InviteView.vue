<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/lib/api';

/**
 * Davet kabul — e-postadaki `/invite?token=...` bağlantısının karşılığı.
 * API ucu public'tır (`POST /authorization/invitations/accept`): token + yeni şifre.
 */
const route = useRoute();
const router = useRouter();

const token = computed(() => (route.query.token as string | undefined) ?? '');
const password = ref('');
const passwordConfirm = ref('');
const busy = ref(false);
const done = ref(false);
const error = ref<string | null>(null);

async function accept() {
  if (!token.value) {
    error.value = 'Davet bağlantısı geçersiz. Lütfen e-postadaki tam bağlantıyı kullanın.';
    return;
  }
  if (password.value !== passwordConfirm.value) {
    error.value = 'Şifreler eşleşmiyor.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await api.post('/v1/authorization/invitations/accept', {
      token: token.value,
      password: password.value,
      passwordConfirm: passwordConfirm.value,
    });
    done.value = true;
    setTimeout(() => void router.replace('/login'), 1500);
  } catch (err) {
    error.value =
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
      'Davet kabul edilemedi. Bağlantı süresi dolmuş olabilir.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <section class="panel" :aria-busy="busy">
      <h1>Daveti kabul edin</h1>
      <p class="lede">
        Size gönderilen davet ile ekibe katılmak için bir şifre belirleyin. Davet bağlantısı 7 gün
        geçerlidir.
      </p>

      <form v-if="!done" class="form" @submit.prevent="accept">
        <label for="invite-password">Şifre</label>
        <input
          id="invite-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="6"
          maxlength="8"
          required
        />
        <label for="invite-password-confirm">Şifre (tekrar)</label>
        <input
          id="invite-password-confirm"
          v-model="passwordConfirm"
          type="password"
          autocomplete="new-password"
          minlength="6"
          maxlength="8"
          required
        />
        <button class="btn btn-primary" type="submit" :disabled="busy">
          {{ busy ? 'Kabul ediliyor…' : 'Daveti kabul et' }}
        </button>
      </form>

      <p v-else class="info">Ekibe katıldınız. Giriş ekranına yönlendiriliyorsunuz…</p>
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
