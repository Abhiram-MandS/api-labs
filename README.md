# HTTP Interceptor

A development tool for intercepting, inspecting, and mocking HTTP requests in real time. Built with Next.js 16 and backed by a Node.js proxy server, it captures both browser-side `fetch` calls and backend API traffic (Java Spring, Node.js, Python, etc.) in a unified, WebSocket-powered live dashboard.

## Features

- **Browser Interception** — Automatically captures all `fetch()` calls in the browser
- **Backend Proxy** — Intercepts HTTP/HTTPS traffic from server-side applications via a configurable proxy (port 8888)
- **Mock Rules** — Define URL-pattern-based mock responses to short-circuit requests without hitting real APIs
- **Domain Tracking** — Highlight and filter requests by tracked domains
- **Request Inspector** — Drill into full request/response details (method, status, headers, body, timing)
- **Real-time Updates** — WebSocket (Socket.io) pushes logs instantly to the UI
- **Unified View** — Browser and server requests appear side-by-side with source indicators

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

### Mock Rules

1. Click the **+** button in Mock Rules
2. Fill in **URL pattern**, **HTTP method**, **status code**, and **JSON body**
3. Matching browser requests return the mock response instead of calling the real API

## Project Structure

```
http-interceptor/
├── app/
│   ├── page.tsx            # Main interceptor UI
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Global styles
├── proxy-server/
│   ├── server.js           # HTTP/HTTPS proxy + WebSocket server
│   ├── test-proxy.js       # Proxy smoke-test script
│   ├── middleware/          # Express middleware (extensible)
│   ├── utils/              # Shared utilities (extensible)
│   ├── package.json
│   └── README.md
├── public/                 # Static assets
├── package.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── IMPLEMENTATION.md       # Technical implementation notes
├── CONTRIBUTING.md
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Icons | Lucide React |
| Real-time (client) | Socket.io Client |
| Proxy Runtime | Node.js + Express |
| Proxy Engine | http-proxy |
| Real-time (server) | Socket.io |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `8888` | Port for the proxy server |
| `UI_PORT` | `3000` | Port where the Next.js UI is running |

## Roadmap

- [ ] Proxy-side mock rules (intercept before forwarding)
- [ ] Request replay
- [ ] Traffic recording / playback
- [ ] Filtering and full-text search
- [ ] Log export (CSV / JSON)
- [ ] Request/response header inspection
- [ ] Multi-service tagging

## Security

> **Development use only.** The proxy server has full visibility into all traffic, including headers, cookies, and request bodies. Never expose it outside a trusted local environment or deploy it to production.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

MIT
