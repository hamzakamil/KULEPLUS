<script setup lang="ts">
import { ref } from 'vue';
import type { FaqItem } from '../types';

const props = defineProps<{
  items: FaqItem[];
}>();

const openIndex = ref<number | null>(props.items.length > 0 ? 0 : null);

function toggle(index: number): void {
  openIndex.value = openIndex.value === index ? null : index;
}
</script>

<template>
  <div class="faq-accordion">
    <div v-for="(item, index) in items" :key="index" class="faq-item">
      <h3 class="faq-heading">
        <button
          type="button"
          class="faq-trigger"
          :aria-expanded="openIndex === index"
          :aria-controls="`faq-panel-${index}`"
          :id="`faq-button-${index}`"
          @click="toggle(index)"
        >
          <span>{{ item.question }}</span>
          <span class="faq-icon" aria-hidden="true">
            {{ openIndex === index ? '−' : '+' }}
          </span>
        </button>
      </h3>
      <div
        v-show="openIndex === index"
        :id="`faq-panel-${index}`"
        role="region"
        :aria-labelledby="`faq-button-${index}`"
        class="faq-panel"
      >
        <p>{{ item.answer }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.faq-accordion {
  border-top: 1px solid var(--color-border, #e2e8f0);
}

.faq-item {
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}

.faq-heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.faq-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  background: none;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  color: inherit;
  text-align: left;
}

.faq-trigger:focus-visible {
  outline: 2px solid var(--color-focus, #2563eb);
  outline-offset: 2px;
}

.faq-icon {
  flex-shrink: 0;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--color-primary, #1d4ed8);
}

.faq-panel {
  padding: 0 0 1rem;
  color: var(--color-muted, #475569);
}

.faq-panel p {
  margin: 0;
}
</style>
