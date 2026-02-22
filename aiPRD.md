# AI PRD — HTTP Interceptor (API Labs)

> **Version:** 1.0  
> **Date:** 2026-02-22  
> **Status:** Living Document  
> **Owner:** API Labs Team

---

## 1. Overview

HTTP Interceptor (API Labs) is a development tool for intercepting, inspecting, and mocking HTTP requests in real time. This PRD defines the AI-powered capabilities that augment the core interception/mocking workflow—starting with AI mock data generation and extending into intelligent request analysis, auto-rule creation, and anomaly detection.

### 1.1 Vision

Eliminate the tedium of hand-crafting mock response bodies. Developers define *what* an endpoint looks like (URL pattern, method, status, and a template JSON shape), and AI fills in *realistic, contextually appropriate data* automatically. Over time, AI capabilities expand to cover request analysis, auto-suggested mock rules, and traffic anomaly detection.

### 1.2 Goals

| # | Goal | Success Metric |
|---|------|---------------|
| G1 | Reduce time-to-mock for new endpoints | < 10 s from rule creation to realistic AI body |
| G2 | Produce valid, schema-faithful responses | 100 % valid JSON; key structure matches template |
| G3 | Support bulk generation (Swagger imports) | All imported rules get AI bodies within 60 s |
| G4 | Zero mandatory configuration in UI | Works with `GITHUB_TOKEN` env var alone |
| G5 | Graceful degradation when AI is unavailable | App remains fully functional; AI features disable cleanly |

---

## 2. Architecture

### 2.1 System Context

```
┌──────────────┐      POST /api/ai/generate      ┌────────────────────┐
│  Next.js UI  │ ──────────────────────────────▶  │  Proxy Server      │
│  (port 3000) │ ◀──────────────────────────────  │  (port 8888)       │
│              │      { aiBody: "..." }           │                    │
└──────────────┘                                  └────────┬───────────┘
                                                           │
                                                           │ OpenAI-compatible API
                                                           ▼
                                                  ┌────────────────────┐
                                                  │  GitHub Models API │
                                                  │  (Azure inference) │
                                                  └────────────────────┘
```

### 2.2 Component Responsibilities

| Component | File(s) | Responsibility |
|-----------|---------|---------------|
| **AI Toggle & Settings** | `app/page.tsx` (Settings Modal) | Enable/disable AI, configure PAT, select model |
| **AI Generation Trigger** | `app/page.tsx` (`generateAIBody`) | Calls proxy `/api/ai/generate`, updates `aiBody` on mock rules |
| **AI REST Endpoint** | `proxy-server/server.js` (`POST /api/ai/generate`) | Token resolution, request validation, delegates to generator |
| **AI Generator** | `proxy-server/utils/ai-generate.js` | OpenAI client instantiation, prompt engineering, response validation |
| **Mock Rule Schema** | `app/page.tsx` (`MockRule` interface) | `aiBody`, `aiStatus`, `aiError` fields on each rule |
| **Effective Body Resolution** | `proxy-server/server.js` (`getEffectiveBody`) | Returns `aiBody` when AI is enabled, else `body` |
| **WebSocket Sync** | Both processes | `settings-update` event carries `isAIEnabled` flag to proxy |

### 2.3 Data Flow — AI Mock Generation

1. User creates/edits a mock rule in the UI.
2. If `isAIEnabled === true`, `generateAIBody(mockId)` fires after a 100 ms debounce.
3. UI sets `aiStatus: 'generating'` on the rule (spinner in table).
4. `originalFetch` (un-patched) calls `POST http://localhost:8888/api/ai/generate` with `{ pattern, method, status, body, model }`.
5. Proxy resolves token: `X-GitHub-Token` header → `GITHUB_TOKEN` env var.
6. `ai-generate.js` builds a system + user prompt and calls the GitHub Models API (`models.inference.ai.azure.com`).
7. Response is validated as parseable JSON, then returned as `{ aiBody }`.
8. UI sets `aiStatus: 'done'` and stores `aiBody` on the rule.
9. On next mock match (browser or proxy), `getEffectiveBody()` returns `aiBody` instead of the template `body`.

### 2.4 AI Body Priority

```
isAIEnabled && mock.aiBody  →  serve mock.aiBody
isAIEnabled && !mock.aiBody →  serve mock.body  (fallback)
!isAIEnabled                →  serve mock.body  (always)
```

