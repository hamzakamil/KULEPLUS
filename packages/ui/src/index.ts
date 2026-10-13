export { default as FaqAccordion } from './components/FaqAccordion.vue';
export type { FaqItem } from './types';
export { default as ContactForm } from './components/ContactForm.vue';

// ---- Tasarım sistemi (web + platform paneli; ADR-0012, SPEC §28) ----
export { default as Button } from './components/Button.vue';
export { default as Input } from './components/Input.vue';
export { default as MoneyInput } from './components/MoneyInput.vue';
export { default as DataTable } from './components/DataTable.vue';
export { default as Modal } from './components/Modal.vue';
export { default as Drawer } from './components/Drawer.vue';
export { default as EmptyState } from './components/EmptyState.vue';
export { default as Logo } from './components/Logo.vue';

// ---- Analitik (Plausible; apps/web + site tarafından kullanılır) ----
export { trackEvent } from './analytics';
