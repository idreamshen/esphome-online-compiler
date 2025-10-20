<template>
  <section class="panel">
    <section v-if="!sessionLoaded" class="loading-card">
      <p>{{ t('compileForm.loading') }}</p>
    </section>

    <template v-else>
      <section v-if="isAuthenticated && missingScopes.length > 0" class="status warning">
        {{ t('compileForm.missingScopes', { scopes: missingScopes.join(', ') }) }}
      </section>

      <form class="form" @submit.prevent="handleSubmit">
        <label class="field">
          <span>{{ t('compileForm.fields.yaml.label') }}</span>
          <YamlEditor
            v-model="yaml"
            :placeholder="YAML_PLACEHOLDER"
          />
        </label>

        <section v-if="hasSecrets" class="secrets-panel">
          <h3>{{ t('compileForm.secrets.title') }}</h3>
          <p class="field-hint">
            <i18n-t keypath="compileForm.secrets.description">
              <template #code>
                <code>!secret</code>
              </template>
            </i18n-t>
          </p>
          <section v-for="name in secretNames" :key="name" class="secret-item">
            <label class="field">
              <span>{{ name }}</span>
              <div class="password-input">
                <input
                  :type="revealedSecrets[name] ? 'text' : 'password'"
                  v-model="secretValues[name]"
                  :placeholder="t('compileForm.secrets.inputPlaceholder')"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="none"
                  spellcheck="false"
                  :disabled="pending"
                />
                <button
                  type="button"
                  class="ghost mini"
                  :disabled="pending"
                  @click="toggleSecretVisibility(name)"
                >
                  {{ revealedSecrets[name] ? t('compileForm.actions.hideSecret') : t('compileForm.actions.showSecret') }}
                </button>
              </div>
            </label>
          </section>
          <p v-if="missingSecretNames.length > 0" class="status warning">
            {{ t('compileForm.secrets.missing', { count: missingSecretNames.length, names: missingSecretNames.join(', ') }) }}
          </p>
        </section>

        <label class="field">
          <span>{{ t('compileForm.fields.esphomeVersion.label') }}</span>
          <select v-model="esphomeVersionSelection" :disabled="pending">
            <option
              v-for="option in ESPHOME_VERSION_OPTIONS"
              :key="option.value || 'latest'"
              :value="option.value"
            >
              {{ option.labelKey ? t(option.labelKey) : option.value }}
            </option>
          </select>
          <input
            v-if="esphomeVersionSelection === '__custom__'"
            v-model="customEsphomeVersion"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            :disabled="pending"
            :placeholder="t('compileForm.fields.esphomeVersion.customPlaceholder')"
          />
          <p class="field-hint">
            {{ t('compileForm.fields.esphomeVersion.hint') }}
          </p>
        </label>

        <label class="field">
          <span>{{ t('compileForm.fields.artifactPassword.label') }}</span>
          <div class="password-input">
            <input
              v-model="artifactPassword"
              type="text"
              inputmode="text"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              maxlength="64"
              :placeholder="t('compileForm.fields.artifactPassword.placeholder')"
              :disabled="pending"
            />
            <button
              type="button"
              class="ghost mini"
              :disabled="pending"
              @click="regenerateArtifactPassword"
            >
              {{ t('compileForm.fields.artifactPassword.regenerate') }}
            </button>
          </div>
          <p class="field-hint">
            {{ t('compileForm.fields.artifactPassword.hint') }}
          </p>
        </label>

        <div class="actions">
          <div class="primary-actions">
            <button :class="{ loading: pending }" :disabled="pending || !canSubmit" type="submit">
              {{ pending ? t('compileForm.actions.submitting') : t('compileForm.actions.submit') }}
            </button>
            <button
              :disabled="!canReset"
              class="ghost"
              type="button"
              @click="reset"
            >
              {{ t('compileForm.actions.reset') }}
            </button>
          </div>
          <div class="auth-controls">
            <div v-if="isAuthenticated" class="auth-user">
              <img
                v-if="user?.avatarUrl"
                :src="user.avatarUrl"
                :alt="t('compileForm.auth.avatarAlt')"
              />
              <div v-else class="avatar-fallback">{{ user?.login?.[0]?.toUpperCase() ?? 'G' }}</div>
              <button class="ghost mini" type="button" @click="logout">{{ t('compileForm.auth.logout') }}</button>
            </div>
            <button
              v-else
              type="button"
              class="ghost mini"
              :class="{ loading: authLoading }"
              :disabled="authLoading"
              @click="login"
            >
              {{ t('compileForm.auth.login') }}
            </button>
          </div>
        </div>
        <p v-if="shouldEncouragePersonal && !isAuthenticated" class="personal-hint">
          {{ t('compileForm.auth.encouragePersonal') }}
        </p>
        <p v-if="submitHint" class="status warning">{{ submitHint }}</p>
        <p v-if="error" class="status error">{{ error }}</p>
      </form>

      <section v-if="requestId" class="status-card">
        <h2>{{ t('compileForm.status.sectionTitle') }}</h2>
        <p><strong>{{ t('compileForm.status.requestId') }}</strong> {{ requestId }}</p>
        <p v-if="runId"><strong>{{ t('compileForm.status.runId') }}</strong> {{ runId }}</p>
        <p>
          <strong>{{ t('compileForm.status.currentStatus') }}</strong>
          <span :class="['badge', statusClass]">
            <span v-if="isStatusLoading" class="badge-spinner" aria-hidden="true"></span>
            {{ displayStatus }}
          </span>
        </p>
        <p v-if="runUrl">
          <strong>{{ t('compileForm.status.runLinkLabel') }}</strong>
          <button class="link-button" type="button" @click="openRunUrl">{{ t('compileForm.status.openRun') }}</button>
        </p>
        <p>
          <strong>{{ t('compileForm.status.esphomeVersion') }}</strong>
          {{ esphomeVersionLabel }}
        </p>
        <p>
          <strong>{{ t('compileForm.status.artifactPassword') }}</strong>
          <span class="password-display">{{ artifactPassword }}</span>
        </p>
        <p v-if="artifact && artifactUrl">
          <strong>{{ t('compileForm.status.artifact') }}</strong>
          <button
            :disabled="downloadingArtifact"
            :class="['ghost', { loading: downloadingArtifact }]"
            type="button"
            @click="downloadArtifact"
          >
            {{ downloadingArtifact ? t('compileForm.status.downloading') : t('compileForm.status.downloadArtifact', { name: artifact.name }) }}
          </button>
        </p>
        
        <section v-if="jobLogs" class="error-logs">
          <h3>{{ t('compileForm.status.errorLogs') }}</h3>
          <pre class="log-content">{{ jobLogs }}</pre>
        </section>
        <section v-else-if="loadingLogs" class="error-logs">
          <p class="loading-text">{{ t('compileForm.status.loadingLogs') }}</p>
        </section>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import axios from 'axios';
