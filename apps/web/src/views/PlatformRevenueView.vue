<template>
  <div class="platform-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">Gelir Paneli</h1>
        <p class="page-sub">
          Platform geneli abonelik gelirleri (SPEC §8.9). Taahhüt bazlıdır: MRR/ARR tahsilat veya
          faturalanan tutar değildir.
        </p>
      </div>
      <div class="page-actions">
        <label class="range">
          <span class="muted small">Dönem</span>
          <select v-model.number="days" class="input" aria-label="Seri dönemi">
            <option :value="7">Son 7 gün</option>
            <option :value="30">Son 30 gün</option>
            <option :value="90">Son 90 gün</option>
            <option :value="365">Son 1 yıl</option>
          </select>
        </label>
        <button
          v-if="store.isOwner"
          class="btn btn-secondary"
          :disabled="store.computing"
          @click="store.computeSnapshot(days)"
        >
          {{ store.computing ? 'Hesaplanıyor…' : 'Bugünü hesapla' }}
        </button>
      </div>
    </header>

    <p v-if="store.error" class="state-msg error">{{ store.error }}</p>
    <p v-else-if="store.loading && !store.metrics" class="state-msg">Yükleniyor…</p>

    <template v-else-if="store.metrics">
      <!-- Özet göstergeler -->
      <section class="kpis" aria-label="Özet göstergeler">
        <article class="card kpi">
          <span class="muted small">MRR (aylık gelir)</span>
          <strong class="kpi-value">{{ fmtMoney(current.mrr) }}</strong>
        </article>
        <article class="card kpi">
          <span class="muted small">ARR (yıllık)</span>
          <strong class="kpi-value">{{ fmtMoney(current.arr) }}</strong>
        </article>
        <article class="card kpi">
          <span class="muted small">Aktif abonelik</span>
          <strong class="kpi-value">{{ current.activeSubscriptions }}</strong>
        </article>
        <article class="card kpi">
          <span class="muted small">Bugün yeni</span>
          <strong class="kpi-value tone-good">+{{ current.newSubscriptions }}</strong>
        </article>
        <article class="card kpi">
          <span class="muted small">Bugün ayrılan</span>
          <strong class="kpi-value" :class="{ 'tone-bad': current.churnedSubscriptions > 0 }">
            {{ current.churnedSubscriptions }}
          </strong>
        </article>
      </section>

      <!-- MRR trendi -->
      <section class="card">
        <header class="card-head">
          <h2 class="section-title">MRR Trendi</h2>
          <span class="muted small">{{ chronological.length }} günlük kayıt</span>
        </header>
        <div class="card-body">
          <svg
            v-if="chronological.length >= 2"
            class="trend"
            :viewBox="`0 0 ${chartW} ${chartH}`"
            preserveAspectRatio="none"
            role="img"
            :aria-label="`MRR trendi, ${chronological.length} gün`"
          >
            <g v-for="(bar, i) in bars" :key="bar.date">
              <rect
                :x="bar.x"
                :y="bar.y"
                :width="bar.w"
                :height="bar.h"
                :class="{ 'bar-last': i === bars.length - 1 }"
                rx="2"
              >
                <title>{{ bar.date }} · {{ fmtMoney(bar.mrr) }}</title>
              </rect>
            </g>
          </svg>
          <p v-else class="muted small">
            Trend için en az iki günlük snapshot gerekir. "Bugünü hesapla" ile bugünün kaydını
            yazabilir; günlük iş devreye girince seri kendiliğinden dolar.
          </p>
          <div v-if="chronological.length >= 2" class="trend-axis muted small">
            <span>{{ fmtDate(chronological[0].metricDate) }}</span>
            <span>{{ fmtDate(chronological[chronological.length - 1].metricDate) }}</span>
          </div>
        </div>
      </section>

      <!-- Plan dağılımı -->
      <section class="card">
        <header class="card-head">
          <h2 class="section-title">Plan Dağılımı</h2>
          <span class="muted small">{{ plans.length }} plan</span>
        </header>
        <div class="card-body">
          <table v-if="plans.length" class="data-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th class="num">Aktif abonelik</th>
                <th class="num">MRR</th>
                <th class="share-col">MRR payı</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="plan in plans" :key="plan.code">
                <td class="strong">{{ plan.code }}</td>
                <td class="num">{{ plan.activeCount }}</td>
                <td class="num">{{ fmtMoney(plan.mrr) }}</td>
                <td class="share-col">
                  <div class="share" :title="`%${plan.share.toFixed(1)}`">
                    <div class="share-fill" :style="{ width: `${plan.share}%` }"></div>
                  </div>
                  <span class="muted small">%{{ plan.share.toFixed(1) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">
            Aktif abonelik yok; dağılım gösterilecek veri bulunmuyor.
          </p>
        </div>
      </section>

      <p class="muted small footnote">
        Canlı hesap: {{ fmtDateTime(current.computedAt) }} · Para birimi {{ current.currency }}.
        Fiyat bulunmayan planlar MRR'a 0 olarak girer.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { usePlatformStore } from '@/stores/platform';

const store = usePlatformStore();
const days = ref(30);

onMounted(() => store.fetchMetrics(days.value));
watch(days, (value) => store.fetchMetrics(value));

const current = computed(() => store.metrics!.current);

/** API en yeniyi başa koyar; grafik soldan sağa eskiden yeniye çizilir. */
const chronological = computed(() => [...(store.metrics?.series ?? [])].reverse());

const plans = computed(() => {
  const breakdown = store.metrics?.current.planBreakdown ?? {};
  const total = Object.values(breakdown).reduce((sum, p) => sum + p.mrr, 0);
  return Object.entries(breakdown)
    .map(([code, p]) => ({
      code,
      activeCount: p.activeCount,
      mrr: p.mrr,
      share: total > 0 ? (p.mrr / total) * 100 : 0,
    }))
    .sort((a, b) => b.mrr - a.mrr);
});

const chartW = 600;
const chartH = 160;

const bars = computed(() => {
  const rows = chronological.value;
  if (rows.length < 2) return [];
  const max = Math.max(...rows.map((r) => r.mrr), 1);
  const slot = chartW / rows.length;
  const w = Math.max(2, slot * 0.7);
  return rows.map((r, i) => {
    const h = Math.max(2, (r.mrr / max) * (chartH - 8));
    return { date: r.metricDate, mrr: r.mrr, x: i * slot + (slot - w) / 2, y: chartH - h, w, h };
  });
});

const fmtMoney = (value: number): string => {
  const currency = store.metrics?.current.currency || 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

const fmtDate = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR');
const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('tr-TR');
</script>

<style scoped>
.platform-view {
  max-width: 90rem;
  margin-inline: auto;
  padding: 1.5rem;
}
.page-sub {
  margin: 0.25rem 0 0;
  color: var(--c-muted);
  font-size: 0.9375rem;
  max-width: 60rem;
}
.range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kpi-value {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.tone-good {
  color: var(--c-success);
}
.tone-bad {
  color: var(--c-danger);
}
section.card + section.card {
  margin-top: 1rem;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.section-title {
  font-size: 1.05rem;
  margin: 0;
}
.trend {
  display: block;
  width: 100%;
  height: 10rem;
}
.trend rect {
  fill: var(--c-primary);
  opacity: 0.45;
}
.trend rect.bar-last {
  opacity: 1;
}
.trend-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
}
.share-col {
  min-width: 10rem;
}
.share {
  height: 0.5rem;
  background: var(--c-primary-soft);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 0.125rem;
}
.share-fill {
  height: 100%;
  background: var(--c-primary);
}
.footnote {
  margin-top: 1rem;
}
</style>
