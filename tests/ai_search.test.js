'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const https = require('https');
const { extractSearchQuery, understandSearchQuery } = require('../ai_search');

async function run() {
  assert.strictEqual(
    extractSearchQuery('{"search_query":"running shoes under 3000"}'),
    'running shoes under 3000'
  );
  assert.throws(
    () => extractSearchQuery('{"search_query":""}'),
    /1 to 120 characters/
  );
  assert.throws(
    () => extractSearchQuery('{"query":"shoes"}'),
    /did not return a search_query/
  );

  const passthrough = await understandSearchQuery('saste running shoes', { apiKey: '' });
  assert.strictEqual(passthrough.searchQuery, 'saste running shoes');
  assert.strictEqual(passthrough.status, 'not_configured');
  assert(passthrough.message.includes('original keywords'));

  const originalRequest = https.request;
  let requestOptions;
  let requestPayload;
  https.request = (options, onResponse) => {
    requestOptions = options;
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = error => process.nextTick(() => request.emit('error', error));
    request.end = payload => {
      requestPayload = JSON.parse(payload);
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        onResponse(response);
        response.emit('data', JSON.stringify({
          choices: [{ message: { content: '{"search_query":"running shoes under 3000 UK 7"}' } }]
        }));
        response.emit('end');
      });
    };
    return request;
  };
  try {
    const rewritten = await understandSearchQuery('jogging ke joote under 3000 UK 7', {
      apiKey: 'unit-test-key',
      model: 'unit-test-model'
    });
    assert.strictEqual(rewritten.status, 'ok');
    assert.strictEqual(rewritten.searchQuery, 'running shoes under 3000 UK 7');
    assert.strictEqual(requestOptions.hostname, 'api.openai.com');
    assert.strictEqual(requestOptions.path, '/v1/chat/completions');
    assert.strictEqual(requestPayload.model, 'unit-test-model');
    assert.strictEqual(requestPayload.messages[1].content, 'jogging ke joote under 3000 UK 7');
  } finally {
    https.request = originalRequest;
  }

  console.log('AI query understanding checks passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
