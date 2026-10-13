/**
 * Günlük/haftalık özet içeriği — paylaşılan kernel (Faz 7, ROADMAP §819).
 *
 * Dashboard kural motoru (`DashboardSummary`) çıktısını e-posta gövdesine çevirir.
 * Dashboard ile aynı göstergeleri kullandığı için "dashboard tutarı ile özet aynı
 * kuralları kullanır" (ROADMAP kabul kriteri) otomatik sağlanır.
 */

import { formatMoneyTR } from '../money';
import type { DashboardIndicator, DashboardSummary, TrafficStatus } from './indicators';

export type DigestPeriod = 'daily' | 'weekly';

const STATUS_LABEL: Record<TrafficStatus, string> = {
  green: 'İyi',
  amber: 'Dikkat',
  red: 'Kritik',
};

const RANK: Record<TrafficStatus, number> = { green: 0, amber: 1, red: 2 };

function formatAmount(amount: number, currency: string): string {
  return formatMoneyTR(amount.toFixed(2), currency);
}

function indicatorLine(ind: DashboardIndicator, currency: string): string {
  const parts = [`[${STATUS_LABEL[ind.status]}] ${ind.label}: ${ind.hint}`];
  if (typeof ind.amount === 'number' && ind.amount > 0) {
    parts.push(`(${formatAmount(ind.amount, currency)})`);
  }
  return `- ${parts.join(' ')}`;
}

/**
 * Kural sonuçlarından okunabilir, düz metin özet üretir.
 * Çıktı `management.daily_digest` (`summary`) / `management.weekly_digest`
 * (`week_summary`) şablon değişkenine verilir.
 */
export function formatDigestSummary(
  summary: DashboardSummary,
  period: DigestPeriod,
  currency = 'TRY',
): string {
  const heading = period === 'daily' ? 'Bugünün özeti' : 'Bu haftanın özeti';
  const lines: string[] = [heading, `Genel durum: ${STATUS_LABEL[summary.overall]}`, ''];

  if (summary.indicators.length === 0) {
    lines.push('Takip edilecek kural bulunmuyor.');
    return lines.join('\n');
  }

  const sorted = [...summary.indicators].sort((a, b) => RANK[b.status] - RANK[a.status]);
  const notable = sorted.filter((i) => i.status !== 'green');

  if (notable.length === 0) {
    lines.push('Tüm göstergeler yeşil — dikkat gerektiren bir konu yok.');
  } else {
    for (const ind of notable) lines.push(indicatorLine(ind, currency));
  }

  const greenOnes = summary.indicators.filter((i) => i.status === 'green');
  if (notable.length > 0 && greenOnes.length > 0) {
    lines.push('');
    lines.push(`Yeşil göstergeler: ${greenOnes.map((i) => i.label).join(', ')}.`);
  }
  return lines.join('\n');
}