---

## 3. Feature Specifications

### 3.1 AI Mock Data Generation (Shipped — v1.0)

#### 3.1.1 Description

Given a mock rule's URL pattern, HTTP method, status code, and a template JSON body, generate a realistic version of the response with contextually appropriate data (names, emails, dates, IDs, prices, etc.).

#### 3.1.2 User Flows

**Flow A — Automatic generation on rule create/edit**

1. User opens **Create Mock Rule** modal.
2. Fills in pattern, method, status, template body.
3. Clicks **Create Rule**.
4. If AI is enabled, a purple sparkle spinner appears on the rule row.
5. After 1–5 s the spinner resolves to a solid sparkle icon (AI body ready).
6. Next matching request uses the AI-generated body.

**Flow B — Manual generation via AI panel**

1. User clicks the sparkle icon on any rule row → **AI Mock Generator** modal opens.
2. Shows template body (read-only) and a **Generate** button.
3. User clicks Generate → loading state → AI body appears in green-highlighted `<pre>` block.
4. User can **Regenerate** (new data each time) or **Apply to Mock** to persist.

**Flow C — Bulk generation on Swagger import**

1. User imports a Swagger/OpenAPI spec (paste or file upload).
2. Selects endpoints → clicks **Import N Rules**.
3. After import, if AI is enabled, `generateAIBody` runs for every imported rule with a 200 ms stagger.

**Flow D — Bulk generation via toolbar**

1. In Mock Rules panel, user selects multiple rules (checkboxes) or clicks **Generate All AI**.
2. Each selected rule gets an AI body generated in parallel.

#### 3.1.3 Prompt Engineering

**System prompt** (in `ai-generate.js`):

- Preserve exact JSON structure (same keys, nesting, array lengths).
- Replace placeholder values with realistic, contextually appropriate data.
- For arrays, generate 2–3 items with varied data.
- Return **only** valid JSON — no markdown fences, no explanation.
- If template is not valid JSON, return it unchanged.

**User prompt**:

```
API Endpoint: {method} {pattern}
Status Code: {status}
Template Response Body:
{body}

Generate a realistic version of this response body:
```

**Parameters**: `temperature: 0.8`, `max_tokens: 4096`.

#### 3.1.4 State Management

Each `MockRule` carries AI-specific fields:

```typescript
interface MockRule {
  id: number;
  pattern: string;
  method: string;
  status: number;
  body: string;          // user-defined template
  aiBody?: string;       // AI-generated body (takes precedence when AI enabled)
  aiStatus?: 'idle' | 'generating' | 'done' | 'error';
  aiError?: string;      // error message from last attempt
  enabled: boolean;
}
```

`aiBody` is persisted to `localStorage` (key `api-labs:mocks`) and synced to the proxy via the `mock-rules-update` WebSocket event.

#### 3.1.5 Authentication

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | `X-GitHub-Token` request header | Set from `githubPat` state (Settings modal) |
| 2 | `GITHUB_TOKEN` env var on proxy | Set in `proxy-server/.env` or shell |

If neither is available, the proxy returns `401` with a descriptive error and hint.

#### 3.1.6 Model Selection

| Model | Description | Default |
|-------|-------------|---------|
| `gpt-4o-mini` | Faster, lower cost | ✅ |
| `gpt-4o` | Higher quality output | |

Configured in Settings modal, persisted to `api-labs:aiModel` in localStorage.

#### 3.1.7 Error Handling

| Error | HTTP Code | UI Behavior |
|-------|-----------|-------------|
| No token | 401 | `aiStatus: 'error'`, tooltip "No GitHub token configured" |
| Invalid token | 401 | `aiStatus: 'error'`, tooltip with auth hint |
| Rate limited | 429 | `aiStatus: 'error'`, "Rate limit exceeded. Try again later." |
| Invalid response JSON | 500 | `aiStatus: 'error'`, "AI generation failed" |
| Network failure | — | `aiStatus: 'error'`, error message from exception |

In all error cases the rule falls back to the user-defined `body`.

#### 3.1.8 Postman Export Integration

When exporting mock rules as a Postman Collection (v2.1), if `isAIEnabled` is true the export uses `aiBody` (when available) instead of the template `body` for each rule's example response.

---

### 3.2 Planned — AI Request Analysis (v2.0)

