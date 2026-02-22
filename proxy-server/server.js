const dotenvResult = require('dotenv').config();
require('dotenv-expand').expand(dotenvResult);
const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const { Server } = require('socket.io');
const cors = require('cors');
const url = require('url');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { generateAIMockBody, generateMockFromNaturalLanguage, analyzeTrafficLogs, suggestMockRules, generateDynamicResponse, aiQueue } = require('./utils/ai-generate');

// --- Server-side traffic log buffer for AI analysis ---
const trafficLogBuffer = [];
const MAX_TRAFFIC_LOG_BUFFER = 200;

const app = express();
const PORT = process.env.PROXY_PORT || 8888;
const UI_PORT = process.env.UI_PORT || 3004;
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';

app.use(cors());

// --- Generate self-signed CA for HTTPS mock interception ---
function generateSelfSignedCert(hostname) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Create a minimal self-signed X.509 certificate using Node's built-in crypto
  const cert = new crypto.X509Certificate(
    require('child_process').execSync(
      `openssl req -new -x509 -key /dev/stdin -out /dev/stdout -days 1 -subj "/CN=${hostname}" -addext "subjectAltName=DNS:${hostname}" 2>/dev/null`,
      { input: privateKey.export({ type: 'pkcs8', format: 'pem' }), encoding: 'utf-8' }
    )
  );

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: cert.toString(),
  };
}

// Cache generated certs per hostname
const certCache = new Map();
function getCertForHost(hostname) {
  if (certCache.has(hostname)) return certCache.get(hostname);
  try {
    console.log(`🔐 Generating self-signed cert for ${hostname}`);
    const pair = generateSelfSignedCert(hostname);
    certCache.set(hostname, pair);
    return pair;
  } catch (err) {
    console.error(`❌ Cert generation failed for ${hostname}:`, err.message);
    return null;
  }
}

const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({});

const io = new Server(server, {
  cors: {
    origin: `http://localhost:${UI_PORT}`,
    methods: ['GET', 'POST']
  }
});

let connectedClients = 0;

// --- Server-side Mock Rules ---
let mockRules = [];
let isAIEnabled = false;
let aiModel = 'gpt-4o-mini';

function getEffectiveBody(mock) {
  if (isAIEnabled && mock.aiBody) return mock.aiBody;
  return mock.body;
}

function isDynamicMock(mock) {
  return mock.mockType === 'dynamic';
}

// Generate a dynamic response body via LLM. Returns the body string.
// Falls back to static body on error.
async function getDynamicBody(mock, { requestBody, requestHeaders } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('⚠️ Dynamic mock: no GITHUB_TOKEN, falling back to static body');
    return getEffectiveBody(mock);
  }
  try {
    const body = await aiQueue.enqueue(() => generateDynamicResponse({
      pattern: mock.pattern,
      method: mock.method,
      status: mock.status,
      body: mock.body,
      description: mock.description || '',
      requestBody,
      requestHeaders,
      model: aiModel,
    }, token));
    console.log(`🤖 Dynamic mock generated for ${mock.method} ${mock.pattern}`);
    return body;
  } catch (err) {
    console.error(`❌ Dynamic mock generation failed for ${mock.pattern}:`, err.message);
    return getEffectiveBody(mock);
  }
}

