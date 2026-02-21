import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('../views/Layout.vue'),
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('../views/Dashboard.vue'),
          meta: { title: 'Dashboard' },
        },
        {
          path: 'hesaplar',
          name: 'accounts',
          component: () => import('../views/Accounts.vue'),
          meta: { title: 'Hesap Planı' },
        },
        {
          path: 'yevmiye',
          name: 'journal',
          component: () => import('../views/Journal.vue'),
          meta: { title: 'Yevmiye Fişleri' },
        },
        {
          path: 'yevmiye/yeni',
          name: 'journal-new',
          component: () => import('../views/JournalForm.vue'),
          meta: { title: 'Yeni Yevmiye Fişi' },
        },
        {
          path: 'raporlar',
          name: 'reports',
          component: () => import('../views/Reports.vue'),
          meta: { title: 'Raporlar' },
        },
        {
          path: 'raporlar/mizan',
          name: 'trial-balance',
          component: () => import('../views/TrialBalance.vue'),
          meta: { title: 'Mizan' },
        },
        {
          path: 'entegrasyonlar',
          name: 'integrations',
          component: () => import('../views/Integrations.vue'),
          meta: { title: 'Entegrasyonlar' },
        },
      ],
    },
  ],
});

router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || 'Muhasebe'} - TDHP Muhasebe`;
  next();
});

export default router;
