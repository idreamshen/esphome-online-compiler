<template>
  <main class="app">
    <section class="hero">
      <h1>ESPHome 在线编译</h1>
    </section>
    <CompileForm />
  </main>
</template>

<script setup lang="ts">
import CompileForm from './components/CompileForm.vue';
</script>

<style scoped>
.app {
  padding: 2.5rem 1.5rem 3rem;
  max-width: 960px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  margin-bottom: 2rem;
}

.hero h1 {
  font-size: 2.5rem;
  margin: 0;
}

.hero p {
  margin: 0.5rem auto 0;
  max-width: 560px;
  color: #cbd5f5;
}
</style>
