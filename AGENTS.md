# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: Vite + Vue 3 SPA; key modules live in `src/components/` (UI + session state), `src/stores/` (persistence helpers), and `src/services/` (GitHub workflow client).
- `functions/[[path]].ts`: Cloudflare Pages Function routing `/auth/*` and `/api/*`, handling OAuth, session cookies, and GitHub API proxying.
- `.github/workflows/esphome-compile.yml`: Workflow that compiles ESPHome firmware, uploads artifacts, and tags runs by `request_id`.
- `.dev.vars.example`: Template for local secrets; copy to `.dev.vars` during development.

## Build, Test, and Development Commands
- `npm install --prefix frontend`: Install front-end dependencies; run after cloning or updating lockfile.
- `npm run dev --prefix frontend`: Start Vite dev server at `http://localhost:5173`, proxying API calls to local Pages Functions.
- `npm run build --prefix frontend`: Generate production assets in `frontend/dist/` for Pages deployments.
- `npm run lint --prefix frontend`: Run ESLint (`.ts`, `.vue`) to enforce style and catch obvious defects.
- `wrangler pages dev frontend/dist --local --port 8787`: Emulate Pages Functions locally; requires `.dev.vars`.

## Coding Style & Naming Conventions
- Follow ESLint + Vue 3 defaults; prefer single-file components with `<script setup lang="ts">` and 2-space indentation.
- Use `kebab-case` for Vue component filenames (`CompileForm.vue` is the lone PascalCase exception), and camelCase for composables/stores.
- Keep Pages Function helpers pure and colocated; export HTTP handlers as named async functions for testability.
- Run `npm run lint --prefix frontend` before pushing to confirm formatting and rule compliance.

## Testing Guidelines
- No automated test suite yet; rely on manual verification of login, workflow trigger, artifact download, and refresh persistence.
- When adding tests, colocate Vitest specs under `frontend/src/**/__tests__/` with filenames `<unit>.spec.ts`.
- Validate OAuth/session changes against both local (`wrangler pages dev`) and deployed Pages environments to catch cookie/domain issues.

## Commit & Pull Request Guidelines
- Commits follow Conventional Commit prefixes (`feat`, `chore`, `docs`, `refactor`, etc.); keep messages under ~72 chars and describe the user-facing effect.
- Group related changes per commit; avoid mixing front-end UX updates with workflow YAML tweaks.
- Pull requests should summarize the user impact, list testing evidence (commands, screenshots), and reference related issues or discussions.

## Security & Configuration Tips
- Never commit secrets; use `.dev.vars` locally and Cloudflare Pages → Settings → Variables for staging/production.
- Required environment keys: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `GITHUB_REPO_*`, `GITHUB_WORKFLOW_*`, `FRONTEND_URL`, `ALLOWED_ORIGINS`; optionally set `GITHUB_SERVICE_TOKEN` for the shared PAT fallback.
- Enforce least privilege: default to GitHub `workflow` + `public_repo`; only enable `repo` scope when targeting private repositories and scope the service token accordingly.
- Cloudflare Pages Functions prefer the shared `GITHUB_SERVICE_TOKEN` and automatically fall back to the authenticated user token on 401/403/429 responses, so handle both paths when debugging.
