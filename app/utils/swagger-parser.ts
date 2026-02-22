/**
 * Parses a Swagger / OpenAPI (2.0 or 3.x) spec and generates MockRule objects.
 *
 * Supports both JSON and YAML input (basic YAML parsing without external deps).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MockRule {
  id: number;
  pattern: string;
  method: string;
  status: number;
  body: string;
  aiBody?: string;
  aiStatus?: 'idle' | 'generating' | 'done' | 'error';
  aiError?: string;
  enabled: boolean;
}

let _idCounter = 0;
const uniqueId = () => {
  _idCounter++;
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 12), 16) + _idCounter
    : Date.now() * 1000 + Math.floor(Math.random() * 10000) + _idCounter;
};

// ---------------------------------------------------------------------------
// Minimal YAML-to-JSON converter (covers the subset used by OpenAPI specs)
// ---------------------------------------------------------------------------

function tryParseYaml(text: string): any {
  // Attempt JSON first
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to YAML parsing
  }

  // Very lightweight YAML parser – handles the flat / nested object & array
  // structures found in typical OpenAPI specs.  For edge-cases the user can
  // always paste JSON instead.
  const lines = text.split('\n');
  const root: any = {};
  const stack: { indent: number; obj: any; key?: string }[] = [{ indent: -1, obj: root }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip blank lines and full-line comments
    if (/^\s*(#.*)?$/.test(raw)) continue;

    const indent = raw.search(/\S/);
    const trimmed = raw.trim();

    // Pop stack to the right parent level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Array item (- key: value  or  - value)
    const arrayMatch = trimmed.match(/^-\s*(.*)/);
    if (arrayMatch) {
      const parentKey = stack[stack.length - 1].key;
      if (parentKey && Array.isArray(parent[parentKey])) {
        const val = parseYamlValue(arrayMatch[1]);
        if (typeof val === 'string' && val.includes(':')) {
          const obj: any = {};
          const kv = arrayMatch[1].match(/^([^:]+):\s*(.*)/);
          if (kv) {
            obj[kv[1].trim()] = parseYamlValue(kv[2]);
          }
          parent[parentKey].push(obj);
          stack.push({ indent, obj: obj, key: undefined });
        } else {
          parent[parentKey].push(val);
        }
      }
      continue;
    }

    // Key: value
    const kvMatch = trimmed.match(/^([^:]+?):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const valRaw = kvMatch[2].trim();

      if (valRaw === '' || valRaw === '|' || valRaw === '>') {
        // Nested object or block scalar – peek ahead
        const nextNonEmpty = lines.slice(i + 1).find(l => /\S/.test(l));
        const nextIndent = nextNonEmpty ? nextNonEmpty.search(/\S/) : indent + 2;
        if (nextNonEmpty && nextNonEmpty.trim().startsWith('-')) {
          parent[key] = [];
          stack.push({ indent: nextIndent, obj: parent, key });
        } else {
          parent[key] = {};
          stack.push({ indent: nextIndent, obj: parent[key], key: undefined });
        }
      } else {
        parent[key] = parseYamlValue(valRaw);
      }
      // Remember key for potential array children
      if (stack[stack.length - 1].obj === parent) {
        stack[stack.length - 1].key = key;
      }
    }
  }

  return root;
}

function parseYamlValue(raw: string): any {
  if (!raw || raw === '~' || raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Quoted string
  if (/^['"].*['"]$/.test(raw)) return raw.slice(1, -1);
  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Inline JSON object / array
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Schema → example value generator
// ---------------------------------------------------------------------------

function generateExampleFromSchema(schema: any, spec: any, depth = 0): any {
  if (!schema || depth > 8) return {};

  // Resolve $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    return generateExampleFromSchema(resolved, spec, depth + 1);
  }

  // Explicit example
  if (schema.example !== undefined) return schema.example;

  // Enum
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  const type = schema.type;

  if (type === 'object' || schema.properties) {
    const obj: any = {};
    const props = schema.properties ?? {};
    for (const [key, propSchema] of Object.entries<any>(props)) {
      obj[key] = generateExampleFromSchema(propSchema, spec, depth + 1);
    }
    // additionalProperties
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      obj['key'] = generateExampleFromSchema(schema.additionalProperties, spec, depth + 1);
    }
    return obj;
  }

  if (type === 'array') {
    const itemExample = schema.items
      ? generateExampleFromSchema(schema.items, spec, depth + 1)
      : {};
    return [itemExample];
  }

  if (type === 'string') {
    if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
    if (schema.format === 'date') return '2026-01-01';
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
    if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
    return 'string';
  }

  if (type === 'integer' || type === 'number') return schema.default ?? 0;
  if (type === 'boolean') return schema.default ?? false;

  // allOf / oneOf / anyOf
  if (schema.allOf) {
    let merged: any = {};
    for (const sub of schema.allOf) {
      const subExample = generateExampleFromSchema(sub, spec, depth + 1);
      if (typeof subExample === 'object' && subExample !== null) {
        merged = { ...merged, ...subExample };
      }
    }
    return merged;
  }
  if (schema.oneOf?.[0]) return generateExampleFromSchema(schema.oneOf[0], spec, depth + 1);
  if (schema.anyOf?.[0]) return generateExampleFromSchema(schema.anyOf[0], spec, depth + 1);

  return {};
}

function resolveRef(ref: string, spec: any): any {
  // "#/definitions/User" or "#/components/schemas/User"
  const parts = ref.replace(/^#\//, '').split('/');
  let node = spec;
  for (const p of parts) {
    node = node?.[p];
  }
  return node ?? {};
}

// ---------------------------------------------------------------------------
// Extract mock rules from a parsed spec
// ---------------------------------------------------------------------------

function extractFromOpenAPI3(spec: any): MockRule[] {
  const rules: MockRule[] = [];
  const paths = spec.paths ?? {};
  const basePath = (spec.servers?.[0]?.url ?? '').replace(/\/$/, '');

  for (const [path, methods] of Object.entries<any>(paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].indexOf(method) === -1) continue;

      const responses = operation.responses ?? {};

      // Prefer 200, then 201, then first 2xx
      const statusCode = responses['200']
        ? 200
        : responses['201']
          ? 201
          : Number(Object.keys(responses).find(s => s.startsWith('2')) ?? '200');

      const responseObj = responses[String(statusCode)] ?? responses['default'] ?? {};

      let body: any = {};

      // OpenAPI 3: content → application/json → schema / example
      const content = responseObj.content?.['application/json'] ?? responseObj.content?.['*/*'];
      if (content) {
        if (content.example !== undefined) {
          body = content.example;
        } else if (content.examples) {
          const firstExample = Object.values<any>(content.examples)[0];
          body = firstExample?.value ?? {};
        } else if (content.schema) {
          body = generateExampleFromSchema(content.schema, spec);
        }
      }

      rules.push({
        id: uniqueId(),
        pattern: basePath + path.replace(/\{[^}]+\}/g, '*'),
        method: method.toUpperCase(),
        status: statusCode,
        body: JSON.stringify(body, null, 2),
        enabled: true,
      });
    }
  }

  return rules;
}

