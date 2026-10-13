<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useInvoiceStore } from '@/stores/invoices';
import { useEntitlementStore } from '@/stores/entitlement';
import { useCompanyStore } from '@/stores/company';

const auth = useAuthStore();
const router = useRouter();
const isAuthenticated = computed(() => auth.isAuthenticated);
const userName = computed(() => auth.company?.name || 'Kullanıcı');

/** Modül hakları + şirket listesi — oturum açılınca bir kez yüklenir (Faz 2 kabuk). */
const entitlements = useEntitlementStore();
const companies = useCompanyStore();
const companyMenuOpen = ref(false);
const currentCompany = computed(() => companies.companies.find((c) => c.id === auth.company?.id));
const currentCompanyName = computed(
  () => currentCompany.value?.trade_name || currentCompany.value?.name || auth.company?.name || 'Şirket',
);

async function loadShell() {
  if (!auth.isAuthenticated) return;
  await Promise.all([entitlements.fetchEntitlements(), companies.fetchCompanies()]);
}
onMounted(loadShell);
watch(isAuthenticated, (value) => {
  if (value) void loadShell();
  else companies.companies = [];
});

/** Kilitli modül: hak yoksa menü maddesi önizlemeye yönlendirir (README §4.1). */
function isLocked(moduleCode?: string): boolean {
  return !!moduleCode && !entitlements.hasModule(moduleCode);
}
function lockedTarget(moduleCode?: string): string | undefined {
  return moduleCode ? `/locked/${moduleCode}` : undefined;
}

function toggleCompanyMenu() {
  companyMenuOpen.value = !companyMenuOpen.value;
  if (companyMenuOpen.value && companies.companies.length === 0) void companies.fetchCompanies();
}
async function onSwitchCompany(tenantId: string) {
  companyMenuOpen.value = false;
  if (tenantId === auth.company?.id) return;
  await companies.switchTo(tenantId);
}

/** Form değil — yalnızca workspace panelinin konumunu geri yüklemek için. */
const invoiceStore = useInvoiceStore();
const panelGeometry = reactive({ left: 0, top: 0 });
const hasInvoiceDraft = ref(false);

function syncPanelVars() {
  const el = document.querySelector<HTMLElement>('.invoice-workspace-panel');
  if (el) {
    if (panelGeometry.left) {
      el.style.setProperty('--erp-invoice-left', `${panelGeometry.left}px`);
    }
    if (panelGeometry.top) {
      el.style.setProperty('--erp-invoice-top', `${panelGeometry.top}px`);
    }
  }
}
function onPanelMove() {
  const el = document.querySelector<HTMLElement>('.invoice-workspace-panel');
  if (!el || invoiceStore.workspaceOpen) return;
  panelGeometry.left = el.offsetLeft;
  panelGeometry.top = el.offsetTop;
  syncPanelVars();
}
function restoreGeometryFromStorage() {
  try {
    const raw = localStorage.getItem('erp_invoice_panel_geo_v1');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.left === 'number') panelGeometry.left = parsed.left;
    if (parsed && typeof parsed.top === 'number') panelGeometry.top = parsed.top;
  } catch {
    localStorage.removeItem('erp_invoice_panel_geo_v1');
  }
}
function persistGeometry() {
  try {
    localStorage.setItem(
      'erp_invoice_panel_geo_v1',
      JSON.stringify({ left: panelGeometry.left, top: panelGeometry.top }),
    );
  } catch {
    /* storage kapalı */
  }
}
function onDraftChange() {
  hasInvoiceDraft.value = !!invoiceStore.draft;
  syncPanelVars();
}
function openInvoiceRoute() {
  router.push('/invoices');
}
function initializeWorkspace() {
  restoreGeometryFromStorage();
  const draft = invoiceStore.loadDraft();
  hasInvoiceDraft.value = !!draft;
  window.addEventListener('erp:invoice-draft-changed', onDraftChange);
  window.addEventListener('erp:invoice-panel-move', onPanelMove);
}
initializeWorkspace();

/** Ağaç (genişletilebilir) uygulama navigasyonu — Faz 2/3 modülleri (docs/product/screens.md).
 *  Ticaret + Finans, "Muhasebe" başlığı altında birleştirildi.
 *  `module` alanı entitlement kapısı içindir (GOVERNANCE §2 modül kodları). */
