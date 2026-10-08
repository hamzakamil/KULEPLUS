import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';

/**
 * Rota iskeleti — docs/product/screens.md formatına göre genişletilir:
 * | Route | Ekran | Görünüm | Rol/Permission | Faz | İlgili API |
 * Faz 1: /login, platform rotaları · Faz 2: /dashboard, /contacts
 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
