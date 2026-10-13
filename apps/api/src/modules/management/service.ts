import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import {
  insertNotification as insertNotificationRecord,
  recordActivity as recordActivityRecord,
} from './events';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  AssignTaskInput,
  CompleteTaskInput,
  TaskListQuery,
  CreateReminderInput,
  SnoozeReminderInput,
  ReminderListQuery,
  CreateCalendarInput,
  UpdateCalendarInput,
  CalendarListQuery,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CalendarEventListQuery,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  AppointmentStatusInput,
  AppointmentListQuery,
  CreateNoteInput,
  UpdateNoteInput,
  NoteListQuery,
  ActivityListQuery,
  CreateNotificationInput,
  NotificationListQuery,
  RegisterDeviceInput,
  DeviceListQuery,
  UpsertPreferenceInput,
  PreferenceListQuery,
} from './schemas';

/**
 * Yönetim Paketi servisi — ROADMAP Faz 7 (SPEC §16, §17).
 *
 * Kapsam: görev, hatırlatıcı, takvim/etkinlik, randevu, not, aktivite akışı,
 * bildirim platformu, kullanıcı cihazları ve bildirim tercihleri.
 *
 * Tenant izolasyonu iki katmanlı (cheque/accounting deseni):
 *  - API katmanı `tenantContext` (RLS),
 *  - servis kendi transaction'ında `set_config('app.tenant_id', ...)`.
 *
 * Ayrım (SPEC §17.2): görev tamamlandı ≠ hatırlatıcı tetiklendi ≠ bildirim
 * teslim edildi → üç ayrı kayıt. `activities` işletme akışıdır; `audit_logs`
 * güvenlik/izleme içindir (SPEC §16.5) — bu servis yalnızca activities yazar.
 */

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

/**
 * T-7.1: görev son tarihine göre varsayılan hatırlatıcı ofsetleri (ms).
 * Üç varsayılan: 15 dk, 1 saat, 1 gün önce (kullanıcı onaylı).
 */
const DEFAULT_REMINDER_OFFSETS_MS: readonly number[] = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

