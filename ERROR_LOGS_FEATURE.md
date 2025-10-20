# 错误日志展示功能

## 功能描述

当 GitHub Actions 编译失败时，前端页面会自动展示错误日志，帮助用户快速定位问题。

## 实现逻辑

### 后端 (functions/[[path]].ts)

1. **修改 handleStatus 函数**：当 workflow 运行完成且结论不是 success 时，查找失败的 job ID
2. **新增 handleJobLogs 函数**：接收 job ID，获取完整的 job logs
3. **新增 extractErrorContext 函数**：
   - 搜索日志中包含 "error" 的行（忽略大小写）
   - 提取 error 附近的上下 10 行内容
   - 合并重叠的上下文区域，用 "..." 分隔不连续的部分
   - 返回提取的错误日志

### 前端 (frontend/src/components/CompileForm.vue)

1. **新增状态**：
   - `jobLogs`: 存储错误日志内容
   - `loadingLogs`: 标记正在加载日志
   - `status.failedJobId`: 存储失败的 job ID

2. **新增 fetchJobLogs 函数**：
   - 调用 `/api/jobs/{jobId}` 获取错误日志
   - 支持 token source 选择（service/session）

3. **自动加载错误日志**：
   - 在 `refreshStatus` 中，当状态变为 completed 且失败时自动获取日志
   - 在 `restoreJobState` 中，恢复已完成且失败的任务时也会加载日志

4. **UI 展示**：
   - 在状态卡片底部显示错误日志区块
   - 使用 `<pre>` 标签展示日志，保持格式
   - 添加滚动条支持，最大高度 400px
   - 深色主题，红色边框突出显示

### 国际化 (frontend/src/i18n.ts)

添加了两个新的翻译 key：
- `compileForm.status.errorLogs`: 错误日志标题
- `compileForm.status.loadingLogs`: 加载中提示

## API 端点

### GET /api/jobs/{jobId}

获取指定 job 的错误日志。

**请求参数**：
- `jobId`: GitHub Actions job ID (路径参数)

**请求头**（可选）：
- `X-GitHub-Token-Source`: 指定 token 来源 (`service` 或 `session`)

**响应**：
```json
{
  "errorLogs": "包含 error 及其上下文的日志内容，如果没有找到错误则为 null"
}
```

**错误响应**：
- 400: 无效的 job ID
- 401: 缺少 GitHub 凭据
- 其他: GitHub API 错误

## 工作流程

1. 用户提交编译 → 前端触发 GitHub Actions workflow
2. Workflow 运行失败 → 后端在 status API 中返回 `failedJobId`
3. 前端检测到失败 → 自动调用 `/api/jobs/{failedJobId}` 获取日志
4. 后端提取错误上下文 → 返回包含 "error" 及其上下 10 行的内容
5. 前端展示日志 → 用户可以看到具体的错误信息

## 测试建议

1. **提交一个会失败的 YAML**：例如包含语法错误的配置
2. **观察状态更新**：确认状态变为 "Failed" 后出现错误日志区块
3. **检查日志内容**：验证显示的日志包含实际的错误信息
4. **刷新页面**：验证错误日志能够从 localStorage 正确恢复
5. **多次失败**：验证多个错误都能正确提取和展示

## 技术细节

### 日志提取算法

```typescript
function extractErrorContext(logs: string): string[] {
  const lines = logs.split('\n');
  const errorIndices: number[] = [];
  
  // 1. 找到所有包含 "error" 的行索引
  for (let i = 0; i < lines.length; i++) {
    if (/error/i.test(lines[i])) {
      errorIndices.push(i);
    }
  }

  // 2. 为每个错误行提取上下 10 行
  const contextLines = new Set<number>();
  for (const errorIndex of errorIndices) {
    const start = Math.max(0, errorIndex - 10);
    const end = Math.min(lines.length - 1, errorIndex + 10);
    for (let i = start; i <= end; i++) {
      contextLines.add(i);
    }
  }

  // 3. 合并连续的行，用 "..." 分隔不连续的部分
  const sortedIndices = Array.from(contextLines).sort((a, b) => a - b);
  const result: string[] = [];
  let lastIndex = -2;
  
  for (const index of sortedIndices) {
    if (index > lastIndex + 1) {
      if (result.length > 0) {
        result.push('...');
      }
    }
    result.push(lines[index]);
    lastIndex = index;
  }

  return result;
}
```

### 样式特点

- 深色背景 + 红色边框，突出错误
- 等宽字体 (monospace)，保持日志格式
- 自定义滚动条样式
- 响应式设计
