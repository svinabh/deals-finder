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

    // Without merchant credentials the app runs in clearly-labelled demo mode.
    const defaultSearch = await get('/api/deals?q=skechers&pin=283135');
    assert.strictEqual(defaultSearch.status, 200);
    assert.strictEqual(defaultSearch.data.search_mode, 'demo');
    assert.strictEqual(defaultSearch.data.provider.status, 'demo');
    assert.strictEqual(defaultSearch.data.ai.status, 'not_configured');
    assert(
      defaultSearch.data.total > 0,
      'Demo catalog should return clearly-labelled sample listings.'
    );
    for (const deal of defaultSearch.data.deals) {
      assert.strictEqual(deal.is_demo, true, 'Every demo result must be flagged is_demo.');
      assert.strictEqual(deal.is_verified_live, false, 'Demo results must never claim live verification.');
      assert.strictEqual(deal.delivery_status, 'demo_delivery_unverified');
      assert.strictEqual(deal.last_checked_at, null, 'Demo results must not fake a check timestamp.');
    }
    assert(
      defaultSearch.data.deals.every(deal => String(deal.id).startsWith('demo_')),
      'Crawled legacy listings must never be returned as search results.'
    );

    // live=false still shows the demo catalog (it is not a "saved listings" fallback).
    const explicitOffline = await get('/api/deals?q=skechers&pin=283135&live=false');
    assert.strictEqual(explicitOffline.data.search_mode, 'demo');
    assert.strictEqual(explicitOffline.data.provider.status, 'demo');
    assert(explicitOffline.data.total > 0);

    // Empty request stays a clean homepage response.
    const idle = await get('/api/deals');
    assert.strictEqual(idle.data.total, 0);
    assert.strictEqual(idle.data.search_mode, 'demo');

    // Budget parsing: every cooktop-under-3000 match must respect the cap.
    const budgetSearch = await get('/api/deals?q=infrared%20cooktop%20under%203000&pin=283135');
    assert(budgetSearch.data.total > 0, 'Budget search should match demo cooktops.');
    for (const deal of budgetSearch.data.deals) {
      assert(deal.price <= 3000, `Demo price must respect the budget cap: ${deal.title}`);
    }

    // Platform filter only returns that platform's demo listings.
    const platformSearch = await get('/api/deals?q=shoes&platform=myntra&pin=283135');
    assert(platformSearch.data.total > 0);
    for (const deal of platformSearch.data.deals) {
      assert.strictEqual(deal.platform, 'Myntra');
    }

    // Minimum-discount filter honours the threshold.
    const discountSearch = await get('/api/deals?q=earbuds&minDiscount=50&pin=283135');
    assert(discountSearch.data.total > 0);
    for (const deal of discountSearch.data.deals) {
      assert(deal.discount_pct >= 50);
    }

    // Sort by price ascending is actually sorted.
    const sortedSearch = await get('/api/deals?q=shoes&sortBy=price_asc&pin=283135');
    const prices = sortedSearch.data.deals.map(deal => deal.price);
    assert(sortedSearch.data.total > 1);
    for (let i = 1; i < prices.length; i += 1) {
      assert(prices[i - 1] <= prices[i], 'price_asc must sort ascending.');
    }

    // Confirmed-in-stock filter drops the sample out-of-stock listings.
    const verifiedSearch = await get('/api/deals?q=shoes&verified=true&pin=283135');
    assert(verifiedSearch.data.total > 0);
    assert(
      verifiedSearch.data.deals.every(deal => deal.in_stock === true),
      'verified=true must exclude demo listings marked out of stock.'
    );

    // Hinglish-style trending chip still finds the Godrej sample item.
    const brandSearch = await get('/api/deals?q=Godrej%20Genteel&pin=283135');
    assert(brandSearch.data.deals.some(deal => deal.brand === 'Godrej'));

    // Prefix noise guard: a "shoes" search must not return jeans via the
    // single-letter token that "Levi's" produces.
    const shoesSearch = await get('/api/deals?q=shoes&pin=283135');
    assert(
      shoesSearch.data.deals.every(deal => !/jeans/i.test(deal.title)),
      '"shoes" search must not match jeans.'
    );

    // Validation errors stay unchanged.
    const badPin = await get('/api/deals?q=shoes&pin=12');
    assert.strictEqual(badPin.status, 400);
    const badDiscount = await get('/api/deals?q=shoes&minDiscount=150');
    assert.strictEqual(badDiscount.status, 400);

    // Demo-mode stats and provider directory are honest about the mode.
    const stats = await get('/api/stats');
    assert.strictEqual(stats.data.demo_mode, true);
    assert(stats.data.totalDeals > 0);
    const directory = await get('/api/providers');
    assert.strictEqual(directory.data.demo_mode, true);
    assert(directory.data.demo_catalog && directory.data.demo_catalog.listing_count > 0);

    console.log('Demo search/filter/sort checks passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