#### 3.2.1 Description

Analyze captured request/response pairs and surface insights: performance outliers, error patterns, payload anomalies, and optimization suggestions.

#### 3.2.2 Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| RA-1 | Detect repeated 4xx/5xx errors on the same endpoint | P1 |
| RA-2 | Highlight unusually slow responses (> 2× rolling average) | P1 |
| RA-3 | Suggest response compression when payloads exceed threshold | P2 |
| RA-4 | Summarize traffic patterns (top endpoints, methods, error rates) | P2 |
| RA-5 | "Explain this response" — parse error bodies into plain-English summaries | P3 |

#### 3.2.3 Proposed UX

- **Insights panel**: a collapsible sidebar section below URL Filters showing live AI-generated insights.
- **Inline badges**: warning/info icons on log rows when AI detects an anomaly.
- **Inspector augmentation**: an "AI Analysis" tab in the request inspector panel.

#### 3.2.4 Technical Approach

- Batch recent logs (last N entries or last T seconds) and send to the AI endpoint for analysis.
- Use a dedicated prompt template focused on HTTP traffic analysis.
- Cache insights per-session to avoid redundant API calls.

---

### 3.3 Planned — Auto Mock Rule Suggestion (v2.0)

#### 3.3.1 Description

After observing enough traffic for an endpoint, automatically suggest a mock rule pre-filled with realistic data derived from actual responses.

#### 3.3.2 Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| AM-1 | After 3+ captured responses for the same endpoint, offer "Create Mock" suggestion | P1 |
| AM-2 | Pre-fill the mock body with a merged/representative response | P1 |
| AM-3 | Detect endpoint patterns across similar paths (parameterized routes) | P2 |
| AM-4 | One-click accept/dismiss for suggestions | P1 |

#### 3.3.3 Proposed UX

- Toast notification: "AI detected a repeating endpoint `GET /api/users`. [Create Mock] [Dismiss]"
- Suggestions section in the Mock Rules panel with confidence scores.

---

### 3.4 Planned — Natural Language Mock Builder (v3.0)

#### 3.4.1 Description

Let users describe a mock rule in plain English and have AI generate the pattern, method, status, and body.

#### 3.4.2 Example

> "Return a 200 with a list of 5 users for GET /api/v2/users"

Produces:

```json
{
  "pattern": "/api/v2/users",
  "method": "GET",
  "status": 200,
  "body": "[{\"id\":1,\"name\":\"Alice Johnson\",...}, ...]"
}
```

#### 3.4.3 Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NL-1 | Free-text input field in Mock Rules toolbar | P1 |
| NL-2 | Parse natural language into MockRule fields | P1 |
| NL-3 | Preview generated rule before saving | P1 |
| NL-4 | Support follow-up refinements ("make it return 404 instead") | P2 |
| NL-5 | Support multi-rule generation ("Create CRUD mocks for /api/products") | P3 |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|--------|--------|
| AI generation latency (p95) | < 5 s |
| UI responsiveness during generation | No blocking; spinner + async state |
| Concurrent generations | Up to 20 parallel requests (Swagger bulk import) |

### 4.2 Reliability

- **Graceful degradation**: If the AI endpoint is unreachable or returns an error, the mock rule uses its template `body`. No crash, no data loss.
- **Retry policy**: No automatic retries for v1 (user can click Regenerate). Future: exponential back-off for bulk operations.
- **JSON validation**: AI output is validated with `JSON.parse()` before storing. Invalid JSON is rejected.

### 4.3 Security

- **Token handling**: GitHub PAT is stored in `localStorage` (`api-labs:githubPat`) and sent only to the local proxy server via `X-GitHub-Token` header. Never transmitted to any other origin.
- **No telemetry**: No usage data leaves the developer's machine beyond the AI model API call.
- **Prompt injection mitigation**: The template body is passed as a user message, not interpolated into the system prompt's instruction section.

### 4.4 Privacy

- Mock rule data (patterns, bodies) is sent to GitHub Models API for generation. Users should avoid putting real PII/secrets in template bodies.
- A warning should be displayed in Settings when AI is enabled.

### 4.5 Accessibility

- All AI-related controls (toggles, buttons, modals) must be keyboard-navigable.
- Spinner states must have `aria-label` or `title` attributes.
- Error states must be announced to screen readers.

---

