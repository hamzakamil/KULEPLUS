import { z } from 'zod';

/**
 * Yönetim Paketi şemaları — ROADMAP Faz 7 (SPEC §16, §17).
 * Görev, hatırlatıcı, takvim, randevu, not, aktivite ve bildirim girdileri.
 */

// ======================= Ortak sabitler =======================
export const TASK_STATUSES = ['todo', 'in_progress', 'waiting', 'completed', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const REMINDER_CHANNELS = ['push', 'in_app', 'email', 'whatsapp', 'sms'] as const;
export const REMINDER_STATUSES = ['pending', 'sent', 'failed', 'cancelled'] as const;
export const CALENDAR_TYPES = ['personal', 'company', 'personnel'] as const;
export const VISIBILITIES = ['private', 'company', 'shared'] as const;
export const CALENDAR_EVENT_STATUSES = ['scheduled', 'cancelled'] as const;
export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'read'] as const;
export const DELIVERY_STATUSES = ['pending', 'sent', 'delivered', 'failed', 'read'] as const;

/** Merkezi bildirim türü kataloğu — SPEC §17.1 (serbest string YOK). */
export const NOTIFICATION_TYPES = [
  'task.assigned',
  'task.due_soon',
  'task.overdue',
  'appointment.upcoming',
  'appointment.created',
  'whatsapp.message_received',
  'invoice.due_soon',
  'invoice.overdue',
  'payment.received',
  'cash.low_balance',
  'stock.critical',
  'user.mentioned',
  'subscription.payment_failed',
  'subscription.expiring',
  'system.security_alert',
  'system.announcement',
] as const;

/** İlgili varlık türü allowlist — SPEC §21.3 (task/appointment dahil). */
export const RELATED_ENTITY_TYPES = [
  'invoice',
  'expense',
  'contact',
  'product',
  'task',
  'appointment',
] as const;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD formatı gerekli');
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM formatı gerekli');
/** Anlık olay: TIMESTAMPTZ (SPEC §16.4). ISO 8601 tarih/saat dizgesi kabul edilir. */
const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Geçerli tarih/saat gerekli');

const pagination = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
};

