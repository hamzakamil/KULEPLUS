import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import DashboardView from '../views/DashboardView.vue';
import ContactsView from '../views/ContactsView.vue';
import StockView from '../views/StockView.vue';
import InvoicesView from '../views/InvoicesView.vue';
import QuoteListView from '../views/TradeQuotesView.vue';
import OrderListView from '../views/TradeOrdersView.vue';
import PurchaseOrderListView from '../views/PurchaseOrdersView.vue';
import DeliveryListView from '../views/DeliveriesView.vue';
import ExpenseListView from '../views/ExpenseListView.vue';
import ExpenseFormView from '../views/ExpenseFormView.vue';
import ReportView from '../views/ReportView.vue';
import LoginView from '../views/LoginView.vue';
import TwoFactorVerifyView from '../views/TwoFactorVerifyView.vue';
import AccountingView from '../views/AccountingView.vue';
import ChequeView from '../views/ChequeView.vue';
import { useAuthStore } from '@/stores/auth';
import { COCKPIT_PERMISSION } from '@/stores/auth';
import IntegrationsView from '../views/IntegrationsView.vue';
import SubscriptionView from '../views/SubscriptionView.vue';
import EInvoiceView from '../views/EInvoiceView.vue';

/**
 * Rota iskeleti — docs/product/screens.md formatına göre genişletilir:
 * | Route | Ekran | Görünüm | Rol/Permission | Faz | İlgili API |
 * Faz 1: /login, platform rotaları · Faz 2: /dashboard, /contacts, /stock, /invoices
 */