function findMockMatch(requestUrl, method) {
  return mockRules.find(m => {
    if (!m.enabled) return false;
    if (m.method !== '*' && m.method !== method) return false;
    return requestUrl.includes(m.pattern);
  });
}

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`✅ UI client connected (${connectedClients} active)`);

  // Send current mocks to newly connected UI
  socket.emit('mock-rules-sync', mockRules);

  // Receive mock rules from UI
  socket.on('mock-rules-update', (rules) => {
    mockRules = rules;
    console.log(`🎭 Mock rules updated (${mockRules.length} rules, ${mockRules.filter(r => r.enabled).length} active)`);
    // Broadcast to all other clients
    socket.broadcast.emit('mock-rules-sync', mockRules);
  });

  // Receive settings from UI
  socket.on('settings-update', (settings) => {
    if (typeof settings.isAIEnabled === 'boolean') {
      isAIEnabled = settings.isAIEnabled;
      console.log(`⚙️ Settings updated: AI ${isAIEnabled ? 'enabled' : 'disabled'}`);
    }
    if (typeof settings.aiModel === 'string') {
      aiModel = settings.aiModel;
      console.log(`⚙️ Settings updated: AI model → ${aiModel}`);
    }
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`❌ UI client disconnected (${connectedClients} active)`);
  });
});

function emitLog(logData) {
  io.emit('proxy-log', logData);
  // Buffer log for AI analysis
  trafficLogBuffer.unshift(logData);
  if (trafficLogBuffer.length > MAX_TRAFFIC_LOG_BUFFER) trafficLogBuffer.length = MAX_TRAFFIC_LOG_BUFFER;
}

// HTTPS CONNECT support — with mock interception
server.on('connect', (req, clientSocket, head) => {
  const startTime = Date.now();
  const { port, hostname } = url.parse(`//${req.url}`, false, true);
  const connectUrl = `https://${hostname}${port == 443 ? '' : `:${port}`}`;
  
  console.log(`🔒 CONNECT ${hostname}:${port}`);

  // Check if any mock rule matches this hostname
  const hostMock = mockRules.find(m => m.enabled && connectUrl.includes(m.pattern));
  
  if (hostMock) {
    // Intercept HTTPS with TLS termination — serve mock over real TLS
    console.log(`🎭 CONNECT intercepted by mock for ${hostname}`);
    
    const certPair = getCertForHost(hostname);
    if (!certPair) {
      // Cert generation failed, fall through to normal tunnel
      console.error(`⚠️ Falling back to normal tunnel for ${hostname}`);
    } else {
      // Establish the CONNECT tunnel
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      
      // Create a TLS server socket wrapping the raw tunnel socket
      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        key: certPair.key,
        cert: certPair.cert,
      });
      
      let requestData = '';
      
      tlsSocket.on('data', (chunk) => {
        requestData += chunk.toString();
        
        if (requestData.includes('\r\n\r\n')) {
          // Parse HTTP request from inside the TLS tunnel
          const firstLine = requestData.split('\r\n')[0];
          const parts = firstLine.split(' ');
          const method = parts[0];
          const path = parts[1] || '/';
          const fullMockUrl = `https://${hostname}${path}`;
          
          // Find matching mock rule
          const specificMock = findMockMatch(fullMockUrl, method) || hostMock;
          const duration = Date.now() - startTime;
          
          let mockBody;
          const effectiveBody = getEffectiveBody(specificMock);
          try {
            mockBody = JSON.parse(effectiveBody);
          } catch {
            mockBody = effectiveBody;
          }

          const responseBody = typeof effectiveBody === 'string' ? effectiveBody : JSON.stringify(effectiveBody);
          const httpResponse = [
            `HTTP/1.1 ${specificMock.status} OK`,
            'Content-Type: application/json',
            'X-Mock-By: HTTPIntercept-Proxy',
            `Content-Length: ${Buffer.byteLength(responseBody)}`,
            'Connection: close',
            '',
            responseBody
          ].join('\r\n');
          
          tlsSocket.write(httpResponse);
          tlsSocket.end();
          
          const logEntry = {
            id: Math.random().toString(36).substr(2, 9),
            url: fullMockUrl,
            method,
            status: specificMock.status,
            duration,
            type: 'Mock',
            body: mockBody,
            timestamp: new Date().toLocaleTimeString(),
            isManaged: true,
            source: 'proxy'
          };
          
          console.log(`🎭 ${method} ${fullMockUrl} → Mock ${specificMock.status} (${duration}ms)`);
          emitLog(logEntry);
        }
      });
      
      tlsSocket.on('error', (err) => {
        console.error(`❌ TLS mock error for ${hostname}:`, err.message);
        if (!clientSocket.destroyed) clientSocket.end();
      });
      
      // Timeout safety
      setTimeout(() => {
        if (!tlsSocket.destroyed) tlsSocket.end();
      }, 10000);
      
      return;
    }
  }

  // No mock match — tunnel normally
  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error(`❌ CONNECT Error:`, err.message);
    clientSocket.end();
  });

  serverSocket.on('end', () => {
    const duration = Date.now() - startTime;
    const logEntry = {
      id: Math.random().toString(36).substr(2, 9),
      url: connectUrl,
      method: 'CONNECT',
      status: 200,
      duration,
      type: 'Server',
      body: 'HTTPS (encrypted)',
      timestamp: new Date().toLocaleTimeString(),
      isManaged: true,
      source: 'proxy'
    };
    console.log(`🔓 CONNECT closed ${hostname} (${duration}ms)`);
    emitLog(logEntry);
  });
});