const navGroups: {
  label: string;
  items: { to: string; label: string; module?: string }[];
}[] = [
  { label: 'Genel', items: [{ to: '/dashboard', label: 'Panel' }] },
  {
    label: 'Muhasebe',
    items: [
      // Ticari işlemler
      { to: '/contacts', label: 'Cari', module: 'contacts' },
      { to: '/stock', label: 'Stok', module: 'stock' },
      { to: '/quotes', label: 'Teklifler', module: 'trade' },
      { to: '/orders', label: 'Siparişler', module: 'trade' },
      { to: '/purchase-orders', label: 'Satın Alma', module: 'trade' },
      { to: '/deliveries', label: 'İrsaliye', module: 'trade' },
      { to: '/invoices', label: 'Faturalar', module: 'trade' },
      // Finansal işlemler
      { to: '/cash-bank', label: 'Kasa & Banka', module: 'cashbank' },
      { to: '/expenses', label: 'Giderler', module: 'trade' },
      { to: '/accounting', label: 'Genel Muhasebe', module: 'accounting' },
      { to: '/cheques', label: 'Çek / Senet', module: 'cheque' },
    ],
  },
  { label: 'Raporlar', items: [{ to: '/reports', label: 'Raporlar', module: 'reports_plus' }] },
  {
    label: 'Yönetim',
    items: [
      { to: '/management/tasks', label: 'Görevler', module: 'management' },
      { to: '/management/appointments', label: 'Randevular', module: 'management' },
      { to: '/management/notifications', label: 'Bildirimler', module: 'management' },
      { to: '/management/preferences', label: 'Bildirim Tercihleri', module: 'management' },
      { to: '/management/approvals', label: 'Onay Kutusu', module: 'management' },
      { to: '/management/rules', label: 'Kural Ayarları', module: 'management' },
    ],
  },
  { label: 'Ayarlar', items: [{ to: '/settings/expense-categories', label: 'Gider Kategorileri' }] },
];

/**
 * Ağaç menü durumu: grup başlıkları tıklanınca alt menüler açılır/kapanır.
 * Seçim localStorage'da hatırlanır; varsayılan tüm gruplar açıktır.
 */
const collapsedGroups = ref<Record<string, boolean>>(loadCollapsedGroups());

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('kuleplus_nav_collapsed_v1') ?? '{}');
  } catch {
    return {};
  }
}
function isGroupExpanded(groupLabel: string): boolean {
  return !collapsedGroups.value[groupLabel];
}
function toggleGroup(groupLabel: string) {
  const next = { ...collapsedGroups.value };
  next[groupLabel] = !next[groupLabel];
  collapsedGroups.value = next;
  try {
    localStorage.setItem('kuleplus_nav_collapsed_v1', JSON.stringify(next));
  } catch {
    /* storage kapalı */
  }
}
</script>

<template>
  <a class="skip-link" href="#icerik">{{ t('web.a11y.skip') }}</a>

  <!-- Giriş yapılmamışken (login/2fa) çıplak ekran -->
  <RouterView v-if="!isAuthenticated" id="icerik" />

  <!-- Uygulama kabuğu: sabit sol kenar çubuğu + içerik alanı -->
  <div v-else class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/dashboard" class="brand" aria-label="Kuleplus Panel">
        <span class="brand-mark" aria-hidden="true">▲</span>
        <span class="brand-name">Kuleplus</span>
      </RouterLink>

      <nav aria-label="Ana menü" class="side-nav">
        <div v-for="group in navGroups" :key="group.label" class="nav-group">
          <button
            type="button"
            class="nav-group-toggle"
            :class="{ 'is-collapsed': !isGroupExpanded(group.label) }"
            :aria-expanded="isGroupExpanded(group.label)"
            @click="toggleGroup(group.label)"
          >
            <span class="nav-chevron" aria-hidden="true"></span>
            <span>{{ group.label }}</span>
          </button>
          <div v-if="isGroupExpanded(group.label)" class="nav-group-items">
            <RouterLink
              v-for="item in group.items"
              :key="item.to"
              :to="isLocked(item.module) && lockedTarget(item.module) ? lockedTarget(item.module)! : item.to"
              class="nav-link"
              :class="{ 'is-locked': isLocked(item.module) }"
            >
              <span>{{ item.label }}</span>
              <span v-if="isLocked(item.module)" class="nav-lock">kilitli</span>
            </RouterLink>
          </div>
        </div>
      </nav>

      <div class="sidebar-foot">
        <!-- Şirket seçici (Faz 2 UX kabuğu — README §5: şirket + kullanıcı menüsü) -->
        <div class="company-switcher">
          <button
            type="button"
            class="company-btn"
            :aria-expanded="companyMenuOpen"
            aria-haspopup="listbox"
            aria-label="Şirket değiştir"
            @click="toggleCompanyMenu"
          >
            <span class="company-name" :title="currentCompanyName">{{ currentCompanyName }}</span>
            <span class="nav-chevron" aria-hidden="true"></span>
          </button>
          <ul v-if="companyMenuOpen" class="company-list" role="listbox" aria-label="Şirketler">
            <li v-if="companies.loading" class="company-empty">Yükleniyor…</li>
            <li v-else-if="companies.companies.length === 0" class="company-empty">Başka şirket yok</li>
            <li
              v-for="c in companies.companies"
              :key="c.id"
              role="option"
              :aria-selected="c.id === auth.company?.id"
            >
              <button
                type="button"
                :class="{ 'is-current': c.id === auth.company?.id }"
                :disabled="companies.switching"
                @click="onSwitchCompany(c.id)"
              >
                {{ c.trade_name || c.name }}
                <span v-if="c.isOwner" class="company-role">sahip</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="user">
          <span class="user-name" :title="userName">{{ userName }}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm btn-block" @click="auth.logout()">
          Çıkış Yap
        </button>
      </div>
    </aside>

    <div class="main">
      <RouterView id="icerik" />
    </div>

    <!-- Kirli fatura taslağı varken geri dönüş affordance'ı (erp-workspace-panels) -->
    <button
      v-if="hasInvoiceDraft"
      type="button"
      class="draft-return"
      @click="openInvoiceRoute"
      title="Kaydedilmemiş fatura taslağı var"
    >
      <span class="draft-dot" aria-hidden="true"></span>
      Fatura taslağına dön
    </button>
  </div>