/**
 * Rota meta sözleşmesi. `permission` tanımlıysa guard, `/v1/auth/me` ile çözülen
 * izin listesinde o kodu arar; tanımsızsa yalnızca oturum yeterlidir.
 */
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    isPublic?: boolean;
    /** İzin kodu — `packages/shared/permissions.ts` kataloğundan. */
    permission?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/login', name: 'login', component: LoginView },
  // Kendi kendine kayıt (ADR-0023) — oturum açıksa guard varış yerine yönlendirir
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
  },
  { path: '/2fa/verify', name: 'two-factor-verify', component: TwoFactorVerifyView },
  // E-posta bağlantıdan gelen kamu ekranları — oturum açıksa da erişilebilir olmalı
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { isPublic: true },
  },
  {
    path: '/invite',
    name: 'invite',
    component: () => import('@/views/InviteView.vue'),
    meta: { isPublic: true },
  },
  // Kilitli modül önizleme (README §4.1) — örnek veri + CTA
  {
    path: '/locked/:module',
    name: 'locked-module',
    component: () => import('@/views/LockedModuleView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true } },
  // Yönetici Kokpiti — yalnızca `management.dashboard.read` izni olanlar (veya owner).
  // Kaynak HTML `public/`ten `src/cockpit/`e taşındı; artık doğrudan URL ile açılamaz.
  {
    path: '/yonetici-kokpiti',
    name: 'management-cockpit',
    component: () => import('@/views/ManagementCockpitView.vue'),
    meta: { requiresAuth: true, permission: COCKPIT_PERMISSION },
  },
  { path: '/contacts', name: 'contacts', component: ContactsView, meta: { requiresAuth: true } },
  {
    path: '/contacts/new',
    name: 'contact-create',
    component: () => import('@/views/CreateAccountView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/stock', name: 'stock', component: StockView, meta: { requiresAuth: true } },
  { path: '/invoices', name: 'invoices', component: InvoicesView, meta: { requiresAuth: true } },
  { path: '/quotes', name: 'quotes', component: QuoteListView, meta: { requiresAuth: true } },
  { path: '/orders', name: 'orders', component: OrderListView, meta: { requiresAuth: true } },
  {
    path: '/purchase-orders',
    name: 'purchase-orders',
    component: PurchaseOrderListView,
    meta: { requiresAuth: true },
  },
  {
    path: '/deliveries',
    name: 'deliveries',
    component: DeliveryListView,
    meta: { requiresAuth: true },
  },
  // Kasa ve Banka ayrı ekranlar olarak yönetilir (kasa ayrı, banka ayrı).
  {
    path: '/cash',
    name: 'cash',
    component: () => import('@/views/CashBankView.vue'),
    props: { ledger: 'cash' },
    meta: { requiresAuth: true },
  },
  {
    path: '/bank',
    name: 'bank',
    component: () => import('@/views/CashBankView.vue'),
    props: { ledger: 'bank' },
    meta: { requiresAuth: true },
  },
  // Banka alt modülleri — Banka Kredileri ve Kredi Kartları ayrı çalışan modüllerdir.
  {
    path: '/bank/loans',
    name: 'bank-loans',
    component: () => import('@/views/BankLoansView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/bank/cards',
    name: 'bank-cards',
    component: () => import('@/views/CreditCardsView.vue'),
    meta: { requiresAuth: true },
  },
  // Eski birleşik yol — geriye dönük uyumluluk için Kasa ekranına yönlendirilir.
  { path: '/cash-bank', redirect: '/cash' },
  { path: '/expenses', name: 'expenses', component: ExpenseListView, meta: { requiresAuth: true } },
  {
    path: '/expenses/new',
    name: 'expense-create',
    component: ExpenseFormView,
    meta: { requiresAuth: true },
  },
  {
    path: '/expenses/:id/edit',
    name: 'expense-edit',
    component: ExpenseFormView,
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings/expense-categories',
    redirect: { name: 'settings', query: { group: 'finance', tab: 'expenses' } },
  },
  { path: '/reports', name: 'reports', component: ReportView, meta: { requiresAuth: true } },
  {
    path: '/accounting',
    name: 'accounting',
    component: AccountingView,
    meta: { requiresAuth: true },
  },
  { path: '/cheques', name: 'cheques', component: ChequeView, meta: { requiresAuth: true } },
  {
    path: '/currency',
    name: 'currency',
    component: () => import('@/views/CurrencyView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/integrations',
    name: 'integrations',
    component: IntegrationsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/subscription',
    name: 'subscription',
    component: SubscriptionView,
    meta: { requiresAuth: true },
  },
  {
    path: '/einvoice',
    name: 'einvoice',
    component: EInvoiceView,
    meta: { requiresAuth: true },
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/views/AuditView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/tasks',
    name: 'management-tasks',
    component: () => import('@/views/ManagementTasksView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/appointments',
    name: 'management-appointments',
    component: () => import('@/views/ManagementAppointmentsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/notifications',
    name: 'management-notifications',
    component: () => import('@/views/ManagementNotificationsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/preferences',
    name: 'management-preferences',
    redirect: { name: 'settings', query: { group: 'management', tab: 'notifications' } },
  },
  {
    path: '/management/rules',
    name: 'management-rules',
    redirect: { name: 'settings', query: { group: 'management', tab: 'rules' } },
  },
  {
    path: '/management/approvals',
    name: 'management-approvals',
    component: () => import('@/views/ManagementApprovalsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/sites',
    name: 'management-sites',
    component: () => import('@/views/SitesView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard — kimlik doğrulama + rol/izin (RBAC)
router.beforeEach(async (to, _from) => {
  const requiresAuth = to.meta.requiresAuth;
  const isPublic = to.meta.isPublic === true;
  const authStore = useAuthStore();

  if (requiresAuth && !authStore.isAuthenticated) {
    // Check if user is on login or 2FA verify page
    const isAuthRoute = to.name === 'login' || to.name === 'two-factor-verify';

    if (!isAuthRoute) {
      // If not authenticated and not on auth route, redirect to login
      return { name: 'login' };
    }
    return true;
  }

  // Rol/izin kapısı. JWT rol TAŞIMAZ → roller `GET /v1/auth/me` ile backend'den
  // çözülür (önbellekli: guard her gezinmede çağırır ama istek tek sefer gider).
  // `/me` başarısız olursa fail-closed → izin yok sayılır ve rota reddedilir.
  if (requiresAuth && to.meta.permission && authStore.isAuthenticated) {
    await authStore.fetchMe();
    if (!authStore.can(to.meta.permission)) {
      return { name: 'dashboard' };
    }
  }

  if (!requiresAuth && !isPublic && authStore.isAuthenticated && to.name !== 'dashboard') {
    // Oturum açıkken giriş/ana ekrana dönüş → kullanıcının VARIŞ yerine gönderilir:
    // yönetici kokpite, diğer kullanıcılar klasik panele.
    // `meta.isPublic` ekranları (davet/şifre sıfırlama bağlantıları) bundan muaftır.
    await authStore.fetchMe();
    return { name: authStore.landingRoute };
  }
  return true;
});

export default router;
