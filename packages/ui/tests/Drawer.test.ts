import { describe, expect, it, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Drawer from '../src/components/Drawer.vue';

/** Teleport hedefi body olduğu için sorgular document üzerinden yapılır. */
const body = () => document.body;

describe('Drawer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('open=false iken render edilmez', () => {
    mount(Drawer, { props: { open: false, title: 'Panel' } });
    expect(body().querySelector('[role="dialog"]')).toBeNull();
  });

  it('open=true iken başlık ve içerik görünür', () => {
    mount(Drawer, {
      props: { open: true, title: 'Detay' },
      slots: { default: '<div>Panel içeriği</div>' },
    });
    const dialog = body().querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Detay');
    expect(dialog?.textContent).toContain('Panel içeriği');
  });

  it('kapat butonu close emit eder', async () => {
    const wrapper = mount(Drawer, { props: { open: true, title: 'D' } });
    const closeBtn = body().querySelector<HTMLButtonElement>('button[aria-label="Kapat"]');
    closeBtn?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('footer slot verilirse render edilir', () => {
    mount(Drawer, {
      props: { open: true, title: 'D' },
      slots: { footer: '<button>Uygula</button>' },
    });
    expect(body().textContent).toContain('Uygula');
  });
});
