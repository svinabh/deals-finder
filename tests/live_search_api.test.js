'use strict';

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const port = 31479;
const server = spawn(process.execPath, ['server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    OPENAI_API_KEY: '',
    AMAZON_ACCESS_KEY: '',
    AMAZON_SECRET_KEY: '',
    AMAZON_PARTNER_TAG: ''
  },
  stdio: ['ignore', 'ignore', 'pipe']
});
let serverStderr = '';
server.stderr.on('data', chunk => { serverStderr += chunk.toString(); });

function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        data: JSON.parse(body)
      }));
    });
    request.on('error', reject);
  });
}

async function run() {
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${serverStderr}`);
      try {
        await get('/api/providers');
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert(ready, `Test server did not start: ${serverStderr}`);

    const defaultSearch = await get('/api/deals?q=skechers&pin=283135');
    assert.strictEqual(defaultSearch.status, 200);
    assert.strictEqual(defaultSearch.data.search_mode, 'live_only');
    assert.strictEqual(defaultSearch.data.ai.status, 'not_configured');
    assert.strictEqual(defaultSearch.data.provider.status, 'unavailable');
    assert.strictEqual(defaultSearch.data.total, 0, 'Saved listings must not be used as live fallback.');

    const explicitOffline = await get('/api/deals?q=skechers&pin=283135&live=false');
    assert.strictEqual(explicitOffline.data.search_mode, 'live_only');
    assert.strictEqual(explicitOffline.data.provider.status, 'live_required');
    assert.strictEqual(explicitOffline.data.total, 0);

    console.log('Live-only search API checks passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
