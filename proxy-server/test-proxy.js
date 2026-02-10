// Simple test script to simulate Java Spring making API calls through proxy

const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_URL = 'http://localhost:8888';

// Create proxy agents
const httpAgent = new HttpProxyAgent(PROXY_URL);
const httpsAgent = new HttpsProxyAgent(PROXY_URL);

console.log('🧪 Testing HTTP Proxy Server\n');
console.log(`Using proxy: ${PROXY_URL}\n`);

// Test 1: HTTP request
console.log('Test 1: Making HTTP request to jsonplaceholder...');
const httpOptions = {
  hostname: 'jsonplaceholder.typicode.com',
  port: 80,
  path: '/todos/1',
  method: 'GET',
  agent: httpAgent
};

http.get(httpOptions, (res) => {
  console.log(`✅ HTTP Response: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response:', JSON.parse(data));
    console.log('\n---\n');
    
    // Test 2: HTTPS request
    setTimeout(() => {
      console.log('Test 2: Making HTTPS request to GitHub API...');
      const httpsOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: '/users/octocat',
        method: 'GET',
        headers: {
          'User-Agent': 'Node-Test-Client'
        },
        agent: httpsAgent
      };

      https.get(httpsOptions, (res) => {
        console.log(`✅ HTTPS Response: ${res.statusCode}`);
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          const json = JSON.parse(data);
          console.log(`Response: User ${json.login} (${json.name})`);
          console.log('\n✅ All tests complete!');
          console.log('Check the UI at http://localhost:3004 to see the logged requests\n');
        });
      }).on('error', (e) => {
        console.error('❌ HTTPS Error:', e.message);
      });
    }, 2000);
  });
}).on('error', (e) => {
  console.error('❌ HTTP Error:', e.message);
});
