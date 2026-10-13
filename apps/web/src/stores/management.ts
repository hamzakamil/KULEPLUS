import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AxiosError } from 'axios';
import { api } from '@/lib/api';

/**
 * Yönetim Paketi store'u — ROADMAP Faz 7 (SPEC §16, §17).
 * Görev, randevu ve bildirim uçlarını sarar. Sunucu kapıları (`requireEntitlement`,
 * `requirePermission`) güvenlik sınırıdır; bu store yalnızca veri taşır.
 */

function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;
}

interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: string | null;
  dueAt: string | null;
  completedAt: string | null;
  source: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  parentTaskId: string | null;
  rrule: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  title: string;
  contactId: string | null;
  ownerUserId: string | null;
  calendarEventId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: AppointmentStatus;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

export interface Notification {
  id: string;
  userId: string;
  notificationType: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
}

export type NotificationChannel = 'push' | 'in_app' | 'email' | 'whatsapp' | 'sms';

export interface NotificationPreference {
  id: string;
  userId: string;
  notificationType: string;
  channel: NotificationChannel;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface UpsertPreferenceInput {
  notification_type: string;
  channel: NotificationChannel;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface UserDevice {
  id: string;
  userId: string;
  deviceToken: string;
  platform: DevicePlatform;
  deviceName: string | null;
  isActive: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface RegisterDeviceInput {
  device_token: string;
  platform?: DevicePlatform;
  device_name?: string;
}

export type TrafficStatus = 'green' | 'amber' | 'red';

export interface DashboardIndicator {
  key: string;
  label: string;
  status: TrafficStatus;
  amount?: number;
  count?: number;
  hint: string;
  link: string;
}

export interface DashboardSummary {
  generatedAt: string;
  overall: TrafficStatus;
  indicators: DashboardIndicator[];
}

export interface RuleParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface RuleSetting {
  key: string;
  label: string;
  link: string;
  description: string;
  enabled: boolean;
  params: Record<string, number>;
  defaults: Record<string, number>;
  paramSpec: RuleParamSpec[];
}

export interface UpdateRuleInput {
  enabled?: boolean;
  params?: Record<string, number>;
}

export type ApprovalRequestType = 'payment_over_limit' | 'invoice_cancellation' | 'journal_entry';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRequest {
  id: string;
  requestType: ApprovalRequestType;
  status: ApprovalStatus;
  title: string;
  summary: string | null;
  amount: number | null;
  currency: string | null;
  requestedBy: string | null;
  assignedTo: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  payload: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApprovalInput {
  request_type: ApprovalRequestType;
  title: string;
  summary?: string | null;
  amount?: number | null;
  currency?: string | null;
  assigned_to?: string | null;
  related_entity_type?: 'invoice' | 'expense' | 'journal_entry' | 'cash_bank_movement' | null;
  related_entity_id?: string | null;
  payload?: Record<string, unknown>;
  due_at?: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string | null;
  due_at?: string | null;
  source?: string;
  related_entity_type?:
    'invoice' | 'expense' | 'contact' | 'product' | 'task' | 'appointment' | null;
  related_entity_id?: string | null;
}

export interface CreateAppointmentInput {
  title: string;
  contact_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  notes?: string | null;
}

export const useManagementStore = defineStore('management', () => {
  const tasks = ref<Task[]>([]);
  const appointments = ref<Appointment[]>([]);
  const notifications = ref<Notification[]>([]);
  const dashboard = ref<DashboardSummary | null>(null);
  const dashboardLoading = ref(false);
  const rules = ref<RuleSetting[]>([]);
  const rulesLoading = ref(false);
  const approvals = ref<ApprovalRequest[]>([]);
  const approvalPendingCount = ref(0);
  const preferences = ref<NotificationPreference[]>([]);
  const preferencesLoading = ref(false);
  const devices = ref<UserDevice[]>([]);

  const taskPagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const appointmentPagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const notificationPagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });
  const approvalPagination = ref({ page: 1, limit: 20, total: 0, pages: 0 });

  const loading = ref(false);
  const error = ref<string | null>(null);

  const taskFilters = ref({
    page: 1,
    limit: 20,
    q: undefined as string | undefined,
    status: undefined as TaskStatus | undefined,
    priority: undefined as TaskPriority | undefined,
    sortBy: 'createdAt' as 'due_at' | 'priority' | 'createdAt' | 'title',
    sortOrder: 'desc' as 'asc' | 'desc',
  });

  const appointmentFilters = ref({
    page: 1,
    limit: 20,
    status: undefined as AppointmentStatus | undefined,
  });

  const notificationFilters = ref({
    page: 1,
    limit: 20,
    unread_only: undefined as boolean | undefined,
  });

  const approvalFilters = ref({
    page: 1,
    limit: 20,
    status: undefined as ApprovalStatus | undefined,
    request_type: undefined as ApprovalRequestType | undefined,
  });

  function buildParams(filters: Record<string, unknown>): string {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.append(key, String(value));
    });
    return params.toString();
  }

  // ======================= Görev =======================

  async function fetchTasks(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get(`/v1/management/tasks?${buildParams(taskFilters.value)}`);
      const data = res.data as PageResult<Task>;
      tasks.value = data.items;
      taskPagination.value = {
        page: data.page,
        limit: data.limit,
        total: data.total,
        pages: data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Görevler yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function createTask(input: CreateTaskInput): Promise<Task> {
    error.value = null;
    try {
      const res = await api.post('/v1/management/tasks', input);
      const created = res.data as Task;
      tasks.value.unshift(created);
      return created;
    } catch (err) {
      error.value = errorMessage(err, 'Görev oluşturulamadı');
      throw err;
    }
  }

  async function completeTask(id: string, note?: string): Promise<void> {
    error.value = null;
    try {
      const res = await api.post(`/v1/management/tasks/${id}/complete`, note ? { note } : {});
      const updated = res.data as Task;
      const index = tasks.value.findIndex((t) => t.id === id);
      if (index !== -1) tasks.value[index] = updated;
    } catch (err) {
      error.value = errorMessage(err, 'Görev tamamlanamadı');
      throw err;
    }
  }

  async function deleteTask(id: string): Promise<void> {
    error.value = null;
    try {
      await api.delete(`/v1/management/tasks/${id}`);
      tasks.value = tasks.value.filter((t) => t.id !== id);
    } catch (err) {
      error.value = errorMessage(err, 'Görev silinemedi');
      throw err;
    }
  }

  // ======================= Randevu =======================

  async function fetchAppointments(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get(
        `/v1/management/appointments?${buildParams(appointmentFilters.value)}`,
      );
      const data = res.data as PageResult<Appointment>;
      appointments.value = data.items;
      appointmentPagination.value = {
        page: data.page,
        limit: data.limit,
        total: data.total,
        pages: data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Randevular yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
    error.value = null;
    try {
      const res = await api.post('/v1/management/appointments', input);
      const created = res.data as Appointment;
      appointments.value.unshift(created);
      return created;
    } catch (err) {
      error.value = errorMessage(err, 'Randevu oluşturulamadı');
      throw err;
    }
  }

  async function setAppointmentStatus(
    id: string,
    status: AppointmentStatus,
    note?: string,
  ): Promise<void> {
    error.value = null;
    try {
      const res = await api.post(`/v1/management/appointments/${id}/status`, { status, note });
      const updated = res.data as Appointment;
      const index = appointments.value.findIndex((a) => a.id === id);
      if (index !== -1) appointments.value[index] = updated;
    } catch (err) {
      error.value = errorMessage(err, 'Randevu durumu güncellenemedi');
      throw err;
    }
  }

  // ======================= Bildirim =======================

  async function fetchNotifications(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get(
        `/v1/management/notifications?${buildParams(notificationFilters.value)}`,
      );
      const data = res.data as PageResult<Notification>;
      notifications.value = data.items;
      notificationPagination.value = {
        page: data.page,
        limit: data.limit,
        total: data.total,
        pages: data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Bildirimler yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function markNotificationRead(id: string): Promise<void> {
    error.value = null;
    try {
      const res = await api.post(`/v1/management/notifications/${id}/read`, {});
      const updated = res.data as Notification;
      const index = notifications.value.findIndex((n) => n.id === id);
      if (index !== -1) notifications.value[index] = updated;
    } catch (err) {
      error.value = errorMessage(err, 'Bildirim okundu olarak işaretlenemedi');
      throw err;
    }
  }

  // ======================= Bildirim Tercihi =======================

  async function fetchPreferences(): Promise<void> {
    preferencesLoading.value = true;
    error.value = null;
    try {
      const res = await api.get('/v1/management/preferences?limit=100');
      preferences.value = (res.data as PageResult<NotificationPreference>).items;
    } catch (err) {
      error.value = errorMessage(err, 'Bildirim tercihleri yüklenemedi');
    } finally {
      preferencesLoading.value = false;
    }
  }

  async function savePreference(input: UpsertPreferenceInput): Promise<NotificationPreference> {
    error.value = null;
    try {
      const res = await api.put('/v1/management/preferences', input);
      const saved = res.data as NotificationPreference;
      const index = preferences.value.findIndex(
        (p) => p.notificationType === saved.notificationType && p.channel === saved.channel,
      );
      if (index !== -1) preferences.value[index] = saved;
      else preferences.value.push(saved);
      return saved;
    } catch (err) {
      error.value = errorMessage(err, 'Bildirim tercihi kaydedilemedi');
      throw err;
    }
  }

  // ======================= Web Push (cihaz kaydı) =======================

  async function fetchDevices(): Promise<void> {
    error.value = null;
    try {
      const res = await api.get('/v1/management/devices?limit=100');
      devices.value = (res.data as PageResult<UserDevice>).items;
    } catch (err) {
      error.value = errorMessage(err, 'Cihazlar yüklenemedi');
    }
  }

  async function registerDevice(input: RegisterDeviceInput): Promise<UserDevice> {
    error.value = null;
    try {
      const res = await api.post('/v1/management/devices', input);
      const saved = res.data as UserDevice;
      const index = devices.value.findIndex((d) => d.deviceToken === saved.deviceToken);
      if (index !== -1) devices.value[index] = saved;
      else devices.value.push(saved);
      return saved;
    } catch (err) {
      error.value = errorMessage(err, 'Cihaz kaydedilemedi');
      throw err;
    }
  }

  async function deleteDevice(id: string): Promise<void> {
    error.value = null;
    try {
      await api.delete(`/v1/management/devices/${id}`);
      devices.value = devices.value.filter((d) => d.id !== id);
    } catch (err) {
      error.value = errorMessage(err, 'Cihaz kaldırılamadı');
      throw err;
    }
  }

  async function sendTestPush(): Promise<{ queued: number; devices: number }> {
    error.value = null;
    try {
      const res = await api.post('/v1/management/push/test', {});
      return res.data as { queued: number; devices: number };
    } catch (err) {
      error.value = errorMessage(err, 'Test bildirimi gönderilemedi');
      throw err;
    }
  }

  // ======================= Patron Paneli (trafik ışığı) =======================

  /**
   * Kural bazlı trafik ışığı özeti (SPEC §26). Erişim yoksa (403) sessizce
   * boş bırakılır — bölüm görünmez; güvenlik sınırı zaten sunucudadır.
   */
  async function fetchDashboard(): Promise<void> {
    dashboardLoading.value = true;
    try {
      const res = await api.get('/v1/management/dashboard');
      dashboard.value = res.data as DashboardSummary;
    } catch {
      dashboard.value = null;
    } finally {
      dashboardLoading.value = false;
    }
  }

  // ======================= Kural motoru ayarları (T-7.5) =======================

  async function fetchRules(): Promise<void> {
    rulesLoading.value = true;
    error.value = null;
    try {
      const res = await api.get('/v1/management/rules');
      rules.value = (res.data as { items: RuleSetting[] }).items;
    } catch (err) {
      error.value = errorMessage(err, 'Kural ayarları yüklenemedi');
    } finally {
      rulesLoading.value = false;
    }
  }

  async function updateRule(key: string, input: UpdateRuleInput): Promise<RuleSetting> {
    error.value = null;
    try {
      const res = await api.put(`/v1/management/rules/${key}`, input);
      const updated = res.data as RuleSetting;
      const index = rules.value.findIndex((r) => r.key === key);
      if (index !== -1) rules.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = errorMessage(err, 'Kural güncellenemedi');
      throw err;
    }
  }

  // ======================= Onay Kutusu =======================

  async function fetchApprovals(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get(`/v1/management/approvals?${buildParams(approvalFilters.value)}`);
      const data = res.data as PageResult<ApprovalRequest>;
      approvals.value = data.items;
      approvalPagination.value = {
        page: data.page,
        limit: data.limit,
        total: data.total,
        pages: data.totalPages,
      };
    } catch (err) {
      error.value = errorMessage(err, 'Onay talepleri yüklenemedi');
    } finally {
      loading.value = false;
    }
  }

  async function fetchApprovalPendingCount(): Promise<void> {
    try {
      const res = await api.get('/v1/management/approvals/pending-count');
      approvalPendingCount.value = (res.data as { pending: number }).pending;
    } catch {
      approvalPendingCount.value = 0;
    }
  }

  async function createApproval(input: CreateApprovalInput): Promise<ApprovalRequest> {
    error.value = null;
    try {
      const res = await api.post('/v1/management/approvals', input);
      const created = res.data as ApprovalRequest;
      approvals.value.unshift(created);
      return created;
    } catch (err) {
      error.value = errorMessage(err, 'Onay talebi oluşturulamadı');
      throw err;
    }
  }

  async function decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ): Promise<void> {
    error.value = null;
    try {
      const res = await api.post(`/v1/management/approvals/${id}/decide`, { decision, note });
      const updated = res.data as ApprovalRequest;
      const index = approvals.value.findIndex((a) => a.id === id);
      if (index !== -1) approvals.value[index] = updated;
      void fetchApprovalPendingCount();
    } catch (err) {
      error.value = errorMessage(err, 'Onay kararı kaydedilemedi');
      throw err;
    }
  }

  async function cancelApproval(id: string): Promise<void> {
    error.value = null;
    try {
      const res = await api.post(`/v1/management/approvals/${id}/cancel`, {});
      const updated = res.data as ApprovalRequest;
      const index = approvals.value.findIndex((a) => a.id === id);
      if (index !== -1) approvals.value[index] = updated;
      void fetchApprovalPendingCount();
    } catch (err) {
      error.value = errorMessage(err, 'Onay talebi iptal edilemedi');
      throw err;
    }
  }

  return {
    tasks,
    appointments,
    notifications,
    dashboard,
    dashboardLoading,
    rules,
    rulesLoading,
    approvals,
    approvalPendingCount,
    preferences,
    preferencesLoading,
    devices,
    taskPagination,
    appointmentPagination,
    notificationPagination,
    approvalPagination,
    loading,
    error,
    taskFilters,
    appointmentFilters,
    notificationFilters,
    approvalFilters,
    fetchTasks,
    createTask,
    completeTask,
    deleteTask,
    fetchAppointments,
    createAppointment,
    setAppointmentStatus,
    fetchNotifications,
    markNotificationRead,
    fetchPreferences,
    savePreference,
    fetchDevices,
    registerDevice,
    deleteDevice,
    sendTestPush,
    fetchDashboard,
    fetchRules,
    updateRule,
    fetchApprovals,
    fetchApprovalPendingCount,
    createApproval,
    decideApproval,
    cancelApproval,
  };
});
