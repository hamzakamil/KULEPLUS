/**
 * Web Push yardımcıları — Faz 7 (ROADMAP §812, §822; SPEC §17).
 *
 * Saf fonksiyonlar: worker ve testler tarafından paylaşılır. Ağa/DB'ye dokunmaz.
 * Sessiz saatler kullanıcı tercihinden gelir (`notification_preferences.quiet_hours_*`);
 * "gece yarısını aşan" aralıklar (örn. 22:00–08:00) desteklenir.
 */

/** Push kanalı için tercih + sessiz saat bilgisi. */
export interface QuietHours {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

/** "HH:MM" veya "HH:MM:SS" dizgesini gece yarısından itibaren dakikaya çevirir. */
function toMinutesOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Verilen an sessiz saat aralığında mı?
 * Başlangıç/bitiş eksik veya geçersizse sessiz saat uygulanmaz (false).
 * Aralık gece yarısını aşabilir (start > end → iki parçalı kontrol).
 */
export function isWithinQuietHours(now: Date, quiet: QuietHours): boolean {
  const start = quiet.quietHoursStart ? toMinutesOfDay(quiet.quietHoursStart) : null;
  const end = quiet.quietHoursEnd ? toMinutesOfDay(quiet.quietHoursEnd) : null;
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) return current >= start && current < end;
  // Gece yarısını aşan aralık (örn. 22:00 – 08:00).
  return current >= start || current < end;
}

/** Push bildirim gövdesi (service worker `push` olayında gösterilir). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  notificationId?: string;
}

export interface PushPayloadInput {
  title: string;
  body: string | null;
  notificationType: string;
  entityType: string | null;
  entityId: string | null;
  notificationId?: string;
}

/** Bildirimin ilgili varlığına giden uygulama içi yol (SPEC §21.3). */
export function entityPath(entityType: string | null, entityId: string | null): string {
  if (!entityType || !entityId) return '/';
  switch (entityType) {
    case 'invoice':
      return `/invoices/${entityId}`;
    case 'expense':
      return `/expenses/${entityId}`;
    case 'contact':
      return `/contacts/${entityId}`;
    case 'product':
      return `/stock/${entityId}`;
    case 'task':
      return '/management/tasks';
    case 'appointment':
      return '/management/appointments';
    default:
      return '/';
  }
}

/** Bildirimden push gövdesi üretir. `tag` mükerrer bildirimleri gruplar. */
export function buildPushPayload(input: PushPayloadInput): PushPayload {
  return {
    title: input.title,
    body: input.body ?? '',
    url: entityPath(input.entityType, input.entityId),
    tag: input.notificationType,
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
  };
}
