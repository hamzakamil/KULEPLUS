import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Button from '../src/components/Button.vue';

describe('Button', () => {
  it('slot içeriğini render eder', () => {
    const wrapper = mount(Button, { slots: { default: 'Kaydet' } });
    expect(wrapper.text()).toContain('Kaydet');
    expect(wrapper.element.tagName).toBe('BUTTON');
  });

  it('variant sınıfını uygular', () => {
    const wrapper = mount(Button, { props: { variant: 'primary' } });
    expect(wrapper.classes()).toContain('bg-blue-600');
  });

  it('danger variant kırmızı sınıf uygular', () => {
    const wrapper = mount(Button, { props: { variant: 'danger' } });
    expect(wrapper.classes()).toContain('bg-red-600');
  });

  it('size sm küçük sınıf uygular', () => {
    const wrapper = mount(Button, { props: { size: 'sm' } });
    expect(wrapper.classes()).toContain('h-8');
  });

  it('disabled iken buton devre dışıdır', () => {
    const wrapper = mount(Button, { props: { disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
  });

  it('tıklama click emit eder', async () => {
    const wrapper = mount(Button, { slots: { default: 'X' } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('dış sınıf ($attrs.class) korunur', () => {
    const wrapper = mount(Button, { attrs: { class: 'ozel-sinif' } });
    expect(wrapper.classes()).toContain('ozel-sinif');
  });
});
