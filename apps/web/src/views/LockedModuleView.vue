<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { EmptyState } from '@kuleplus/ui';
import { useEntitlementStore } from '@/stores/entitlement';

/**
 * Kilitli modül önizleme — README §4.1: kilitli modül yalnızca gizlenmez,
 * örnek veriyle tanıtılır ve "bize ulaşın" CTA'sı gösterilir.
 * Gerçek erişim kapısı sunucudadır (`requireEntitlement` → MODULE_NOT_ENTITLED).
 */
const route = useRoute();
const router = useRouter();
const entitlements = useEntitlementStore();

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || '';

interface ModulePreview {
  title: string;
  summary: string;
  features: string[];
  sampleColumns: string[];
  sampleRows: string[][];
}

const PREVIEWS: Record<string, ModulePreview> = {
  trade: {
    title: 'Ticaret',
    summary: 'Tekliften siparişe, irsaliyeden faturaya kadar satış ve satın alma akışı.',
    features: ['Satış teklifi ve siparişi', 'Satın alma siparişi', 'İrsaliye', 'Satış/alış faturası'],
    sampleColumns: ['Belge', 'Cari', 'Tarih', 'Tutar'],
    sampleRows: [
      ['SF-2026-0001', 'Yıldız Gıda A.Ş.', '12.10.2026', '24.500,00 ₺'],
      ['SF-2026-0002', 'Deniz Nakliyat Ltd.', '11.10.2026', '8.750,00 ₺'],
    ],
  },
  cashbank: {
    title: 'Kasa & Banka',
    summary: 'Nakit ve banka hesapları, tahsilat/ödeme akışları ve gün sonu bakiyeleri.',
    features: ['Kasa ve banka hesapları', 'Tahsilat / ödeme kaydı', 'Hesaplar arası transfer'],
    sampleColumns: ['Hesap', 'Tür', 'Bakiye', 'Son hareket'],
    sampleRows: [
      ['Merkez Kasa', 'Kasa', '12.400,00 ₺', '10.10.2026'],
      ['Banka 01', 'Banka', '186.300,00 ₺', '09.10.2026'],
    ],
  },
  einvoice: {
    title: 'e-Dönüşüm',
    summary: 'GİB altyapısıyla e-fatura gönderimi, gelen kutusu ve arşiv.',
    features: ['e-Fatura gönderme', 'Gelen kutusu senkronizasyonu', 'XML/PDF arşiv', 'İptal ve durum takibi'],
    sampleColumns: ['Belge', 'Cari', 'Yön', 'Durum'],
    sampleRows: [
      ['SF-2026-0007', 'Yıldız Gıda A.Ş.', 'Giden', 'Kabul edildi'],
      ['PF-2026-0119', 'Aurum Kırtasiye', 'Gelen', 'Bekliyor'],
    ],
  },
  reports_plus: {
    title: 'Yönetim Raporları',
    summary: 'Yaşlandırma, kârlılık, stok değerleme gibi yönetim paketleri.',
    features: ['Alacak/vade yaşlandırma', 'Kâr-zarar ve KDV özeti', 'Stok değerleme'],
    sampleColumns: ['Rapor', 'Dönem', 'Sonuç'],
    sampleRows: [
      ['Alacak yaşlandırma', 'Ekim 2026', '0-30 gün: 148.000 ₺'],
      ['Stok değerleme', 'Ekim 2026', '96.400 ₺'],
    ],
  },
  accounting: {
    title: 'Muhasebe',
    summary: 'Mali dönem, hesap planı, yevmiye kayıtları ve dönem kilidi.',
    features: ['Hesap planı', 'Yevmiye ve mizan', 'Dönem kilidi'],
    sampleColumns: ['Yevmiye', 'Tarih', 'Borç', 'Alacak'],
    sampleRows: [['FYV-2026-0142', '09.10.2026', '24.500,00 ₺', '24.500,00 ₺']],
  },
  cheque: {
    title: 'Çek & Senet',
    summary: 'Çek/senet portföyü, ciro ve tahsilat takibi.',
    features: ['Portföy takibi', 'Ciro ve tahsilat', 'Vade takvimi'],
    sampleColumns: ['Belge', 'Cari', 'Vade', 'Tutar'],
    sampleRows: [['ÇEK-2026-0031', 'Deniz Nakliyat Ltd.', '25.11.2026', '32.000,00 ₺']],
  },
  management: {
    title: 'Patron Paketi',
    summary: 'Günlük/haftalık özet, görev hatırlatıcıları ve patron görünümü.',
    features: ['Günlük özet e-postası', 'Görev ve hatırlatma', 'Ekibin aktivite özeti'],
    sampleColumns: ['Özet', 'Bugün', 'Dün'],
    sampleRows: [
      ['Tahsilat', '18.400 ₺', '9.200 ₺'],
      ['Yeni teklif', '4', '2'],
    ],
  },
};