import { Base64 } from 'js-base64';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import YamlEditor from './YamlEditor.vue';

type TokenSource = 'service' | 'session';

type SessionPayload = {
  authenticated: boolean;
  serviceTokenAvailable?: boolean;
  defaultTokenSource?: TokenSource | null;
  user?: {
    login: string;
    name: string | null;
    avatarUrl: string | null;
    htmlUrl: string | null;
  } | null;
  tokenScopes?: string[];
  missingScopes?: string[];
  repo?: {
    owner: string;
    name: string;
    workflowId: string;
    ref: string;
  } | null;
};

type WorkflowStatus = {
  status: string;
  conclusion: string;
  message: string;
  failedJobId?: number | null;
};

type ArtifactMeta = {
  id: number;
  name: string;
};

type PersistedJobState = {
  requestId: string;
  runId: number | null;
  runUrl: string | null;
  status: WorkflowStatus;
  artifact: ArtifactMeta | null;
  artifactUrl: string | null;
  artifactPassword?: string | null;
  tokenSource: TokenSource | null;
  esphomeVersion?: string | null;
};

type ApiErrorPayload = {
  message?: string;
  serviceTokenDegraded?: boolean;
};

const { t, te } = useI18n();

const STORAGE_DRAFT_KEY = 'esphome-online-compiler:yaml-draft';
const STORAGE_JOB_KEY = 'esphome-online-compiler:job-state';
const STORAGE_PASSWORD_KEY = 'esphome-online-compiler:artifact-password';
const STORAGE_SECRETS_KEY = 'esphome-online-compiler:secret-values';
const STORAGE_VERSION_KEY = 'esphome-online-compiler:esphome-version';
const YAML_PLACEHOLDER = `esphome:
  name: mydevice
...`;

const ESPHOME_VERSION_OPTIONS: ReadonlyArray<{ value: string; labelKey?: string }> = [
  { value: '', labelKey: 'compileForm.fields.esphomeVersion.options.latest' },
  { value: '2025.10.1' },
  { value: '2025.9.0' },
  { value: '2025.8.3' },
  { value: '__custom__', labelKey: 'compileForm.fields.esphomeVersion.options.custom' }
];

const client = axios.create({
  withCredentials: true
});

const session = ref<SessionPayload | null>(null);
const sessionLoaded = ref(false);

