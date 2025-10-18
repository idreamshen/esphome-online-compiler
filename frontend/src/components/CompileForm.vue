<template>
  <section class="panel">
    <section v-if="!sessionLoaded" class="loading-card">
      <p>正在加载会话...</p>
    </section>

    <template v-else>
      <section v-if="isAuthenticated" class="user-card">
        <div class="user-meta">
          <img v-if="user?.avatarUrl" :src="user.avatarUrl" alt="avatar" />
          <div>
            <p class="user-name">
              <a :href="user?.htmlUrl || '#'" target="_blank" rel="noreferrer">{{ user?.login }}</a>
              <span v-if="user?.name">（{{ user.name }}）</span>
            </p>
            <p class="repo-info">
              目标仓库：
              <strong>{{ repo?.owner }} / {{ repo?.name }}</strong>
              <span> Workflow：{{ repo?.workflowId }} · 分支：{{ repo?.ref }}</span>
            </p>
          </div>
        </div>
        <div class="user-actions">
          <button class="ghost" type="button" @click="logout">退出登录</button>
        </div>
      </section>

      <section v-else class="auth-banner">
        <h2>GitHub 授权</h2>
        <p>
          点击下方按钮跳转至 GitHub 完成授权（仅请求 `public_repo`/`repo` 与 `workflow` 权限），即可在本页面提交编译。
        </p>
        <button type="button" @click="login">GitHub 登录</button>
        <p class="status info">登录后即可触发编译并下载固件。</p>
      </section>

      <section v-if="isAuthenticated && missingScopes.length > 0" class="status warning">
        当前授权缺少以下 scope：{{ missingScopes.join(', ') }}，请退出后重新授权。
      </section>

      <form class="form" @submit.prevent="handleSubmit">
        <label class="field">
          <span>ESPHome YAML</span>
          <textarea
            v-model="yaml"
            placeholder="esphome:\n  name: mydevice\n..."
            required
            rows="18"
          />
        </label>

        <div class="actions">
          <button :disabled="pending || !canSubmit" type="submit">
            {{ pending ? '正在提交...' : '提交编译' }}
          </button>
          <button
            :disabled="pending || (!runId && !requestId)"
            class="ghost"
            type="button"
            @click="reset"
          >
            重置
          </button>
        </div>
        <p v-if="!isAuthenticated" class="status info">请先登录 GitHub 后再提交编译。</p>
        <p v-if="error" class="status error">{{ error }}</p>
      </form>

      <section v-if="requestId" class="status-card">
        <h2>编译状态</h2>
        <p><strong>请求 ID：</strong> {{ requestId }}</p>
        <p v-if="runId"><strong>Workflow Run ID：</strong> {{ runId }}</p>
        <p>
          <strong>当前状态：</strong>
          <span :class="['badge', statusClass]">{{ displayStatus }}</span>
        </p>
        <p v-if="runUrl">
          <strong>GitHub Workflow：</strong>
          <a :href="runUrl" target="_blank" rel="noreferrer">打开</a>
        </p>
        <p v-if="artifact && artifactUrl">
          <strong>固件产物：</strong>
          <button
            :disabled="downloadingArtifact"
            class="ghost"
            type="button"
            @click="downloadArtifact"
          >
            {{ downloadingArtifact ? '下载中...' : `下载 ${artifact.name}.zip` }}
          </button>
        </p>
        <p v-if="statusMessage" class="status info">{{ statusMessage }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import axios from 'axios';
import { Base64 } from 'js-base64';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

type SessionPayload = {
  authenticated: boolean;
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
};

const STORAGE_DRAFT_KEY = 'esphome-online-compiler:yaml-draft';
const STORAGE_JOB_KEY = 'esphome-online-compiler:job-state';

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
const pending = ref(false);
const downloadingArtifact = ref(false);
const error = ref<string | null>(null);
const pollTimer = ref<number | null>(null);

const status = reactive<WorkflowStatus>({
  status: '',
  conclusion: '',
  message: ''
});

const isAuthenticated = computed(() => Boolean(session.value?.authenticated));
const user = computed(() => session.value?.user ?? null);
const repo = computed(() => session.value?.repo ?? null);
const missingScopes = computed(() => session.value?.missingScopes ?? []);
const canSubmit = computed(() => isAuthenticated.value && missingScopes.value.length === 0);

const displayStatus = computed(() => {
  if (!status.status) return '尚未开始';
  if (status.status === 'completed') {
    return status.conclusion === 'success' ? '完成' : status.conclusion || '完成';
  }
  if (status.status === 'in_progress') return '运行中';
  if (status.status === 'queued') return '排队中';
  return status.status;
});

const statusClass = computed(() => {
  if (!status.status) return 'default';
  if (status.status === 'completed') {
    return status.conclusion === 'success' ? 'success' : 'error';
  }
  return 'progress';
});

const statusMessage = computed(() => status.message || '');

onMounted(() => {
  restoreDraft();
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
    console.warn('保存 YAML 草稿失败', err);
  }
});

async function loadSession() {
  sessionLoaded.value = false;
  try {
    const { data } = await client.get<SessionPayload>('/api/session');
    session.value = data;
  } catch (err) {
    console.error('加载 session 失败', err);
    session.value = { authenticated: false };
  } finally {
    sessionLoaded.value = true;
    if (session.value?.authenticated) {
      restoreJobState();
    } else {
      clearJobState();
    }
  }
}

function login() {
  window.location.href = '/auth/login';
}

function logout() {
  clearJobState();
  window.location.href = '/auth/logout';
}

