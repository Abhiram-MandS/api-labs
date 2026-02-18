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

async function generateAIMockBody({ pattern, method, status, body, model = 'gpt-4o-mini' }, token) {
  const client = getClient(token);

  const systemPrompt = `You are an API mock data generator. Given an API endpoint pattern, HTTP method, status code, and a template JSON response body, generate a realistic version of the response body with believable, contextually appropriate data.

Rules:
1. PRESERVE the exact JSON structure (same keys, same nesting, same array lengths).
2. REPLACE placeholder values (like "string", 0, false, "user@example.com") with realistic, contextually appropriate data based on the field names and the API endpoint.
3. For arrays, generate 2-3 items with varied realistic data.
4. Use realistic names, emails, dates, IDs, prices, descriptions, etc.
5. Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.
6. If the template is not valid JSON, return it unchanged.`;

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

module.exports = { generateAIMockBody };
