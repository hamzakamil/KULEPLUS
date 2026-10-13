import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Input from '../src/components/Input.vue';

describe('Input', () => {
  it('modelValue değerini gösterir', () => {
    const wrapper = mount(Input, { props: { modelValue: 'Merhaba' } });
    expect(wrapper.find('input').element.value).toBe('Merhaba');
  });

  it('label prop verilirse görünür', () => {
    const wrapper = mount(Input, { props: { modelValue: '', label: 'Ad Soyad' } });
    expect(wrapper.text()).toContain('Ad Soyad');
  });

  it('yazıldığında update:modelValue emit eder', async () => {
    const wrapper = mount(Input, { props: { modelValue: '' } });
    await wrapper.find('input').setValue('yeni değer');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['yeni değer']);
  });

  it('helpText verilirse yardım metni görünür', () => {
    const wrapper = mount(Input, { props: { modelValue: '', helpText: 'Zorunlu alan' } });
    expect(wrapper.text()).toContain('Zorunlu alan');
  });

  it('errorMessage verilirse hata metni görünür', () => {
    const wrapper = mount(Input, {
      props: { modelValue: '', errorMessage: 'Geçersiz değer' },
    });
    expect(wrapper.text()).toContain('Geçersiz değer');
  });

  it('disabled iken input devre dışıdır', () => {
    const wrapper = mount(Input, { props: { modelValue: '', disabled: true } });
    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
  });
});
