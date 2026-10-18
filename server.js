const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const {
  buildProvidersResponse,
  buildStatsResponse,
  handleDealsRequest,
  isAmazonSearchConfigured
} = require('./search_pipeline');
const { createAmazonSearchRunner } = require('./amazon_live_search');

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

// Live in-memory cache of deals
let deals = [];
let isCrawling = false;
const runAmazonSearch = createAmazonSearchRunner({
  pythonPath: PYTHON_PATH,
  scriptPath: AMAZON_SEARCH_SCRIPT
});

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
    const { statusCode, payload } = await handleDealsRequest(parsedUrl.query, {
      runLiveSearch: runAmazonSearch
    });
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  // API: GET /api/providers
  if (pathname === '/api/providers' && req.method === 'GET') {
    const pincode = parsedUrl.query.pin === undefined
      ? null
      : String(parsedUrl.query.pin).trim();
    const { statusCode, payload } = buildProvidersResponse({ pincode });
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  // API: GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    const { statusCode, payload } = buildStatsResponse({ crawledDeals: deals });
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
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