// --- Mock Rules REST API ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    connectedClients,
    mockRules: mockRules.length,
    activeMocks: mockRules.filter(r => r.enabled).length,
    timestamp: new Date().toISOString()
  });
});

app.get('/__mocks', (req, res) => {
  res.json(mockRules);
});

app.use(express.json());

app.post('/__mocks', (req, res) => {
  const rule = req.body;
  if (!rule.pattern) return res.status(400).json({ error: 'pattern is required' });
  const newRule = {
    id: rule.id || Date.now(),
    pattern: rule.pattern,
    method: rule.method || 'GET',
    status: rule.status || 200,
    body: rule.body || '{"status":"ok"}',
    enabled: rule.enabled !== false
  };
  mockRules.push(newRule);
  io.emit('mock-rules-sync', mockRules);
  console.log(`🎭 Mock added: ${newRule.method} *${newRule.pattern}* → ${newRule.status}`);
  res.json(newRule);
});

app.delete('/__mocks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  mockRules = mockRules.filter(r => r.id !== id);
  io.emit('mock-rules-sync', mockRules);
  res.json({ ok: true });
});

// --- Mock Endpoint: Java/backend apps call this directly ---
// Any request to /__proxy-mock/** will be matched against mock rules
// Spring Boot just overrides external URLs to: http://localhost:8888/__proxy-mock/validate
app.all('/__proxy-mock/*', async (req, res) => {
  const startTime = Date.now();
  const mockPath = req.url.replace('/__proxy-mock', '');
  const requestUrl = req.url;
  
  console.log(`🎯 ${req.method} ${requestUrl} (mock endpoint)`);
  
  // Try to match against mock rules using the path portion
  const mockMatch = mockRules.find(m => {
    if (!m.enabled) return false;
    if (m.method !== '*' && m.method !== req.method) return false;
    // Match against: the mock path, the full request URL, or the pattern as-is
    return mockPath.includes(m.pattern) || requestUrl.includes(m.pattern) || m.pattern.includes(mockPath.substring(1));
  });
  
  if (mockMatch) {
    // For dynamic mocks, generate a fresh response via LLM
    let effectiveBody;
    if (isDynamicMock(mockMatch)) {
      effectiveBody = await getDynamicBody(mockMatch, { requestBody: req.body, requestHeaders: req.headers });
    } else {
      effectiveBody = getEffectiveBody(mockMatch);
    }

    const duration = Date.now() - startTime;
    let mockBody;
    try {
      mockBody = JSON.parse(effectiveBody);
    } catch {
      mockBody = effectiveBody;
    }

    const logEntry = {
      id: Math.random().toString(36).substr(2, 9),
      url: `[mock] ${mockPath}`,
      method: req.method,
      status: mockMatch.status,
      duration,
      type: isDynamicMock(mockMatch) ? 'Dynamic Mock' : 'Mock',
      body: mockBody,
      timestamp: new Date().toLocaleTimeString(),
      isManaged: true,
      source: 'proxy'
    };

    console.log(`🎭 ${req.method} ${mockPath} → ${isDynamicMock(mockMatch) ? 'Dynamic ' : ''}Mock ${mockMatch.status} (${duration}ms)`);
    emitLog(logEntry);

    res.writeHead(mockMatch.status, {
      'Content-Type': 'application/json',
      'X-Mock-By': 'HTTPIntercept-Proxy',
      'X-Mock-Type': isDynamicMock(mockMatch) ? 'dynamic' : 'static'
    });
    return res.end(typeof effectiveBody === 'string' ? effectiveBody : JSON.stringify(effectiveBody));
  }
  
  // No mock matched
  console.log(`⚠️ No mock rule matched for ${mockPath}`);
  res.status(404).json({
    error: 'No mock rule matched',
    path: mockPath,
    method: req.method,
    availableMocks: mockRules.filter(m => m.enabled).map(m => ({ pattern: m.pattern, method: m.method })),
    hint: 'Create a mock rule in the UI with a pattern that matches this path'
  });
});

