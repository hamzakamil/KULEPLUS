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
import IntegrationsView from '../views/IntegrationsView.vue';
import SubscriptionView from '../views/SubscriptionView.vue';

/**
 * Rota iskeleti — docs/product/screens.md formatına göre genişletilir:
 * | Route | Ekran | Görünüm | Rol/Permission | Faz | İlgili API |
 * Faz 1: /login, platform rotaları · Faz 2: /dashboard, /contacts, /stock, /invoices
 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/login', name: 'login', component: LoginView },
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
  {
    path: '/cash-bank',
    name: 'cash-bank',
    component: () => import('@/views/CashBankView.vue'),
    meta: { requiresAuth: true },
  },
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
    path: '/settings/expense-categories',
    name: 'expense-categories',
    component: () => import('@/views/ExpenseCategoriesView.vue'),
    meta: { requiresAuth: true },
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
    component: () => import('@/views/ManagementPreferencesView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/rules',
    name: 'management-rules',
    component: () => import('@/views/ManagementRulesView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/management/approvals',
    name: 'management-approvals',
    component: () => import('@/views/ManagementApprovalsView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard for authentication check
router.beforeEach((to, _from) => {
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
  } else if (!requiresAuth && !isPublic && authStore.isAuthenticated && to.name !== 'dashboard') {
    // If already authenticated and trying to access login, redirect to dashboard.
    // `meta.isPublic` ekranları (davet/şifre sıfırlama bağlantıları) bundan muaftır.
    return { name: 'dashboard' };
  }
  return true;
});

export default router;
