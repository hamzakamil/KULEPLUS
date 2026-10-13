<template>
  <div class="twofa-page">
    <div class="twofa-container">
      <div class="twofa-card">
        <h1 class="twofa-title">2FA Doğrulama</h1>

        <div v-if="backupCodes.length" class="twofa-section twofa-backup">
          <h2 class="twofa-subtitle">Yedek Kurtarma Kodları</h2>
          <p class="muted small">
            Bu kodları GÜVENLİ bir yere kaydedin. Cihazınız kaybolursa girişiniz için gereklidir.
          </p>
          <div class="backup-code-grid">
            <code v-for="(code, idx) in backupCodes" :key="code" class="backup-code">{{ code }}</code>
          </div>
          <button @click="finishSetup" class="btn btn-primary">Kodları kaydettim, devam et</button>
        </div>

        <div v-else-if="totpSetup" class="twofa-section">
          <h2 class="twofa-subtitle">TOTP Uygulama Bağlantısı</h2>
          <p class="muted small">
            TOTP uygulamasına (Google Authenticator, Authy vb.) aşağıdaki kodu ekleyin:
          </p>

          <div class="twofa-secret-box">
            <input
              type="text"
              v-model="totpSecret"
              readonly
              class="input"
              placeholder="TOTP secret kodunu buraya girin"
            />
            <button @click="copyToClipboard(totpSecret)" class="btn btn-secondary btn-sm twofa-copy">
              Kopyala
            </button>
          </div>

          <div class="qr-preview">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="TOTP QR kodu" class="qr-image" />
            <p class="muted small">QR Code (tarayarak bağlayın)</p>
          </div>

          <div class="field">
            <label for="totp-code-input" class="field-label">Uygulamada oluşan 6 haneli kodu girin</label>
            <input
              id="totp-code-input"
              v-model="enteredCode"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{6}"
              maxlength="6"
              class="input"
              placeholder="000000"
              @keyup.enter="verifyTotpCode"
            />
          </div>
          <div class="twofa-actions">
            <button @click="verifyTotpCode" class="btn btn-primary">Doğrula ve Etkinleştir</button>
          </div>
        </div>

        <!-- TOTP Code Entry -->
        <div v-else class="twofa-section">
          <p class="muted small">Cihazınızda oluşturulan 6 haneli TOTP kodunu girin:</p>

          <div class="twofa-digits">
            <button
              v-for="digit in digits"
              :key="digit"
              @click="appendDigit(digit)"
              class="btn btn-secondary twofa-digit"
            >
              {{ digit }}
            </button>
          </div>

          <div class="twofa-actions">
            <button @click="deleteLastDigit" class="btn btn-secondary">Sil</button>
            <button @click="verifyTotpCode" class="btn btn-primary">Doğrula</button>
          </div>
        </div>

        <!-- Error Message -->
        <p v-if="totpError" class="alert-error">{{ totpError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const router = useRouter();

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const enteredCode = ref('');
const totpSecret = ref('');
const totpSetup = ref(false);
const totpError = ref('');
const qrDataUrl = ref('');
// Yedek kodlar yalnızca etkinleştirme anında bir kez gelir (P0 #6).
const backupCodes = ref<string[]>([]);

// Initialize 2FA setup
onMounted(async () => {
  try {
    const result = await authStore.get2FASetup();
    totpSecret.value = result.secret || '';
    qrDataUrl.value = result.qrCode || '';
    totpSetup.value = true;
  } catch {
    // Error handled by store
  }
});

// Append digit to code
const appendDigit = (digit: string) => {
  if (enteredCode.value.length < 6) {
    enteredCode.value += digit;
  }
};

// Delete last digit
const deleteLastDigit = () => {
  enteredCode.value = enteredCode.value.slice(0, -1);
};

// Verify TOTP code
const verifyTotpCode = async () => {
  if (enteredCode.value.length !== 6) {
    totpError.value = 'Lütfen 6 haneli bir kod girin.';
    return;
  }

  try {
    const result = await authStore.verify2FA(enteredCode.value);
    backupCodes.value = result?.backupCodes ?? [];
    enteredCode.value = '';
  } catch {
    totpError.value = 'Yanlış TOTP kodu. Lütfen tekrar deneyin.';
    enteredCode.value = '';
  }
};

const finishSetup = () => {
  router.push('/dashboard');
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    // success feedback
  });
};
</script>

<style scoped>
.twofa-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--c-bg);
  padding: 1rem;
}

.twofa-container {
  width: 100%;
  max-width: 400px;
}

.twofa-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 0.875rem;
  box-shadow:
    0 1px 3px 0 rgb(15 23 42 / 0.08),
    0 1px 2px 0 rgb(15 23 42 / 0.05);
  padding: 2rem;
}

.twofa-title {
  font-size: 1.5rem;
  font-weight: 700;
  text-align: center;
  margin: 0 0 1.5rem;
}

.twofa-subtitle {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0 0 1rem;
}

.twofa-section {
  margin-bottom: 1.5rem;
}

.small {
  font-size: 0.8125rem;
  margin: 0 0 1rem;
}

.twofa-secret-box {
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.twofa-copy {
  width: 100%;
  margin-top: 0.5rem;
}

.twofa-digits {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  margin-top: 1rem;
}

.twofa-digit {
  font-size: 1.125rem;
  font-weight: 600;
}

.twofa-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.twofa-actions .btn {
  flex: 1;
}

.qr-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 150px;
  height: 150px;
  background: var(--c-bg);
  border-radius: 0.5rem;
  margin: 1rem auto;
}

.qr-image {
  width: 130px;
  height: 130px;
  border-radius: 0.375rem;
}

.backup-code-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.backup-code {
  display: block;
  padding: 0.5rem;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 0.375rem;
}
</style>
