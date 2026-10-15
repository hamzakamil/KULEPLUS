<template>
  <div class="register-page">
    <!-- Marka paneli (yalnızca geniş ekran) -->
    <aside class="brand-panel">
      <span class="brand-mark" aria-hidden="true">▲</span>
      <p class="brand-name">Kuleplus</p>
      <blockquote class="brand-headline">Ücretsiz modelle<br />bugün başlayın.</blockquote>
      <p class="brand-sub">
        Kayıt oldığınız anda çalışma alanınız hazır: cari ve stok kartlarını içe aktarın,
        faturalarınızı aynı gün kesin.
      </p>
      <ul class="brand-points">
        <li>Kredi kartı yok, satış görüşmesi yok</li>
        <li>Çekirdek modüller süresiz ücretsiz</li>
        <li>Verileriniz Türkiye'de, KVKK uyumlu</li>
      </ul>
    </aside>

    <div class="register-container">
      <div class="register-card">
        <h1 class="register-title">Hesap oluştur</h1>
        <p class="register-sub">Ücretsiz — kurulum 2 dakika sürer</p>

        <form class="register-form" novalidate @submit.prevent="handleRegister">
          <div class="field">
            <label class="field-label" for="register-name">Ad soyad</label>
            <input
              id="register-name"
              v-model="name"
              class="input"
              type="text"
              required
              minlength="2"
              maxlength="100"
              autocomplete="name"
              placeholder="Ayşe Yılmaz"
            />
          </div>

          <div class="field">
            <label class="field-label" for="register-company">Şirket adı</label>
            <input
              id="register-company"
              v-model="companyName"
              class="input"
              type="text"
              maxlength="200"
              autocomplete="organization"
              placeholder="Örnek Ticaret Ltd. Şti. (opsiyonel)"
            />
            <p class="field-hint">
              Boş bırakırsanız çalışma alanı adınızla oluşturulur; sonra değiştirebilirsiniz.
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="register-email">E-posta</label>
            <input
              id="register-email"
              v-model="email"
              class="input"
              type="email"
              required
              maxlength="200"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              placeholder="ornek@sirket.com"
            />
          </div>

          <div class="field">
            <label class="field-label" for="register-password">Şifre</label>
            <div class="password-wrap">
              <input
                id="register-password"
                v-model="password"
                class="input"
                :type="showPassword ? 'text' : 'password'"
                required
                minlength="8"
                maxlength="128"
                autocomplete="new-password"
                placeholder="En az 8 karakter"
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
            <p v-if="password" class="strength" :class="`strength-${strength.level}`">
              {{ strength.label }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="register-module">İlk adımınız</label>
            <select id="register-module" v-model="startingModule" class="input">
              <option value="">Sadece çekirdek ile başla</option>
              <option value="contacts">Cari hesapları içe aktar</option>
              <option value="stock">Stok kartlarını içe aktar</option>
            </select>
          </div>

          <div class="field kvkk">
            <label class="kvkk-row">
              <input v-model="acceptTerms" type="checkbox" class="kvkk-box" required />
              <span>
                <a href="#kvkk-metin" @click.prevent="kvkkOpen = !kvkkOpen">
                  KVKK aydınlatma metnini
                </a>
                okudum, kişisel verilerimin işlenmesine izin veriyorum.
              </span>
            </label>
            <details id="kvkk-metin" :open="kvkkOpen">
              <summary>Kişisel verilerinizi neden işliyoruz?</summary>
              <p>
                Hesabınızı açmak, giriş ve güvenlik (oturum, 2FA, IP kaydı) işlemlerini yürütmek,
                sistem bildirimleri göndermek ve 6102 sayılı TTK / VUK gereği kayıt saklamak için
                işliyoruz. Veriler yalnızca kendi çalışma alanınızla ilişkilendirilir, üçüncü
                taraflara satılmaz ve destek talebi dışında personeliniz erişemez.
              </p>
            </details>
          </div>

          <div v-if="error" class="register-error" role="alert">{{ error }}</div>

          <button type="submit" class="btn btn-primary btn-block" :disabled="busy || !canSubmit">
            <span v-if="busy" class="spinner" aria-hidden="true"></span>
            {{ busy ? 'Hesabınız oluşturuluyor…' : 'Ücretsiz hesabı aç' }}
          </button>
        </form>

        <GoogleAuthButton text="signup_with" @done="handleGoogleDone" />

        <p class="foot">
          Zaten hesabınız var mı?
          <RouterLink to="/login" class="foot-link">Giriş yapın</RouterLink>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import { useAuthStore, type SessionResponse } from '@/stores/auth';
import GoogleAuthButton from '@/components/GoogleAuthButton.vue';

/**
 * Kendi kendine kayıt (ADR-0023): kullanıcı + şirket backend'de tek transaction'da
 * açılır ve oturum hemen kurulur — kullanıcı ikinci kez giriş yapmaz.
 * Yönlendirme giriş ekranıyla aynı kuraldadır (2FA açık → doğrulama ekranı).
 */
const authStore = useAuthStore();
const router = useRouter();

const name = ref('');
const companyName = ref('');
const email = ref('');
const password = ref('');
const startingModule = ref<'' | 'contacts' | 'stock'>('');
const acceptTerms = ref(false);
const showPassword = ref(false);
const capsLockOn = ref(false);
const kvkkOpen = ref(false);
const error = ref('');

const busy = computed(() => authStore.loading);

const canSubmit = computed(
  () =>
    name.value.trim().length >= 2 &&
    email.value.trim().length > 3 &&
    password.value.length >= 8 &&
    acceptTerms.value,
);

/**
 * Kaba güç göstergesi — sıralama amaçlı, güvenlik kontrolü DEĞİL. Asıl zorunluluk
 * sunucuda `registerSchema`'dadır; kullanıcı "8 karakter yeterli"yi ekranda görür,
 * ama 12 karakterin neden iyi olduğunu da sezmelidir.
 */
const strength = computed(() => {
  const value = password.value;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-ZĞÜŞİÖÇ]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 2) {
    return { level: 'weak' as const, label: 'Zayıf — daha uzun ve çeşitli kullanın' };
  }
  if (score === 3) {
    return { level: 'fair' as const, label: 'Orta — büyük harf ve rakam ekleyin' };
  }
  return { level: 'strong' as const, label: 'Güçlü' };
});