const yaml = ref('');
const runId = ref<number | null>(null);
const requestId = ref<string | null>(null);
const runUrl = ref<string | null>(null);
const artifactUrl = ref<string | null>(null);
const artifact = ref<ArtifactMeta | null>(null);
const artifactPassword = ref('');
const pending = ref(false);
const downloadingArtifact = ref(false);
const error = ref<string | null>(null);
const pollTimer = ref<number | null>(null);
const preferPersonalToken = ref(false);
const lastTokenSource = ref<TokenSource | null>(null);
const serviceTokenDegraded = ref(false);
const authLoading = ref(false);
const secretNames = ref<string[]>([]);
const secretValues = reactive<Record<string, string>>({});
const revealedSecrets = reactive<Record<string, boolean>>({});
const customEsphomeVersion = ref('');
const selectedEsphomeVersion = ref('');
const esphomeVersionSelection = ref<string>(ESPHOME_VERSION_OPTIONS[0].value);
const jobLogs = ref<string | null>(null);
const loadingLogs = ref(false);
const esphomeVersionLabel = computed(() => {
  if (!selectedEsphomeVersion.value) {
    return t('compileForm.fields.esphomeVersion.defaultLabel');
  }
  const match = ESPHOME_VERSION_OPTIONS.find(
    (option) => option.value === selectedEsphomeVersion.value
  );
  if (match && match.value !== '__custom__') {
    if (match.labelKey) {
      return t(match.labelKey);
    }
    return match.value;
  }
  return selectedEsphomeVersion.value;
});

const status = reactive<WorkflowStatus>({
  status: '',
  conclusion: '',
  message: '',
  failedJobId: null
});

const isAuthenticated = computed(() => Boolean(session.value?.authenticated));
const user = computed(() => session.value?.user ?? null);
const repo = computed(() => session.value?.repo ?? null);
const missingScopes = computed(() => session.value?.missingScopes ?? []);
const serviceTokenAvailable = computed(() => Boolean(session.value?.serviceTokenAvailable));
const canUsePersonalToken = computed(
  () => isAuthenticated.value && missingScopes.value.length === 0
);
const shouldEncouragePersonal = computed(
  () => !serviceTokenAvailable.value || serviceTokenDegraded.value
);
const hasSecrets = computed(() => secretNames.value.length > 0);
const canSubmit = computed(() => {
  if (preferPersonalToken.value) {
    return canUsePersonalToken.value;
  }
  if (serviceTokenAvailable.value && !serviceTokenDegraded.value) {
    return true;
  }
  return canUsePersonalToken.value;
});
const missingSecretNames = computed(() =>
  secretNames.value.filter((name) => !(secretValues[name]?.trim()))
);
const submitHint = computed(() => {
  if (canSubmit.value || serviceTokenDegraded.value) {
    return null;
  }
  if (!isAuthenticated.value) {
    return t('compileForm.submitHints.loginRequired');
  }
  if (missingScopes.value.length > 0) {
    return t('compileForm.submitHints.missingScopes');
  }
  return null;
});
const tokenInfo = computed(() => null);

const canReset = computed(() => {
  if (pending.value) {
    return false;
  }
  if (runId.value || requestId.value) {
    return true;
  }
  return yaml.value.trim().length > 0;
});

const displayStatus = computed(() => {
  if (!status.status) {
    return t('compileForm.statusDisplay.notStarted');
  }
  if (status.status === 'completed') {
    if (status.conclusion) {
      const conclusionKey = `compileForm.statusDisplay.conclusion.${status.conclusion}`;
      if (te(conclusionKey)) {
        return t(conclusionKey);
      }
      return status.conclusion;
    }
    return t('compileForm.statusDisplay.completed');
  }
  const statusKey = `compileForm.statusDisplay.status.${status.status}`;
  if (te(statusKey)) {
    return t(statusKey);
  }
  return status.status;
});

const statusClass = computed(() => {
  if (!status.status) return 'default';
  if (status.status === 'completed') {
    return status.conclusion === 'success' ? 'success' : 'error';
  }
  if (status.status === 'queued') {
    return 'queued';
  }
  if (status.status === 'in_progress') {
    return 'in-progress';
  }
  return 'progress';
});

const isStatusLoading = computed(
  () => status.status === 'queued' || status.status === 'in_progress'
);

function applyServiceTokenDegraded(payload: ApiErrorPayload | undefined) {
  if (payload?.serviceTokenDegraded) {
    serviceTokenDegraded.value = true;
    if (isAuthenticated.value && missingScopes.value.length === 0) {
      preferPersonalToken.value = true;
    }
  }
}

function generateRandomPassword(length = 16): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bucketLength = characters.length;
  if (length <= 0) {
    return '';
  }
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto ?? null : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const randomValues = new Uint32Array(length);
    cryptoObj.getRandomValues(randomValues);
    return Array.from(randomValues, (value) => characters[value % bucketLength]).join('');
  }
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * bucketLength);
    result += characters[randomIndex];
  }
  return result;
}

function persistPassword(value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_PASSWORD_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_PASSWORD_KEY);
    }
  } catch (err) {
    console.warn('Failed to persist artifact password', err);
  }
}

function restorePassword() {
  if (typeof window === 'undefined') {
    artifactPassword.value = generateRandomPassword();
    return;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_PASSWORD_KEY);
    if (saved && /^[A-Za-z0-9]{8,64}$/.test(saved)) {
      artifactPassword.value = saved;
      return;
    }
  } catch (err) {
    console.warn('Failed to restore artifact password', err);
  }
  artifactPassword.value = generateRandomPassword();
  persistPassword(artifactPassword.value);
}

