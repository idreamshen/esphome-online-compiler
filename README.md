# ESPHome 在线编译平台

Vue 3 前端 + Cloudflare Pages Functions + GitHub Actions：用户完成 GitHub OAuth 授权后，在浏览器中粘贴 ESPHome YAML 即可触发 Workflow 编译并下载固件，无需手动填写 Personal Access Token。

## 目录结构

- `frontend/`：Vite + Vue 3 单页应用，负责 OAuth 登录、YAML 输入、状态轮询与固件下载
- `functions/`：Cloudflare Pages Functions（`[[path]].ts`）实现 OAuth 流程、会话管理以及对 GitHub Actions API 的代理
- `.github/workflows/esphome-compile.yml`：实际执行编译的 GitHub Actions Workflow
- `.dev.vars.example`：本地开发时可复制为 `.dev.vars`，内含所需环境变量示例

## 准备 GitHub OAuth App

1. 访问 [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) 创建新的 OAuth App。
2. Homepage / Callback URL 建议设置为将来 Cloudflare Pages 的域名，例如：
   - Homepage：`https://your-project.pages.dev/`
   - Authorization callback URL：`https://your-project.pages.dev/auth/callback`
3. 记录 `Client ID`，并点击 “Generate a new client secret” 保存 `Client Secret`。
4. Pages Functions 会请求 `workflow` 与 `public_repo`（或 `repo`）权限，以便触发公开/私有仓库的 `workflow_dispatch`。

## Cloudflare Pages 配置

1. 在 Cloudflare 控制台创建 Pages 项目（连接 Git 仓库或手动上传）。
2. 构建设置示例：
   - Build Command：`npm install && npm run build --prefix frontend`
   - Build Output Directory：`frontend/dist`
   - Functions Directory：`functions`
3. 在 **Pages → Settings → Variables (Production & Preview)** 中添加：
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET`（随机 32+ 字节字符串，例如 `openssl rand -base64 32`）
   - `GITHUB_OAUTH_REDIRECT_URI`（与 OAuth App callback 保持一致；生产填 Pages 域名的 `/auth/callback`，开发时可用 `http://localhost:5173/auth/callback`，确保域名一致）
   - `GITHUB_REPO_OWNER`
   - `GITHUB_REPO_NAME`
   - `GITHUB_WORKFLOW_ID`（如 `esphome-compile.yml`）
   - `GITHUB_WORKFLOW_REF`（默认 `main`）
   - `FRONTEND_URL`（授权结束后的跳转地址，生产时建议写 Pages 域名）
   - `ALLOWED_ORIGINS`（逗号分隔的允许跨域来源；至少包含 Pages 域名，开发时可加 `http://localhost:5173`）
   - `GITHUB_REQUIRE_PRIVATE_REPO`（默认留空/false，仅在需要访问私有仓库时设为 `true` 以请求 `repo` scope）

> 注：Cloudflare Pages 会为 Production 和 Preview 分别保存变量，可使用不同的 OAuth App 区分环境。

## 本地开发

1. 安装并运行前端：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. 在仓库根目录复制 `.dev.vars.example` 为 `.dev.vars`，填入 Dev OAuth App 的配置。
3. 启动 Pages Functions 本地环境（需要安装 `wrangler`）：
   ```bash
  # 在仓库根目录
  wrangler pages dev frontend/dist --local --port 8787
   ```
   如果 `frontend/dist` 尚未存在，可先执行一次 `npm run build --prefix frontend`。
4. 浏览器访问 `http://localhost:5173`；Vite 会通过代理把 `/auth/*`、`/api/*` 请求转发到 `http://127.0.0.1:8787`。

## 使用步骤

1. 点击 “GitHub 登录” 跳转授权页，授予 `workflow` + `public_repo`（或 `repo`）权限。
2. 回到页面后粘贴 ESPHome YAML。
3. 提交后，前端将 YAML Base64 编码，通过 Pages Functions 触发 `workflow_dispatch`。
4. 前端轮询 Workflow 状态，完成后显示固件下载按钮。
5. 需要切换账号时可点击 “退出登录” 清除会话。

## GitHub Actions Workflow

- 解码 YAML 到 `config.yaml`。
- 安装最新 ESPHome 并执行 `esphome compile config.yaml`。
- 将所有生成的固件 `*.bin`（以及 manifest）与 `config.yaml` 打包到 `artifact/`，上传为 `firmware-<request_id>` Artifact（保留 14 天）。
- 运行名称包含 `request_id`，Pages Functions 据此匹配 Workflow Run。

## 安全注意事项

- OAuth Access Token 以签名后的 HttpOnly Cookie 存储，仅 Pages Functions 可访问；部署到生产时会自动启用 `Secure`。
- 切勿将真实密钥写入仓库；线上变量通过 Cloudflare 控制台配置，开发时使用 `.dev.vars`（已加入 `.gitignore`）。
- 如需撤销授权，可在 GitHub → Settings → Applications 中移除对应 OAuth App。
- 使用 `GITHUB_REQUIRE_PRIVATE_REPO=true` 时，授权范围会扩大到 `repo`，请确保仅在必要场景启用。

## 可选增强

- 集成 Monaco / CodeMirror 提供 YAML 高亮与校验。
- 提供常见板型模板、示例库。
- 展示更多运行历史记录、支持多产物选择。
- 针对长耗时编译增加进度提示或通知渠道。