function checkCapsLock(event: KeyboardEvent) {
  capsLockOn.value = event.getModifierState?.('CapsLock') ?? false;
}

/** Oturum açıldı: varış yeri role göre çözülür (kaydı yapan owner, dolayısıyla yöneticidir). */
async function goToDestination(session: SessionResponse) {
  if (session.user?.totpEnabled) {
    await router.push('/2fa/verify');
    return;
  }
  await authStore.fetchMe(true);
  await router.push({ name: authStore.landingRoute });
}

async function handleRegister() {
  error.value = '';
  try {
    const session = await authStore.signup({
      email: email.value,
      password: password.value,
      name: name.value.trim(),
      ...(companyName.value.trim() ? { companyName: companyName.value.trim() } : {}),
      ...(startingModule.value ? { startingModule: startingModule.value } : {}),
      acceptTerms: true,
    });
    await goToDestination(session);
  } catch {
    error.value = authStore.error || 'Kayıt tamamlanamadı. Lütfen tekrar deneyin.';
  }
}

async function handleGoogleDone(session: SessionResponse) {
  error.value = '';
  await goToDestination(session);
}
</script>

<style scoped>
/* Giriş ekranıyla aynı split düzen: solda marka, sağda form (tutarlılık). */
.register-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr;
  background: var(--c-bg);
}
@media (min-width: 60rem) {
  .register-page {
    grid-template-columns: 1.05fr 1fr;
  }
}
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
.register-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.register-card {
  width: 100%;
  max-width: 27rem;
}
.register-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}
.register-sub {
  margin: 0.25rem 0 1.5rem;
  color: var(--c-muted);
  font-size: 0.9375rem;
}
.register-form {
  display: grid;
  gap: 1rem;
}
.field-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.375rem;
}
.field-hint {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  color: var(--c-muted);
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
.strength {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  font-weight: 600;
}
.strength-weak {
  color: #b91c1c;
}
.strength-fair {
  color: var(--c-warning);
}
.strength-strong {
  color: #047857;
}
.kvkk {
  display: grid;
  gap: 0.5rem;
}
.kvkk-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
}
.kvkk-box {
  width: 1rem;
  height: 1rem;
  margin-top: 0.15rem;
  accent-color: var(--c-primary);
}
.kvkk a {
  color: var(--c-primary);
  font-weight: 600;
}
.kvkk details {
  font-size: 0.8125rem;
  color: var(--c-muted);
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}
.kvkk summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--c-foreground);
}
.register-error {
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--c-danger-soft);
  color: #b91c1c;
  font-size: 0.875rem;
}
.btn-block {
  width: 100%;
  margin-top: 0.25rem;
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
.foot {
  margin: 1.25rem 0 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--c-muted);
}
.foot-link {
  color: var(--c-primary);
  font-weight: 600;
  text-decoration: none;
}
.foot-link:hover {
  text-decoration: underline;
}
</style>
