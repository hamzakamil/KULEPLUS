<script setup lang="ts">
import { computed, ref } from 'vue';
import { trackEvent } from '../analytics';

/**
 * İletişim formu — POST {apiUrl}/api/v1/public/contact
 * (ROADMAP Faz 2: "İletişim formu → outbox → e-posta")
 */
const props = defineProps<{
  apiUrl: string;
}>();

const name = ref('');
const email = ref('');
const message = ref('');
const company = ref('');

const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle');
const errorMessage = ref('');

const canSubmit = computed(
  () =>
    name.value.trim() !== '' && /.+@.+\..+/.test(email.value) && message.value.trim().length >= 10,
);

async function submit(): Promise<void> {
  if (!canSubmit.value || status.value === 'sending') return;
  status.value = 'sending';
  errorMessage.value = '';
  try {
    const res = await fetch(`${props.apiUrl.replace(/\/$/, '')}/api/v1/public/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        name: name.value.trim(),
        email: email.value.trim(),
        company: company.value.trim() || undefined,
        message: message.value.trim(),
      }),
    });
    if (!res.ok) {
      throw new Error(`Sunucu ${res.status} döndü`);
    }
    status.value = 'sent';
    trackEvent('contact_form_submit');
  } catch (e) {
    status.value = 'error';
    errorMessage.value =
      e instanceof Error
        ? `Form gönderilemedi: ${e.message}. Lütfen daha sonra tekrar deneyin veya destek@kuleplus.com adresine yazın.`
        : 'Form gönderilemedi. Lütfen daha sonra tekrar deneyin.';
  }
}
</script>

<template>
  <div>
    <form v-if="status !== 'sent'" class="contact-form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="contact-name">Ad Soyad <span aria-hidden="true">*</span></label>
        <input
          id="contact-name"
          v-model="name"
          name="name"
          type="text"
          autocomplete="name"
          required
          :aria-invalid="status === 'error' && name.trim() === ''"
        />
      </div>

      <div class="field">
        <label for="contact-email">E-posta <span aria-hidden="true">*</span></label>
        <input
          id="contact-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
        />
      </div>

      <div class="field">
        <label for="contact-company">Şirket</label>
        <input
          id="contact-company"
          v-model="company"
          name="company"
          type="text"
          autocomplete="organization"
        />
      </div>

      <div class="field">
        <label for="contact-message">Mesajınız <span aria-hidden="true">*</span></label>
        <textarea
          id="contact-message"
          v-model="message"
          name="message"
          rows="5"
          required
        ></textarea>
      </div>

      <p v-if="status === 'error'" class="form-error" role="alert">
        {{ errorMessage }}
      </p>

      <button type="submit" class="btn btn-primary" :disabled="!canSubmit || status === 'sending'">
        {{ status === 'sending' ? 'Gönderiliyor…' : 'Gönder' }}
      </button>

      <p class="form-note">
        Formu göndererek <a href="/yasal/kullanim-kosullari">kullanım koşullarını</a> ve
        <a href="/yasal/gizlilik-kvkk">KVKK aydınlatma metnini</a> okuduğunuzu kabul edersiniz.
      </p>
    </form>

    <p v-else class="form-success" role="status">
      Mesajınız alındı. En kısa sürede size dönüş yapacağız.
    </p>
  </div>
</template>

<style scoped>
.contact-form {
  display: grid;
  gap: 1rem;
  max-width: 36rem;
}

.field {
  display: grid;
  gap: 0.375rem;
}

label {
  font-weight: 600;
  font-size: 0.9375rem;
}

input,
textarea {
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border, #cbd5e1);
  border-radius: 0.5rem;
  font: inherit;
  color: inherit;
  background: var(--color-surface, #fff);
}

input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--color-focus, #2563eb);
  outline-offset: 1px;
}

.form-error {
  margin: 0;
  color: var(--color-danger, #b91c1c);
  font-size: 0.9375rem;
}

.form-success {
  margin: 0;
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--color-success-bg, #ecfdf5);
  color: var(--color-success, #047857);
  font-weight: 600;
}

.form-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-muted, #64748b);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