// --- AI Mock Data Generation ---
app.post('/api/ai/generate', async (req, res) => {
  const { pattern, method, status, body, model } = req.body;

  // Resolve token: header first, then env var
  const token = req.headers['x-github-token'] || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({
      error: 'No GitHub token configured',
      hint: 'Set GITHUB_TOKEN environment variable or configure in Settings'
    });
  }

  if (!pattern || !body) {
    return res.status(400).json({ error: 'pattern and body are required' });
  }

  try {
    const aiBody = await aiQueue.enqueue(() => generateAIMockBody(
      { pattern, method: method || 'GET', status: status || 200, body, model, customSystemPrompt: req.body.customSystemPrompt },
      token
    ));
    res.json({ aiBody });
  } catch (err) {
    console.error('AI generation error:', err.message);

    if (err.status === 401) {
      return res.status(401).json({ error: 'Invalid or insufficient GitHub token. Ensure the token has the "models" permission.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    }

    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

// --- Dynamic Mock Response (called per-request for dynamic mock rules) ---
app.post('/api/ai/dynamic-mock', async (req, res) => {
  const { pattern, method, status, body, description, requestBody, requestHeaders, model } = req.body;

  const token = req.headers['x-github-token'] || process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(401).json({
      error: 'No GitHub token configured',
      hint: 'Set GITHUB_TOKEN environment variable or configure in Settings'
    });
  }

  if (!pattern) {
    return res.status(400).json({ error: 'pattern is required' });
  }

  try {
    const dynamicBody = await aiQueue.enqueue(() => generateDynamicResponse(
      { pattern, method: method || 'GET', status: status || 200, body: body || '', description: description || '', requestBody, requestHeaders, model: model || aiModel },
      token
    ));
    console.log(`🤖 Dynamic mock API: ${method} ${pattern} → generated`);
    res.json({ body: dynamicBody });
  } catch (err) {
    console.error('Dynamic mock generation error:', err.message);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid or insufficient GitHub token.' });
    if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    res.status(500).json({ error: err.message || 'Dynamic mock generation failed' });
  }
});

// --- Natural Language Mock Builder ---
app.post('/api/ai/natural-language', async (req, res) => {
  const { prompt, model } = req.body;
  const token = req.headers['x-github-token'] || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({ error: 'No GitHub token configured', hint: 'Set GITHUB_TOKEN environment variable or configure in Settings' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const rules = await aiQueue.enqueue(() => generateMockFromNaturalLanguage({ prompt, model }, token));
    console.log(`🗣️ NL mock builder: "${prompt.slice(0, 50)}..." → ${rules.length} rule(s)`);
    res.json({ rules });
  } catch (err) {
    console.error('NL mock builder error:', err.message);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid or insufficient GitHub token.' });
    if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    res.status(500).json({ error: err.message || 'Natural language generation failed' });
  }
});

// --- AI Traffic Analysis ---
app.post('/api/ai/analyze', async (req, res) => {
  const { logs: clientLogs, model } = req.body;
  const token = req.headers['x-github-token'] || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({ error: 'No GitHub token configured', hint: 'Set GITHUB_TOKEN environment variable or configure in Settings' });
  }

  // Merge client-sent logs with server-buffered logs, deduplicate by id
  const allLogs = clientLogs || [];
  const serverLogs = trafficLogBuffer;
  const seen = new Set(allLogs.map(l => l.id));
  const merged = [...allLogs, ...serverLogs.filter(l => !seen.has(l.id))];

  if (merged.length === 0) {
    return res.status(400).json({ error: 'No traffic logs to analyze' });
  }

  try {
    const analysis = await aiQueue.enqueue(() => analyzeTrafficLogs({ logs: merged, model }, token));
    console.log(`🔍 AI analysis: ${analysis.insights?.length || 0} insights generated`);
    res.json(analysis);
  } catch (err) {
    console.error('AI analysis error:', err.message);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid or insufficient GitHub token.' });
    if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    res.status(500).json({ error: err.message || 'Traffic analysis failed' });
  }
});

// --- Auto Mock Suggestion ---
app.post('/api/ai/suggest-mocks', async (req, res) => {
  const { endpointStats, model } = req.body;
  const token = req.headers['x-github-token'] || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(401).json({ error: 'No GitHub token configured', hint: 'Set GITHUB_TOKEN environment variable or configure in Settings' });
  }
  if (!endpointStats || !Array.isArray(endpointStats) || endpointStats.length === 0) {
    return res.status(400).json({ error: 'endpointStats array is required' });
  }

  try {
    const suggestions = await aiQueue.enqueue(() => suggestMockRules({ endpointStats, model }, token));
    console.log(`💡 Mock suggestions: ${suggestions.length} suggestion(s)`);
    res.json({ suggestions });
  } catch (err) {
    console.error('Mock suggestion error:', err.message);
    if (err.status === 401) return res.status(401).json({ error: 'Invalid or insufficient GitHub token.' });
    if (err.status === 429) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    res.status(500).json({ error: err.message || 'Mock suggestion failed' });
  }
});

app.use(async (req, res) => {
  const startTime = Date.now();
  const targetUrl = req.url;
  
  console.log(`📤 ${req.method} ${targetUrl}`);

  const parsedUrl = url.parse(targetUrl);
  
  // If URL has protocol and host, use it as-is (forward proxy mode)
  // Otherwise, treat as reverse proxy and forward to TARGET_URL
  let target;
  let fullUrl;
  
  if (parsedUrl.protocol && parsedUrl.host) {
    // Forward proxy mode: full absolute URL (e.g., configured as system/browser proxy)
    target = `${parsedUrl.protocol}//${parsedUrl.host}`;
    fullUrl = targetUrl;
  } else {
    // Reverse proxy mode: relative path, forward to TARGET_URL
    target = TARGET_URL;
    fullUrl = `${TARGET_URL}${targetUrl}`;
    console.log(`   ↪ Forwarding to ${fullUrl}`);
  }

  // --- Check for mock match (HTTP) ---
  const mockMatch = findMockMatch(fullUrl, req.method);
  if (mockMatch) {
    // For dynamic mocks, generate a fresh response via LLM
    let effectiveBody;
    if (isDynamicMock(mockMatch)) {
      effectiveBody = await getDynamicBody(mockMatch, { requestBody: req.body, requestHeaders: req.headers });
    } else {
      effectiveBody = getEffectiveBody(mockMatch);
    }

    const duration = Date.now() - startTime;
    let mockBody;
    try {
      mockBody = JSON.parse(effectiveBody);
    } catch {
      mockBody = effectiveBody;
    }

    const logEntry = {
      id: Math.random().toString(36).substr(2, 9),
      url: fullUrl,
      method: req.method,
      status: mockMatch.status,
      duration,
      type: isDynamicMock(mockMatch) ? 'Dynamic Mock' : 'Mock',
      body: mockBody,
      timestamp: new Date().toLocaleTimeString(),
      isManaged: true,
      source: 'proxy'
    };

    console.log(`🎭 ${req.method} ${fullUrl} → ${isDynamicMock(mockMatch) ? 'Dynamic ' : ''}Mock ${mockMatch.status} (${duration}ms)`);
    emitLog(logEntry);

    res.writeHead(mockMatch.status, {
      'Content-Type': 'application/json',
      'X-Mock-By': 'HTTPIntercept-Proxy',
      'X-Mock-Type': isDynamicMock(mockMatch) ? 'dynamic' : 'static'
    });
    return res.end(typeof effectiveBody === 'string' ? effectiveBody : JSON.stringify(effectiveBody));
  }

  const oldWrite = res.write;
  const oldEnd = res.end;
  const chunks = [];

  res.write = function (chunk) {
    chunks.push(Buffer.from(chunk));
    oldWrite.apply(res, arguments);
  };

  res.end = function (chunk) {
    if (chunk) chunks.push(Buffer.from(chunk));
    
    const duration = Date.now() - startTime;
    const bodyBuffer = Buffer.concat(chunks);
    let parsedBody;
    
    try {
      parsedBody = JSON.parse(bodyBuffer.toString());
    } catch (e) {
      const bodyStr = bodyBuffer.toString();
      parsedBody = bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr;
    }

    const logEntry = {
      id: Math.random().toString(36).substr(2, 9),
      url: fullUrl,
      method: req.method,
      status: res.statusCode,
      duration,
      type: 'Server',
      body: parsedBody,
      timestamp: new Date().toLocaleTimeString(),
      isManaged: true,
      source: 'proxy'
    };

    console.log(`📥 ${req.method} ${fullUrl} - ${res.statusCode} (${duration}ms)`);
    emitLog(logEntry);
    oldEnd.apply(res, arguments);
  };

  proxy.web(req, res, { 
    target,
    changeOrigin: true
  }, (err) => {
    if (err) {
      const duration = Date.now() - startTime;
      console.error('❌ Proxy Error:', err.message);
      
      const errorLog = {
        id: Math.random().toString(36).substr(2, 9),
        url: fullUrl,
        method: req.method,
        status: 'FAIL',
        duration,
        type: 'Server',
        body: { error: err.message },
        timestamp: new Date().toLocaleTimeString(),
        isManaged: true,
        source: 'proxy'
      };
      
      emitLog(errorLog);
      
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy Error', message: err.message }));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('\n🚀 HTTP Proxy Server Started');
  console.log('================================');
  console.log(`📡 Proxy: http://localhost:${PORT}`);
  console.log(`🎯 Target: ${TARGET_URL}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`🎯 UI: http://localhost:${UI_PORT}`);
  console.log('================================\n');
  console.log('💡 Usage:');
  console.log(`   Reverse proxy: http://localhost:${PORT}/api/seasons → ${TARGET_URL}/api/seasons`);
  console.log(`   Forward proxy: configure http.proxyHost=localhost http.proxyPort=${PORT}`);
  console.log('');
  console.log('🎭 Mock External APIs (recommended for Java/Spring Boot):');
  console.log(`   Mock endpoint: http://localhost:${PORT}/__proxy-mock/<path>`);
  console.log('   1. Create mock rule in UI (e.g. pattern: "validate", method: GET)');
  console.log(`   2. In application-dev.properties:`);
  console.log(`      external.service.url=http://localhost:${PORT}/__proxy-mock`);
  console.log('   3. The proxy will match mock rules and return the mocked response\n');
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  server.close(() => process.exit(0));
});