## 5. Configuration & Environment

### 5.1 Environment Variables

| Variable | Default | Scope | Description |
|----------|---------|-------|-------------|
| `GITHUB_TOKEN` | — | Proxy server | PAT for GitHub Models API |
| `PROXY_PORT` | `8888` | Proxy server | Port for proxy + AI endpoint |
| `UI_PORT` | `3004` | Proxy server | Expected UI origin (CORS) |
| `TARGET_URL` | `http://localhost:8080` | Proxy server | Default reverse-proxy target |

### 5.2 localStorage Keys (AI-related)

| Key | Type | Description |
|-----|------|-------------|
| `api-labs:aiEnabled` | `boolean` | Whether AI mock generation is active |
| `api-labs:githubPat` | `string` | GitHub PAT (encrypted at rest in future) |
| `api-labs:aiModel` | `string` | Selected model (`gpt-4o-mini` or `gpt-4o`) |
| `api-labs:mocks` | `MockRule[]` | Includes `aiBody`, `aiStatus`, `aiError` per rule |

### 5.3 WebSocket Events (AI-related)

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `settings-update` | UI → Proxy | `{ isAIEnabled: boolean }` | Sync AI toggle so proxy uses `aiBody` in mock matching |
| `mock-rules-update` | UI → Proxy | `MockRule[]` | Includes `aiBody` fields for proxy-side mock responses |
| `mock-rules-sync` | Proxy → UI | `MockRule[]` | Broadcast rule changes (including AI data) to all clients |

---

## 6. API Specification

### 6.1 `POST /api/ai/generate`

**Request:**

```json
{
  "pattern": "/api/v1/users",
  "method": "GET",
  "status": 200,
  "body": "{\n  \"users\": [{ \"id\": 0, \"name\": \"string\" }]\n}",
  "model": "gpt-4o-mini"
}
```

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `X-GitHub-Token` | No | Overrides `GITHUB_TOKEN` env var |

**Success Response (200):**

```json
{
  "aiBody": "{\n  \"users\": [\n    { \"id\": 1042, \"name\": \"Sarah Chen\" },\n    { \"id\": 1043, \"name\": \"Marcus Rivera\" }\n  ]\n}"
}
```

**Error Responses:**

| Code | Body | Condition |
|------|------|-----------|
| 400 | `{ "error": "pattern and body are required" }` | Missing fields |
| 401 | `{ "error": "No GitHub token configured", "hint": "..." }` | No token |
| 401 | `{ "error": "Invalid or insufficient GitHub token..." }` | Bad token |
| 429 | `{ "error": "Rate limit exceeded. Try again later." }` | Rate limited |
| 500 | `{ "error": "<message>" }` | Generation failure |

---

## 7. Dependencies

| Dependency | Version | Location | Purpose |
|------------|---------|----------|---------|
| `openai` | ^4.x | `proxy-server/` | OpenAI-compatible client for GitHub Models API |
| `dotenv` | ^16.x | `proxy-server/` | Load `GITHUB_TOKEN` from `.env` |
| `dotenv-expand` | ^12.x | `proxy-server/` | Expand env var references |

The AI feature adds **no new dependencies** to the Next.js UI (`app/`). All AI calls use the existing `originalFetch` + proxy endpoint.

---

## 8. Testing Strategy

### 8.1 Unit Tests (Planned)

| Test | Scope | Description |
|------|-------|-------------|
| `ai-generate.test.js` | `proxy-server/utils/` | Verify prompt construction, JSON validation, error handling |
| `getEffectiveBody.test.js` | `proxy-server/` | Verify AI body priority logic |
| `mockRule.aiFields.test.ts` | `app/` | Verify `aiStatus` state transitions |

### 8.2 Integration Tests (Planned)

| Test | Description |
|------|-------------|
| Generate endpoint happy path | POST to `/api/ai/generate` with valid token → valid JSON back |
| Generate endpoint no token | POST without token → 401 |
| Mock match uses AI body | Create rule → generate AI body → trigger mock → verify response uses `aiBody` |
| Bulk generation | Import 10 rules → all get `aiStatus: 'done'` within timeout |

### 8.3 Manual Test Cases

