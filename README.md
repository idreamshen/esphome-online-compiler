# ESPHome 在线编译平台
在浏览器中粘贴 ESPHome YAML 即可完成云端编译并下载固件

## 功能亮点

- ✅ 自动识别并按出现顺序收集 `!secret`，支持填写后缓存本地，下次继续编译无需重复输入。
- ✅ 生成 16 位字母数字压缩包密码，可自定义并在本地持久化；上传的固件 Artifact 为加密压缩包，命名格式 `firmware-<request_id>-password.zip`。
- ✅ YAML 草稿、压缩包密码、ESPHome 版本选择及最近编译状态都会自动保存，刷新页面即可恢复。
- ✅ 支持在表单中选择常用 ESPHome 版本或手动输入具体版本号进行历史版本编译。
- ✅ 失败时保留 GitHub Workflow 链接，一键跳转查看完整日志。

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
   - `GITHUB_SERVICE_TOKEN`（可选，平台默认使用的 Fine-grained PAT，建议仅勾选 `workflow` 与 `public_repo` 权限）

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

1. （可选）点击 “GitHub 登录” 跳转授权页，授予 `workflow` + `public_repo`（或 `repo`）权限；未登录时平台会使用 `GITHUB_SERVICE_TOKEN` 触发 Workflow。
2. 回到页面后粘贴 ESPHome YAML。
3. 如 YAML 中包含 `!secret`，系统会自动检测并生成输入框，支持自动补全 `"` 包裹的值与本地缓存；可在提交前确认字段。
4. 若无自定义压缩包密码，界面会生成 16 位字母数字组合并展示，后续解压 Artifact 时需使用该密码。
5. 提交后，前端将 YAML Base64 编码，通过 Pages Functions 触发 `workflow_dispatch`（默认优先使用平台 Token，若失败会回退到已登录用户的 Token）。
6. 前端轮询 Workflow 状态，完成后显示固件下载按钮，直接下载加密包 `firmware-<request_id>-password.zip`。
7. 需要切换账号时可点击 “退出登录” 清除会话。

> 页面刷新不会丢失 YAML 草稿与正在进行的编译，请求会自动恢复并继续轮询状态。

## GitHub Actions Workflow

- 解码 YAML 到 `config.yaml`。
- 根据前端传入的版本号安装对应的 ESPHome（默认为最新稳定版）并执行 `esphome compile config.yaml`。
- 将所有生成的固件 `*.bin`（以及 manifest）与 `config.yaml` 加密打包为 `firmware-<request_id>-password.zip`，上传到 `artifact/` 目录；Artifact 保留 1 天。
- 运行名称包含 `request_id`，Pages Functions 据此匹配 Workflow Run。

## 安全注意事项

- OAuth Access Token 以签名后的 HttpOnly Cookie 存储，仅 Pages Functions 可访问；部署到生产时会自动启用 `Secure`。
- 切勿将真实密钥写入仓库；线上变量通过 Cloudflare 控制台配置，开发时使用 `.dev.vars`（已加入 `.gitignore`）。
- 如需撤销授权，可在 GitHub → Settings → Applications 中移除对应 OAuth App。
- 使用 `GITHUB_REQUIRE_PRIVATE_REPO=true` 时，授权范围会扩大到 `repo`，请确保仅在必要场景启用。
- `GITHUB_SERVICE_TOKEN` 建议使用 Fine-grained PAT 并保存为 Pages Secret；GitHub 对单 Token 的 API 配额为每小时 5000 次，必要时可提示用户登录并切换为个人授权。

