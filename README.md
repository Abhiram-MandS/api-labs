# HTTP Interceptor

A development tool for intercepting, inspecting, and mocking HTTP requests in real time. Built with Next.js 16 and backed by a Node.js proxy server, it captures both browser-side `fetch` calls and backend API traffic (Java Spring, Node.js, Python, etc.) in a unified, WebSocket-powered live dashboard.

## Features

### Core

- **Browser Interception** — Automatically captures all `fetch()` calls in the browser via monkey-patching
- **Backend Proxy** — Intercepts HTTP/HTTPS traffic from server-side applications via a configurable proxy (port 8888)
- **Request Inspector** — Drill into full request/response details (method, status, headers, body, timing)
- **Real-time Updates** — WebSocket (Socket.io) pushes logs instantly to the UI
- **Unified View** — Browser and server requests appear side-by-side with source indicators
- **Domain Tracking** — Highlight and filter requests by tracked domains
- **URL Filters** — Hide noise by filtering out unwanted URL patterns
- **Dark Mode** — Toggle between light and dark themes, persisted across sessions

### Mock Rules

- **Static Mocks** — Define URL-pattern-based mock responses with fixed JSON bodies
- **Dynamic Mocks (AI)** — Describe API behavior in natural language; AI generates a fresh, realistic response on every request
- **Swagger/OpenAPI Import** — Import mock rules from Swagger 2.0 or OpenAPI 3.x specs (JSON or YAML, paste or file upload)
- **Postman Export** — Export mock rules as a Postman Collection v2.1 JSON file
- **Bulk Operations** — Select, enable, disable, delete, or AI-generate for multiple rules at once
- **Right-click Context Menu** — Create mock rules directly from intercepted log entries

### AI-Powered Features

- **AI Mock Data Generation** — Given a template JSON body, AI fills in realistic, contextually appropriate data (names, emails, dates, IDs, prices, etc.)
- **Dynamic Mock Responses** — Write a natural language description of your API's behavior; every request gets a unique AI-generated response matching that description
- **Natural Language Mock Builder** — Describe what mocks you need in plain English and AI creates the rules for you
- **Traffic Analysis** — AI analyzes intercepted traffic patterns and provides insights
- **Mock Suggestions** — AI suggests mock rules based on observed traffic
- **Model Selection** — Choose between `gpt-4o-mini` (faster) and `gpt-4o` (higher quality)

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Backend App    │────────▶│   Proxy Server   │────────▶│  External APIs  │
│  (Java/Python)  │  HTTP   │   (Port 8888)    │  HTTP   │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     │ WebSocket
                                     ▼
