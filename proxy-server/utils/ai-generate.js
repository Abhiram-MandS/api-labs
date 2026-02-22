const OpenAI = require('openai');

let clientInstance = null;
let clientToken = null;

function getClient(token) {
  if (!clientInstance || clientToken !== token) {
    clientInstance = new OpenAI({
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: token,
    });
    clientToken = token;
  }
  return clientInstance;
}

// --- Rate-limit queue with exponential back-off ---
class RateLimitQueue {
  constructor({ concurrency = 3, baseDelay = 500, maxDelay = 30000, maxRetries = 3 } = {}) {
    this.concurrency = concurrency;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.maxRetries = maxRetries;
    this.running = 0;
    this.queue = [];
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, retries: 0 });
      this._drain();
    });
  }

  _drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      this.running++;
      this._run(item);
    }
  }

  async _run(item) {
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      if (err.status === 429 && item.retries < this.maxRetries) {
        item.retries++;
        const delay = Math.min(this.baseDelay * Math.pow(2, item.retries), this.maxDelay);
        console.log(`⏳ Rate limited, retrying in ${delay}ms (attempt ${item.retries}/${this.maxRetries})`);
        setTimeout(() => {
          this.queue.unshift(item);
          this._drain();
        }, delay);
      } else {
        item.reject(err);
      }
    } finally {
      this.running--;
      this._drain();
    }
  }
}

const aiQueue = new RateLimitQueue({ concurrency: 3, baseDelay: 1000 });

// --- AI Mock Body Generation ---
async function generateAIMockBody({ pattern, method, status, body, model = 'gpt-4o-mini', customSystemPrompt }, token) {
  const client = getClient(token);

  const defaultSystemPrompt = `You are an API mock data generator. Given an API endpoint pattern, HTTP method, status code, and a template JSON response body, generate a realistic version of the response body with believable, contextually appropriate data.

Rules:
1. PRESERVE the exact JSON structure (same keys, same nesting, same array lengths).
2. REPLACE placeholder values (like "string", 0, false, "user@example.com") with realistic, contextually appropriate data based on the field names and the API endpoint.
3. For arrays, generate 2-3 items with varied realistic data.
4. Use realistic names, emails, dates, IDs, prices, descriptions, etc.
5. Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.
6. If the template is not valid JSON, return it unchanged.`;

  const systemPrompt = customSystemPrompt || defaultSystemPrompt;

  const userPrompt = `API Endpoint: ${method} ${pattern}
Status Code: ${status}
Template Response Body:
${body}

Generate a realistic version of this response body:`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from AI model');
  }

  // Validate it is parseable JSON
  JSON.parse(content);
  return content;
}

