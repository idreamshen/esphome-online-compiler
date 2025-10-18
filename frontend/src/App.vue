<template>
  <main class="app">
    <section class="hero">
      <div class="hero-header">
        <h1 class="hero-title">{{ t('app.title') }}</h1>
        <div class="locale-switcher">
          <label class="sr-only" for="locale-select">{{ t('app.localeLabel') }}</label>
          <select id="locale-select" v-model="currentLocale" class="locale-select">
            <option v-for="option in localeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>
    </section>
    <CompileForm />
  </main>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import CompileForm from './components/CompileForm.vue';
import { persistLocale, SUPPORTED_LOCALES, type SupportedLocale } from './i18n';

const { t, locale } = useI18n();

const currentLocale = computed<SupportedLocale>({
  get: () => locale.value as SupportedLocale,
  set: (value) => {
    locale.value = value;
  }
});

const localeOptions = computed(() =>
  SUPPORTED_LOCALES.map((value) => ({
    value,
    label: t(`app.locales.${value}`)
  }))
);

watch(locale, (nextLocale) => {
  if (SUPPORTED_LOCALES.includes(nextLocale as SupportedLocale)) {
    persistLocale(nextLocale as SupportedLocale);
  }
});
</script>

<style scoped>
.app {
  padding: 2.5rem 1.5rem 3rem;
  max-width: 960px;
  margin: 0 auto;
}

.hero {
  margin-bottom: 2rem;
  display: grid;
  gap: 1rem;
}

.hero-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.hero-title {
  font-size: 2.5rem;
  margin: 0;
}

.locale-switcher {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.locale-select {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.9);
  color: #f8fafc;
  padding: 0 0.75rem;
  font-size: 0.95rem;
}

.locale-select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
