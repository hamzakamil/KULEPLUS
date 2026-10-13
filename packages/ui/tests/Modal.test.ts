import { describe, expect, it, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modal from '../src/components/Modal.vue';

/** Teleport hedefi body olduğu için sorgular document üzerinden yapılır. */
const body = () => document.body;

describe('Modal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('open=false iken içerik render edilmez', () => {
    mount(Modal, { props: { open: false, title: 'Test' } });
    expect(body().querySelector('[role="dialog"]')).toBeNull();
  });

  it('open=true iken başlık ve içerik görünür', () => {
    mount(Modal, {
      props: { open: true, title: 'Yeni Kayıt' },
      slots: { default: '<p>Form içeriği</p>' },
    });
    const dialog = body().querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Yeni Kayıt');
    expect(dialog?.textContent).toContain('Form içeriği');
  });

  it('kapat butonu close emit eder', async () => {
    const wrapper = mount(Modal, { props: { open: true, title: 'T' } });
    const closeBtn = body().querySelector<HTMLButtonElement>('button[aria-label="Kapat"]');
    closeBtn?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('backdrop tıklaması close emit eder (closeOnBackdrop=true)', async () => {
    const wrapper = mount(Modal, { props: { open: true, title: 'T' } });
    const dialog = body().querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closeOnBackdrop=false iken backdrop close emit etmez', async () => {
    const wrapper = mount(Modal, {
      props: { open: true, title: 'T', closeOnBackdrop: false },
    });
    const dialog = body().querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('Escape tuşu close emit eder', async () => {
    const wrapper = mount(Modal, { props: { open: true, title: 'T' } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('footer slot verilirse render edilir', () => {
    mount(Modal, {
      props: { open: true, title: 'T' },
      slots: { footer: '<button>Kaydet</button>' },
    });
    expect(body().textContent).toContain('Kaydet');
  });
});
