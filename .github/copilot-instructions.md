# Copilot Instructions — HTTP Interceptor (API Labs)

## Architecture

Two independent processes that communicate via **Socket.io WebSocket** on port 8888:

| Component | Path | Runtime | Port |
|-----------|------|---------|------|
| **Next.js UI** | `app/` | Next.js 16 App Router, React 19, TypeScript | 3000 (dev) |
| **Proxy Server** | `proxy-server/` | Express + http-proxy, plain JS (CommonJS) | 8888 |

The UI is a **single-page `'use client'` component** in `app/page.tsx` (~2600 lines). All state, fetch interception, mock management, filtering, and rendering live in this one file. There are no API routes in Next.js — the proxy server owns all backend endpoints.

### Data flow

1. **Browser interception** — `window.fetch` is monkey-patched in `app/page.tsx` to log every request and apply client-side mock rules before they hit the network.
2. **Backend interception** — External apps (Java/Python/etc.) route HTTP through the proxy on `:8888`. The proxy captures request/response pairs, applies server-side mock rules, and emits `proxy-log` events over Socket.io.
3. **Mock sync** — Mock rules are bidirectionally synced between UI ↔ proxy via `mock-rules-update` / `mock-rules-sync` WebSocket events. A `skipNextSync` ref prevents echo loops.
4. **AI mock generation** — The UI calls `POST http://localhost:8888/api/ai/generate` which uses `proxy-server/utils/ai-generate.js` to hit the GitHub Models API (`models.inference.ai.azure.com`) with an OpenAI-compatible client. Auth via `GITHUB_TOKEN` env var or `X-GitHub-Token` header.
5. **Dynamic mocks** — Rules with `mockType: 'dynamic'` generate a fresh AI response on every request. The proxy calls `generateDynamicResponse()` using the rule's `description` (natural language) and `body` (JSON template) as prompt context.

## Mock Rule Types

| Type | Field | Behavior |
|------|-------|----------|
| **Static** | `mockType: 'static'` (default) | Returns the fixed `body` (or `aiBody` if AI is enabled) |
| **Dynamic** | `mockType: 'dynamic'` | Calls `generateDynamicResponse()` on every request; uses `description` + `body` as AI prompt |

The `MockRule` interface includes: `id`, `pattern`, `method`, `status`, `body`, `mockType`, `description`, `aiBody`, `aiStatus`, `aiError`, `enabled`.

## Development

```bash
# Terminal 1 — UI
npm install && npm run dev

# Terminal 2 — Proxy
cd proxy-server && npm install && node server.js
```

Proxy config is via env vars: `PROXY_PORT` (default 8888), `UI_PORT` (default 3004), `TARGET_URL` (default `http://localhost:8080`), `GITHUB_TOKEN`.

Lint: `npm run lint` (ESLint 9 flat config with `eslint-config-next`). No test framework is configured.

## Key Conventions

- **TypeScript** in `app/`, **plain JS (CommonJS `require`)** in `proxy-server/`. Do not mix.
- **Tailwind CSS v4** utility classes only — no custom CSS files beyond `globals.css`.
- **Icons**: `lucide-react` — import individual icons, not the barrel.
- **localStorage** keys are prefixed `api-labs:` (e.g., `api-labs:mocks`, `api-labs:darkMode`, `api-labs:aiEnabled`, `api-labs:aiModel`). Hydration uses a `hydratedRef` guard pattern to avoid SSR/client mismatch — follow existing code in `app/page.tsx` when adding new persisted state.
- **IDs**: Use the `uniqueId()` helper (crypto.randomUUID-based) for mock rules; `Math.random().toString(36)` for log entries. The `dedup()` helper resolves ID collisions on sync.
- **Commit messages**: Conventional Commits — `feat(proxy):`, `fix(ui):`, `docs(readme):` etc.
- **Branch naming**: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.

## Proxy Server Structure

- `server.js` — single-file server: Express routes, http-proxy forwarding, HTTPS CONNECT tunneling with on-the-fly self-signed cert generation, Socket.io, mock matching logic, and dynamic mock generation via `getDynamicBody()`.
- `utils/ai-generate.js` — OpenAI-compatible client for GitHub Models API. Exports: `generateAIMockBody`, `generateMockFromNaturalLanguage`, `analyzeTrafficLogs`, `suggestMockRules`, `generateDynamicResponse`, `aiQueue`.
- `middleware/` — empty, intended for future request middleware.
- REST endpoints: `GET /health`, `GET/POST/DELETE /__mocks`, `ALL /__proxy-mock/*` (direct mock endpoint for backends), `POST /api/ai/generate`, `POST /api/ai/natural-language`, `POST /api/ai/analyze`, `POST /api/ai/suggest`.

The proxy operates in **two modes**: forward proxy (absolute URL in request) and reverse proxy (relative path → `TARGET_URL`).

## Frontend Patterns

- The entire UI is `app/page.tsx`. Utility modules live in `app/utils/`:
  - `swagger-parser.ts` — parses OpenAPI 2.0/3.x (JSON or minimal YAML) into `MockRule[]`.
  - `postman-export.ts` — converts `MockRule[]` to Postman Collection v2.1 JSON.
- `originalFetch` is captured at module scope before the monkey-patch, and used for internal API calls (e.g., AI generation) to avoid self-logging.
- Mock rules support `mockType` (`'static'` | `'dynamic'`) and `description` (natural language) fields. Dynamic mocks show a side-by-side description + JSON template editor in the modal.
- The Create/Edit Mock Rule modal is responsive: `max-w-2xl` for static mode, expanding to `max-w-4xl` with a two-column layout for dynamic mode.
- Mock rules support an `aiBody` field that takes precedence over `body` when AI mode is enabled (`isAIEnabled` state + synced to proxy via `settings-update` event).

## When Adding Features

- New proxy middleware → `proxy-server/middleware/`, import in `server.js`.
- New UI utility → `app/utils/`, import in `page.tsx`.
- New persisted UI state → add `api-labs:<key>` localStorage entry, follow the `loadFromStorage` / `hydratedRef` pattern.
- New WebSocket event → define emit/listen in both `proxy-server/server.js` (Socket.io server) and `app/page.tsx` (Socket.io client).
- New AI capability → add function in `proxy-server/utils/ai-generate.js`, expose via REST endpoint in `server.js`, call from UI via `originalFetch`.