// ======================= Görev =======================
export const createTaskSchema = z.object({
  title: z.string().min(1).max(255, 'Başlık zorunlu'),
  description: z.string().max(5000).optional(),
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  assigned_to: z.string().uuid().nullish(),
  due_at: isoDateTime.nullish(),
  source: z.string().max(50).default('manual'),
  related_entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
  related_entity_id: z.string().uuid().nullish(),
  parent_task_id: z.string().uuid().nullish(),
  rrule: z.string().max(500).nullish(),
  tags: z.array(z.string().max(50)).max(50).default([]),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(5000).nullish(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    assigned_to: z.string().uuid().nullish(),
    due_at: isoDateTime.nullish(),
    related_entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
    related_entity_id: z.string().uuid().nullish(),
    rrule: z.string().max(500).nullish(),
    tags: z.array(z.string().max(50)).max(50),
  })
  .partial();

export const assignTaskSchema = z.object({
  assigned_to: z.string().uuid('Atanacak kullanıcı zorunlu'),
});

export const completeTaskSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const taskListQuerySchema = z.object({
  ...pagination,
  q: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigned_to: z.string().uuid().optional(),
  due_from: isoDateTime.optional(),
  due_to: isoDateTime.optional(),
  parent_task_id: z.string().uuid().optional(),
  sortBy: z.enum(['due_at', 'priority', 'createdAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ======================= Hatırlatıcı =======================
export const createReminderSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    task_id: z.string().uuid().nullish(),
    event_id: z.string().uuid().nullish(),
    remind_at: isoDateTime,
    channel: z.enum(REMINDER_CHANNELS).default('in_app'),
  })
  .refine((v) => v.task_id || v.event_id, {
    message: 'Hatırlatıcı için görev veya etkinlik gerekli',
    path: ['task_id'],
  });

export const snoozeReminderSchema = z.object({
  snoozed_until: isoDateTime,
});

export const reminderListQuerySchema = z.object({
  ...pagination,
  user_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional(),
  status: z.enum(REMINDER_STATUSES).optional(),
  channel: z.enum(REMINDER_CHANNELS).optional(),
});

// ======================= Takvim =======================
export const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  calendar_type: z.enum(CALENDAR_TYPES).default('personal'),
  owner_user_id: z.string().uuid().nullish(),
  color: z.string().max(20).nullish(),
  visibility: z.enum(VISIBILITIES).default('company'),
  is_default: z.boolean().default(false),
  timezone: z.string().max(64).default('Europe/Istanbul'),
});

export const updateCalendarSchema = createCalendarSchema.partial();

export const calendarListQuerySchema = z.object({
  ...pagination,
  calendar_type: z.enum(CALENDAR_TYPES).optional(),
  owner_user_id: z.string().uuid().optional(),
});

export const createCalendarEventSchema = z
  .object({
    calendar_id: z.string().uuid('Takvim zorunlu'),
    title: z.string().min(1).max(255),
    description: z.string().max(5000).nullish(),
    event_type: z.string().max(50).default('event'),
    owner_user_id: z.string().uuid().nullish(),
    starts_at: isoDateTime,
    ends_at: isoDateTime.nullish(),
    all_day: z.boolean().default(false),
    local_start_date: dateString.nullish(),
    local_end_date: dateString.nullish(),
    timezone: z.string().max(64).default('Europe/Istanbul'),
    rrule: z.string().max(500).nullish(),
    location: z.string().max(255).nullish(),
    visibility: z.enum(VISIBILITIES).default('company'),
    related_entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
    related_entity_id: z.string().uuid().nullish(),
  })
  .refine((v) => !v.all_day || v.local_start_date, {
    message: 'Tüm gün etkinliği için yerel başlangıç tarihi gerekli',
    path: ['local_start_date'],
  });

export const updateCalendarEventSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(5000).nullish(),
    event_type: z.string().max(50),
    owner_user_id: z.string().uuid().nullish(),
    starts_at: isoDateTime,
    ends_at: isoDateTime.nullish(),
    all_day: z.boolean(),
    local_start_date: dateString.nullish(),
    local_end_date: dateString.nullish(),
    timezone: z.string().max(64),
    rrule: z.string().max(500).nullish(),
    location: z.string().max(255).nullish(),
    visibility: z.enum(VISIBILITIES),
    status: z.enum(CALENDAR_EVENT_STATUSES),
    related_entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
    related_entity_id: z.string().uuid().nullish(),
  })
  .partial();

export const calendarEventListQuerySchema = z.object({
  ...pagination,
  calendar_id: z.string().uuid().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  status: z.enum(CALENDAR_EVENT_STATUSES).optional(),
});

// ======================= Randevu =======================
export const createAppointmentSchema = z
  .object({
    title: z.string().min(1).max(255),
    contact_id: z.string().uuid().nullish(),
    owner_user_id: z.string().uuid().nullish(),
    starts_at: isoDateTime,
    ends_at: isoDateTime.nullish(),
    location: z.string().max(255).nullish(),
    notes: z.string().max(5000).nullish(),
    create_calendar_event: z.boolean().default(false),
  })
  .refine((v) => !v.ends_at || Date.parse(v.ends_at) >= Date.parse(v.starts_at), {
    message: 'Bitiş, başlangıçtan önce olamaz',
    path: ['ends_at'],
  });

export const updateAppointmentSchema = z
  .object({
    title: z.string().min(1).max(255),
    contact_id: z.string().uuid().nullish(),
    owner_user_id: z.string().uuid().nullish(),
    starts_at: isoDateTime,
    ends_at: isoDateTime.nullish(),
    location: z.string().max(255).nullish(),
    notes: z.string().max(5000).nullish(),
  })
  .partial();

export const appointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  note: z.string().max(1000).optional(),
});