┌─────────────────┐         ┌──────────────────┐
│  Browser fetch  │────────▶│   Next.js UI     │
│  Interception   │  Direct │   (Port 3000)    │
└─────────────────┘         └──────────────────┘
```

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Quick Start

### 1. Install dependencies

```bash
npm install
cd proxy-server && npm install && cd ..
```

### 2. Start the Next.js UI

```bash
npm run dev
```

Open **http://localhost:3000**.

### 3. Start the Proxy Server (optional — for backend interception)

In a second terminal:

```bash
cd proxy-server
node server.js
```

The proxy runs on **http://localhost:8888**. Verify with:

```bash
curl http://localhost:8888/health
```

## Usage

### Browser-Side Interception

1. Open the UI at **http://localhost:3000**
2. Click **"Test Random Request"** to fire sample API calls
3. Any `fetch()` call made from the browser (including the DevTools console) is logged automatically
4. Click a row to inspect full request/response details

### Backend Interception

Point your backend application's HTTP client at the proxy. No code changes are needed beyond proxy configuration.

#### Java Spring — `application.properties`

```properties
http.proxyHost=localhost
http.proxyPort=8888
https.proxyHost=localhost
https.proxyPort=8888
```

#### Java Spring — RestTemplate Bean

```java
@Bean
public RestTemplate restTemplate() {
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    Proxy proxy = new Proxy(Proxy.Type.HTTP,
        new InetSocketAddress("localhost", 8888));
    factory.setProxy(proxy);
    return new RestTemplate(factory);
}
```

#### cURL

```bash
curl -x http://localhost:8888 https://jsonplaceholder.typicode.com/todos/1
```

See [proxy-server/README.md](proxy-server/README.md) for WebClient (reactive), Python, and other configuration examples.

### Domain Tracking

1. Click the **+** button in the Domains section
2. Enter a domain (e.g. `api.github.com`)
3. Requests to tracked domains are highlighted in the log

### Creating Mock Rules

1. Click the **+** button in Mock Rules (or right-click any log entry → "Create mock for this URL")
2. Fill in **URL pattern**, **HTTP method**, **status code**
3. Choose **Response Type**:
   - **Static** — Enter a fixed JSON body that is returned every time
   - **Dynamic** — Write a natural language description of the API behavior; AI generates a fresh response per request
4. Matching browser requests return the mock response instead of calling the real API

#### Swagger / OpenAPI Import

1. Click the **Swagger** button in the Mock Rules panel
2. Paste a Swagger 2.0 or OpenAPI 3.x spec (JSON or YAML), or upload a file
3. Select which endpoints to import → click **Import**
4. If AI is enabled, mock bodies are auto-generated for all imported rules

#### Postman Export

Click the **Download** button in the Mock Rules panel to export all rules as a Postman Collection v2.1 JSON file.

### AI Setup

AI features are powered by the [GitHub Models API](https://github.com/marketplace/models). To enable:

1. Set `GITHUB_TOKEN` in `proxy-server/.env` (or as a shell env var)
2. Toggle **AI** on in the Settings modal
3. Optionally configure a personal access token and model in Settings

## Project Structure

```
http-interceptor/
├── app/
│   ├── page.tsx            # Main interceptor UI (single-page client component)
│   ├── layout.tsx          # Root layout
│   ├── globals.css         # Global styles (Tailwind)
│   └── utils/
│       ├── swagger-parser.ts   # OpenAPI 2.0/3.x → MockRule[] parser
│       └── postman-export.ts   # MockRule[] → Postman Collection v2.1
├── proxy-server/
│   ├── server.js           # HTTP/HTTPS proxy + WebSocket server + mock matching
│   ├── utils/
│   │   └── ai-generate.js  # AI mock generation (GitHub Models API)
│   ├── middleware/          # Express middleware (extensible)
│   ├── test-proxy.js       # Proxy smoke-test script
│   ├── package.json
│   └── README.md
├── public/                 # Static assets
├── aiPRD.md                # AI feature PRD
├── IMPLEMENTATION.md       # Technical implementation notes
├── CONTRIBUTING.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
└── README.md
```

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| UI Framework | Next.js 16 (App Router) |
| Language | TypeScript (UI), JavaScript CommonJS (proxy) |
| Styling | Tailwind CSS 4 |
| Icons | Lucide React |
| Real-time (client) | Socket.io Client |
| Proxy Runtime | Node.js + Express |
| Proxy Engine | http-proxy |
| Real-time (server) | Socket.io |
| AI | OpenAI SDK → GitHub Models API (Azure inference) |

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PROXY_PORT` | `8888` | Port for the proxy server |
| `UI_PORT` | `3000` | Port where the Next.js UI is running |
| `TARGET_URL` | `http://localhost:8080` | Default upstream server for reverse proxy mode |
| `GITHUB_TOKEN` | — | GitHub personal access token for AI features (GitHub Models API) |

## Roadmap

- [x] Static mock rules with JSON bodies
- [x] AI-powered mock data generation
- [x] Dynamic mocks with natural language descriptions
- [x] Swagger/OpenAPI import
- [x] Postman Collection export
- [x] Natural language mock builder
- [x] Traffic analysis & mock suggestions
- [ ] Request replay
- [ ] Traffic recording / playback
- [ ] Log export (CSV / JSON)
- [ ] Multi-service tagging
- [ ] AI anomaly detection
- [ ] Collaborative mock sharing

## Security

> **Development use only.** The proxy server has full visibility into all traffic, including headers, cookies, and request bodies. Never expose it outside a trusted local environment or deploy it to production.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
