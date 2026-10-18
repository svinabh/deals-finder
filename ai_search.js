'use strict';

const https = require('https');

const MAX_QUERY_LENGTH = 120;
const AI_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function extractSearchQuery(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error('AI search returned invalid JSON.');
  }

  if (!parsed || typeof parsed.search_query !== 'string') {
    throw new Error('AI search did not return a search_query.');
  }
  const searchQuery = parsed.search_query.replace(/\s+/g, ' ').trim();
  if (!searchQuery || searchQuery.length > MAX_QUERY_LENGTH) {
    throw new Error('AI search query must contain 1 to 120 characters.');
  }
  return searchQuery;
}

function requestSearchQuery(query, { apiKey, model = 'gpt-4o-mini' }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Rewrite the shopper request as a concise retailer product-search query. Translate Hindi/Hinglish product terms to common English shopping terms when useful. Keep the brand and model. Preserve every user-provided size and numeric budget exactly; do not remove, change, or invent them. Do not invent a specific product model. Return only JSON: {"search_query":"..."}'
        },
        { role: 'user', content: String(query).slice(0, MAX_QUERY_LENGTH) }
      ]
    });
    let responseBody = '';
    const request = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, response => {
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBody += chunk;
        if (responseBody.length > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('AI search response exceeded the size limit.'));
        }
      });
      response.on('end', () => {
        let body;
        try {
          body = JSON.parse(responseBody);
        } catch (error) {
          reject(new Error(`AI search returned invalid JSON (HTTP ${response.statusCode || 'unknown'}).`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const providerMessage = body.error && body.error.message;
          reject(new Error(`AI search request failed (HTTP ${response.statusCode}): ${providerMessage || 'provider error'}`));
          return;
        }
        const content = body.choices && body.choices[0] &&
          body.choices[0].message && body.choices[0].message.content;
        try {
          resolve(extractSearchQuery(content));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(AI_TIMEOUT_MS, () => {
      request.destroy(new Error('AI search timed out.'));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function understandSearchQuery(query, options = {}) {
  const originalQuery = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!originalQuery) {
    throw new Error('Enter a product keyword to search.');
  }
  if (!options.apiKey) {
    return {
      searchQuery: originalQuery,
      status: 'not_configured',
      message: 'AI query understanding is not configured; searching the original keywords.'
    };
  }
  try {
    const searchQuery = await requestSearchQuery(originalQuery, options);
    return {
      searchQuery,
      status: 'ok',
      message: 'AI understood the product request.'
    };
  } catch (error) {
    console.error(`[AI search] Query understanding failed: ${error.message}`);
    return {
      searchQuery: originalQuery,
      status: 'error',
      message: 'AI query understanding failed; searching the original keywords.'
    };
  }
}

module.exports = { extractSearchQuery, understandSearchQuery };