// --- Natural Language Mock Builder ---
async function generateMockFromNaturalLanguage({ prompt, model = 'gpt-4o-mini' }, token) {
  const client = getClient(token);

  const systemPrompt = `You are a mock rule generator. Given a natural language description, generate one or more mock rules for an HTTP interceptor tool.

Each mock rule must be a JSON object with these fields:
- "pattern": string — the URL path or pattern to match (e.g. "/api/v1/users")
- "method": string — HTTP method: GET, POST, PUT, DELETE, or PATCH
- "status": number — HTTP status code (e.g. 200, 201, 404)
- "body": string — a JSON string representing the response body

Rules:
1. Always return a JSON array of mock rule objects, even for a single rule.
2. The "body" field MUST be a JSON string (escaped), not a raw object.
3. Generate realistic, contextually appropriate data in the body.
4. If the user asks for CRUD mocks, generate GET (list), GET (single), POST, PUT, DELETE rules.
5. Infer reasonable URL patterns from the description.
6. Return ONLY the JSON array. No markdown code fences, no explanation, no extra text.`;

  const userPrompt = `Generate mock rules for: ${prompt}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from AI model');
  }

  const rules = JSON.parse(content);
  if (!Array.isArray(rules)) {
    throw new Error('Expected an array of mock rules');
  }

  // Validate and normalize each rule
  return rules.map(rule => ({
    pattern: String(rule.pattern || '/'),
    method: String(rule.method || 'GET').toUpperCase(),
    status: Number(rule.status || 200),
    body: typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body, null, 2),
  }));
}

// --- AI Request Analysis ---
async function analyzeTrafficLogs({ logs, model = 'gpt-4o-mini' }, token) {
  const client = getClient(token);

  const systemPrompt = `You are an HTTP traffic analyst. Given a list of captured HTTP request/response log entries, analyze the traffic and produce insights.

Return a JSON object with these fields:
- "insights": array of insight objects, each with:
  - "type": "error" | "warning" | "info" | "suggestion"
  - "title": short headline (max 60 chars)
  - "description": explanation (1-2 sentences)
  - "affectedUrls": array of related URLs (can be empty)
  - "severity": "high" | "medium" | "low"
- "summary": object with:
  - "totalRequests": number
  - "errorRate": string (percentage)
  - "avgDuration": string (e.g. "245ms")
  - "topEndpoints": array of { "url": string, "count": number } (top 5)
  - "statusBreakdown": object of { "2xx": n, "3xx": n, "4xx": n, "5xx": n, "fail": n }

Analysis rules:
1. Flag repeated 4xx/5xx errors on the same endpoint.
2. Identify unusually slow responses (> 2x the average duration).
3. Suggest mock rules for frequently called external endpoints.
4. Note any patterns (burst traffic, sequential calls, etc.).
5. Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;

  // Summarize logs to fit token limits
  const summarized = logs.slice(0, 50).map(l => ({
    method: l.method,
    url: l.url,
    status: l.status,
    duration: l.duration,
    type: l.type,
    source: l.source,
    timestamp: l.timestamp,
  }));

  const userPrompt = `Analyze these ${summarized.length} HTTP log entries:\n${JSON.stringify(summarized, null, 2)}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from AI model');
  }

  return JSON.parse(content);
}

// --- Auto Mock Suggestion ---
async function suggestMockRules({ endpointStats, model = 'gpt-4o-mini' }, token) {
  const client = getClient(token);

  const systemPrompt = `You are an API mock rule advisor. Given endpoint statistics from observed traffic, suggest which endpoints should have mock rules created and generate the mock rule data.

Return a JSON array of suggestion objects, each with:
- "pattern": the URL pattern to mock
- "method": HTTP method
- "status": suggested status code
- "body": a realistic JSON response body (as a JSON string)
- "reason": why this mock is recommended (1 sentence)
- "confidence": "high" | "medium" | "low"

Rules:
1. Prioritize endpoints called 3+ times.
2. Prioritize external API calls over local ones.
3. Generate realistic response bodies based on the endpoint path.
4. Return ONLY valid JSON. No markdown, no extra text.`;

  const userPrompt = `Suggest mock rules based on these observed endpoints:\n${JSON.stringify(endpointStats, null, 2)}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from AI model');
  }

  const rules = JSON.parse(content);
  if (!Array.isArray(rules)) {
    throw new Error('Expected an array of suggestions');
  }

  return rules;
}

// --- Dynamic Mock Response Generation ---
// Called on every request for rules with mockType === 'dynamic'.
// Uses the natural-language `description` plus the template `body`
// to produce a fresh, realistic response each time.
async function generateDynamicResponse({ pattern, method, status, body, description, requestBody, requestHeaders, model = 'gpt-4o-mini' }, token) {
  const client = getClient(token);

  const systemPrompt = `You are a live API mock server. You receive the endpoint info and a natural-language description of what the API does, along with an optional JSON template for the response shape.

Your job is to generate a FRESH, realistic JSON response body that matches the description and the template structure. Each call should produce slightly different but plausible data (e.g. different IDs, names, timestamps, values).

Rules:
1. PRESERVE the exact JSON structure from the template (same keys, same nesting, same types).
2. Generate varied, realistic data each time — never return the exact same values twice.
3. Respect the API description to determine the semantics of each field.
4. If a request body is provided, use it as context (e.g. for POST/PUT, echo back relevant fields).
5. For arrays, generate 2-5 items with varied data.
6. Use realistic names, emails, dates (ISO 8601), UUIDs, prices, etc.
7. Return ONLY valid JSON. No markdown, no explanation, no extra text.
8. If the template is empty or not valid JSON, infer a reasonable response structure from the description.`;

  let userPrompt = `API Endpoint: ${method} ${pattern}\nStatus Code: ${status}`;
  if (description) {
    userPrompt += `\n\nAPI Description:\n${description}`;
  }
  if (body) {
    userPrompt += `\n\nResponse Template:\n${body}`;
  }
  if (requestBody) {
    userPrompt += `\n\nIncoming Request Body:\n${typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody, null, 2)}`;
  }
  if (requestHeaders) {
    userPrompt += `\n\nRequest Headers:\n${JSON.stringify(requestHeaders, null, 2)}`;
  }
  userPrompt += `\n\nGenerate a fresh, realistic response:`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.9,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from AI model');
  }

  // Validate it is parseable JSON
  JSON.parse(content);
  return content;
}

module.exports = {
  generateAIMockBody,
  generateMockFromNaturalLanguage,
  analyzeTrafficLogs,
  suggestMockRules,
  generateDynamicResponse,
  aiQueue,
  RateLimitQueue,
};
