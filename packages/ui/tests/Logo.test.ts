import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Logo from '../src/components/Logo.vue';

describe('Logo', () => {
  it('"KULEPLUS" wordmark ve "+" işaretini render eder', () => {
    const wrapper = mount(Logo);
    const texts = wrapper.findAll('text').map((t) => t.text());
    expect(texts).toContain('KULEPLUS');
    expect(texts).toContain('+');
  });

  it('erişilebilirlik: role="img" + aria-label="Kuleplus" (SPEC §11.1)', () => {
    const wrapper = mount(Logo);
    const svg = wrapper.find('svg');
    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe('Kuleplus');
  });

  it('id prop verilirse svg üzerine taşınır', () => {
    const wrapper = mount(Logo, { props: { id: 'logo-header' } });
    expect(wrapper.find('svg').attributes('id')).toBe('logo-header');
  });

  it('id prop verilmezse id attribute eklenmez', () => {
    const wrapper = mount(Logo);
    expect(wrapper.find('svg').attributes('id')).toBeUndefined();
  });
});
