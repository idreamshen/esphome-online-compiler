<template>
  <section class="panel">
    <section class="config">
      <h2>GitHub 设置</h2>
      <p class="hint">
        需要使用拥有 `repo` 与 `workflow` 权限的
        <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
          Personal Access Token
        </a>
        （不会离开浏览器）。
      </p>
      <div class="config-grid">
        <label class="field">
          <span>GitHub Token</span>
          <input
            v-model="githubToken"
            :type="showToken ? 'text' : 'password'"
            placeholder="ghp_xxx"
            required
          />
        </label>
        <label class="field">
          <span>Token 可见</span>
          <label class="toggle">
            <input v-model="showToken" type="checkbox" />
            <span>显示令牌</span>
          </label>
        </label>
        <label class="field">
          <span>仓库拥有者</span>
          <input v-model="repoOwner" placeholder="your-github" />
        </label>
        <label class="field">
          <span>仓库名</span>
          <input v-model="repoName" placeholder="esphome-online-compiler" />
        </label>
        <label class="field">
          <span>Workflow 文件名或 ID</span>
          <input v-model="workflowId" placeholder="esphome-compile.yml" />
        </label>
        <label class="field">
          <span>触发分支</span>
          <input v-model="workflowRef" placeholder="main" />
        </label>
      </div>
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

      <div class="settings">
        <label class="field">
          <span>设备标识（可选）</span>
          <input v-model="deviceName" placeholder="mydevice" maxlength="40" />
        </label>
        <label class="field">
          <span>板子类型（可选）</span>
          <input v-model="board" placeholder="esp32dev" maxlength="40" />
        </label>
      </div>

      <div class="actions">
        <button :disabled="pending" type="submit">
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
      <p v-if="artifact">
        <strong>固件产物：</strong>
        <button :disabled="downloadingArtifact" class="ghost" type="button" @click="downloadArtifact">
          {{ downloadingArtifact ? '下载中...' : `下载 ${artifact.name}.zip` }}
        </button>
      </p>
      <p v-if="statusMessage" class="status info">{{ statusMessage }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import axios from 'axios';
import { Base64 } from 'js-base64';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

type WorkflowStatus = {
  status: string;
  conclusion: string;
  message: string;
};

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  name?: string | null;
  head_commit?: {
    message?: string;
  } | null;
};

type WorkflowArtifact = {
  id: number;
  name: string;
  archive_download_url: string;
  expired: boolean;
};

const STORAGE_KEY = 'esphome-online-compiler-settings';

const yaml = ref('');
const deviceName = ref('');
const board = ref('');
const githubToken = ref('');
const showToken = ref(false);
const repoOwner = ref('');
const repoName = ref('');
const workflowId = ref('esphome-compile.yml');
const workflowRef = ref('main');

const runId = ref<number | null>(null);
const requestId = ref<string | null>(null);
const runUrl = ref<string | null>(null);
const artifact = ref<WorkflowArtifact | null>(null);
const pending = ref(false);
const downloadingArtifact = ref(false);
const error = ref<string | null>(null);
const pollTimer = ref<number | null>(null);

const status = reactive<WorkflowStatus>({
  status: '',
  conclusion: '',
  message: ''
});

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

const apiHeaders = computed(() => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const token = githubToken.value.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
});

onMounted(() => {
  try {
    const storedRaw = window.localStorage.getItem(STORAGE_KEY);
    if (storedRaw) {
      const stored = JSON.parse(storedRaw) as {
        repoOwner?: string;
        repoName?: string;
        workflowId?: string;
        workflowRef?: string;
      };
      repoOwner.value = stored.repoOwner ?? '';
      repoName.value = stored.repoName ?? '';
      workflowId.value = stored.workflowId ?? 'esphome-compile.yml';
      workflowRef.value = stored.workflowRef ?? 'main';
    }
  } catch (err) {
    console.warn('Failed to load stored settings', err);
  }
});