function toDateString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class ManagementService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(options?: { pool?: Pool }) {
    this.providedPool = options?.pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  private async withTenantClient<T>(
    tenantId: string | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ======================= Görev =======================

  async listTasks(query: TaskListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['t.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.q) {
        conditions.push(`t.title ILIKE $${i}`);
        values.push(`%${query.q}%`);
        i++;
      }
      if (query.status) {
        conditions.push(`t.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.priority) {
        conditions.push(`t.priority = $${i}`);
        values.push(query.priority);
        i++;
      }
      if (query.assigned_to) {
        conditions.push(`t.assigned_to = $${i}`);
        values.push(query.assigned_to);
        i++;
      }
      if (query.due_from) {
        conditions.push(`t.due_at >= $${i}`);
        values.push(query.due_from);
        i++;
      }
      if (query.due_to) {
        conditions.push(`t.due_at <= $${i}`);
        values.push(query.due_to);
        i++;
      }
      if (query.parent_task_id) {
        conditions.push(`t.parent_task_id = $${i}`);
        values.push(query.parent_task_id);
        i++;
      }
      const where = conditions.join(' AND ');
      const sortColumnMap: Record<string, string> = {
        due_at: 't.due_at NULLS LAST',
        priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
        createdAt: 't.created_at',
        title: 't.title',
      };
      const sortColumn = sortColumnMap[query.sortBy] ?? 't.created_at';
      const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT t.* FROM tasks t WHERE ${where}
           ORDER BY ${sortColumn} ${sortOrder} LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM tasks t WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapTaskRow), Number(count.rows[0].total), query);
    });
  }

  async getTask(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapTaskRow(r.rows[0]);
    });
  }

  async createTask(input: CreateTaskInput, userId: string, tenantId?: string) {
    const taskId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tasks
           (id, tenant_id, title, description, status, priority, assigned_to, due_at,
            source, related_entity_type, related_entity_id, parent_task_id, rrule, tags,
            created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          taskId,
          input.title,
          input.description ?? null,
          input.status,
          input.priority,
          input.assigned_to ?? null,
          input.due_at ?? null,
          input.source,
          input.related_entity_type ?? null,
          input.related_entity_id ?? null,
          input.parent_task_id ?? null,
          input.rrule ?? null,
          input.tags,
          userId,
        ],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'task.created',
        entityType: 'task',
        entityId: taskId,
        summary: `Görev oluşturuldu: ${input.title}`,
      });
      if (input.assigned_to && input.assigned_to !== userId) {
        await this.insertNotification(client, {
          userId: input.assigned_to,
          notificationType: 'task.assigned',
          title: 'Yeni görev atandı',
          body: input.title,
          entityType: 'task',
          entityId: taskId,
        });
        await this.recordActivity(client, {
          actorUserId: userId,
          activityType: 'task.assigned',
          entityType: 'task',
          entityId: taskId,
          summary: `Görev atandı: ${input.title}`,
        });
      }
      // T-7.1: son tarih varsa varsayılan hatırlatıcılar (sorumluya, yoksa oluşturana).
      if (input.due_at) {
        await this.insertDefaultTaskReminders(client, {
          taskId,
          userId: input.assigned_to ?? userId,
          actorUserId: userId,
          dueAt: input.due_at,
        });
      }
    });
    return this.getTask(taskId, tenantId);
  }

  async updateTask(id: string, input: UpdateTaskInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Görev bulunamadı');
      const current = found.rows[0];

      const status = input.status ?? current.status;
      let completedAt: string | null = current.completed_at;
      if (status === 'completed' && current.status !== 'completed')
        completedAt = new Date().toISOString();
      else if (status !== 'completed') completedAt = null;

      await client.query(
        `UPDATE tasks SET
           title = $1,
           description = $2,
           status = $3,
           priority = $4,
           assigned_to = $5,
           due_at = $6,
           related_entity_type = $7,
           related_entity_id = $8,
           rrule = $9,
           tags = $10,
           completed_at = $11,
           updated_by = $12, updated_at = now()
         WHERE id = $13 AND tenant_id = app.current_tenant_id()`,
        [
          input.title ?? current.title,
          input.description !== undefined ? input.description : current.description,
          status,
          input.priority ?? current.priority,
          input.assigned_to !== undefined ? input.assigned_to : current.assigned_to,
          input.due_at !== undefined ? input.due_at : current.due_at,
          input.related_entity_type !== undefined
            ? input.related_entity_type
            : current.related_entity_type,
          input.related_entity_id !== undefined
            ? input.related_entity_id
            : current.related_entity_id,
          input.rrule !== undefined ? input.rrule : current.rrule,
          input.tags ?? current.tags,
          completedAt,
          userId,
          id,
        ],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'task.updated',
        entityType: 'task',
        entityId: id,
        summary: `Görev güncellendi: ${input.title ?? current.title}`,
      });
    });
    return this.getTask(id, tenantId);
  }

  async deleteTask(id: string, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const existing = await client.query(
        'SELECT title FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (existing.rows.length === 0) throw new AppError('NOT_FOUND', 'Görev bulunamadı');
      await client.query(
        'DELETE FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'task.deleted',
        entityType: 'task',
        entityId: id,
        summary: `Görev silindi: ${existing.rows[0].title}`,
      });
      return { success: true };
    });
  }

  async assignTask(id: string, input: AssignTaskInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT title, assigned_to FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Görev bulunamadı');
      await client.query(
        `UPDATE tasks SET assigned_to = $1, updated_by = $2, updated_at = now()
          WHERE id = $3 AND tenant_id = app.current_tenant_id()`,
        [input.assigned_to, userId, id],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'task.assigned',
        entityType: 'task',
        entityId: id,
        summary: `Görev atandı: ${found.rows[0].title}`,
        metadata: { assigned_to: input.assigned_to },
      });
      if (input.assigned_to !== userId) {
        await this.insertNotification(client, {
          userId: input.assigned_to,
          notificationType: 'task.assigned',
          title: 'Görev atandı',
          body: found.rows[0].title,
          entityType: 'task',
          entityId: id,
        });
      }
    });
    return this.getTask(id, tenantId);
  }

  async completeTask(id: string, input: CompleteTaskInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT title, status FROM tasks WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Görev bulunamadı');
      if (found.rows[0].status === 'cancelled') {
        throw new AppError('FORBIDDEN', 'İptal edilmiş görev tamamlanamaz');
      }
      await client.query(
        `UPDATE tasks SET status = 'completed', completed_at = now(),
                            updated_by = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = app.current_tenant_id()`,
        [userId, id],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'task.completed',
        entityType: 'task',
        entityId: id,
        summary: `Görev tamamlandı: ${found.rows[0].title}`,
        metadata: input.note ? { note: input.note } : undefined,
      });
    });
    return this.getTask(id, tenantId);
  }

  // ======================= Hatırlatıcı =======================

  async listReminders(query: ReminderListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['r.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      for (const [col, val] of [
        ['user_id', query.user_id],
        ['task_id', query.task_id],
        ['event_id', query.event_id],
        ['status', query.status],
        ['channel', query.channel],
      ] as const) {
        if (val) {
          conditions.push(`r.${col} = $${i}`);
          values.push(val);
          i++;
        }
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT r.* FROM reminders r WHERE ${where}
           ORDER BY r.remind_at ASC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM reminders r WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapReminderRow), Number(count.rows[0].total), query);
    });
  }

  async createReminder(input: CreateReminderInput, userId: string, tenantId?: string) {
    const reminderId = newId();
    const targetUser = input.user_id ?? userId;
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO reminders
           (id, tenant_id, user_id, task_id, event_id, remind_at, channel, status,
            created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, 'pending', $7, $7)`,
        [
          reminderId,
          targetUser,
          input.task_id ?? null,
          input.event_id ?? null,
          input.remind_at,
          input.channel,
          userId,
        ],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'reminder.created',
        entityType: input.task_id ? 'task' : 'appointment',
        entityId: input.task_id ?? input.event_id ?? null,
        summary: `Hatırlatıcı kuruldu (${input.channel})`,
        metadata: { remind_at: input.remind_at },
      });
    });
    return this.getReminder(reminderId, tenantId);
  }

  async getReminder(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM reminders WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapReminderRow(r.rows[0]);
    });
  }

  async snoozeReminder(id: string, input: SnoozeReminderInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT status FROM reminders WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Hatırlatıcı bulunamadı');
      if (r.rows[0].status === 'sent') {
        throw new AppError('FORBIDDEN', 'Gönderilmiş hatırlatıcı ertelenemez');
      }
      await client.query(
        `UPDATE reminders SET snoozed_until = $1, remind_at = $1, status = 'pending',
                              updated_by = $2, updated_at = now()
          WHERE id = $3 AND tenant_id = app.current_tenant_id()`,
        [input.snoozed_until, userId, id],
      );
    });
    return this.getReminder(id, tenantId);
  }

  async cancelReminder(id: string, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT status FROM reminders WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Hatırlatıcı bulunamadı');
      await client.query(
        `UPDATE reminders SET status = 'cancelled', updated_by = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = app.current_tenant_id()`,
        [userId, id],
      );
    });
    return this.getReminder(id, tenantId);
  }

  // ======================= Takvim =======================

  async listCalendars(query: CalendarListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['c.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.calendar_type) {
        conditions.push(`c.calendar_type = $${i}`);
        values.push(query.calendar_type);
        i++;
      }
      if (query.owner_user_id) {
        conditions.push(`c.owner_user_id = $${i}`);
        values.push(query.owner_user_id);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT c.* FROM calendars c WHERE ${where}
           ORDER BY c.is_default DESC, c.name ASC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM calendars c WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapCalendarRow), Number(count.rows[0].total), query);
    });
  }

  async createCalendar(input: CreateCalendarInput, userId: string, tenantId?: string) {
    const calendarId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      if (input.is_default) {
        await client.query(
          'UPDATE calendars SET is_default = false WHERE tenant_id = app.current_tenant_id()',
        );
      }
      await client.query(
        `INSERT INTO calendars
           (id, tenant_id, name, calendar_type, owner_user_id, color, visibility,
            is_default, timezone, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          calendarId,
          input.name,
          input.calendar_type,
          input.owner_user_id ?? userId,
          input.color ?? null,
          input.visibility,
          input.is_default,
          input.timezone,
          userId,
        ],
      );
    });
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM calendars WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [calendarId],
      );
      return mapCalendarRow(r.rows[0]);
    });
  }

  async updateCalendar(id: string, input: UpdateCalendarInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM calendars WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Takvim bulunamadı');
      const c = found.rows[0];
      if (input.is_default) {
        await client.query(
          'UPDATE calendars SET is_default = false WHERE tenant_id = app.current_tenant_id()',
        );
      }
      await client.query(
        `UPDATE calendars SET
           name = $1, calendar_type = $2, owner_user_id = $3, color = $4,
           visibility = $5, is_default = $6, timezone = $7, updated_by = $8, updated_at = now()
         WHERE id = $9 AND tenant_id = app.current_tenant_id()`,
        [
          input.name ?? c.name,
          input.calendar_type ?? c.calendar_type,
          input.owner_user_id !== undefined ? input.owner_user_id : c.owner_user_id,
          input.color !== undefined ? input.color : c.color,
          input.visibility ?? c.visibility,
          input.is_default ?? c.is_default,
          input.timezone ?? c.timezone,
          userId,
          id,
        ],
      );
    });
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM calendars WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return mapCalendarRow(r.rows[0]);
    });
  }

  async deleteCalendar(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'DELETE FROM calendars WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING id',
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Takvim bulunamadı');
      return { success: true };
    });
  }

  // ======================= Takvim Etkinliği =======================

  async listCalendarEvents(
    query: CalendarEventListQuery,
    tenantId?: string,
  ): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['e.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.calendar_id) {
        conditions.push(`e.calendar_id = $${i}`);
        values.push(query.calendar_id);
        i++;
      }
      if (query.status) {
        conditions.push(`e.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.from) {
        conditions.push(`e.starts_at >= $${i}`);
        values.push(query.from);
        i++;
      }
      if (query.to) {
        conditions.push(`e.starts_at <= $${i}`);
        values.push(query.to);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT e.* FROM calendar_events e WHERE ${where}
           ORDER BY e.starts_at ASC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM calendar_events e WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapCalendarEventRow), Number(count.rows[0].total), query);
    });
  }

  async createCalendarEvent(input: CreateCalendarEventInput, userId: string, tenantId?: string) {
    const eventId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      const cal = await client.query(
        'SELECT id FROM calendars WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [input.calendar_id],
      );
      if (cal.rows.length === 0) throw new AppError('NOT_FOUND', 'Takvim bulunamadı');
      await client.query(
        `INSERT INTO calendar_events
           (id, tenant_id, calendar_id, title, description, event_type, owner_user_id,
            starts_at, ends_at, all_day, local_start_date, local_end_date, timezone,
            rrule, location, visibility, status, related_entity_type, related_entity_id,
            created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11, $12, $13, $14, $15, 'scheduled', $16, $17, $18, $18)`,
        [
          eventId,
          input.calendar_id,
          input.title,
          input.description ?? null,
          input.event_type,
          input.owner_user_id ?? userId,
          input.starts_at,
          input.ends_at ?? null,
          input.all_day,
          input.local_start_date ?? null,
          input.local_end_date ?? null,
          input.timezone,
          input.rrule ?? null,
          input.location ?? null,
          input.visibility,
          input.related_entity_type ?? null,
          input.related_entity_id ?? null,
          userId,
        ],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'calendar.event.created',
        entityType: 'appointment',
        entityId: eventId,
        summary: `Takvim etkinliği oluşturuldu: ${input.title}`,
      });
    });
    return this.getCalendarEvent(eventId, tenantId);
  }

  async getCalendarEvent(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM calendar_events WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapCalendarEventRow(r.rows[0]);
    });
  }

  async updateCalendarEvent(
    id: string,
    input: UpdateCalendarEventInput,
    userId: string,
    tenantId?: string,
  ) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM calendar_events WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Takvim etkinliği bulunamadı');
      const e = found.rows[0];
      await client.query(
        `UPDATE calendar_events SET
           title = $1, description = $2, event_type = $3, owner_user_id = $4,
           starts_at = $5, ends_at = $6, all_day = $7, local_start_date = $8,
           local_end_date = $9, timezone = $10, rrule = $11, location = $12,
           visibility = $13, status = $14, related_entity_type = $15, related_entity_id = $16,
           updated_by = $17, updated_at = now()
         WHERE id = $18 AND tenant_id = app.current_tenant_id()`,
        [
          input.title ?? e.title,
          input.description !== undefined ? input.description : e.description,
          input.event_type ?? e.event_type,
          input.owner_user_id !== undefined ? input.owner_user_id : e.owner_user_id,
          input.starts_at ?? e.starts_at,
          input.ends_at !== undefined ? input.ends_at : e.ends_at,
          input.all_day ?? e.all_day,
          input.local_start_date !== undefined ? input.local_start_date : e.local_start_date,
          input.local_end_date !== undefined ? input.local_end_date : e.local_end_date,
          input.timezone ?? e.timezone,
          input.rrule !== undefined ? input.rrule : e.rrule,
          input.location !== undefined ? input.location : e.location,
          input.visibility ?? e.visibility,
          input.status ?? e.status,
          input.related_entity_type !== undefined
            ? input.related_entity_type
            : e.related_entity_type,
          input.related_entity_id !== undefined ? input.related_entity_id : e.related_entity_id,
          userId,
          id,
        ],
      );
    });
    return this.getCalendarEvent(id, tenantId);
  }

  async deleteCalendarEvent(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'DELETE FROM calendar_events WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING id',
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Takvim etkinliği bulunamadı');
      return { success: true };
    });
  }

  // ======================= Randevu =======================

  async listAppointments(
    query: AppointmentListQuery,
    tenantId?: string,
  ): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['a.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.status) {
        conditions.push(`a.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.contact_id) {
        conditions.push(`a.contact_id = $${i}`);
        values.push(query.contact_id);
        i++;
      }
      if (query.owner_user_id) {
        conditions.push(`a.owner_user_id = $${i}`);
        values.push(query.owner_user_id);
        i++;
      }
      if (query.from) {
        conditions.push(`a.starts_at >= $${i}`);
        values.push(query.from);
        i++;
      }
      if (query.to) {
        conditions.push(`a.starts_at <= $${i}`);
        values.push(query.to);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT a.* FROM appointments a WHERE ${where}
           ORDER BY a.starts_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM appointments a WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapAppointmentRow), Number(count.rows[0].total), query);
    });
  }

  async getAppointment(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM appointments WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapAppointmentRow(r.rows[0]);
    });
  }

  async createAppointment(input: CreateAppointmentInput, userId: string, tenantId?: string) {
    const appointmentId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      let calendarEventId: string | null = null;
      if (input.create_calendar_event) {
        const cal = await client.query(
          `SELECT id FROM calendars
            WHERE tenant_id = app.current_tenant_id()
            ORDER BY (owner_user_id = $1) DESC, is_default DESC, created_at ASC
            LIMIT 1`,
          [input.owner_user_id ?? userId],
        );
        if (cal.rows.length > 0) {
          calendarEventId = newId();
          await client.query(
            `INSERT INTO calendar_events
               (id, tenant_id, calendar_id, title, event_type, owner_user_id,
                starts_at, ends_at, timezone, visibility, status, created_by, updated_by)
             VALUES ($1, app.current_tenant_id(), $2, $3, 'appointment', $4,
                     $5, $6, 'Europe/Istanbul', 'company', 'scheduled', $7, $7)`,
            [
              calendarEventId,
              cal.rows[0].id,
              input.title,
              input.owner_user_id ?? userId,
              input.starts_at,
              input.ends_at ?? null,
              userId,
            ],
          );
        }
      }

      await client.query(
        `INSERT INTO appointments
           (id, tenant_id, title, contact_id, owner_user_id, calendar_event_id,
            starts_at, ends_at, status, location, notes, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $10)`,
        [
          appointmentId,
          input.title,
          input.contact_id ?? null,
          input.owner_user_id ?? userId,
          calendarEventId,
          input.starts_at,
          input.ends_at ?? null,
          input.location ?? null,
          input.notes ?? null,
          userId,
        ],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: 'appointment.created',
        entityType: 'appointment',
        entityId: appointmentId,
        summary: `Randevu oluşturuldu: ${input.title}`,
      });
      const owner = input.owner_user_id ?? userId;
      if (owner !== userId) {
        await this.insertNotification(client, {
          userId: owner,
          notificationType: 'appointment.created',
          title: 'Yeni randevu',
          body: input.title,
          entityType: 'appointment',
          entityId: appointmentId,
        });
      }
    });
    return this.getAppointment(appointmentId, tenantId);
  }

  async updateAppointment(
    id: string,
    input: UpdateAppointmentInput,
    userId: string,
    tenantId?: string,
  ) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM appointments WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Randevu bulunamadı');
      const a = found.rows[0];
      await client.query(
        `UPDATE appointments SET
           title = $1, contact_id = $2, owner_user_id = $3, starts_at = $4, ends_at = $5,
           location = $6, notes = $7, updated_by = $8, updated_at = now()
         WHERE id = $9 AND tenant_id = app.current_tenant_id()`,
        [
          input.title ?? a.title,
          input.contact_id !== undefined ? input.contact_id : a.contact_id,
          input.owner_user_id !== undefined ? input.owner_user_id : a.owner_user_id,
          input.starts_at ?? a.starts_at,
          input.ends_at !== undefined ? input.ends_at : a.ends_at,
          input.location !== undefined ? input.location : a.location,
          input.notes !== undefined ? input.notes : a.notes,
          userId,
          id,
        ],
      );
      if (a.calendar_event_id) {
        await client.query(
          `UPDATE calendar_events SET title = $1, starts_at = $2, ends_at = $3,
                                      updated_by = $4, updated_at = now()
            WHERE id = $5 AND tenant_id = app.current_tenant_id()`,
          [
            input.title ?? a.title,
            input.starts_at ?? a.starts_at,
            input.ends_at ?? a.ends_at,
            userId,
            a.calendar_event_id,
          ],
        );
      }
    });
    return this.getAppointment(id, tenantId);
  }

  async setAppointmentStatus(
    id: string,
    input: AppointmentStatusInput,
    userId: string,
    tenantId?: string,
  ) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT title, status FROM appointments WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Randevu bulunamadı');
      await client.query(
        `UPDATE appointments SET status = $1, updated_by = $2, updated_at = now()
          WHERE id = $3 AND tenant_id = app.current_tenant_id()`,
        [input.status, userId, id],
      );
      await this.recordActivity(client, {
        actorUserId: userId,
        activityType: `appointment.${input.status}`,
        entityType: 'appointment',
        entityId: id,
        summary: `Randevu durumu: ${found.rows[0].status} → ${input.status} (${found.rows[0].title})`,
        metadata: input.note ? { note: input.note } : undefined,
      });
    });
    return this.getAppointment(id, tenantId);
  }

  // ======================= Not =======================

  async listNotes(query: NoteListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['n.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.q) {
        conditions.push(`(n.title ILIKE $${i} OR n.body ILIKE $${i})`);
        values.push(`%${query.q}%`);
        i++;
      }
      if (query.related_entity_type) {
        conditions.push(`n.related_entity_type = $${i}`);
        values.push(query.related_entity_type);
        i++;
      }
      if (query.related_entity_id) {
        conditions.push(`n.related_entity_id = $${i}`);
        values.push(query.related_entity_id);
        i++;
      }
      if (query.pinned !== undefined) {
        conditions.push(`n.pinned = $${i}`);
        values.push(query.pinned);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT n.* FROM notes n WHERE ${where}
           ORDER BY n.pinned DESC, n.updated_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM notes n WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapNoteRow), Number(count.rows[0].total), query);
    });
  }

  async getNote(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM notes WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapNoteRow(r.rows[0]);
    });
  }

  async createNote(input: CreateNoteInput, userId: string, tenantId?: string) {
    const noteId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO notes
           (id, tenant_id, title, body, related_entity_type, related_entity_id, pinned,
            created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $7)`,
        [
          noteId,
          input.title ?? null,
          input.body ?? null,
          input.related_entity_type ?? null,
          input.related_entity_id ?? null,
          input.pinned,
          userId,
        ],
      );
    });
    return this.getNote(noteId, tenantId);
  }

  async updateNote(id: string, input: UpdateNoteInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM notes WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Not bulunamadı');
      const n = found.rows[0];
      await client.query(
        `UPDATE notes SET
           title = $1, body = $2, related_entity_type = $3, related_entity_id = $4,
           pinned = $5, updated_by = $6, updated_at = now()
         WHERE id = $7 AND tenant_id = app.current_tenant_id()`,
        [
          input.title !== undefined ? input.title : n.title,
          input.body !== undefined ? input.body : n.body,
          input.related_entity_type !== undefined
            ? input.related_entity_type
            : n.related_entity_type,
          input.related_entity_id !== undefined ? input.related_entity_id : n.related_entity_id,
          input.pinned ?? n.pinned,
          userId,
          id,
        ],
      );
    });
    return this.getNote(id, tenantId);
  }

  async deleteNote(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'DELETE FROM notes WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING id',
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Not bulunamadı');
      return { success: true };
    });
  }

  // ======================= Aktivite =======================

  async listActivities(query: ActivityListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['a.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.entity_type) {
        conditions.push(`a.entity_type = $${i}`);
        values.push(query.entity_type);
        i++;
      }
      if (query.entity_id) {
        conditions.push(`a.entity_id = $${i}`);
        values.push(query.entity_id);
        i++;
      }
      if (query.activity_type) {
        conditions.push(`a.activity_type = $${i}`);
        values.push(query.activity_type);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT a.* FROM activities a WHERE ${where}
           ORDER BY a.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM activities a WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapActivityRow), Number(count.rows[0].total), query);
    });
  }

  // ======================= Bildirim =======================

  async listNotifications(
    query: NotificationListQuery,
    tenantId?: string,
  ): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['n.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.user_id) {
        conditions.push(`n.user_id = $${i}`);
        values.push(query.user_id);
        i++;
      }
      if (query.notification_type) {
        conditions.push(`n.notification_type = $${i}`);
        values.push(query.notification_type);
        i++;
      }
      if (query.status) {
        conditions.push(`n.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.unread_only) {
        conditions.push(`n.read_at IS NULL`);
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT n.* FROM notifications n WHERE ${where}
           ORDER BY n.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapNotificationRow), Number(count.rows[0].total), query);
    });
  }

  async createNotification(input: CreateNotificationInput, userId: string, tenantId?: string) {
    const notificationId = newId();
    await this.withTenantClient(tenantId, async (client) => {
      await this.insertNotification(client, {
        id: notificationId,
        userId: input.user_id,
        notificationType: input.notification_type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entity_type ?? null,
        entityId: input.entity_id ?? null,
        payload: input.payload ?? null,
        actorUserId: userId,
      });
    });
    return this.getNotification(notificationId, tenantId);
  }

  async getNotification(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM notifications WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      return r.rows.length === 0 ? null : mapNotificationRow(r.rows[0]);
    });
  }

  async markNotificationRead(id: string, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT status FROM notifications WHERE id = $1 AND tenant_id = app.current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Bildirim bulunamadı');
      await client.query(
        `UPDATE notifications SET status = 'read', read_at = now(),
                                  updated_by = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = app.current_tenant_id()`,
        [userId, id],
      );
    });
    return this.getNotification(id, tenantId);
  }

  // ======================= Cihaz =======================

  async listDevices(query: DeviceListQuery, tenantId?: string): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['d.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.user_id) {
        conditions.push(`d.user_id = $${i}`);
        values.push(query.user_id);
        i++;
      }
      if (query.is_active !== undefined) {
        conditions.push(`d.is_active = $${i}`);
        values.push(query.is_active);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT d.* FROM user_devices d WHERE ${where}
           ORDER BY d.last_active_at DESC NULLS LAST LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM user_devices d WHERE ${where}`, values),
      ]);
      return this.page(list.rows.map(mapDeviceRow), Number(count.rows[0].total), query);
    });
  }

  async registerDevice(input: RegisterDeviceInput, userId: string, tenantId?: string) {
    const deviceId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        `INSERT INTO user_devices
           (id, tenant_id, user_id, device_token, platform, device_name, is_active,
            last_active_at, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, true, now(), $6, $6)
         ON CONFLICT (tenant_id, device_token) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               platform = EXCLUDED.platform,
               device_name = EXCLUDED.device_name,
               is_active = true,
               last_active_at = now(),
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING *`,
        [deviceId, userId, input.device_token, input.platform, input.device_name ?? null, userId],
      );
      return mapDeviceRow(r.rows[0]);
    });
  }

  async deleteDevice(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        `UPDATE user_devices SET is_active = false, updated_at = now()
          WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING id`,
        [id],
      );
      if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Cihaz bulunamadı');
      return { success: true };
    });
  }

  // ======================= Bildirim Tercihi =======================

  async listPreferences(
    query: PreferenceListQuery,
    userId: string,
    tenantId?: string,
  ): Promise<PageResult<unknown>> {
    return this.withTenantClient(tenantId, async (client) => {
      // Tercihler kullanıcıya özeldir; `user_id` verilmezse oturum sahibiyle sınırlanır
      // (başka kullanıcıların tercihlerinin listelenmesini engeller).
      const conditions: string[] = ['p.tenant_id = app.current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      conditions.push(`p.user_id = $${i}`);
      values.push(query.user_id ?? userId);
      i++;
      if (query.notification_type) {
        conditions.push(`p.notification_type = $${i}`);
        values.push(query.notification_type);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT p.* FROM notification_preferences p WHERE ${where}
           ORDER BY p.notification_type, p.channel LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(
          `SELECT COUNT(*) AS total FROM notification_preferences p WHERE ${where}`,
          values,
        ),
      ]);
      return this.page(list.rows.map(mapPreferenceRow), Number(count.rows[0].total), query);
    });
  }

  async upsertPreference(input: UpsertPreferenceInput, userId: string, tenantId?: string) {
    await this.withTenantClient(tenantId, async (client) => {
      // T-7.2: boş bırakılırsa varsayılan sessiz saatler (22:00–08:00) uygulanır;
      // mevcut satırda sessiz saat belirtilmezse önceki değer korunur.
      await client.query(
        `INSERT INTO notification_preferences
           (id, tenant_id, user_id, notification_type, channel, enabled,
            quiet_hours_start, quiet_hours_end, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5,
                 COALESCE($6::time, '22:00'::time), COALESCE($7::time, '08:00'::time), $2, $2)
         ON CONFLICT (tenant_id, user_id, notification_type, channel) DO UPDATE
           SET enabled = EXCLUDED.enabled,
               quiet_hours_start = COALESCE($6, notification_preferences.quiet_hours_start),
               quiet_hours_end = COALESCE($7, notification_preferences.quiet_hours_end),
               updated_by = EXCLUDED.updated_by,
               updated_at = now()`,
        [
          newId(),
          userId,
          input.notification_type,
          input.channel,
          input.enabled,
          input.quiet_hours_start ?? null,
          input.quiet_hours_end ?? null,
        ],
      );
    });
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        `SELECT * FROM notification_preferences
          WHERE tenant_id = app.current_tenant_id() AND user_id = $1
            AND notification_type = $2 AND channel = $3`,
        [userId, input.notification_type, input.channel],
      );
      return mapPreferenceRow(r.rows[0]);
    });
  }

  // ======================= Web Push =======================

  /** VAPID genel anahtarı — istemci abone olurken kullanır (gizli değildir). */
  getPushPublicKey(): { publicKey: string } {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? '' };
  }

  /**
   * Kullanıcının aktif web cihazlarına test bildirimi kuyruklar.
   * `insertNotification` in_app + (cihaz varsa) push teslim kaydı üretir; worker
   * `notification-push` kuyruğu push'u gönderir (SPEC §17.2).
   */
  async sendTestPush(userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const devices = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM user_devices
          WHERE user_id = $1 AND is_active = true AND platform = 'web'`,
        [userId],
      );
      const count = Number(devices.rows[0]?.count ?? 0);
      if (count === 0) {
        throw new AppError('VALIDATION_ERROR', 'Kayıtlı aktif web cihazı yok');
      }
      const notificationId = await this.insertNotification(client, {
        userId,
        notificationType: 'system.announcement',
        title: 'Test bildirimi',
        body: 'Web Push test bildirimi. Bildirimleri alıyorsanız kurulum tamam.',
        entityType: null,
        entityId: null,
        payload: { test: true },
      });
      return { queued: 1, devices: count, notificationId };
    });
  }

  // ======================= Yardımcılar =======================

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; limit: number },
  ): PageResult<T> {
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /** İşletme akışı kaydı (SPEC §16.5) — audit_logs DEĞİL. Append-only. */
  private async recordActivity(
    client: PoolClient,
    input: {
      actorUserId: string;
      activityType: string;
      entityType: string | null;
      entityId: string | null;
      summary: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await recordActivityRecord(client, input);
  }

  /** Bildirim kaydı + teslim kaydı (SPEC §17.2: ayrı olaylar, ayrı kayıtlar). */
  private async insertNotification(
    client: PoolClient,
    input: {
      id?: string;
      userId: string;
      notificationType: string;
      title: string;
      body: string | null;
      entityType: string | null;
      entityId: string | null;
      payload?: Record<string, unknown> | null;
      actorUserId?: string;
    },
  ): Promise<string> {
    return insertNotificationRecord(client, input);
  }

  /**
   * T-7.1: görev son tarihine göre varsayılan hatırlatıcılar (15 dk / 1 saat / 1 gün önce).
   * Geçmişte kalan ofsetler atlanır; sessiz saatlere saygı bayrağı işaretlenir.
   */
  private async insertDefaultTaskReminders(
    client: PoolClient,
    input: { taskId: string; userId: string; actorUserId: string; dueAt: string },
  ): Promise<void> {
    const dueMs = Date.parse(input.dueAt);
    if (Number.isNaN(dueMs)) return;
    const now = Date.now();
    const targets = DEFAULT_REMINDER_OFFSETS_MS.map((offset) => ({
      offset,
      remindAt: dueMs - offset,
    })).filter((t) => t.remindAt > now);
    if (targets.length === 0) return;

    for (const target of targets) {
      await client.query(
        `INSERT INTO reminders
           (id, tenant_id, user_id, task_id, remind_at, channel, status,
            quiet_hours_respected, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, 'in_app', 'pending', true, $5, $5)`,
        [
          newId(),
          input.userId,
          input.taskId,
          new Date(target.remindAt).toISOString(),
          input.actorUserId,
        ],
      );
    }
    await this.recordActivity(client, {
      actorUserId: input.actorUserId,
      activityType: 'reminder.created',
      entityType: 'task',
      entityId: input.taskId,
      summary: `Varsayılan hatırlatıcılar kuruldu (${targets.length})`,
      metadata: { offsets_ms: targets.map((t) => t.offset) },
    });
  }
}

// ======================= Row Mapper'lar =======================

function mapTaskRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to,
    dueAt: toIso(row.due_at),
    completedAt: toIso(row.completed_at),
    source: row.source,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    parentTaskId: row.parent_task_id,
    rrule: row.rrule,
    tags: row.tags ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapReminderRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    eventId: row.event_id,
    remindAt: toIso(row.remind_at),
    channel: row.channel,
    status: row.status,
    snoozedUntil: toIso(row.snoozed_until),
    quietHoursRespected: row.quiet_hours_respected,
    createdAt: toIso(row.created_at),
  };
}

function mapCalendarRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    calendarType: row.calendar_type,
    ownerUserId: row.owner_user_id,
    color: row.color,
    visibility: row.visibility,
    isDefault: row.is_default,
    timezone: row.timezone,
    createdAt: toIso(row.created_at),
  };
}

function mapCalendarEventRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    ownerUserId: row.owner_user_id,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    allDay: row.all_day,
    localStartDate: toDateString(row.local_start_date),
    localEndDate: toDateString(row.local_end_date),
    timezone: row.timezone,
    rrule: row.rrule,
    location: row.location,
    visibility: row.visibility,
    status: row.status,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: toIso(row.created_at),
  };
}

function mapAppointmentRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    contactId: row.contact_id,
    ownerUserId: row.owner_user_id,
    calendarEventId: row.calendar_event_id,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    status: row.status,
    location: row.location,
    notes: row.notes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapNoteRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    pinned: row.pinned,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapActivityRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    activityType: row.activity_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: toIso(row.created_at),
  };
}

function mapNotificationRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    notificationType: row.notification_type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    status: row.status,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

function mapDeviceRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    deviceToken: row.device_token,
    platform: row.platform,
    deviceName: row.device_name,
    isActive: row.is_active,
    lastActiveAt: toIso(row.last_active_at),
    createdAt: toIso(row.created_at),
  };
}

function mapPreferenceRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    notificationType: row.notification_type,
    channel: row.channel,
    enabled: row.enabled,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
  };
}