</template>

<style scoped>
.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 0;
  z-index: 100;
  padding: 0.75rem 1rem;
  background: var(--c-primary);
  color: #fff;
  border-radius: 0 0 0.5rem 0;
}

.app-shell {
  /* erp-workspace-panels: panel sınırları shell değişkenlerinden türetilir */
  --erp-sidebar-width: 16rem;
  --erp-header-height: 0rem;
  display: grid;
  grid-template-columns: var(--erp-sidebar-width) 1fr;
  min-height: 100vh;
}

/* === Sol kenar çubuğu === */
.sidebar {
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #f8fafc;
  border-right: 1px solid #1e293b;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.25rem 1.25rem 1rem;
  font-weight: 800;
  font-size: 1.125rem;
  color: #f8fafc;
  text-decoration: none;
}
.brand-mark {
  color: var(--c-primary);
}
.side-nav {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
}
.nav-group {
  margin-bottom: 1.25rem;
}
.nav-group-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin: 0 0 0.25rem;
  padding: 0.375rem 0.5rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: #64748b;
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}
.nav-group-toggle:hover {
  background: #1e293b;
  color: #cbd5e1;
}
.nav-chevron {
  flex: none;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid currentColor;
  transition: transform 0.15s ease;
}
.nav-group-toggle.is-collapsed .nav-chevron {
  transform: rotate(-90deg);
}
.nav-group-items {
  display: flex;
  flex-direction: column;
  margin: 0 0 0.125rem 0.5rem;
  padding: 0.125rem 0 0.25rem 0.75rem;
  border-left: 1px solid #1e293b;
}
.nav-link {
  display: block;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.125rem;
  border-radius: 0.5rem;
  color: #cbd5e1;
  text-decoration: none;
  font-size: 0.9375rem;
}
.nav-link:hover {
  background: #1e293b;
  color: #f8fafc;
}
.nav-link.router-link-active {
  background: var(--c-primary);
  color: #fff;
  font-weight: 600;
}
.sidebar-foot {
  padding: 1rem;
  border-top: 1px solid #1e293b;
}
.user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #1e293b;
  border-radius: 0.5rem;
}
.user-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #e2e8f0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-block {
  width: 100%;
}

/* === Kilitli modül rozeti (README §4.1 — gizleme değil, önizlemeye götürür) === */
.nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.nav-lock {
  flex: none;
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: #334155;
  color: #cbd5e1;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.nav-link.is-locked {
  color: #94a3b8;
}

/* === Şirket seçici === */
.company-switcher {
  position: relative;
  margin-bottom: 0.625rem;
}
.company-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  background: #0f172a;
  color: #e2e8f0;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}
.company-btn:hover {
  border-color: var(--c-primary);
}
.company-btn:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.company-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.company-list {
  position: absolute;
  bottom: calc(100% + 0.25rem);
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  background: #0f172a;
  box-shadow: 0 -12px 24px -12px rgb(2 6 23 / 0.7);
}
.company-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4375rem 0.5rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: #cbd5e1;
  font: inherit;
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
}
.company-list button:hover:not(:disabled) {
  background: #1e293b;
  color: #f8fafc;
}
.company-list button.is-current {
  background: var(--c-primary);
  color: #fff;
}
.company-list button:disabled {
  cursor: progress;
  opacity: 0.7;
}
.company-role {
  flex: none;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
.company-empty {
  padding: 0.5rem;
  color: #94a3b8;
  font-size: 0.75rem;
}

.main {
  min-width: 0;
}

/* === Kirli fatura taslağı geri dönüş affordance'ı (erp-workspace-panels) === */
.draft-return {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text);
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  box-shadow: 0 12px 24px -12px rgb(15 23 42 / 0.35);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.draft-return:hover {
  border-color: var(--c-primary);
  box-shadow: 0 16px 28px -12px rgb(15 23 42 / 0.45);
}
.draft-return:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
}
.draft-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--c-warning);
}

/* Mobil: kenar çubuğu üstte yatay kaydırılır */
@media (max-width: 60rem) {
  .app-shell {
    --erp-sidebar-width: 0rem;
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: static;
    height: auto;
  }
  .side-nav {
    display: flex;
    gap: 1.5rem;
    overflow-x: auto;
    padding: 0.5rem 1rem;
  }
  .nav-group {
    margin-bottom: 0;
  }
  .nav-group-toggle {
    margin-bottom: 0.25rem;
  }
  .nav-group-items {
    border-left: 0;
    margin-left: 0;
    padding-left: 0.5rem;
  }
}
</style>