function persistEsphomeVersion(value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_VERSION_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_VERSION_KEY);
    }
  } catch (err) {
    console.warn('Failed to persist ESPHome version', err);
  }
}

function restoreEsphomeVersion() {
  if (typeof window === 'undefined') {
    selectedEsphomeVersion.value = '';
    customEsphomeVersion.value = '';
    return;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_VERSION_KEY);
    if (stored) {
      selectedEsphomeVersion.value = stored;
      if (!ESPHOME_VERSION_OPTIONS.some((option) => option.value === stored)) {
        customEsphomeVersion.value = stored;
      }
      return;
    }
  } catch (err) {
    console.warn('Failed to restore ESPHome version', err);
  }
  selectedEsphomeVersion.value = '';
  customEsphomeVersion.value = '';
}

function regenerateArtifactPassword() {
  artifactPassword.value = generateRandomPassword();
}

function openRunUrl() {
  if (!runUrl.value) return;
  const opened = window.open(runUrl.value, '_blank', 'noopener');
  if (!opened) {
    window.location.href = runUrl.value;
  }
}

function toggleSecretVisibility(name: string) {
  if (!(name in revealedSecrets)) {
    revealedSecrets[name] = false;
  }
  revealedSecrets[name] = !revealedSecrets[name];
}

function collectSecretNames(source: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const matcher = source.matchAll(/!secret\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))/g);
  for (const match of matcher) {
    const key = match[1] ?? match[2] ?? match[3] ?? '';
    const normalized = key.trim();
    if (!normalized) {
      continue;
    }
    const index = match.index ?? 0;
    const lineStart = source.lastIndexOf('\n', index);
    const prefix = source.slice((lineStart >= 0 ? lineStart + 1 : 0), index);
    if (prefix.trimStart().startsWith('#')) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function updateSecretPlaceholders(source: string) {
  const found = collectSecretNames(source);
  const nextSet = new Set(found);
  secretNames.value = found;

  Object.keys(secretValues).forEach((key) => {
    if (!nextSet.has(key)) {
      delete secretValues[key];
    }
  });

  Object.keys(revealedSecrets).forEach((key) => {
    if (!nextSet.has(key)) {
      delete revealedSecrets[key];
    }
  });

  found.forEach((name) => {
    if (!(name in secretValues)) {
      secretValues[name] = '';
    }
    if (!(name in revealedSecrets)) {
      revealedSecrets[name] = false;
    }
  });

  const saved = loadPersistedSecrets();
  found.forEach((name) => {
    if (!secretValues[name] && saved[name]) {
      secretValues[name] = saved[name];
    }
  });
  persistSecrets();
}

function loadPersistedSecrets(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_SECRETS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'string') {
        result[key] = value;
      }
    });
    return result;
  } catch (err) {
    console.warn('Failed to restore secret values', err);
    return {};
  }
}

function persistSecrets() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload: Record<string, string> = {};
    secretNames.value.forEach((name) => {
      const value = secretValues[name];
      if (typeof value === 'string' && value) {
        payload[name] = value;
      }
    });
    if (Object.keys(payload).length > 0) {
      window.localStorage.setItem(STORAGE_SECRETS_KEY, JSON.stringify(payload));
    } else {
      window.localStorage.removeItem(STORAGE_SECRETS_KEY);
    }
  } catch (err) {
    console.warn('Failed to persist secret values', err);
  }
}

function formatSecretValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function applySecretValues(source: string): string {
  if (!hasSecrets.value) {
    return source;
  }
  return source.replace(
    /!secret\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))/g,
    (match, g1, g2, g3, offset: number, input: string) => {
      const key = (g1 ?? g2 ?? g3 ?? '').trim();
      if (!key) {
        return match;
      }
      const lineStart = input.lastIndexOf('\n', offset);
      const prefix = input.slice((lineStart >= 0 ? lineStart + 1 : 0), offset);
      if (prefix.trimStart().startsWith('#')) {
        return match;
      }
      const replacement = secretValues[key];
      if (typeof replacement !== 'string') {
        return match;
      }
      const normalized = replacement.trim();
      if (!normalized) {
        return match;
      }
      return formatSecretValue(normalized);
    }
  );
}

function clearSecrets() {
  secretNames.value = [];
  Object.keys(secretValues).forEach((key) => {
    delete secretValues[key];
  });
  Object.keys(revealedSecrets).forEach((key) => {
    delete revealedSecrets[key];
  });
  persistSecrets();
}

onMounted(() => {
  restoreDraft();
  updateSecretPlaceholders(yaml.value);
  restorePassword();
  restoreEsphomeVersion();
  loadSession();
});

watch(yaml, (value) => {
  try {
    if (typeof window === 'undefined') {
      return;
    }
    if (value) {
      window.localStorage.setItem(STORAGE_DRAFT_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_DRAFT_KEY);
    }
  } catch (err) {
    console.warn('Failed to persist YAML draft', err);
  }
  updateSecretPlaceholders(value);
});