async function handleSubmit() {
  if (!isAuthenticated.value) {
    error.value = '请先登录 GitHub 后再提交编译';
    return;
  }

  if (!yaml.value.trim()) {
    error.value = '请输入有效的 YAML 内容';
    return;
  }

  if (yaml.value.length > 200_000) {
    error.value = 'YAML 太大，请控制在 200KB 内';
    return;
  }

  if (missingScopes.value.length > 0) {
    error.value = '当前授权缺少必要的 GitHub 权限，请重新授权';
    return;
  }

  pending.value = true;
  error.value = null;

  try {
    const payload = {
      encodedYaml: Base64.encode(yaml.value)
    };

    const { data } = await client.post<{
      requestId: string;
      runId: number | null;
      htmlUrl?: string | null;
      message?: string | null;
    }>('/api/compile', payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    artifact.value = null;
    artifactUrl.value = null;
    requestId.value = data.requestId;
    runId.value = data.runId;
    runUrl.value = data.htmlUrl ?? null;
    status.status = 'queued';
    status.conclusion = '';
    status.message = data.message ?? 'Workflow 已触发，等待运行...';
    persistJobState();
    startPolling();
  } catch (err) {
    console.error('触发编译失败', err);
    error.value =
      axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : '触发编译失败，请稍后再试';
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
      console.error('刷新状态失败', err);
      error.value =
        axios.isAxiosError(err) && err.response?.data?.message
          ? err.response.data.message
          : '获取状态失败';
      clearPolling();
    }
  }, 10_000);
}

async function refreshStatus() {
  if (!requestId.value) {
    return;
  }

  const target = runId.value ? String(runId.value) : requestId.value;
  const { data } = await client.get<{
    runId: number;
    status: string;
    conclusion: string | null;
    htmlUrl: string | null;
    artifactUrl: string | null;
    artifact: ArtifactMeta | null;
    message: string | null;
  }>(`/api/status/${encodeURIComponent(target)}`);

  runId.value = data.runId ?? runId.value;
  runUrl.value = data.htmlUrl ?? runUrl.value;
  artifactUrl.value = data.artifactUrl ?? null;
  artifact.value = data.artifact ?? null;
  status.status = data.status ?? '';
  status.conclusion = data.conclusion ?? '';
  status.message = data.message ?? '';

  if (data.status === 'completed') {
    clearPolling();
  }

  persistJobState();
}

async function downloadArtifact() {
  if (!artifactUrl.value) return;
  downloadingArtifact.value = true;

  try {
    const response = await client.get<ArrayBuffer>(artifactUrl.value, {
      responseType: 'arraybuffer'
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
    console.error('下载产物失败', err);
    error.value =
      axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : '下载固件失败，请检查权限或稍后重试';
  } finally {
    downloadingArtifact.value = false;
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
    console.warn('恢复 YAML 草稿失败', err);
  }
}

function restoreJobState() {
  if (requestId.value) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  if (!session.value?.authenticated) {
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
    artifact.value = saved.artifact ?? null;

    if (saved.artifactUrl) {
      artifactUrl.value = saved.artifactUrl;
    } else if (saved.runId != null && saved.artifact) {
      artifactUrl.value = `/api/artifacts/${saved.runId}/${saved.artifact.id}`;
    } else {
      artifactUrl.value = null;
    }

    pending.value = false;
    downloadingArtifact.value = false;
    error.value = null;

    if (status.status && status.status !== 'completed') {
      startPolling();
    }

    persistJobState();
  } catch (err) {
    console.warn('恢复任务状态失败', err);
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
    artifactUrl: artifactUrl.value
  };

  try {
    window.localStorage.setItem(STORAGE_JOB_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('保存任务状态失败', err);
  }
}

function clearPersistedJob() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_JOB_KEY);
  } catch (err) {
    console.warn('清理任务缓存失败', err);
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
  error.value = null;
  downloadingArtifact.value = false;
  pending.value = false;
  clearPersistedJob();
}

function reset() {
  clearJobState();
  yaml.value = '';
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

.loading-card,
.auth-banner {
  text-align: center;
  padding: 2rem 1rem;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.auth-banner h2 {
  margin-top: 0;
}

.user-card {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  padding: 1rem;
  flex-wrap: wrap;
}

.user-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-meta img {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid rgba(148, 163, 184, 0.3);
}

.user-name {
  margin: 0;
  font-weight: 600;
}

.user-name a {
  color: #f8fafc;
  text-decoration: none;
}

.user-name a:hover {
  text-decoration: underline;
}

.repo-info {
  margin: 0.1rem 0 0;
  color: #cbd5f5;
  font-size: 0.9rem;
}

.user-actions {
  display: flex;
  gap: 0.5rem;
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

textarea {
  resize: vertical;
  min-height: 320px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 12px;
  padding: 0.75rem;
  color: #f8fafc;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo,
    Monaco, Consolas, monospace;
  font-size: 0.9rem;
  line-height: 1.45;
}

textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

input {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.9);
  padding: 0 0.75rem;
  color: #f8fafc;
}

input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-start;
  flex-wrap: wrap;
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

.ghost {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.4);
  color: #e2e8f0;
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

.status-card {
  background: rgba(30, 41, 59, 0.65);
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.status-card h2 {
  margin-top: 0;
}

.badge {
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.75rem;
}

.badge.default {
  background: rgba(148, 163, 184, 0.2);
  color: #cbd5f5;
}

.badge.progress {
  background: rgba(56, 189, 248, 0.2);
  color: #bae6fd;
}

.badge.success {
  background: rgba(74, 222, 128, 0.2);
  color: #bbf7d0;
}

.badge.error {
  background: rgba(248, 113, 113, 0.2);
  color: #fecaca;
}
</style>
