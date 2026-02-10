# HTTP Proxy Server

A Node.js-based HTTP/HTTPS proxy server that intercepts backend API calls and logs them in real-time to the HTTP Interceptor UI.

## Features

- ✅ Intercepts HTTP/HTTPS requests from any backend application
- ✅ Real-time logging via WebSocket to Next.js UI
- ✅ Request/response capture with timing
- ✅ Language-agnostic (works with Java, Python, Node.js, Go, etc.)
- ✅ Zero code changes required in your backend

## Quick Start

### 1. Start the Proxy Server

```bash
cd proxy-server
npm install
npm start
```

The proxy server will start on **port 8888**.

### 2. Configure Your Java Spring Application

Choose one of the configuration methods below:

#### Option A: System Properties (Global)

Add to your application startup or `application.properties`:

```java
System.setProperty("http.proxyHost", "localhost");
System.setProperty("http.proxyPort", "8888");
System.setProperty("https.proxyHost", "localhost");
System.setProperty("https.proxyPort", "8888");
```

Or in `application.properties`:
```properties
http.proxyHost=localhost
http.proxyPort=8888
https.proxyHost=localhost
https.proxyPort=8888
```

#### Option B: RestTemplate Configuration

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import java.net.InetSocketAddress;
import java.net.Proxy;

@Configuration
public class RestTemplateConfig {
    
    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory requestFactory = 
            new SimpleClientHttpRequestFactory();
        
        Proxy proxy = new Proxy(
            Proxy.Type.HTTP, 
            new InetSocketAddress("localhost", 8888)
        );
        requestFactory.setProxy(proxy);
        
        return new RestTemplate(requestFactory);
    }
}
```

#### Option C: WebClient Configuration (Reactive)

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

@Configuration
public class WebClientConfig {
    
    @Bean
    public WebClient webClient() {
        HttpClient httpClient = HttpClient.create()
            .proxy(proxy -> proxy
                .type(ProxyProvider.Proxy.HTTP)
                .host("localhost")
                .port(8888)
            );
        
        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .build();
    }
}
```

### 3. Start the Next.js UI

In another terminal:

```bash
cd ..  # Back to http-interceptor root
npm run dev
```

The UI will be available at **http://localhost:3004**.

### 4. Make API Calls from Your Java App

Now when your Spring application makes HTTP requests to external APIs, they will:
1. Route through the proxy server (localhost:8888)
2. Get forwarded to the actual destination
3. Be logged and sent to the UI via WebSocket
4. Appear in real-time in the HTTP Interceptor dashboard

## Example Usage

### Spring Boot Example

```java
@RestController
public class UserController {
    
    @Autowired
    private RestTemplate restTemplate;  // Configured with proxy
    
    @GetMapping("/users/{id}")
    public String getUser(@PathVariable String id) {
        // This call will be intercepted and logged!
        String url = "https://jsonplaceholder.typicode.com/users/" + id;
        return restTemplate.getForObject(url, String.class);
    }
}
```

When you call `http://localhost:8080/users/1`, you'll see the request to `jsonplaceholder.typicode.com` appear in the UI!

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Java Spring    │────────▶│   Node.js Proxy  │────────▶│  External APIs  │
│  Application    │         │   Server         │         │  (GitHub, etc)  │
│  (Port 8080)    │         │   (Port 8888)    │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     │ WebSocket
                                     ▼
                            ┌──────────────────┐
                            │   Next.js UI     │
                            │  (Port 3004)     │
                            │  Interceptor     │
                            └──────────────────┘
```

## Configuration

### Environment Variables

```bash
PROXY_PORT=8888    # Port for proxy server (default: 8888)
UI_PORT=3004       # Port where Next.js UI is running (default: 3004)
```

### Health Check

Check if the proxy server is running:

```bash
curl http://localhost:8888/health
```

Response:
```json
{
  "status": "ok",
  "port": 8888,
  "connectedClients": 1,
  "timestamp": "2026-02-07T08:45:00.000Z"
}
```

## Troubleshooting

### Proxy not receiving requests

1. Verify proxy is running:
   ```bash
   curl http://localhost:8888/health
   ```

2. Check Java proxy configuration:
   ```bash
   # In your Spring app, add logging
   System.out.println("Proxy: " + System.getProperty("http.proxyHost"));
   ```

3. Test with curl:
   ```bash
   curl -x http://localhost:8888 https://jsonplaceholder.typicode.com/todos/1
   ```

### UI not showing logs

1. Check WebSocket connection in browser console
2. Verify UI is running on port 3004
3. Check CORS settings in proxy server

### HTTPS requests failing

For HTTPS, the proxy uses CONNECT tunneling. Some HTTPS endpoints may require additional certificate configuration.

## Security Note

⚠️ **Development Only**: This proxy can see all traffic including sensitive data. Only use in local development environments. Never use in production.

## Advanced Features (Coming Soon)

- [ ] Proxy-side mock rules
- [ ] Request replay
- [ ] Traffic recording/playback
- [ ] Response modification
- [ ] Request throttling

## Tech Stack

- **Node.js** - Runtime
- **Express** - HTTP server
- **http-proxy-middleware** - Proxy functionality
- **Socket.io** - Real-time WebSocket communication
- **Morgan** - Request logging

## License

MIT
