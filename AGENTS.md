# Repository Guidelines

## Project Structure & Module Organization
- `frontend/` – Vue 3 + Vite SPA; UI logic lives in `src/components/` (notably `CompileForm.vue`), app bootstrap in `src/main.ts`, shared styles in `src/style.scss`.
- `functions/[[path]].ts` – Cloudflare Pages Function handling `/auth/*` and `/api/*`, including OAuth, session cookies, GitHub workflow triggers, status polling, and artifact proxying.
- `.github/workflows/esphome-compile.yml` – GitHub Actions workflow compiling ESPHome firmware and publishing a zipped artifact tagged with the `request_id`.
- `.dev.vars.example` – template for Wrangler local secrets; copy to `.dev.vars` before running `wrangler pages dev`.

## Build, Test, and Development Commands
- `npm install --prefix frontend` – install front-end dependencies after cloning or when the lockfile changes.
- `npm run dev --prefix frontend` – start the Vite dev server; pair with `wrangler pages dev frontend --local --port 8787` to emulate Pages Functions.
- `npm run build --prefix frontend` – produce production assets in `frontend/dist/`.
- `npm run lint --prefix frontend` – execute ESLint over `.ts` and `.vue` sources to catch regressions early.
- `wrangler pages deploy` – publish the latest `dist/` bundle and `functions/` code to Cloudflare Pages (requires authenticated Wrangler session).

## Coding Style & Naming Conventions
- TypeScript-first Vue components using `<script setup>` and two-space indentation.
- Component filenames stay PascalCase (`CompileForm.vue`), while helpers/assets follow kebab-case (`workflow-client.ts`, `style.scss`).
- Keep GitHub/API helpers colocated with their consumer; prefer async/await with explicit error messages surfaced to users.

## Testing Guidelines
- Current validation is manual: confirm OAuth login, service-token fallback, workflow trigger, artifact download, and refresh persistence whenever logic changes.
- Future automated tests should live under `frontend/src/__tests__/` using Vitest (`<component>.spec.ts`) with MSW or simple stubs for GitHub APIs.
- Exercise Cloudflare endpoints locally via `wrangler pages dev frontend --local` to confirm cookies, headers, and rate-limit handling before deploying.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat`, `fix`, `chore`, `docs`, etc.) with concise (<72 char) imperatives describing observable impact.
- Commit related changes together; avoid mixing UI tweaks, workflow YAML edits, and infrastructure updates unless tightly coupled.
- PRs should summarize behaviour changes, list verification steps (`npm run build`, manual flow checks), and call out required secret or configuration updates.

## Security & Configuration Tips
- Do not commit secrets; store local values in `.dev.vars`, production secrets in Cloudflare Pages → Settings → Variables.
- Required env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `GITHUB_SERVICE_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_WORKFLOW_ID`, `GITHUB_WORKFLOW_REF`, and `FRONTEND_URL`.
- Monitor 401/403/429 responses to determine when to rotate the shared service token; the UI automatically falls back to personal OAuth when the platform token is degraded.