export const appointmentListQuerySchema = z.object({
  ...pagination,
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  contact_id: z.string().uuid().optional(),
  owner_user_id: z.string().uuid().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

// ======================= Not =======================
export const createNoteSchema = z.object({
  title: z.string().max(255).nullish(),
  body: z.string().max(20000).optional(),
  related_entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
  related_entity_id: z.string().uuid().nullish(),
  pinned: z.boolean().default(false),
});

export const updateNoteSchema = createNoteSchema.partial();

export const noteListQuerySchema = z.object({
  ...pagination,
  q: z.string().optional(),
  related_entity_type: z.enum(RELATED_ENTITY_TYPES).optional(),
  related_entity_id: z.string().uuid().optional(),
  pinned: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

// ======================= Aktivite =======================
export const activityListQuerySchema = z.object({
  ...pagination,
  entity_type: z.enum(RELATED_ENTITY_TYPES).optional(),
  entity_id: z.string().uuid().optional(),
  activity_type: z.string().optional(),
});

// ======================= Bildirim =======================
export const createNotificationSchema = z.object({
  user_id: z.string().uuid('Alıcı kullanıcı zorunlu'),
  notification_type: z.enum(NOTIFICATION_TYPES),
  title: z.string().min(1).max(255),
  body: z.string().max(5000).optional(),
  entity_type: z.enum(RELATED_ENTITY_TYPES).nullish(),
  entity_id: z.string().uuid().nullish(),
  payload: z.record(z.unknown()).nullish(),
});

export const notificationListQuerySchema = z.object({
  ...pagination,
  user_id: z.string().uuid().optional(),
  notification_type: z.enum(NOTIFICATION_TYPES).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  unread_only: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

// ======================= Cihaz =======================
export const registerDeviceSchema = z.object({
  device_token: z.string().min(1).max(500, 'Cihaz token zorunlu'),
  platform: z.enum(DEVICE_PLATFORMS).default('web'),
  device_name: z.string().max(255).optional(),
});

export const deviceListQuerySchema = z.object({
  ...pagination,
  user_id: z.string().uuid().optional(),
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

// ======================= Bildirim Tercihi =======================
export const upsertPreferenceSchema = z.object({
  notification_type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(REMINDER_CHANNELS),
  enabled: z.boolean().default(true),
  quiet_hours_start: timeOfDay.nullish(),
  quiet_hours_end: timeOfDay.nullish(),
});

export const preferenceListQuerySchema = z.object({
  ...pagination,
  user_id: z.string().uuid().optional(),
  notification_type: z.enum(NOTIFICATION_TYPES).optional(),
});

// ======================= Onay Kutusu =======================
export const APPROVAL_REQUEST_TYPES = [
  'payment_over_limit',
  'invoice_cancellation',
  'journal_entry',
] as const;
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const APPROVAL_ENTITY_TYPES = [
  'invoice',
  'expense',
  'journal_entry',
  'cash_bank_movement',
] as const;

export const createApprovalRequestSchema = z.object({
  request_type: z.enum(APPROVAL_REQUEST_TYPES),
  title: z.string().min(1).max(255, 'Başlık zorunlu'),
  summary: z.string().max(5000).nullish(),
  amount: z.number().finite().nonnegative().nullish(),
  currency: z.string().length(3).nullish(),
  assigned_to: z.string().uuid().nullish(),
  related_entity_type: z.enum(APPROVAL_ENTITY_TYPES).nullish(),
  related_entity_id: z.string().uuid().nullish(),
  payload: z.record(z.unknown()).default({}),
  due_at: isoDateTime.nullish(),
});

export const decideApprovalRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(2000).nullish(),
});

export const approvalListQuerySchema = z.object({
  ...pagination,
  status: z.enum(APPROVAL_STATUSES).optional(),
  request_type: z.enum(APPROVAL_REQUEST_TYPES).optional(),
  assigned_to: z.string().uuid().optional(),
  related_entity_type: z.enum(APPROVAL_ENTITY_TYPES).optional(),
  related_entity_id: z.string().uuid().optional(),
  q: z.string().optional(),
  sortBy: z.enum(['createdAt', 'amount', 'due_at', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ======================= Tipler =======================
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;
export type ReminderListQuery = z.infer<typeof reminderListQuerySchema>;
export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
export type CalendarListQuery = z.infer<typeof calendarListQuerySchema>;
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;
export type CalendarEventListQuery = z.infer<typeof calendarEventListQuerySchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;
export type UpsertPreferenceInput = z.infer<typeof upsertPreferenceSchema>;
export type PreferenceListQuery = z.infer<typeof preferenceListQuerySchema>;
export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;
export type DecideApprovalRequestInput = z.infer<typeof decideApprovalRequestSchema>;
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
