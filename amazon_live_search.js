'use strict';

const { spawn } = require('child_process');
const path = require('path');

const AMAZON_SEARCH_CACHE_MS = 5 * 60 * 1000;
const AMAZON_SEARCH_TIMEOUT_MS = 15000;
const AMAZON_MIN_REQUEST_INTERVAL_MS = 1100;

/**
 * Creates a queued, rate-limited Amazon PA-API search runner.
 * Returns an async function: query -> provider result
 * ({ status, provider, deals?, message? }).
 */
function createAmazonSearchRunner({ pythonPath = 'python3', scriptPath } = {}) {
  const resolvedScriptPath = scriptPath ||
    path.join(__dirname, 'scraper', 'amazon_paapi.py');
  const searchCache = new Map();
  const searchInFlight = new Map();
  let searchQueue = Promise.resolve();
  let lastSearchAt = 0;

  function callSearch(query) {
    const task = new Promise(resolve => {
      const proc = spawn(pythonPath, [resolvedScriptPath, query], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (result.status === 'ok' || result.status === 'unavailable') {
          searchCache.set(query, { result, cachedAt: Date.now() });
          if (searchCache.size > 100) {
            searchCache.delete(searchCache.keys().next().value);
          }
        }
        resolve(result);
      };
      const timeout = setTimeout(() => {
        proc.kill();
        finish({
          status: 'error',
          provider: 'amazon_paapi',
          message: 'Amazon live search timed out. Try again in a moment.'
        });
      }, AMAZON_SEARCH_TIMEOUT_MS);

      proc.stdout.on('data', chunk => {
        stdout += chunk.toString();
        if (stdout.length > 2 * 1024 * 1024) {
          proc.kill();
          finish({
            status: 'error',
            provider: 'amazon_paapi',
            message: 'Amazon returned an unexpectedly large response.'
          });
        }
      });
      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
        if (stderr.length > 4096) stderr = stderr.slice(-4096);
      });
      proc.on('error', error => {
        console.error(`[Amazon PA-API] Unable to start provider: ${error.message}`);
        finish({
          status: 'error',
          provider: 'amazon_paapi',
          message: 'Amazon live search could not start. Check the configured Python runtime.'
        });
      });
      proc.on('close', code => {
        if (settled) return;
        if (code !== 0) {
          console.error(`[Amazon PA-API] Provider exited ${code}: ${stderr.trim()}`);
          finish({
            status: 'error',
            provider: 'amazon_paapi',
            message: 'Amazon live search failed. Check provider configuration and logs.'
          });
          return;
        }
        try {
          const result = JSON.parse(stdout);
          finish(result);
        } catch (error) {
          console.error(`[Amazon PA-API] Invalid provider response: ${error.message}`);
          finish({
            status: 'error',
            provider: 'amazon_paapi',
            message: 'Amazon live search returned an invalid response.'
          });
        }
      });
    });
    return task;
  }

  return function runAmazonSearch(query) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.cachedAt < AMAZON_SEARCH_CACHE_MS) {
      return Promise.resolve(cached.result);
    }
    if (searchInFlight.has(query)) return searchInFlight.get(query);

    const task = searchQueue.then(async () => {
      const waitMs = Math.max(
        0,
        AMAZON_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastSearchAt)
      );
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastSearchAt = Date.now();
      return callSearch(query);
    });
    searchQueue = task.catch(() => undefined);
    const tracked = task.finally(() => searchInFlight.delete(query));
    searchInFlight.set(query, tracked);
    return tracked;
  };
}

module.exports = { createAmazonSearchRunner };
