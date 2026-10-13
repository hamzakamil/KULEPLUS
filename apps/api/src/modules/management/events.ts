import { newId } from '@kuleplus/shared';
import type { PoolClient } from 'pg';

/**
 * Yönetim modülü ortak yazıcıları (DRY).
 *
 * `recordActivity` işletme akışıdır (SPEC §16.5) — audit_logs DEĞİL, append-only.
 * `insertNotification` bildirim + teslim kaydı üretir (SPEC §17.2: ayrı olaylar,
 * ayrı kayıtlar). Teslim kanalı `in_app`; kullanıcının aktif web cihazı varsa ayrıca
 * `push` teslim kaydı üretilir (worker `notification-push` kuyruğu işler).
 */

export interface ActivityInput {
  actorUserId: string;
  activityType: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationInput {
  id?: string;
  userId: string;
  notificationType: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  payload?: Record<string, unknown> | null;
  actorUserId?: string;
}

export async function recordActivity(client: PoolClient, input: ActivityInput): Promise<void> {
  await client.query(
    `INSERT INTO activities
       (id, tenant_id, actor_user_id, activity_type, entity_type, entity_id, summary, metadata, created_by)
     VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $2)`,
    [
      newId(),
      input.actorUserId,
      input.activityType,
      input.entityType,
      input.entityId,
      input.summary,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

export async function insertNotification(
  client: PoolClient,
  input: NotificationInput,
): Promise<string> {
  const notificationId = input.id ?? newId();
  const actor = input.actorUserId ?? input.userId;
  await client.query(
    `INSERT INTO notifications
       (id, tenant_id, user_id, notification_type, title, body, entity_type, entity_id,
        payload, status, created_by, updated_by)
     VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $9)`,
    [
      notificationId,
      input.userId,
      input.notificationType,
      input.title,
      input.body,
      input.entityType,
      input.entityId,
      input.payload ? JSON.stringify(input.payload) : null,
      actor,
    ],
  );
  await client.query(
    `INSERT INTO notification_deliveries
       (id, tenant_id, notification_id, user_id, channel, status, created_by, updated_by)
     VALUES ($1, app.current_tenant_id(), $2, $3, 'in_app', 'pending', $4, $4)`,
    [newId(), notificationId, input.userId, actor],
  );

  // Aktif web cihazı varsa Web Push teslim kaydı da üretilir (worker: notification-push).
  // Cihaz yoksa gereksiz teslim kaydı oluşturmamak için atlanır.
  const hasWebDevice = await client.query(
    `SELECT 1 FROM user_devices
      WHERE user_id = $1 AND is_active = true AND platform = 'web' LIMIT 1`,
    [input.userId],
  );
  if (hasWebDevice.rows.length > 0) {
    await client.query(
      `INSERT INTO notification_deliveries
         (id, tenant_id, notification_id, user_id, channel, status, created_by, updated_by)
       VALUES ($1, app.current_tenant_id(), $2, $3, 'push', 'pending', $4, $4)`,
      [newId(), notificationId, input.userId, actor],
    );
  }
  return notificationId;
}