function extractFromSwagger2(spec: any): MockRule[] {
  const rules: MockRule[] = [];
  const paths = spec.paths ?? {};
  const basePath = (spec.basePath ?? '').replace(/\/$/, '');

  for (const [path, methods] of Object.entries<any>(paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].indexOf(method) === -1) continue;

      const responses = operation.responses ?? {};
      const statusCode = responses['200']
        ? 200
        : responses['201']
          ? 201
          : Number(Object.keys(responses).find(s => s.startsWith('2')) ?? '200');

      const responseObj = responses[String(statusCode)] ?? responses['default'] ?? {};

      let body: any = {};

      // Swagger 2: schema directly on response, or examples
      if (responseObj.examples?.['application/json'] !== undefined) {
        body = responseObj.examples['application/json'];
      } else if (responseObj.schema) {
        body = generateExampleFromSchema(responseObj.schema, spec);
      }

      rules.push({
        id: uniqueId(),
        pattern: basePath + path.replace(/\{[^}]+\}/g, '*'),
        method: method.toUpperCase(),
        status: statusCode,
        body: JSON.stringify(body, null, 2),
        enabled: true,
      });
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SwaggerParseResult {
  rules: MockRule[];
  title: string;
  version: string;
  pathCount: number;
  error?: string;
}

export function parseSwaggerSpec(input: string): SwaggerParseResult {
  let spec: any;

  try {
    spec = tryParseYaml(input);
  } catch {
    return { rules: [], title: '', version: '', pathCount: 0, error: 'Failed to parse input. Ensure it is valid JSON or YAML.' };
  }

  if (!spec || typeof spec !== 'object') {
    return { rules: [], title: '', version: '', pathCount: 0, error: 'Input does not appear to be a valid Swagger/OpenAPI spec.' };
  }

  const title = spec.info?.title ?? 'Untitled API';
  const version = spec.info?.version ?? '';
  const pathCount = Object.keys(spec.paths ?? {}).length;

  let rules: MockRule[];

  if (spec.openapi && String(spec.openapi).startsWith('3')) {
    rules = extractFromOpenAPI3(spec);
  } else if (spec.swagger && String(spec.swagger).startsWith('2')) {
    rules = extractFromSwagger2(spec);
  } else {
    // Best effort – try OpenAPI 3 extraction
    rules = extractFromOpenAPI3(spec);
    if (rules.length === 0) {
      return { rules: [], title, version, pathCount, error: 'Could not detect OpenAPI version. Ensure the spec contains an "openapi" or "swagger" field.' };
    }
  }

  return { rules, title, version, pathCount };
}