| # | Scenario | Expected Outcome |
|---|----------|-----------------|
| 1 | Enable AI in Settings → create a mock rule | AI body generates automatically; sparkle icon appears |
| 2 | Click sparkle on rule → Regenerate | New AI body replaces old one |
| 3 | Disable AI → trigger mock match | Template body served, not AI body |
| 4 | Remove token → attempt generation | Error state with "No GitHub token" message |
| 5 | Import Swagger spec with 15 endpoints, AI enabled | All 15 rules get AI bodies |
| 6 | Export as Postman with AI enabled | Collection uses AI bodies |
| 7 | Proxy mock match (server-side) with AI enabled | Proxy returns `aiBody` to backend app |

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| GitHub Models API rate limits | AI generation fails for bulk operations | Medium | Stagger requests; queue with back-off (v2) |
| AI returns invalid JSON | Mock serves raw AI text, breaking clients | Low | `JSON.parse()` validation gate; reject invalid |
| Token exposure in localStorage | PAT readable via browser DevTools | Medium | Document risk; planned: use `sessionStorage` or OS keychain |
| Large template bodies exceed `max_tokens` | Truncated/incomplete AI response | Low | Validate response length; increase `max_tokens` for large templates (v2) |
| AI generates offensive/inappropriate data | Embarrassing mock data in demos | Very Low | System prompt constrains output; add content filter (v2) |
| Model API endpoint changes | Generation breaks silently | Low | Pin base URL in config; health check on startup (v2) |

---

## 10. Roadmap

### Phase 1 — AI Mock Generation ✅ (Shipped)

- [x] AI toggle in Settings
- [x] GitHub PAT configuration (UI + env var)
- [x] Model selection (GPT-4o-mini / GPT-4o)
- [x] Auto-generate on rule create/edit
- [x] Manual generate/regenerate via AI modal
- [x] Bulk generate on Swagger import
- [x] Bulk generate selected rules
- [x] `aiBody` priority in mock matching (browser + proxy)
- [x] Postman export uses AI body
- [x] Error handling with status indicators
- [x] Settings sync to proxy via WebSocket

### Phase 2 — Intelligence Layer (Planned)

- [ ] AI request analysis (insights panel)
- [ ] Auto mock rule suggestions from traffic patterns
- [ ] Response diff view (template vs. AI body)
- [ ] Prompt customization (let users tune the system prompt)
- [ ] Rate limit queue with exponential back-off
- [ ] Token storage encryption

### Phase 3 — Natural Language Interface (Planned)

- [ ] Natural language mock builder
- [ ] Conversational refinement ("make it return 404")
- [ ] Multi-rule generation ("CRUD mocks for /api/products")
- [ ] AI-assisted Swagger spec generation from traffic
- [ ] Smart mock rule deduplication suggestions

---

## 11. Appendix

### A. Prompt Template (Current)

**System:**

```
You are an API mock data generator. Given an API endpoint pattern, HTTP method,
status code, and a template JSON response body, generate a realistic version of
the response body with believable, contextually appropriate data.

Rules:
1. PRESERVE the exact JSON structure (same keys, same nesting, same array lengths).
2. REPLACE placeholder values with realistic, contextually appropriate data.
3. For arrays, generate 2-3 items with varied realistic data.
4. Use realistic names, emails, dates, IDs, prices, descriptions, etc.
5. Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.
6. If the template is not valid JSON, return it unchanged.
```

**User:**

```
API Endpoint: {method} {pattern}
Status Code: {status}
Template Response Body:
{body}

Generate a realistic version of this response body:
```

### B. OpenAI Client Configuration

```javascript
new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: token,   // GitHub PAT with "models" permission
});
```

**Call parameters:** `model: <selected>`, `temperature: 0.8`, `max_tokens: 4096`.

### C. File Map (AI-related code)

| File | Lines | AI Responsibility |
|------|-------|-------------------|
| `app/page.tsx` | ~1938 | `generateAIBody` callback, `aiTestModal` state, AI column in mock table, Settings modal AI section |
| `proxy-server/server.js` | ~548 | `POST /api/ai/generate` endpoint, `getEffectiveBody()`, `isAIEnabled` flag, `settings-update` listener |
| `proxy-server/utils/ai-generate.js` | ~65 | `generateAIMockBody()` — prompt engineering, OpenAI client, JSON validation |
| `app/utils/postman-export.ts` | ~140 | `mocksToPostmanCollection()` — uses `aiBody` when `isAIEnabled` flag is passed |
