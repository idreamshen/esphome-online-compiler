# ESPHome Online Compiler

Paste your ESPHome YAML in the browser to compile in the cloud and download firmware.

## Features

- ✅ Automatically detects and collects `!secret` placeholders in order of appearance, with local caching to avoid re-entering values on subsequent compilations.
- ✅ Generates a 16-character alphanumeric archive password, customizable and locally persisted; firmware artifacts are encrypted zip files named `firmware-<request_id>-password.zip`.
- ✅ Automatically saves YAML drafts, archive passwords, ESPHome version selection, and recent compilation status; recovers on page refresh.
- ✅ Supports selecting common ESPHome versions from a dropdown or manually entering a specific version number for historical builds.
- ✅ Retains GitHub Workflow link on failure for one-click access to full logs.

## Project Structure

- `frontend/`: Vite + Vue 3 SPA handling OAuth login, YAML input, status polling, and firmware downloads
- `functions/`: Cloudflare Pages Functions (`[[path]].ts`) implementing OAuth flow, session management, and GitHub Actions API proxy
- `.github/workflows/esphome-compile.yml`: GitHub Actions Workflow that performs the actual compilation
- `.dev.vars.example`: Example environment variables for local development; copy to `.dev.vars`

## GitHub OAuth App Setup

1. Visit [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) to create a new OAuth App.
2. Set Homepage / Callback URL to your future Cloudflare Pages domain, for example:
   - Homepage: `https://your-project.pages.dev/`
   - Authorization callback URL: `https://your-project.pages.dev/auth/callback`
3. Note the `Client ID` and click "Generate a new client secret" to save the `Client Secret`.
4. Pages Functions will request `workflow` and `public_repo` (or `repo`) permissions to trigger `workflow_dispatch` on public/private repositories.

## Cloudflare Pages Configuration

1. Create a Pages project in the Cloudflare dashboard (connect a Git repository or upload manually).
2. Build settings example:
   - Build Command: `npm install && npm run build --prefix frontend`
   - Build Output Directory: `frontend/dist`
   - Functions Directory: `functions`
3. Add environment variables in **Pages → Settings → Variables (Production & Preview)**:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET` (random 32+ byte string, e.g., `openssl rand -base64 32`)
   - `GITHUB_OAUTH_REDIRECT_URI` (must match OAuth App callback; production uses Pages domain `/auth/callback`, development can use `http://localhost:5173/auth/callback`)
   - `GITHUB_REPO_OWNER`
   - `GITHUB_REPO_NAME`
   - `GITHUB_WORKFLOW_ID` (e.g., `esphome-compile.yml`)
   - `GITHUB_WORKFLOW_REF` (default `main`)
   - `FRONTEND_URL` (redirect URL after authorization; recommend Pages domain for production)
   - `ALLOWED_ORIGINS` (comma-separated list of allowed CORS origins; must include Pages domain, add `http://localhost:5173` for development)
   - `GITHUB_REQUIRE_PRIVATE_REPO` (default empty/false; set to `true` only when accessing private repos to request `repo` scope)
   - `GITHUB_SERVICE_TOKEN` (optional; platform default Fine-grained PAT; recommend selecting only `workflow` and `public_repo` permissions)

> Note: Cloudflare Pages stores variables separately for Production and Preview; you can use different OAuth Apps to distinguish environments.

## Local Development

1. Install and run frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Copy `.dev.vars.example` to `.dev.vars` in the repository root and fill in your Dev OAuth App configuration.
3. Start Pages Functions local environment (requires `wrangler` installation):
   ```bash
   # In repository root
   wrangler pages dev frontend/dist --local --port 8787
   ```
   If `frontend/dist` doesn't exist yet, run `npm run build --prefix frontend` first.
4. Visit `http://localhost:5173` in your browser; Vite will proxy `/auth/*` and `/api/*` requests to `http://127.0.0.1:8787`.

## Usage

1. (Optional) Click "GitHub Login" to authorize, granting `workflow` + `public_repo` (or `repo`) permissions; when not logged in, the platform uses `GITHUB_SERVICE_TOKEN` to trigger Workflows.
2. Return to the page and paste your ESPHome YAML.
3. If YAML contains `!secret`, the system auto-detects and generates input fields with auto-completion for quoted values and local caching; confirm fields before submission.
4. If no custom archive password is set, the interface generates a 16-character alphanumeric password displayed for later use when extracting the artifact.
5. After submission, the frontend Base64-encodes the YAML and triggers `workflow_dispatch` via Pages Functions (defaults to platform token; falls back to logged-in user token on failure).
6. Frontend polls Workflow status; upon completion, displays firmware download button to directly download the encrypted `firmware-<request_id>-password.zip`.
7. Click "Logout" to clear session when switching accounts.

> Page refresh doesn't lose YAML drafts or ongoing compilations; requests automatically recover and continue polling status.

## GitHub Actions Workflow

- Decodes YAML to `config.yaml`.
- Installs ESPHome based on the version number passed from frontend (defaults to latest stable) and runs `esphome compile config.yaml`.
- Encrypts and packages all generated firmware `*.bin` (and manifest) with `config.yaml` into `firmware-<request_id>-password.zip`, uploaded to `artifact/` directory; artifacts retained for 1 day.
- Run name includes `request_id`; Pages Functions matches Workflow Run accordingly.

## Security Notes

- OAuth Access Token stored in signed HttpOnly Cookie, accessible only to Pages Functions; `Secure` flag automatically enabled in production.
- Never commit real secrets to repository; configure production variables via Cloudflare dashboard, use `.dev.vars` for development (added to `.gitignore`).
- To revoke authorization, remove the OAuth App in GitHub → Settings → Applications.
- When using `GITHUB_REQUIRE_PRIVATE_REPO=true`, authorization scope expands to `repo`; ensure only enabled when necessary.
- `GITHUB_SERVICE_TOKEN` should be a Fine-grained PAT saved as Pages Secret; GitHub API quota per token is 5000 requests/hour; prompt users to login and switch to personal authorization when needed.

