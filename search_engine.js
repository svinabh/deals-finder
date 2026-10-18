'use strict';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'in', 'me', 'of', 'on', 'or', 'the', 'to', 'with',
  'find', 'show', 'best', 'deal', 'deals', 'price', 'buy', 'please'
]);

const SYNONYM_GROUPS = [
  ['shoe', 'shoes', 'sneaker', 'sneakers', 'footwear'],
  ['mobile', 'phone', 'smartphone', 'cellphone'],
  ['earbud', 'earbuds', 'headphone', 'headphones', 'earphone', 'earphones'],
  ['jean', 'jeans', 'denim'],
  ['fridge', 'refrigerator'],
  ['tv', 'television'],
  ['laptop', 'notebook'],
  ['cooktop', 'induction', 'infrared'],
  ['atta', 'flour'],
  ['namkeen', 'snack', 'snacks']
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) SYNONYMS.set(word, new Set(group));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseAmount(value) {
  const normalized = String(value).replace(/,/g, '').toLowerCase();
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount)) return null;
  return normalized.endsWith('k') ? amount * 1000 : amount;
}

function parseQuery(query) {
  const raw = String(query || '').trim();
  let working = raw.toLowerCase();
  let maxPrice = null;
  let size = null;

  const budgetMatch = working.match(
    /(?:under|below|less than|upto|up to|max(?:imum)?|<=|≤)\s*(?:₹\s*)?([\d,]+(?:\.\d+)?k?)/i
  ) || working.match(/₹\s*([\d,]+(?:\.\d+)?k?)/i);
  if (budgetMatch) {
    maxPrice = parseAmount(budgetMatch[1]);
    working = working.replace(budgetMatch[0], ' ');
  }

  const sizeMatch = working.match(/\b(uk|us|size)\s*[:#-]?\s*(\d{1,3}(?:\.\d)?)\b/i);
  if (sizeMatch) {
    size = { system: sizeMatch[1].toLowerCase(), value: sizeMatch[2] };
    working = working.replace(sizeMatch[0], ' ');
  }

  const tokens = normalizeText(working)
    .split(' ')
    .filter(token => token && !STOP_WORDS.has(token));

  return { raw, tokens, maxPrice, size };
}

function editDistanceAtMostOne(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
}

function tokenMatchScore(queryToken, candidateTokens) {
  let best = 0;
  for (const token of candidateTokens) {
    if (token === queryToken) return 1;
    if (
      (token.length > 3 && token === `${queryToken}s`) ||
      (queryToken.length > 3 && queryToken === `${token}s`) ||
      (token.length > 4 && queryToken.length > 2 && token.startsWith(queryToken)) ||
      (queryToken.length > 4 && token.length > 2 && queryToken.startsWith(token))
    ) {
      best = Math.max(best, 0.88);
      continue;
    }
    const synonyms = SYNONYMS.get(queryToken);
    if (synonyms && synonyms.has(token)) {
      best = Math.max(best, 0.86);
      continue;
    }
    if (
      queryToken.length >= 5 &&
      token.length >= 5 &&
      editDistanceAtMostOne(queryToken, token)
    ) {
      best = Math.max(best, 0.78);
    }
  }
  return best;
}

function getFreshness(deal, now = Date.now()) {
  const lastCheckedAt = deal.last_checked_at || deal.last_seen || deal.updated_at || null;
  const timestamp = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN;
  const ageMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;

  if (deal.source === 'amazon_paapi' && ageMs !== null && ageMs <= 30 * 60 * 1000) {
    return { status: 'live_checked', lastCheckedAt, ageMs };
  }
  if (ageMs === null) return { status: 'unknown', lastCheckedAt: null, ageMs: null };
  if (ageMs <= 6 * 60 * 60 * 1000) return { status: 'recent_snapshot', lastCheckedAt, ageMs };
  if (ageMs <= 48 * 60 * 60 * 1000) return { status: 'aging_snapshot', lastCheckedAt, ageMs };
  return { status: 'stale', lastCheckedAt, ageMs };
}

function rankDeals(deals, options = {}) {
  const query = parseQuery(options.query);
  const platform = String(options.platform || 'all').toLowerCase();
  const category = normalizeText(options.category === 'all' ? '' : options.category);
  const minDiscount = Math.max(0, Number(options.minDiscount) || 0);
  const verifiedOnly = options.verifiedOnly === true;
  const now = options.now || Date.now();

  const results = [];
  for (const deal of deals) {
    if (!deal || !deal.title || !Number.isFinite(Number(deal.price))) continue;
    if (platform !== 'all' && normalizeText(deal.platform) !== platform) continue;
    const categoryText = normalizeText(`${deal.category || ''} ${deal.subcategory || ''}`);
    if (category && !categoryText.includes(category)) continue;
    const discountPercent = Math.max(0, Number(deal.discount_pct) || 0);
    if (discountPercent < minDiscount) continue;
    if (query.maxPrice !== null && Number(deal.price) > query.maxPrice) continue;

    const freshness = getFreshness(deal, now);
    const liveInStock =
      freshness.status === 'live_checked' &&
      deal.availability_status === 'in_stock';
    if (verifiedOnly && !liveInStock) continue;

    const searchable = normalizeText([
      deal.title, deal.brand, deal.category, deal.subcategory, deal.size,
      deal.model, deal.platform
    ].join(' '));
    const candidateTokens = searchable.split(' ');
    let matched = 0;
    for (const token of query.tokens) {
      matched += tokenMatchScore(token, candidateTokens);
    }
    const matchRatio = query.tokens.length ? matched / query.tokens.length : 1;
    if (query.tokens.length && matchRatio < 0.7) continue;

    if (query.size) {
      const sizeText = normalizeText(`${deal.size || ''} ${deal.title || ''}`);
      const sizeValue = query.size.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(^|\\D)${sizeValue}($|\\D)`).test(sizeText)) continue;
      if (
        query.size.system !== 'size' &&
        !new RegExp(`\\b${query.size.system}\\b`).test(sizeText)
      ) continue;
    }

    const titleText = normalizeText(deal.title);
    const phraseBonus = query.tokens.length > 1 &&
      titleText.includes(query.tokens.join(' ')) ? 0.08 : 0;
    const brandBonus = deal.brand && query.tokens.some(token =>
      normalizeText(deal.brand).split(' ').includes(token)
    ) ? 0.05 : 0;
    const relevance = Math.min(1, matchRatio + phraseBonus + brandBonus);
    const discount = Math.max(0, Math.min(100, discountPercent));
    const rating = Math.max(0, Math.min(5, Number(deal.rating) || 0));
    const freshnessScore = freshness.status === 'live_checked' ? 1 :
      freshness.status === 'recent_snapshot' ? 0.55 :
        freshness.status === 'aging_snapshot' ? 0.25 : 0;
    const recommendationScore = Math.round(
      relevance * 70 + discount * 0.15 + freshnessScore * 10 + rating * 1
    );

    results.push({
      ...deal,
      match_score: Math.round(relevance * 100),
      recommendation_score: recommendationScore,
      freshness_status: freshness.status,
      last_checked_at: freshness.lastCheckedAt,
      availability_status: liveInStock ? 'in_stock' :
        (freshness.status === 'live_checked' ? deal.availability_status || 'unknown' : 'unknown'),
      is_verified_live: liveInStock,
      _comparison_key: normalizeText(`${deal.brand || ''} ${deal.title} ${deal.size || ''}`)
    });
  }

  const sameProductOffers = new Map();
  for (const result of results) {
    const group = sameProductOffers.get(result._comparison_key) || [];
    group.push(result);
    sameProductOffers.set(result._comparison_key, group);
  }
  for (const group of sameProductOffers.values()) {
    const prices = group.map(deal => deal.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spread = maxPrice - minPrice;
    for (const result of group) {
      result.best_price_for_match = result.price === minPrice;
      result.comparison_offer_count = group.length;
      if (spread > 0) {
        result.recommendation_score += Math.round(
          ((maxPrice - result.price) / spread) * 15
        );
      }
      delete result._comparison_key;
    }
  }

  return results;
}

function sortDeals(deals, sortBy = 'best_match') {
  const sorted = [...deals];
  if (sortBy === 'price_asc') sorted.sort((a, b) => a.price - b.price);
  else if (sortBy === 'price_desc') sorted.sort((a, b) => b.price - a.price);
  else if (sortBy === 'savings_desc') sorted.sort((a, b) => b.savings - a.savings);
  else if (sortBy === 'discount_desc') {
    sorted.sort((a, b) => b.discount_pct - a.discount_pct || b.savings - a.savings);
  } else {
    sorted.sort((a, b) =>
      b.recommendation_score - a.recommendation_score ||
      a.price - b.price
    );
  }
  return sorted;
}

module.exports = { getFreshness, parseQuery, rankDeals, sortDeals };