watch(artifactPassword, (value) => {
  persistPassword(value);
  if (requestId.value) {
    persistJobState();
  }
});

let syncingEsphomeVersion = false;

watch(esphomeVersionSelection, (value) => {
  if (syncingEsphomeVersion) {
    return;
  }
  syncingEsphomeVersion = true;
  if (value === '__custom__') {
    selectedEsphomeVersion.value = customEsphomeVersion.value.trim();
  } else {
    selectedEsphomeVersion.value = value;
  }
  syncingEsphomeVersion = false;
});

watch(selectedEsphomeVersion, (value) => {
  persistEsphomeVersion(value);
  if (!syncingEsphomeVersion) {
    syncingEsphomeVersion = true;
    const match = ESPHOME_VERSION_OPTIONS.find((option) => option.value === value);
    if (match) {
      esphomeVersionSelection.value = match.value;
      if (match.value !== '__custom__') {
        customEsphomeVersion.value = '';
      }
    } else if (value) {
      customEsphomeVersion.value = value;
      esphomeVersionSelection.value = '__custom__';
    } else {
      customEsphomeVersion.value = '';
      esphomeVersionSelection.value = '';
    }
    syncingEsphomeVersion = false;
  }
  if (requestId.value) {
    persistJobState();
  }
});

watch(customEsphomeVersion, (value) => {
  if (esphomeVersionSelection.value === '__custom__') {
    const trimmed = value.trim();
    if (trimmed !== selectedEsphomeVersion.value) {
      selectedEsphomeVersion.value = trimmed;
    }
  }
});

watch(
  secretValues,
  () => {
    persistSecrets();
    if (requestId.value) {
      persistJobState();
    }
  },
  { deep: true }
);

watch([isAuthenticated, shouldEncouragePersonal], ([authed, encourage]) => {
  if (encourage && authed && missingScopes.value.length === 0) {
    preferPersonalToken.value = true;
  } else if (!authed) {
    preferPersonalToken.value = false;
  }
});

watch(missingScopes, (scopes) => {
  if (scopes.length > 0) {
    preferPersonalToken.value = false;
  }
});

async function loadSession() {
  sessionLoaded.value = false;
  try {
    const { data } = await client.get<SessionPayload>('/api/session');
    session.value = data;
    serviceTokenDegraded.value = !data.serviceTokenAvailable;
    if (!data.serviceTokenAvailable && data.authenticated && (data.missingScopes?.length ?? 0) === 0) {
      preferPersonalToken.value = true;
    } else if (data.serviceTokenAvailable) {
      preferPersonalToken.value = false;
    }
  } catch (err) {
    console.error('Failed to load session', err);
    session.value = { authenticated: false };
    preferPersonalToken.value = false;
    serviceTokenDegraded.value = true;
  } finally {
    sessionLoaded.value = true;
    if (isAuthenticated.value || serviceTokenAvailable.value) {
      await restoreJobState();
    } else {
      clearJobState();
    }
    authLoading.value = false;
  }
}

function login() {
  if (authLoading.value) return;
  authLoading.value = true;
  window.location.href = '/auth/login';
}

function logout() {
  clearJobState();
  window.location.href = '/auth/logout';
}

