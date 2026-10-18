'use strict';

const fs = require('fs');
const path = require('path');

const { rankDeals, sortDeals } = require('./search_engine');
const {
  filterDealsForPincode,
  getProviderDirectory,
  hasSixDigitPincodeFormat
} = require('./provider_registry');
const { understandSearchQuery } = require('./ai_search');

const DEMO_DATA_FILE = path.join(__dirname, 'data', 'demo_deals.json');

const DEMO_PROVIDER_MESSAGE =
  'Demo mode: ye sample listings hain (demo data, live prices nahi). ' +
  'Price aur delivery retailer website par confirm karein. ' +
  'Real merchant search (Amazon PA-API/partner feeds) connect nahi hai.';

const DEMO_AI_MESSAGE =
  'AI query helper optional hai; OPENAI_API_KEY set nahi hai, isliye normal keyword search use ho raha hai.';

let demoDealsCache = null;

function isAmazonSearchConfigured() {
  return Boolean(
    process.env.AMAZON_ACCESS_KEY &&
    process.env.AMAZON_SECRET_KEY &&
    process.env.AMAZON_PARTNER_TAG
  );
}

function isDemoModeEnabled() {
  return !isAmazonSearchConfigured();
}

/**
 * Demo catalog loader. Primary path is the JSON file on disk; the static
 * require() fallback keeps the same data available inside a serverless
 * bundle where only traced files ship.
 */
function loadDemoDeals() {
  if (demoDealsCache) return demoDealsCache;
  try {
    const loaded = JSON.parse(fs.readFileSync(DEMO_DATA_FILE, 'utf8'));
    if (!Array.isArray(loaded)) throw new Error('demo_deals.json must contain an array');
    demoDealsCache = loaded.filter(deal => deal && deal.title && Number.isFinite(Number(deal.price)));
  } catch (error) {
    try {
      demoDealsCache = require('./data/demo_deals.json');
    } catch (fallbackError) {
      console.error(`[Demo catalog] Could not load demo listings: ${error.message}`);
      demoDealsCache = [];
    }
  }
  return demoDealsCache;
}

/**
 * Demo listings have no delivery verification at all, so every demo card
 * carries the same explicit "confirm on retailer website" status.
 */
function annotateDemoDelivery(deals) {
  return deals.map(deal => ({
    ...deal,
    delivery_status: 'demo_delivery_unverified'
  }));
}

function getPincodeSearchSummary(pincode, filteredDeals = []) {
  if (!pincode) return null;
  return {
    pincode,
    live_delivery_verified: filteredDeals.some(deal => deal.delivery_status === 'verified_for_pincode'),
    message: `Pincode ${pincode} applied; exact-pin delivery feeds are not connected.`
  };
}

/**
 * Shared /api/deals handler used by the local server and the Vercel
 * serverless function. `runLiveSearch(query)` is the configured Amazon
 * PA-API runner; in demo mode it is never called.
 */
