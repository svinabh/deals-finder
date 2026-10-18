const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'deals.json');
const STATUS_FILE = path.join(DATA_DIR, 'crawler_status.json');
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';
const CRAWLER_SCRIPT = path.join(__dirname, 'scraper', 'deals_crawler.py');

// Live in-memory cache of deals
let deals = [];
let isCrawling = false;

function reloadDeals() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      deals = JSON.parse(raw);
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

const server = http.createServer((req, res) => {
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
    const q = (parsedUrl.query.q || '').toLowerCase().trim();
    const platform = (parsedUrl.query.platform || 'all').toLowerCase();
    const category = (parsedUrl.query.category || 'all').toLowerCase();
    const minDiscount = parseInt(parsedUrl.query.minDiscount || '0', 10);
    const sortBy = parsedUrl.query.sortBy || 'discount_desc';
    const verifiedOnly = parsedUrl.query.verified === 'true';

    // If no search query and platform is all, return empty (clean search tool state)
    if (!q && platform === 'all' && category === 'all') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total: 0,
        deals: []
      }));
      return;
    }

    let filtered = deals.filter(d => {
      if (platform !== 'all' && d.platform.toLowerCase() !== platform) return false;
      if (category !== 'all' && !d.category.toLowerCase().includes(category) && !d.subcategory.toLowerCase().includes(category)) return false;
      if (d.discount_pct < minDiscount) return false;
      if (verifiedOnly && !d.in_stock) return false;
      if (q) {
        const text = `${d.title} ${d.brand} ${d.category} ${d.size} ${d.platform}`.toLowerCase();
        const words = q.split(/\s+/);
        const match = words.every(w => text.includes(w));
        if (!match) return false;
      }
      return true;
    });

    if (sortBy === 'discount_desc') {
      filtered.sort((a, b) => b.discount_pct - a.discount_pct || b.savings - a.savings);
    } else if (sortBy === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'savings_desc') {
      filtered.sort((a, b) => b.savings - a.savings);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: filtered.length,
      deals: filtered
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
    } catch (e) {}
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

    proc.stdout.on('data', data => {
      console.log(`[Crawler stdout] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', data => {
      console.error(`[Crawler stderr] ${data.toString().trim()}`);
    });

    proc.on('close', code => {
      isCrawling = false;
      console.log(`[Crawler] Completed with exit code ${code}.`);
      reloadDeals();
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'started',
      message: 'Live crawler started across Amazon, Flipkart, Myntra, and Blinkit.'
    }));
    return;
  }

  // API: POST /api/convert-link
  if (pathname === '/api/convert-link' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { targetUrl, amazonTag } = JSON.parse(body || '{}');
        let finalUrl = targetUrl;
        if (targetUrl && targetUrl.includes('amazon.in')) {
          const tag = amazonTag || 'dealsfinder-21';
          const sep = targetUrl.includes('?') ? '&' : '?';
          finalUrl = `${targetUrl}${sep}tag=${tag}`;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ originalUrl: targetUrl, affiliateUrl: finalUrl }));
      } catch (e) {
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
