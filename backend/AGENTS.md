# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: TypeScript service on Hono with runtime abstraction (`cli/`, `handlers/`, `history/`, `middleware/`, `runtime/`, `utils/`). Run from this directory for CLI tasks.
- `frontend/`: Vite + React client (`src/components`, `hooks`, `contexts`, `utils`, `config`). Focuses on chat UI, history, and permission modes.
- `shared/`: Cross-package TypeScript types such as `StreamResponse` and `ChatRequest`.
- Root scripts: `make` targets wrap combined workflows; Git hooks and CI trigger `make check`.

## Build, Test, and Development Commands
- `make dev-backend` / `make dev-frontend`: Watch-mode servers for API and UI (default ports 22080 and 3000).
- `make test-backend` / `make test-frontend`: Run Deno tests and Vitest + Testing Library suites independently.
- `make test`, `make lint`, `make typecheck`, `make format`: Aggregate runners covering both packages; `make check` executes the full quality gate used in CI and Lefthook.
- `cd backend && deno task build`: Produce the single backend binary for distribution.

## Coding Style & Naming Conventions
- Language stack is TypeScript throughout; use ES modules and prefer descriptive file names (e.g., `PlanPermissionInputPanel.tsx`).
- Formatting goes through `make format`, so do not mix manual styling; avoid caret (`^`) semver ranges when updating dependencies per policy.
- Keep logging consistent with `utils/logger.ts`; prefer structured messages over ad-hoc `console.log`.

## Testing Guidelines
- Backend relies on the Deno test runner; co-locate specs alongside source files and mirror the module name (e.g., `chat.test.ts`).
- Frontend uses Vitest with Testing Library; place tests near components and favor behavior-driven descriptions.
- Always run the specific package tests you touched plus `make test` before pushing; CI expects deterministic, hermetic tests.

## Commit & Pull Request Guidelines
- Follow the existing conventional, action-oriented commit titles (e.g., `fix: handle CLI detection fallback`). Keep commits scoped so Lefthook’s `make check` stays green.
- PRs should describe the change, link issues, include screenshots for UI updates, and set labels (`bug`, `frontend`, `backend`, etc.). Use release labels (minor/major) when appropriate; tagpr automates version bumps afterward.

## Security & Configuration Tips
- Store secrets in `.env` and load via `dotenvx`; never commit credentials. Ports can be overridden with `PORT=...` in the root env file.
- Claude CLI discovery runs automatically—verify `claude --version` locally before sending chat requests to avoid runtime failures.
