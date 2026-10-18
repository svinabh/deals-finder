'use strict';

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

// Live-configured mode: fake PA-API credentials are present, so the app must
// NOT fall back to the demo catalog or to crawled listings. It reports the
// honest provider failure instead.
const port = 31480;
const server = spawn(process.execPath, ['server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    OPENAI_API_KEY: '',
    AMAZON_ACCESS_KEY: 'FAKE-ACCESS-KEY-FOR-TESTS',
    AMAZON_SECRET_KEY: 'FAKE-SECRET-KEY-FOR-TESTS',
    AMAZON_PARTNER_TAG: 'teststore-21'
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

    const directory = await get('/api/providers');
    assert.strictEqual(directory.status, 200);
    assert.strictEqual(directory.data.demo_mode, false, 'Fake credentials disable demo mode.');
    const amazon = directory.data.providers.find(provider => provider.id === 'amazon_paapi');
    assert.strictEqual(amazon.configured, true);

    // live=false in live-configured mode: no saved listings, no demo leakage.
    const explicitOffline = await get('/api/deals?q=skechers&pin=283135&live=false');
    assert.strictEqual(explicitOffline.status, 200);
    assert.strictEqual(explicitOffline.data.search_mode, 'live_only');
    assert.strictEqual(explicitOffline.data.provider.status, 'live_required');
    assert.strictEqual(explicitOffline.data.total, 0);

    // Too-short query: live merchant search is not triggered.
    const tooShort = await get('/api/deals?q=s&pin=283135');
    assert.strictEqual(tooShort.data.provider.status, 'query_too_short');
    assert.strictEqual(tooShort.data.total, 0);

    // Full live attempt with invalid credentials: provider reports failure
    // honestly instead of returning demo or crawled listings.
    const failedLive = await get('/api/deals?q=skechers&pin=283135');
    assert.strictEqual(failedLive.status, 200);
    assert.strictEqual(failedLive.data.search_mode, 'live_only');
    assert.notStrictEqual(failedLive.data.provider.status, 'ok');
    assert.notStrictEqual(failedLive.data.provider.status, 'demo');
    assert.strictEqual(failedLive.data.total, 0);

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
