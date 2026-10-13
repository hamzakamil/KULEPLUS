import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MoneyInput from '../src/components/MoneyInput.vue';

describe('MoneyInput', () => {
  it('başlangıç değerini tr-TR biçiminde gösterir', () => {
    const wrapper = mount(MoneyInput, { props: { modelValue: 1234.5 } });
    expect(wrapper.find('input').element.value).toBe('1.234,50');
  });

  it('türkçe ondalık ayracıyla girilen değeri sayıya çevirir', async () => {
    const wrapper = mount(MoneyInput, { props: { modelValue: 0 } });
    await wrapper.find('input').setValue('150,75');
    const emitted = wrapper.emitted('update:modelValue')?.at(-1);
    expect(emitted?.[0]).toBeCloseTo(150.75);
  });

  it('currencySymbol verilirse önek gösterilir', () => {
    const wrapper = mount(MoneyInput, { props: { modelValue: 0, currencySymbol: '₺' } });
    expect(wrapper.text()).toContain('₺');
  });

  it('helpText verilirse görünür', () => {
    const wrapper = mount(MoneyInput, { props: { modelValue: 0, helpText: 'KDV hariç' } });
    expect(wrapper.text()).toContain('KDV hariç');
  });

  it('errorMessage verilirse görünür', () => {
    const wrapper = mount(MoneyInput, { props: { modelValue: 0, errorMessage: 'Zorunlu' } });
    expect(wrapper.text()).toContain('Zorunlu');
  });
});
