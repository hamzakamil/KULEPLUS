import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from '../src/components/EmptyState.vue';

describe('EmptyState', () => {
  it('başlık ve açıklama gösterir', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Kayıt yok', description: 'İlk kaydınızı oluşturun.' },
    });
    expect(wrapper.text()).toContain('Kayıt yok');
    expect(wrapper.text()).toContain('İlk kaydınızı oluşturun.');
  });

  it('açıklama verilmezse yalnızca başlık gösterir', () => {
    const wrapper = mount(EmptyState, { props: { title: 'Boş' } });
    expect(wrapper.text()).toContain('Boş');
    expect(wrapper.find('p').exists()).toBe(false);
  });

  it('action slot verilirse render edilir', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Boş' },
      slots: { action: '<button>Yeni Ekle</button>' },
    });
    expect(wrapper.text()).toContain('Yeni Ekle');
  });
});
