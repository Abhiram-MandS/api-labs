/**
 * Converts MockRule[] into a Postman Collection v2.1 JSON string.
 *
 * Each mock rule becomes a request item with the method, URL pattern,
 * a pre-set example response body, and relevant headers.
 */

interface MockRule {
  id: number;
  pattern: string;
  method: string;
  status: number;
  body: string;
  enabled: boolean;
}

interface PostmanHeader {
  key: string;
  value: string;
  type: string;
}

interface PostmanUrl {
  raw: string;
  protocol?: string;
  host?: string[];
  path?: string[];
}

interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: {
    mode: string;
    raw: string;
    options?: { raw: { language: string } };
  };
}

interface PostmanResponse {
  name: string;
  status: string;
  code: number;
  header: PostmanHeader[];
  body: string;
}

interface PostmanItem {
  name: string;
  request: PostmanRequest;
  response: PostmanResponse[];
}

interface PostmanCollection {
  info: {
    name: string;
    description: string;
    schema: string;
    _postman_id?: string;
  };
  item: PostmanItem[];
}

function parsePattern(pattern: string): PostmanUrl {
  // If it looks like a full URL, parse it
  if (/^https?:\/\//.test(pattern)) {
    try {
      const url = new URL(pattern);
      return {
        raw: pattern,
        protocol: url.protocol.replace(':', ''),
        host: url.hostname.split('.'),
        path: url.pathname.split('/').filter(Boolean),
      };
    } catch {
      // fall through
    }
  }

  // Treat as a path — use a placeholder host
  const cleanPath = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  return {
    raw: `{{baseUrl}}/${cleanPath}`,
    host: ['{{baseUrl}}'],
    path: cleanPath.split('/').filter(Boolean),
  };
}

function statusText(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
  };
  return map[code] ?? 'OK';
}

export function mocksToPostmanCollection(
  mocks: MockRule[],
  collectionName = 'API Labs — Mock Rules',
): string {
  const items: PostmanItem[] = mocks.map((mock) => {
    const url = parsePattern(mock.pattern);
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(mock.method);

    const request: PostmanRequest = {
      method: mock.method,
      header: [
        { key: 'Content-Type', value: 'application/json', type: 'text' },
        { key: 'Accept', value: 'application/json', type: 'text' },
      ],
      url,
    };

    if (hasBody) {
      request.body = {
        mode: 'raw',
        raw: '{}',
        options: { raw: { language: 'json' } },
      };
    }

    const response: PostmanResponse = {
      name: `${mock.method} ${mock.pattern} — ${mock.status}`,
      status: statusText(mock.status),
      code: mock.status,
      header: [
        { key: 'Content-Type', value: 'application/json', type: 'text' },
      ],
      body: mock.body,
    };

    return {
      name: `${mock.method} ${mock.pattern}`,
      request,
      response: [response],
    };
  });

  const collection: PostmanCollection = {
    info: {
      name: collectionName,
      description: `Exported from API Labs on ${new Date().toISOString().slice(0, 10)}. Contains ${mocks.length} mock rule(s).`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };

  return JSON.stringify(collection, null, 2);
}