const moduleCode = computed(() => String(route.params.module ?? 'trade'));
const preview = computed<ModulePreview>(
  () =>
    PREVIEWS[moduleCode.value] ?? {
      title: 'Modül',
      summary: 'Bu modül paketinize dahil değil.',
      features: [],
      sampleColumns: [],
      sampleRows: [],
    },
);
const unlocked = computed(() => entitlements.hasModule(moduleCode.value));
const contactUrl = computed(() => `${SITE_URL}/iletisim`);
</script>

<template>
  <section class="locked">
    <div class="locked-head">
      <RouterLink to="/dashboard" class="back">← Panele dön</RouterLink>
      <h1>{{ preview.title }} modülü hesabınızda etkin değil</h1>
      <p class="lede">{{ preview.summary }}</p>
    </div>

    <p v-if="unlocked" class="notice">
      Bu modül hesabınızda görünüyor. Sayfayı yenilediğinizde açılır.
      <button type="button" class="btn btn-secondary btn-sm" @click="router.push('/dashboard')">
        Panele dön
      </button>
    </p>

    <div class="grid">
      <article class="card">
        <h2>Neler yapabilirsiniz?</h2>
        <ul class="features">
          <li v-for="feature in preview.features" :key="feature">{{ feature }}</li>
        </ul>
      </article>

      <article class="card">
        <h2>Örnek görünüm</h2>
        <p class="hint">Aşağıdaki veriler tanıtım amaçlıdır, hesabınıza ait değildir.</p>
        <table v-if="preview.sampleColumns.length" class="sample">
          <thead>
            <tr>
              <th v-for="column in preview.sampleColumns" :key="column" scope="col">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in preview.sampleRows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-else
          title="Bu modül için örnek ekran hazır değil"
          description="İletişim sayfamızdan bize yazın, ihtiyacınızı birlikte netleştirelim."
        />
      </article>
    </div>

    <div class="cta">
      <h2>Paketinize ekleyelim</h2>
      <p>{{ preview.title }} modülünü hesabınıza eklemek için bizimle görüşün.</p>
      <a class="btn btn-primary" :href="contactUrl">Bize ulaşın</a>
    </div>
  </section>
</template>

<style scoped>
.locked {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.back {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--c-primary, #1d4ed8);
  text-decoration: none;
  font-size: 0.875rem;
}
.locked-head h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}
.lede {
  margin: 0;
  color: #475569;
}
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.25rem 0 0;
  padding: 0.75rem 1rem;
  border: 1px solid #bfdbfe;
  border-radius: 0.5rem;
  background: #eff6ff;
  color: #1e3a8a;
}
.grid {
  display: grid;
  gap: 1rem;
  margin: 1.5rem 0;
}
@media (min-width: 56rem) {
  .grid {
    grid-template-columns: 1fr 1.4fr;
  }
}
.card {
  padding: 1.25rem;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 0.75rem;
  background: var(--c-surface, #fff);
}
.card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.0625rem;
}
.features {
  margin: 0;
  padding-left: 1.125rem;
  color: #334155;
  line-height: 1.7;
}
.hint {
  margin: 0 0 0.75rem;
  color: #64748b;
  font-size: 0.8125rem;
}
.sample {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.sample th,
.sample td {
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid var(--c-border, #e2e8f0);
  text-align: left;
}
.sample th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
}
.cta {
  padding: 1.25rem;
  border: 1px dashed var(--c-primary, #1d4ed8);
  border-radius: 0.75rem;
  background: #eff6ff;
}
.cta h2 {
  margin: 0 0 0.375rem;
  font-size: 1.0625rem;
}
.cta p {
  margin: 0 0 0.875rem;
  color: #1e3a8a;
}
.btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.btn-primary {
  background: var(--c-primary, #1d4ed8);
  color: #fff;
}
.btn-secondary {
  border-color: var(--c-border, #e2e8f0);
  background: #fff;
  color: #0f172a;
}
.btn-sm {
  padding: 0.3125rem 0.75rem;
  font-size: 0.8125rem;
}
</style>