async function handleSubmit() {
  if (!yaml.value.trim()) {
    error.value = t('compileForm.errors.invalidYaml');
    return;
  }

  const wantsPersonalToken =
    preferPersonalToken.value || !serviceTokenAvailable.value || serviceTokenDegraded.value;
  if (wantsPersonalToken) {
    if (!isAuthenticated.value) {
      error.value = t('compileForm.errors.loginRequired');
      return;
    }
    if (!canUsePersonalToken.value) {
      error.value = t('compileForm.errors.missingScopes');
      return;
    }
  } else if (!serviceTokenAvailable.value && !isAuthenticated.value) {
    error.value = t('compileForm.errors.loginRequired');
    return;
  }

  if (secretNames.value.length > 0) {
    const missing = secretNames.value.filter((name) => !(secretValues[name]?.trim()));
    if (missing.length > 0) {
      error.value = t('compileForm.errors.secretsMissing', { names: missing.join(', ') });
      return;
    }
  }

  const yamlForCompile = applySecretValues(yaml.value);

  if (yamlForCompile.length > 200_000) {
    error.value = t('compileForm.errors.yamlTooLarge');
    return;
  }

  const normalizedPassword = artifactPassword.value.trim();
  if (!normalizedPassword) {
    error.value = t('compileForm.errors.passwordRequired');
    return;
  }
  if (normalizedPassword.length < 8 || normalizedPassword.length > 64) {
    error.value = t('compileForm.errors.passwordLength');
    return;
  }
  if (!/^[A-Za-z0-9]+$/.test(normalizedPassword)) {
    error.value = t('compileForm.errors.passwordCharset');
    return;
  }
  if (normalizedPassword !== artifactPassword.value) {
    artifactPassword.value = normalizedPassword;
  }

  pending.value = true;
  error.value = null;

  try {
    const payload: {
      encodedYaml: string;
      artifactPassword: string;
      useUserToken?: boolean;
      esphomeVersion?: string;
    } = {
      encodedYaml: Base64.encode(yamlForCompile),
      artifactPassword: normalizedPassword
    };

    const versionToUse = selectedEsphomeVersion.value.trim();
    if (versionToUse) {
      payload.esphomeVersion = versionToUse;
    }

    if (wantsPersonalToken && canUsePersonalToken.value) {
      payload.useUserToken = true;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (wantsPersonalToken && canUsePersonalToken.value) {
      headers['X-GitHub-Token-Source'] = 'session';
    }

    const { data } = await client.post<{
      requestId: string;
      runId: number | null;
      htmlUrl?: string | null;
      message?: string | null;
      tokenSource?: TokenSource | null;
    }>('/api/compile', payload, {
      headers
    });

    artifact.value = null;
    artifactUrl.value = null;
    requestId.value = data.requestId;
    runId.value = data.runId;
    runUrl.value = data.htmlUrl ?? null;
    status.status = 'queued';
    status.conclusion = '';
    status.message = data.message ?? t('compileForm.status.workflowQueued');
    const resolvedSource =
      data.tokenSource ??
      (wantsPersonalToken && canUsePersonalToken.value
        ? 'session'
        : serviceTokenAvailable.value && !serviceTokenDegraded.value
        ? 'service'
        : canUsePersonalToken.value
        ? 'session'
        : null);
    lastTokenSource.value = resolvedSource;
    if (resolvedSource === 'service' && serviceTokenAvailable.value) {
      serviceTokenDegraded.value = false;
      if (!shouldEncouragePersonal.value) {
        preferPersonalToken.value = false;
      }
    } else if (resolvedSource === 'session') {
      serviceTokenDegraded.value = true;
      if (isAuthenticated.value && missingScopes.value.length === 0) {
        preferPersonalToken.value = true;
      }
    }
    persistJobState();
    startPolling();
  } catch (err) {
    console.error('Failed to trigger compilation', err);
    const payload = axios.isAxiosError(err)
      ? (err.response?.data as ApiErrorPayload | undefined)
      : undefined;
    const message = payload?.message ?? t('compileForm.errors.triggerFailed');
    applyServiceTokenDegraded(payload);
    error.value = payload?.serviceTokenDegraded ? null : message;
  } finally {
    pending.value = false;
  }
}

function startPolling() {
  clearPolling();
  pollTimer.value = window.setInterval(async () => {
    try {
      await refreshStatus();
    } catch (err) {
      console.error('Failed to refresh workflow status', err);
      const payload = axios.isAxiosError(err)
        ? (err.response?.data as ApiErrorPayload | undefined)
        : undefined;
      const message = payload?.message ?? t('compileForm.errors.statusFailed');
      applyServiceTokenDegraded(payload);
      error.value = payload?.serviceTokenDegraded ? null : message;
      clearPolling();
    }
  }, 10_000);
}

async function refreshStatus() {
  if (!requestId.value) {
    return;
  }

  const target = runId.value ? String(runId.value) : requestId.value;
    const tokenHeaders =
      (preferPersonalToken.value || serviceTokenDegraded.value) && canUsePersonalToken.value
        ? { 'X-GitHub-Token-Source': 'session' }
        : undefined;
  const { data } = await client.get<{
    runId: number;
    status: string;
    conclusion: string | null;
    htmlUrl: string | null;
    artifactUrl: string | null;
    artifact: ArtifactMeta | null;
    message: string | null;
  }>(`/api/status/${encodeURIComponent(target)}`, {
    headers: tokenHeaders
  });

  runId.value = data.runId ?? runId.value;
  runUrl.value = data.htmlUrl ?? runUrl.value;
  artifactUrl.value = data.artifactUrl ?? null;
  artifact.value = data.artifact ?? null;
  status.status = data.status ?? '';
  status.conclusion = data.conclusion ?? '';
  status.message = data.message ?? '';
  status.failedJobId = data.failedJobId ?? null;

  if (data.status === 'completed') {
    clearPolling();
    if (data.conclusion !== 'success' && data.failedJobId) {
      await fetchJobLogs(data.failedJobId);
    }
  }

  persistJobState();
}

async function downloadArtifact() {
  if (!artifactUrl.value) return;
  downloadingArtifact.value = true;

  try {
    const tokenHeaders =
      (preferPersonalToken.value || serviceTokenDegraded.value) && canUsePersonalToken.value
        ? { 'X-GitHub-Token-Source': 'session' }
        : undefined;
    const response = await client.get<ArrayBuffer>(artifactUrl.value, {
      responseType: 'arraybuffer',
      headers: tokenHeaders
    });
    const blob = new Blob([response.data], { type: 'application/zip' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${artifact.value?.name ?? 'firmware'}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
    persistJobState();
  } catch (err) {
    console.error('Failed to download artifact', err);
    const payload = axios.isAxiosError(err)
      ? (err.response?.data as ApiErrorPayload | undefined)
      : undefined;
    const message = payload?.message ?? t('compileForm.errors.downloadFailed');
    applyServiceTokenDegraded(payload);
    error.value = payload?.serviceTokenDegraded ? null : message;
  } finally {
    downloadingArtifact.value = false;
  }
}

async function fetchJobLogs(jobId: number) {
  if (loadingLogs.value) return;
  loadingLogs.value = true;
  jobLogs.value = null;

  try {
    const tokenHeaders =
      (preferPersonalToken.value || serviceTokenDegraded.value) && canUsePersonalToken.value
        ? { 'X-GitHub-Token-Source': 'session' }
        : undefined;
    const { data } = await client.get<{ errorLogs: string | null }>(
      `/api/jobs/${jobId}`,
      {
        headers: tokenHeaders
      }
    );
    jobLogs.value = data.errorLogs;
  } catch (err) {
    console.error('Failed to fetch job logs', err);
    const payload = axios.isAxiosError(err)
      ? (err.response?.data as ApiErrorPayload | undefined)
      : undefined;
    applyServiceTokenDegraded(payload);
    jobLogs.value = null;
  } finally {
    loadingLogs.value = false;
  }
}

function restoreDraft() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const draft = window.localStorage.getItem(STORAGE_DRAFT_KEY);
    if (draft) {
      yaml.value = draft;
    }
  } catch (err) {
    console.warn('Failed to restore YAML draft', err);
  }
}

async function restoreJobState() {
  if (requestId.value) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  if (!isAuthenticated.value && !serviceTokenAvailable.value) {
    clearPersistedJob();
    return;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_JOB_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as Partial<PersistedJobState> | null;
    if (!saved || !saved.requestId) {
      return;
    }

    requestId.value = saved.requestId;
    runId.value = saved.runId ?? null;
    runUrl.value = saved.runUrl ?? null;
    status.status = saved.status?.status ?? '';
    status.conclusion = saved.status?.conclusion ?? '';
    status.message = saved.status?.message ?? '';
    status.failedJobId = saved.status?.failedJobId ?? null;
    artifact.value = saved.artifact ?? null;
    lastTokenSource.value = saved.tokenSource ?? null;

    if (saved.tokenSource === 'session') {
      serviceTokenDegraded.value = true;
      if (serviceTokenAvailable.value && canUsePersonalToken.value) {
        preferPersonalToken.value = true;
      }
    } else if (saved.tokenSource === 'service' && serviceTokenAvailable.value) {
      serviceTokenDegraded.value = false;
    }

    if (saved.artifactUrl) {
      artifactUrl.value = saved.artifactUrl;
    } else if (saved.runId != null && saved.artifact) {
      artifactUrl.value = `/api/artifacts/${saved.runId}/${saved.artifact.id}`;
    } else {
      artifactUrl.value = null;
    }
    if (saved.artifactPassword) {
      artifactPassword.value = saved.artifactPassword;
    }
    if (Object.prototype.hasOwnProperty.call(saved, 'esphomeVersion')) {
      const savedVersion = saved.esphomeVersion ?? '';
      selectedEsphomeVersion.value = savedVersion;
      if (
        savedVersion &&
        !ESPHOME_VERSION_OPTIONS.some((option) => option.value === savedVersion)
      ) {
        customEsphomeVersion.value = savedVersion;
      } else if (!savedVersion) {
        customEsphomeVersion.value = '';
      }
    }

    pending.value = false;
    downloadingArtifact.value = false;
    error.value = null;

    if (status.status && status.status !== 'completed') {
      startPolling();
    } else if (status.status === 'completed' && status.conclusion !== 'success' && saved.status?.failedJobId) {
      await fetchJobLogs(saved.status.failedJobId);
    }

    persistJobState();
  } catch (err) {
    console.warn('Failed to restore job state', err);
    clearPersistedJob();
  }
}

function persistJobState() {
  if (typeof window === 'undefined') {
    return;
  }

  if (!requestId.value) {
    clearPersistedJob();
    return;
  }

  const payload: PersistedJobState = {
    requestId: requestId.value,
    runId: runId.value,
    runUrl: runUrl.value,
    status: {
      status: status.status,
      conclusion: status.conclusion,
      message: status.message
    },
    artifact: artifact.value ? { ...artifact.value } : null,
    artifactUrl: artifactUrl.value,
    artifactPassword: artifactPassword.value || null,
    tokenSource: lastTokenSource.value ?? null,
    esphomeVersion: selectedEsphomeVersion.value ? selectedEsphomeVersion.value : null
  };

  try {
    window.localStorage.setItem(STORAGE_JOB_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to persist job state', err);
  }
}

function clearPersistedJob() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_JOB_KEY);
  } catch (err) {
    console.warn('Failed to clear job cache', err);
  }
}

function clearPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

function clearJobState() {
  clearPolling();
  requestId.value = null;
  runId.value = null;
  runUrl.value = null;
  artifactUrl.value = null;
  artifact.value = null;
  status.status = '';
  status.conclusion = '';
  status.message = '';
  status.failedJobId = null;
  lastTokenSource.value = null;
  error.value = null;
  downloadingArtifact.value = false;
  pending.value = false;
  jobLogs.value = null;
  clearPersistedJob();
}

function reset() {
  clearJobState();
  yaml.value = '';
  clearSecrets();
}

onBeforeUnmount(() => {
  clearPolling();
});
</script>

<style scoped>
.panel {
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 10px 30px rgba(15, 15, 80, 0.2);
  display: grid;
  gap: 1.5rem;
}

.loading-card {
  text-align: center;
  padding: 2rem 1rem;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.form {
  display: grid;
  gap: 1.25rem;
}

.field {
  display: grid;
  gap: 0.5rem;
  font-size: 0.95rem;
  color: #e2e8f0;
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: #94a3b8;
}

.password-input {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.password-input input {
  flex: 1;
}

.password-display {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.6rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #e0f2fe;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo,
    Monaco, Consolas, monospace;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
}

input:not([type='checkbox']) {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.9);
  padding: 0 0.75rem;
  color: #f8fafc;
}

input:not([type='checkbox']):focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

select {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.9);
  padding: 0 0.75rem;
  color: #f8fafc;
}

