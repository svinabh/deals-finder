const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const { rankDeals, sortDeals } = require('./search_engine');
const {
  filterDealsForPincode,
  getProviderDirectory,
  hasSixDigitPincodeFormat
} = require('./provider_registry');
const { understandSearchQuery } = require('./ai_search');

function loadLocalEnv() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'deals.json');
const STATUS_FILE = path.join(DATA_DIR, 'crawler_status.json');
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';
const CRAWLER_SCRIPT = path.join(__dirname, 'scraper', 'deals_crawler.py');
const AMAZON_SEARCH_SCRIPT = path.join(__dirname, 'scraper', 'amazon_paapi.py');
const AMAZON_SEARCH_CACHE_MS = 5 * 60 * 1000;
const AMAZON_SEARCH_TIMEOUT_MS = 15000;
const AMAZON_MIN_REQUEST_INTERVAL_MS = 1100;

// Live in-memory cache of deals
let deals = [];
let isCrawling = false;
const amazonSearchCache = new Map();
const amazonSearchInFlight = new Map();
let amazonSearchQueue = Promise.resolve();
let lastAmazonSearchAt = 0;

function callAmazonSearch(query) {
  const task = new Promise(resolve => {
    const proc = spawn(PYTHON_PATH, [AMAZON_SEARCH_SCRIPT, query], {
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
        amazonSearchCache.set(query, { result, cachedAt: Date.now() });
        if (amazonSearchCache.size > 100) {
          amazonSearchCache.delete(amazonSearchCache.keys().next().value);
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

function runAmazonSearch(query) {
  const cached = amazonSearchCache.get(query);
  if (cached && Date.now() - cached.cachedAt < AMAZON_SEARCH_CACHE_MS) {
    return Promise.resolve(cached.result);
  }
  if (amazonSearchInFlight.has(query)) return amazonSearchInFlight.get(query);

  const task = amazonSearchQueue.then(async () => {
    const waitMs = Math.max(
      0,
      AMAZON_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastAmazonSearchAt)
    );
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastAmazonSearchAt = Date.now();
    return callAmazonSearch(query);
  });
  amazonSearchQueue = task.catch(() => undefined);
  const tracked = task.finally(() => amazonSearchInFlight.delete(query));
  amazonSearchInFlight.set(query, tracked);
  return tracked;
}

function reloadDeals() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(raw);
      if (!Array.isArray(loaded)) throw new Error('deals.json must contain an array');
      deals = loaded;
      console.log(`[Cache] Reloaded ${deals.length} deals into memory.`);
    }
  } catch (err) {
    console.error('Error reloading deals:', err);
  }
}

function getPincodeSearchSummary(pincode, filteredDeals = []) {
  if (!pincode) return null;
  return {
    pincode,
    live_delivery_verified: filteredDeals.some(deal => deal.delivery_status === 'verified_for_pincode'),
    message: `Pincode ${pincode} applied; exact-pin delivery feeds are not connected.`
  };
}

function isAmazonSearchConfigured() {
  return Boolean(
    process.env.AMAZON_ACCESS_KEY &&
    process.env.AMAZON_SECRET_KEY &&
    process.env.AMAZON_PARTNER_TAG
  );
}

// Initial load
reloadDeals();

// Auto reload if file updates on disk
if (fs.existsSync(DATA_FILE)) {
  fs.watchFile(DATA_FILE, { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      reloadDeals();
    }
  });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: GET /api/deals
  if (pathname === '/api/deals' && req.method === 'GET') {
    const q = String(parsedUrl.query.q || '').trim();
    const platform = String(parsedUrl.query.platform || 'all').toLowerCase();
    const category = String(parsedUrl.query.category || 'all').toLowerCase();
    const minDiscount = Number.parseInt(parsedUrl.query.minDiscount || '0', 10);
    const sortBy = String(parsedUrl.query.sortBy || 'best_match');
    const verifiedOnly = parsedUrl.query.verified === 'true';
    const liveRequested = parsedUrl.query.live !== 'false';
    const pincode = parsedUrl.query.pin === undefined
      ? null
      : String(parsedUrl.query.pin).trim();

    if (q.length > 120) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Search keywords must be 120 characters or fewer.' }));
      return;
    }
    if (pincode !== null && !hasSixDigitPincodeFormat(pincode)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'pin must contain exactly 6 digits.' }));
      return;
    }
    if (!Number.isInteger(minDiscount) || minDiscount < 0 || minDiscount > 100) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'minDiscount must be between 0 and 100.' }));
      return;
    }

    let provider = {
      status: liveRequested ? 'not_requested' : 'live_required',
      provider: 'amazon_paapi',
      message: liveRequested
        ? 'Live merchant search runs when you submit a search.'
        : 'Saved listings are not returned; enable live search to query a merchant.'
    };
    let ai = {
      status: process.env.OPENAI_API_KEY ? 'pending' : 'not_configured',
      message: process.env.OPENAI_API_KEY
        ? 'AI is preparing the retailer search query.'
        : 'AI query understanding is not configured; live search uses the original keywords.'
    };
    let providerQuery = q;
    let liveDeals = [];
    if (liveRequested && q.length >= 2) {
      if (!isAmazonSearchConfigured()) {
        provider = {
          status: 'unavailable',
          provider: 'amazon_paapi',
          message: 'Amazon live search needs approved PA-API access and credentials.'
        };
        ai = {
          status: process.env.OPENAI_API_KEY ? 'skipped_no_live_source' : 'not_configured',
          message: 'AI does not invent deal data; connect a live merchant source before using AI for search.'
        };
      } else {
        try {
          const interpreted = await understandSearchQuery(q, {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
          });
          providerQuery = interpreted.searchQuery;
          ai = { status: interpreted.status, message: interpreted.message };
          const result = await runAmazonSearch(providerQuery);
          provider = {
            status: result.status || 'error',
            provider: result.provider || 'amazon_paapi',
            message: result.message || (
              result.status === 'ok'
                ? `Checked Amazon just now; ${result.deals.length} listings returned.`
                : 'Amazon live search is unavailable.'
            )
          };
          if (result.status === 'ok') liveDeals = result.deals || [];
        } catch (error) {
          console.error(`[Amazon PA-API] Search error: ${error.message}`);
          provider = {
            status: 'error',
            provider: 'amazon_paapi',
            message: 'Amazon live search failed. Check the server logs.'
          };
        }
      }
    } else if (liveRequested && q.length < 2) {
      provider = {
        status: 'query_too_short',
        provider: 'amazon_paapi',
        message: 'Enter at least 2 characters to search live merchant sources.'
      };
    }

    if (!q && platform === 'all' && category === 'all') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total: 0,
        deals: [],
        provider,
        ai,
        search_query: providerQuery,
        search_mode: 'live_only',
        ...(pincode ? { location: getPincodeSearchSummary(pincode) } : {})
      }));
      return;
    }

    const ranked = rankDeals(liveDeals, {
      query: providerQuery,
      platform,
      category,
      minDiscount,
      verifiedOnly
    });
    const locationScoped = pincode ? filterDealsForPincode(ranked, pincode) : ranked;
    const filtered = sortDeals(locationScoped, sortBy);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: filtered.length,
      deals: filtered,
      provider,
      ai,
      search_query: providerQuery,
      search_mode: 'live_only',
      ...(pincode ? { location: getPincodeSearchSummary(pincode, filtered) } : {})
    }));
    return;
  }

  // API: GET /api/providers
  if (pathname === '/api/providers' && req.method === 'GET') {
    const pincode = parsedUrl.query.pin === undefined
      ? null
      : String(parsedUrl.query.pin).trim();
    if (pincode !== null && !hasSixDigitPincodeFormat(pincode)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'pin must contain exactly 6 digits.' }));
      return;
    }
    const amazonConfigured = isAmazonSearchConfigured();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...getProviderDirectory({ amazonConfigured, pincode }),
      ai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        provider: 'OpenAI-compatible Chat Completions',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }
    }));
    return;
  }

  // API: GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    const totalDeals = deals.length;
    const totalSavings = deals.reduce((acc, d) => acc + (d.savings || 0), 0);
    const avgDiscount = totalDeals ? Math.round(deals.reduce((acc, d) => acc + d.discount_pct, 0) / totalDeals) : 0;
    const platforms = [...new Set(deals.map(d => d.platform))];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalDeals,
      totalSavings,
      avgDiscount,
      platforms
    }));
    return;
  }

  // API: GET /api/crawler/status
  if (pathname === '/api/crawler/status' && req.method === 'GET') {
    let status = { status: isCrawling ? 'running' : 'idle', total_deals: deals.length };
    try {
      if (fs.existsSync(STATUS_FILE)) {
        status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      }
    } catch (error) {
      console.error(`[Crawler] Could not read status file: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Crawler status is temporarily unavailable.' }));
      return;
    }
    if (isCrawling) status.status = 'running';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // API: POST /api/crawler/trigger
  if (pathname === '/api/crawler/trigger' && req.method === 'POST') {
    if (isCrawling) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Crawler is already actively scanning.' }));
      return;
    }

    isCrawling = true;
    console.log('[Crawler] Background crawler execution triggered via API...');

    const proc = spawn(PYTHON_PATH, [CRAWLER_SCRIPT, '--run-once']);
    proc.on('error', error => {
      isCrawling = false;
      console.error(`[Crawler] Unable to start source scan: ${error.message}`);
      try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
          status: 'error',
          message: 'Could not start the source scan. Check Python runtime configuration.'
        }, null, 2));
      } catch (statusError) {
        console.error(`[Crawler] Could not persist scan error: ${statusError.message}`);
      }
    });

    proc.stdout.on('data', data => {
      console.log(`[Crawler stdout] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', data => {
      console.error(`[Crawler stderr] ${data.toString().trim()}`);
    });

    proc.on('close', code => {
      isCrawling = false;
      console.log(`[Crawler] Completed with exit code ${code}.`);
      if (code !== 0) {
        try {
          fs.writeFileSync(STATUS_FILE, JSON.stringify({
            status: 'error',
            message: `Source scan exited with code ${code}. Check server logs.`
          }, null, 2));
        } catch (error) {
          console.error(`[Crawler] Could not persist scan failure: ${error.message}`);
        }
      }
      reloadDeals();
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'started',
      message: 'Authorized-source scan started. Only configured provider feeds can return fresh listings.'
    }));
    return;
  }

  // API: POST /api/convert-link
  if (pathname === '/api/convert-link' && req.method === 'POST') {
    let body = '';
    let payloadTooLarge = false;
    req.on('data', chunk => {
      if (payloadTooLarge) return;
      if (body.length + chunk.length > 4096) {
        payloadTooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Link conversion payload is too large.' }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (payloadTooLarge) return;
      try {
        const { targetUrl, amazonTag } = JSON.parse(body || '{}');
        const target = new URL(String(targetUrl || ''));
        const hostname = target.hostname.toLowerCase();
        const allowedHosts = [
          'amazon.in', '.amazon.in',
          'flipkart.com', '.flipkart.com',
          'myntra.com', '.myntra.com',
          'blinkit.com', '.blinkit.com'
        ];
        const allowed = target.protocol === 'https:' && allowedHosts.some(host =>
          host.startsWith('.') ? hostname.endsWith(host) : hostname === host
        );
        if (!allowed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only supported retailer HTTPS links can be converted.' }));
          return;
        }
        if (hostname === 'amazon.in' || hostname.endsWith('.amazon.in')) {
          if (amazonTag) {
            if (!/^[a-zA-Z0-9-]{1,64}$/.test(amazonTag)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Amazon Associates tag is invalid.' }));
              return;
            }
            target.searchParams.set('tag', amazonTag);
          }
        }
        const finalUrl = target.toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ originalUrl: targetUrl, affiliateUrl: finalUrl }));
      } catch (error) {
        console.error(`[Affiliate] Invalid link-conversion request: ${error.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  // Static File Serving
  const publicDir = path.join(__dirname, 'public');
  let routePath = pathname === '/' ? '/index.html' : pathname;
  try {
    routePath = decodeURIComponent(routePath);
  } catch (e) {}
  let filePath = path.normalize(path.join(publicDir, routePath));
  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, fallback) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(fallback);
          }
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 DealsFinder Server running at http://localhost:${PORT}`);
});