watch([repoOwner, repoName, workflowId, workflowRef], () => {
  const payload = {
    repoOwner: repoOwner.value,
    repoName: repoName.value,
    workflowId: workflowId.value,
    workflowRef: workflowRef.value
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
});

async function handleSubmit() {
  if (!yaml.value.trim()) {
    error.value = '请输入有效的 YAML 内容';
    return;
  }

  if (yaml.value.length > 200_000) {
    error.value = 'YAML 太大，请控制在 200KB 内';
    return;
  }

  if (!githubToken.value.trim()) {
    error.value = '请提供 GitHub Token';
    return;
  }

  if (!repoOwner.value.trim() || !repoName.value.trim() || !workflowId.value.trim()) {
    error.value = '请完整填写仓库信息与 workflow 标识';
    return;
  }

  pending.value = true;
  error.value = null;
  artifact.value = null;
  requestId.value = window.crypto.randomUUID();
  status.status = 'queued';
  status.conclusion = '';
  status.message = 'Workflow 已触发，等待运行...';

  try {
    const payload = {
      ref: workflowRef.value.trim() || 'main',
      inputs: {
        encoded_yaml: Base64.encode(yaml.value),
        request_id: requestId.value,
        ...(deviceName.value ? { device_name: deviceName.value } : {}),
        ...(board.value ? { board: board.value } : {})
      }
    };

    await axios.post(
      `https://api.github.com/repos/${repoOwner.value}/${repoName.value}/actions/workflows/${workflowId.value}/dispatches`,
      payload,
      {
        headers: apiHeaders.value
      }
    );

    runId.value = null;
    runUrl.value = null;
    startPolling();
  } catch (err) {
    console.error(err);
    error.value =
      axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : '触发编译失败，请稍后再试';
    requestId.value = null;
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
  }, 5000);
}

async function refreshStatus() {
  if (!requestId.value) {
    return;
  }

  if (!runId.value) {
    const run = await findRunByRequestId(requestId.value);
    if (!run) {
      status.message = 'Workflow 正在初始化...';
      return;
    }
    runId.value = run.id;
    runUrl.value = run.html_url;
  }

  if (!runId.value) return;

  const { data: runData } = await axios.get<WorkflowRun>(
    `https://api.github.com/repos/${repoOwner.value}/${repoName.value}/actions/runs/${runId.value}`,
    { headers: apiHeaders.value }
  );

  status.status = runData.status ?? '';
  status.conclusion = runData.conclusion ?? '';
  status.message = runData.name ?? runData.head_commit?.message ?? '';
  runUrl.value = runData.html_url ?? runUrl.value;

  const { data: artifactData } = await axios.get<{ artifacts: WorkflowArtifact[] }>(
    `https://api.github.com/repos/${repoOwner.value}/${repoName.value}/actions/runs/${runId.value}/artifacts`,
    { headers: apiHeaders.value }
  );

  artifact.value =
    artifactData.artifacts.find((item) => !item.expired) ?? artifact.value ?? null;

  if (status.status === 'completed') {
    clearPolling();
  }
}

async function findRunByRequestId(reqId: string) {
  const { data } = await axios.get<{ workflow_runs: WorkflowRun[] }>(
    `https://api.github.com/repos/${repoOwner.value}/${repoName.value}/actions/workflows/${workflowId.value}/runs`,
    {
      headers: apiHeaders.value,
      params: {
        event: 'workflow_dispatch',
        per_page: 25
      }
    }
  );

  return data.workflow_runs.find((run) => run.name?.includes(reqId));
}

async function downloadArtifact() {
  if (!artifact.value) return;
  downloadingArtifact.value = true;

  try {
    const response = await axios.get<ArrayBuffer>(artifact.value.archive_download_url, {
      headers: apiHeaders.value,
      responseType: 'arraybuffer'
    });
    const blob = new Blob([response.data], { type: 'application/zip' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${artifact.value.name}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('下载产物失败', err);
    error.value = '下载固件失败，请检查 Token 权限或稍后重试';
  } finally {
    downloadingArtifact.value = false;
  }
}

function clearPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

function reset() {
  yaml.value = '';
  deviceName.value = '';
  board.value = '';
  runId.value = null;
  requestId.value = null;
  runUrl.value = null;
  artifact.value = null;
  status.status = '';
  status.conclusion = '';
  status.message = '';
  error.value = null;
  downloadingArtifact.value = false;
  clearPolling();
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

.config {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

.config h2 {
  margin: 0 0 0.5rem;
}

.hint {
  margin: 0 0 1rem;
  color: #cbd5f5;
  font-size: 0.85rem;
}

.hint a {
  color: #38bdf8;
}

.config-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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

.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #cbd5f5;
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

.settings {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
</style>