select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.primary-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.auth-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.auth-user {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}

.auth-user img,
.avatar-fallback {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(148, 163, 184, 0.4);
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
  font-weight: 600;
}

button {
  padding: 0.7rem 1.6rem;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #2563eb, #38bdf8);
  color: #0f172a;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.25);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button.loading {
  position: relative;
  padding-right: 2.75rem;
}

button.loading::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 1rem;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 50%;
  border: 2px solid rgba(226, 232, 240, 0.8);
  border-top-color: transparent;
  animation: spin 0.8s linear infinite;
}

.ghost.loading {
  padding-right: 2.4rem;
}

.ghost.mini.loading {
  padding-right: 2rem;
}

.ghost.loading::after {
  border-color: rgba(148, 163, 184, 0.9);
  border-top-color: transparent;
}

.ghost.mini.loading::after {
  right: 0.75rem;
  width: 14px;
  height: 14px;
  margin-top: -7px;
}

.ghost {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.4);
  color: #e2e8f0;
}

.ghost.mini {
  padding: 0.35rem 1rem;
  font-size: 0.82rem;
  border-radius: 999px;
}

.personal-hint {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  color: #fef08a;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.status {
  margin: 0;
  font-size: 0.9rem;
}

.status.error {
  color: #fda4af;
}

.status.info {
  color: #bae6fd;
}

.status.warning {
  color: #fef08a;
}

.status-card .status + .status {
  margin-top: 0.35rem;
}

.status-card {
  background: rgba(30, 41, 59, 0.65);
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.status-card h2 {
  margin-top: 0;
}

.status-card p {
  margin: 0.4rem 0;
}

.status-card p:first-of-type {
  margin-top: 0.15rem;
}

.status-card p:last-of-type {
  margin-bottom: 0;
}

.status-card strong {
  margin-right: 0.5rem;
}

.secrets-panel {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.6);
}

.secrets-panel h3 {
  margin: 0;
  font-size: 1rem;
  color: #e2e8f0;
}

.secrets-panel code {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, monospace;
  font-size: 0.85rem;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 6px;
  padding: 0.05rem 0.4rem;
}

.secret-item + .secret-item {
  margin-top: 0.25rem;
}

.link-button {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.link-button:focus-visible {
  outline: 2px solid rgba(56, 189, 248, 0.9);
  outline-offset: 2px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.75rem;
}

.badge-spinner {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: spin 0.9s linear infinite;
}

.badge.default {
  background: rgba(148, 163, 184, 0.2);
  color: #cbd5f5;
}

.badge.progress {
  background: rgba(56, 189, 248, 0.2);
  color: #bae6fd;
}

.badge.queued {
  background: rgba(253, 224, 71, 0.2);
  color: #facc15;
}

.badge.in-progress {
  background: rgba(129, 140, 248, 0.25);
  color: #c7d2fe;
}

.badge.success {
  background: rgba(74, 222, 128, 0.2);
  color: #bbf7d0;
}

.badge.error {
  background: rgba(248, 113, 113, 0.2);
  color: #fecaca;
}

.error-logs {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.error-logs h3 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  color: #fecaca;
}

.error-logs .loading-text {
  margin: 0;
  color: #94a3b8;
  font-size: 0.9rem;
}

.log-content {
  margin: 0;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  color: #f1f5f9;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  max-height: 400px;
  overflow-y: auto;
}

.log-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.log-content::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 4px;
}

.log-content::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.5);
  border-radius: 4px;
}

.log-content::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.7);
}
</style>
