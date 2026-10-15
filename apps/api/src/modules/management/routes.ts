import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import {
  assignTaskSchema,
  appointmentListQuerySchema,
  appointmentStatusSchema,
  approvalListQuerySchema,
  calendarEventListQuerySchema,
  calendarListQuerySchema,
  completeTaskSchema,
  createAppointmentSchema,
  createApprovalRequestSchema,
  createCalendarEventSchema,
  createCalendarSchema,
  createNoteSchema,
  createNotificationSchema,
  createReminderSchema,
  createTaskSchema,
  decideApprovalRequestSchema,
  deviceListQuerySchema,
  noteListQuerySchema,
  notificationListQuerySchema,
  preferenceListQuerySchema,
  registerDeviceSchema,
  reminderListQuerySchema,
  snoozeReminderSchema,
  taskListQuerySchema,
  updateAppointmentSchema,
  updateCalendarEventSchema,
  updateCalendarSchema,
  updateNoteSchema,
  updateTaskSchema,
  upsertPreferenceSchema,
  activityListQuerySchema,
} from './schemas';
import type {
  AppointmentListQuery,
  ApprovalListQuery,
  CalendarEventListQuery,
  CalendarListQuery,
  CreateApprovalRequestInput,
  DecideApprovalRequestInput,
  DeviceListQuery,
  NoteListQuery,
  NotificationListQuery,
  PreferenceListQuery,
  ReminderListQuery,
  TaskListQuery,
  ActivityListQuery,
} from './schemas';
import { ManagementService } from './service';
import { ManagementDashboardService } from './dashboard.service';
import { ManagementCockpitService } from './cockpit.service';
import { ApprovalService } from './approval.service';
import { loadPermissionGrants } from '../../middleware/permission-grants';
import { ruleUpsertSchema, type RuleUpsertInput } from './rules';

const router = Router();

// Tüm yönetim uçları: kimlik + tenant + entitlement (GOVERNANCE §2: 'management', Faz 7).
router.use(authenticate, tenantContext, requireEntitlement('management'));

const service = new ManagementService();
const dashboardService = new ManagementDashboardService();
const cockpitService = new ManagementCockpitService();
const approvalService = new ApprovalService();

const canTaskRead = requirePermission('management.task.read');
const canTaskCreate = requirePermission('management.task.create');
const canTaskUpdate = requirePermission('management.task.update');
const canTaskDelete = requirePermission('management.task.delete');
const canTaskAssign = requirePermission('management.task.assign');
const canTaskComplete = requirePermission('management.task.complete');
const canCalendarRead = requirePermission('management.calendar.read');
const canCalendarManage = requirePermission('management.calendar.manage');
const canAppointmentRead = requirePermission('management.appointment.read');
const canAppointmentCreate = requirePermission('management.appointment.create');
const canAppointmentUpdate = requirePermission('management.appointment.update');
const canAppointmentManage = requirePermission('management.appointment.manage');
const canNoteRead = requirePermission('management.note.read');
const canNoteCreate = requirePermission('management.note.create');
const canNoteUpdate = requirePermission('management.note.update');
const canNoteDelete = requirePermission('management.note.delete');
const canActivityRead = requirePermission('management.activity.read');
const canNotificationRead = requirePermission('management.notification.read');
const canNotificationSend = requirePermission('management.notification.send');
const canPreferenceManage = requirePermission('management.preference.manage');
const canDeviceManage = requirePermission('management.device.manage');
const canDashboardRead = requirePermission('management.dashboard.read');
const canRuleRead = requirePermission('management.rule.read');
const canRuleManage = requirePermission('management.rule.manage');
const canApprovalRead = requirePermission('management.approval.read');
const canApprovalCreate = requirePermission('management.approval.create');
const canApprovalDecide = requirePermission('management.approval.decide');

/** Kısa yol: try/catch + next(error) sarmalayıcısı (cheque deseni). */
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
function handle(fn: Handler) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
}

const tenant = (req: AuthenticatedRequest) => (req as TenantRequest).tenantId;
const userId = (req: AuthenticatedRequest) => (req as TenantRequest).user!.sub;