async function handleDealsRequest(params = {}, { runLiveSearch = null } = {}) {
  const q = String(params.q || '').trim();
  const platform = String(params.platform || 'all').toLowerCase();
  const category = String(params.category || 'all').toLowerCase();
  const minDiscount = Number.parseInt(params.minDiscount || '0', 10);
  const sortBy = String(params.sortBy || 'best_match');
  const verifiedOnly = params.verified === 'true';
  const liveRequested = params.live !== 'false';
  const pincode = params.pin === undefined ? null : String(params.pin).trim();

  if (q.length > 120) {
    return { statusCode: 400, payload: { error: 'Search keywords must be 120 characters or fewer.' } };
  }
  if (pincode !== null && !hasSixDigitPincodeFormat(pincode)) {
    return { statusCode: 400, payload: { error: 'pin must contain exactly 6 digits.' } };
  }
  if (!Number.isInteger(minDiscount) || minDiscount < 0 || minDiscount > 100) {
    return { statusCode: 400, payload: { error: 'minDiscount must be between 0 and 100.' } };
  }

  const demoMode = isDemoModeEnabled();
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
      : DEMO_AI_MESSAGE
  };
  let providerQuery = q;
  let sourceDeals = [];

  if (demoMode) {
    provider = {
      status: 'demo',
      provider: 'demo_catalog',
      message: DEMO_PROVIDER_MESSAGE
    };
    ai = {
      status: process.env.OPENAI_API_KEY ? 'skipped_no_live_source' : 'not_configured',
      message: process.env.OPENAI_API_KEY
        ? 'AI does not invent deal data; connect a live merchant source before using AI for search.'
        : DEMO_AI_MESSAGE
    };
    sourceDeals = loadDemoDeals();
    if (verifiedOnly) {
      sourceDeals = sourceDeals.filter(deal => deal.in_stock === true);
    }
  } else if (liveRequested && q.length >= 2) {
    try {
      const interpreted = await understandSearchQuery(q, {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        baseUrl: process.env.OPENAI_BASE_URL
      });
      providerQuery = interpreted.searchQuery;
      ai = { status: interpreted.status, message: interpreted.message };
      if (!runLiveSearch) throw new Error('No live search runner configured.');
      const result = await runLiveSearch(providerQuery);
      provider = {
        status: result.status || 'error',
        provider: result.provider || 'amazon_paapi',
        message: result.message || (
          result.status === 'ok'
            ? `Checked Amazon just now; ${result.deals.length} listings returned.`
            : 'Amazon live search is unavailable.'
        )
      };
      if (result.status === 'ok') sourceDeals = result.deals || [];
    } catch (error) {
      console.error(`[Amazon PA-API] Search error: ${error.message}`);
      provider = {
        status: 'error',
        provider: 'amazon_paapi',
        message: 'Amazon live search failed. Check the server logs.'
      };
    }
  } else if (liveRequested && q.length < 2) {
    provider = {
      status: 'query_too_short',
      provider: 'amazon_paapi',
      message: 'Enter at least 2 characters to search live merchant sources.'
    };
  }

  const searchMode = demoMode ? 'demo' : 'live_only';

  if (!q && platform === 'all' && category === 'all') {
    return {
      statusCode: 200,
      payload: {
        total: 0,
        deals: [],
        provider,
        ai,
        search_query: providerQuery,
        search_mode: searchMode,
        ...(pincode ? { location: getPincodeSearchSummary(pincode) } : {})
      }
    };
  }

  // In demo mode "confirmed in stock" maps to the sample in_stock flag
  // (already applied above); live-checked verification does not exist here.
  const ranked = rankDeals(sourceDeals, {
    query: providerQuery,
    platform,
    category,
    minDiscount,
    verifiedOnly: demoMode ? false : verifiedOnly
  });
  const located = pincode
    ? (demoMode ? annotateDemoDelivery(ranked) : filterDealsForPincode(ranked, pincode))
    : ranked;
  const filtered = sortDeals(located, sortBy);

  return {
    statusCode: 200,
    payload: {
      total: filtered.length,
      deals: filtered,
      provider,
      ai,
      search_query: providerQuery,
      search_mode: searchMode,
      ...(pincode ? { location: getPincodeSearchSummary(pincode, filtered) } : {})
    }
  };
}

/**
 * Shared /api/providers handler.
 */
function buildProvidersResponse({ pincode = null } = {}) {
  if (pincode !== null && !hasSixDigitPincodeFormat(pincode)) {
    return { statusCode: 400, payload: { error: 'pin must contain exactly 6 digits.' } };
  }
  const amazonConfigured = isAmazonSearchConfigured();
  return {
    statusCode: 200,
    payload: {
      ...getProviderDirectory({ amazonConfigured, pincode }),
      demo_mode: !amazonConfigured,
      ...(amazonConfigured ? {} : {
        demo_catalog: {
          note: 'Demo mode: sample listings are shown so search, filters and sort can be tried without any merchant API. Prices and delivery must be confirmed on the retailer website.',
          listing_count: loadDemoDeals().length
        }
      }),
      ai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        provider: 'OpenAI-compatible Chat Completions',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }
    }
  };
}

/**
 * Shared /api/stats handler. `crawledDeals` is the locally crawled index
 * (kept only for maintenance); demo mode reports the demo catalog instead.
 */
function buildStatsResponse({ crawledDeals = [] } = {}) {
  const sourceDeals = isDemoModeEnabled() ? loadDemoDeals() : crawledDeals;
  const totalDeals = sourceDeals.length;
  const totalSavings = sourceDeals.reduce((acc, d) => acc + (d.savings || 0), 0);
  const avgDiscount = totalDeals
    ? Math.round(sourceDeals.reduce((acc, d) => acc + d.discount_pct, 0) / totalDeals)
    : 0;
  const platforms = [...new Set(sourceDeals.map(d => d.platform))];
  return {
    statusCode: 200,
    payload: {
      demo_mode: isDemoModeEnabled(),
      totalDeals,
      totalSavings,
      avgDiscount,
      platforms
    }
  };
}

module.exports = {
  buildProvidersResponse,
  buildStatsResponse,
  getPincodeSearchSummary,
  handleDealsRequest,
  isAmazonSearchConfigured,
  isDemoModeEnabled,
  loadDemoDeals
};
