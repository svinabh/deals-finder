'use strict';

const assert = require('assert');
const { parseQuery, rankDeals, sortDeals } = require('../search_engine');

const now = Date.parse('2026-10-18T18:00:00Z');
const products = [
  {
    id: 'right-size',
    title: "Skechers Women's Go Run Running Shoe",
    brand: 'Skechers',
    platform: 'Amazon',
    price: 2600,
    mrp: 4000,
    savings: 1400,
    discount_pct: 35,
    size: 'UK 7',
    in_stock: true,
    last_seen: '2026-10-18T17:30:00Z'
  },
  {
    id: 'over-budget',
    title: "Skechers Women's Go Run Running Shoe",
    brand: 'Skechers',
    platform: 'Myntra',
    price: 3100,
    mrp: 4000,
    savings: 900,
    discount_pct: 23,
    size: 'UK 7',
    in_stock: true,
    last_seen: '2026-10-18T17:30:00Z'
  },
  {
    id: 'wrong-size',
    title: "Skechers Women's Go Run Running Shoe",
    brand: 'Skechers',
    platform: 'Flipkart',
    price: 2200,
    mrp: 4000,
    savings: 1800,
    discount_pct: 45,
    size: 'UK 8',
    in_stock: true,
    last_seen: '2026-10-18T17:30:00Z'
  },
  {
    id: 'typo-match',
    title: 'Skechers Performance Running Shoes',
    brand: 'Skechers',
    platform: 'Amazon',
    price: 1800,
    mrp: 2500,
    savings: 700,
    discount_pct: 28,
    size: 'UK 8',
    in_stock: true,
    last_seen: '2026-10-18T17:30:00Z'
  }
];

const intent = parseQuery("Skechers UK 7 under ₹3,000");
assert.strictEqual(intent.maxPrice, 3000);
assert.deepStrictEqual(intent.size, { system: 'uk', value: '7' });
assert.deepStrictEqual(intent.tokens, ['skechers']);

const sizeAndBudgetResults = rankDeals(products, {
  query: "Skechers UK 7 under ₹3,000",
  now
});
assert.deepStrictEqual(sizeAndBudgetResults.map(item => item.id), ['right-size']);

const typoResults = rankDeals(products, { query: 'sketchers running shoes', now });
assert(typoResults.some(item => item.id === 'typo-match'));
assert(typoResults.some(item => item.id === 'over-budget'));

const cachedButNotVerified = rankDeals([{
  ...products[0],
  source: undefined,
  in_stock: true
}], {
  query: 'skechers',
  verifiedOnly: true,
  now
});
assert.strictEqual(cachedButNotVerified.length, 0);

const unknownFreshness = rankDeals([{
  ...products[0],
  last_seen: undefined,
  in_stock: true
}], { query: 'skechers', now });
assert.strictEqual(unknownFreshness[0].freshness_status, 'unknown');
assert.strictEqual(unknownFreshness[0].availability_status, 'unknown');

const sorted = sortDeals(sizeAndBudgetResults, 'best_match');
assert.strictEqual(sorted[0].id, 'right-size');

const sameProduct = [
  {
    id: 'cheap',
    title: 'Example wireless headphones model 55',
    brand: 'Example',
    platform: 'Amazon',
    price: 4200,
    mrp: 5000,
    savings: 800,
    discount_pct: 16,
    size: 'Standard',
    last_seen: '2026-10-18T17:30:00Z'
  },
  {
    id: 'high-discount',
    title: 'Example wireless headphones model 55',
    brand: 'Example',
    platform: 'Flipkart',
    price: 4500,
    mrp: 6000,
    savings: 1500,
    discount_pct: 25,
    size: 'Standard',
    last_seen: '2026-10-18T17:30:00Z'
  }
];
const crossStoreOffers = sortDeals(
  rankDeals(sameProduct, { query: 'Example model 55', now }),
  'best_match'
);
assert.strictEqual(crossStoreOffers[0].id, 'cheap');
assert.strictEqual(crossStoreOffers[0].best_price_for_match, true);

console.log('Search engine checks passed.');