// ======================= Patron Paneli (trafik ışığı) =======================

router.get(
  '/dashboard',
  canDashboardRead,
  handle(async (req, res) => {
    res.json(await dashboardService.summary(tenant(req)));
  }),
);

// ======================= Yönetici Kokpiti (canlı yüklemesi) =======================

/**
 * Kokpitin tek veri ucu: KPI şeridi, hesap bakiyeleri, cari, nakit akışı,
 * vadeler, çek/senet, stok, onay kuyruğu ve kural motoru uyarıları.
 *
 * `approvalsEditable` alanı için karar yetkisi ayrıca sorgulanır — iframe'deki
 * "Onayla/Reddet" düğmeleri yalnızca yetkisi olan kullanıcıda çalışır; asıl
 * zorlama `POST /approvals/:id/decide` ucunda yine backend'dedir.
 */
router.get(
  '/cockpit',
  canDashboardRead,
  handle(async (req, res) => {
    const grants = await loadPermissionGrants(tenant(req), userId(req));
    res.json(
      await cockpitService.payload({
        tenantId: tenant(req),
        canDecideApprovals: grants.isOwner || grants.codes.has('management.approval.decide'),
      }),
    );
  }),
);


// Kural motoru ayarları (T-7.5: hazır kurallar kod + parametreler DB).

router.get(
  '/rules',
  canRuleRead,
  handle(async (req, res) => {
    res.json({ items: await dashboardService.listRules(tenant(req)) });
  }),
);

router.put(
  '/rules/:key',
  canRuleManage,
  validate(ruleUpsertSchema, 'body'),
  handle(async (req, res) => {
    res.json(
      await dashboardService.upsertRule(
        req.params.key,
        req.body as RuleUpsertInput,
        userId(req),
        tenant(req),
      ),
    );
  }),
);

// ======================= Onay Kutusu (Faz 7) =======================

router.get(
  '/approvals',
  canApprovalRead,
  validate(approvalListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(
      await approvalService.listApprovalRequests(
        req.query as unknown as ApprovalListQuery,
        tenant(req),
      ),
    );
  }),
);

router.get(
  '/approvals/pending-count',
  canApprovalRead,
  handle(async (req, res) => {
    res.json({ pending: await approvalService.countPending(tenant(req)) });
  }),
);

router.get(
  '/approvals/:id',
  canApprovalRead,
  handle(async (req, res) => {
    const item = await approvalService.getApprovalRequest(req.params.id, tenant(req));
    if (!item) throw new AppError('NOT_FOUND', 'Onay talebi bulunamadı');
    res.json(item);
  }),
);

router.post(
  '/approvals',
  canApprovalCreate,
  validate(createApprovalRequestSchema, 'body'),
  handle(async (req, res) => {
    res
      .status(201)
      .json(
        await approvalService.createApprovalRequest(
          req.body as CreateApprovalRequestInput,
          userId(req),
          tenant(req),
        ),
      );
  }),
);

router.post(
  '/approvals/:id/decide',
  canApprovalDecide,
  validate(decideApprovalRequestSchema, 'body'),
  handle(async (req, res) => {
    res.json(
      await approvalService.decideApprovalRequest(
        req.params.id,
        req.body as DecideApprovalRequestInput,
        userId(req),
        tenant(req),
      ),
    );
  }),
);

router.post(
  '/approvals/:id/cancel',
  canApprovalCreate,
  handle(async (req, res) => {
    res.json(await approvalService.cancelApprovalRequest(req.params.id, userId(req), tenant(req)));
  }),
);

// ======================= Görev =======================

router.get(
  '/tasks',
  canTaskRead,
  validate(taskListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listTasks(req.query as unknown as TaskListQuery, tenant(req)));
  }),
);

router.get(
  '/tasks/:id',
  canTaskRead,
  handle(async (req, res) => {
    const result = await service.getTask(req.params.id, tenant(req));
    if (!result) throw new AppError('NOT_FOUND', 'Görev bulunamadı');
    res.json(result);
  }),
);

router.post(
  '/tasks',
  canTaskCreate,
  validate(createTaskSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createTask(req.body, userId(req), tenant(req)));
  }),
);

router.patch(
  '/tasks/:id',
  canTaskUpdate,
  validate(updateTaskSchema),
  handle(async (req, res) => {
    res.json(await service.updateTask(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.delete(
  '/tasks/:id',
  canTaskDelete,
  handle(async (req, res) => {
    res.json(await service.deleteTask(req.params.id, userId(req), tenant(req)));
  }),
);

router.post(
  '/tasks/:id/assign',
  canTaskAssign,
  validate(assignTaskSchema),
  handle(async (req, res) => {
    res.json(await service.assignTask(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.post(
  '/tasks/:id/complete',
  canTaskComplete,
  validate(completeTaskSchema),
  handle(async (req, res) => {
    res.json(await service.completeTask(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

// ======================= Hatırlatıcı =======================

router.get(
  '/reminders',
  canTaskRead,
  validate(reminderListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listReminders(req.query as unknown as ReminderListQuery, tenant(req)));
  }),
);

router.post(
  '/reminders',
  canTaskUpdate,
  validate(createReminderSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createReminder(req.body, userId(req), tenant(req)));
  }),
);

router.post(
  '/reminders/:id/snooze',
  canTaskUpdate,
  validate(snoozeReminderSchema),
  handle(async (req, res) => {
    res.json(await service.snoozeReminder(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.post(
  '/reminders/:id/cancel',
  canTaskUpdate,
  handle(async (req, res) => {
    res.json(await service.cancelReminder(req.params.id, userId(req), tenant(req)));
  }),
);

// ======================= Takvim =======================

router.get(
  '/calendars',
  canCalendarRead,
  validate(calendarListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listCalendars(req.query as unknown as CalendarListQuery, tenant(req)));
  }),
);

router.post(
  '/calendars',
  canCalendarManage,
  validate(createCalendarSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createCalendar(req.body, userId(req), tenant(req)));
  }),
);

router.patch(
  '/calendars/:id',
  canCalendarManage,
  validate(updateCalendarSchema),
  handle(async (req, res) => {
    res.json(await service.updateCalendar(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.delete(
  '/calendars/:id',
  canCalendarManage,
  handle(async (req, res) => {
    res.json(await service.deleteCalendar(req.params.id, tenant(req)));
  }),
);

// ======================= Takvim Etkinliği =======================

router.get(
  '/calendar-events',
  canCalendarRead,
  validate(calendarEventListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(
      await service.listCalendarEvents(req.query as unknown as CalendarEventListQuery, tenant(req)),
    );
  }),
);

router.post(
  '/calendar-events',
  canCalendarManage,
  validate(createCalendarEventSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createCalendarEvent(req.body, userId(req), tenant(req)));
  }),
);

router.patch(
  '/calendar-events/:id',
  canCalendarManage,
  validate(updateCalendarEventSchema),
  handle(async (req, res) => {
    res.json(await service.updateCalendarEvent(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.delete(
  '/calendar-events/:id',
  canCalendarManage,
  handle(async (req, res) => {
    res.json(await service.deleteCalendarEvent(req.params.id, tenant(req)));
  }),
);

// ======================= Randevu =======================

router.get(
  '/appointments',
  canAppointmentRead,
  validate(appointmentListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(
      await service.listAppointments(req.query as unknown as AppointmentListQuery, tenant(req)),
    );
  }),
);

router.get(
  '/appointments/:id',
  canAppointmentRead,
  handle(async (req, res) => {
    const result = await service.getAppointment(req.params.id, tenant(req));
    if (!result) throw new AppError('NOT_FOUND', 'Randevu bulunamadı');
    res.json(result);
  }),
);

router.post(
  '/appointments',
  canAppointmentCreate,
  validate(createAppointmentSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createAppointment(req.body, userId(req), tenant(req)));
  }),
);

router.patch(
  '/appointments/:id',
  canAppointmentUpdate,
  validate(updateAppointmentSchema),
  handle(async (req, res) => {
    res.json(await service.updateAppointment(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.post(
  '/appointments/:id/status',
  canAppointmentManage,
  validate(appointmentStatusSchema),
  handle(async (req, res) => {
    res.json(await service.setAppointmentStatus(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

// ======================= Not =======================

router.get(
  '/notes',
  canNoteRead,
  validate(noteListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listNotes(req.query as unknown as NoteListQuery, tenant(req)));
  }),
);

router.get(
  '/notes/:id',
  canNoteRead,
  handle(async (req, res) => {
    const result = await service.getNote(req.params.id, tenant(req));
    if (!result) throw new AppError('NOT_FOUND', 'Not bulunamadı');
    res.json(result);
  }),
);

router.post(
  '/notes',
  canNoteCreate,
  validate(createNoteSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createNote(req.body, userId(req), tenant(req)));
  }),
);

router.patch(
  '/notes/:id',
  canNoteUpdate,
  validate(updateNoteSchema),
  handle(async (req, res) => {
    res.json(await service.updateNote(req.params.id, req.body, userId(req), tenant(req)));
  }),
);

router.delete(
  '/notes/:id',
  canNoteDelete,
  handle(async (req, res) => {
    res.json(await service.deleteNote(req.params.id, tenant(req)));
  }),
);

// ======================= Aktivite =======================

router.get(
  '/activities',
  canActivityRead,
  validate(activityListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listActivities(req.query as unknown as ActivityListQuery, tenant(req)));
  }),
);

// ======================= Bildirim =======================

router.get(
  '/notifications',
  canNotificationRead,
  validate(notificationListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(
      await service.listNotifications(req.query as unknown as NotificationListQuery, tenant(req)),
    );
  }),
);

router.get(
  '/notifications/:id',
  canNotificationRead,
  handle(async (req, res) => {
    const result = await service.getNotification(req.params.id, tenant(req));
    if (!result) throw new AppError('NOT_FOUND', 'Bildirim bulunamadı');
    res.json(result);
  }),
);

router.post(
  '/notifications',
  canNotificationSend,
  validate(createNotificationSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.createNotification(req.body, userId(req), tenant(req)));
  }),
);

router.post(
  '/notifications/:id/read',
  canNotificationRead,
  handle(async (req, res) => {
    res.json(await service.markNotificationRead(req.params.id, userId(req), tenant(req)));
  }),
);

// ======================= Cihaz =======================

router.get(
  '/devices',
  canDeviceManage,
  validate(deviceListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(await service.listDevices(req.query as unknown as DeviceListQuery, tenant(req)));
  }),
);

router.post(
  '/devices',
  canDeviceManage,
  validate(registerDeviceSchema),
  handle(async (req, res) => {
    res.status(201).json(await service.registerDevice(req.body, userId(req), tenant(req)));
  }),
);

router.delete(
  '/devices/:id',
  canDeviceManage,
  handle(async (req, res) => {
    res.json(await service.deleteDevice(req.params.id, tenant(req)));
  }),
);

// ======================= Bildirim Tercihi =======================

router.get(
  '/preferences',
  canPreferenceManage,
  validate(preferenceListQuerySchema, 'query'),
  handle(async (req, res) => {
    res.json(
      await service.listPreferences(
        req.query as unknown as PreferenceListQuery,
        userId(req),
        tenant(req),
      ),
    );
  }),
);

router.put(
  '/preferences',
  canPreferenceManage,
  validate(upsertPreferenceSchema),
  handle(async (req, res) => {
    res.json(await service.upsertPreference(req.body, userId(req), tenant(req)));
  }),
);

// ======================= Web Push =======================

router.get(
  '/push/public-key',
  canDeviceManage,
  handle(async (_req, res) => {
    res.json(service.getPushPublicKey());
  }),
);

router.post(
  '/push/test',
  canDeviceManage,
  handle(async (req, res) => {
    res.status(201).json(await service.sendTestPush(userId(req), tenant(req)));
  }),
);

export { router as managementRoutes };
