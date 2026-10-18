'use strict';

const assert = require('assert');
const {
  filterDealsForPincode,
  getProviderDirectory,
  hasSixDigitPincodeFormat,
  isQuickCommerce
} = require('../provider_registry');

assert.strictEqual(hasSixDigitPincodeFormat('283135'), true);
assert.strictEqual(hasSixDigitPincodeFormat('999999'), true);
assert.strictEqual(hasSixDigitPincodeFormat('28313'), false);
assert.strictEqual(hasSixDigitPincodeFormat('ABC135'), false);
assert.strictEqual(isQuickCommerce('Blinkit'), true);
assert.strictEqual(isQuickCommerce('BigBasket'), true);
assert.strictEqual(isQuickCommerce('Amazon'), false);

const providers = getProviderDirectory({ amazonConfigured: false, pincode: '283135' });
assert.strictEqual(providers.country, 'IN');
assert.strictEqual(providers.requested_pincode, '283135');
assert.strictEqual(providers.pincode_format_valid, true);
assert(providers.providers.length >= 20);
assert.strictEqual(providers.providers.find(provider => provider.id === 'amazon_paapi').configured, false);
assert(providers.providers.filter(provider => provider.id !== 'amazon_paapi').every(provider => !provider.configured));

const listings = [
  { id: 'all-india-marketplace', platform: 'Amazon', pincode: 'All India', delivery_status: 'delivery_unverified' },
  { id: 'other-pin-marketplace', platform: 'Flipkart', pincode: '110001' },
  { id: 'same-pin-quick-commerce-snapshot', platform: 'Blinkit', pincode: '283135', freshness_status: 'recent_snapshot', availability_status: 'unknown' },
  { id: 'other-pin-quick-commerce-live', platform: 'Blinkit', pincode: '110001', freshness_status: 'live_checked', availability_status: 'in_stock' },
  { id: 'same-pin-quick-commerce-live', platform: 'Blinkit', pincode: '283135', freshness_status: 'live_checked', availability_status: 'in_stock' }
];

const filtered = filterDealsForPincode(listings, '283135');
assert.deepStrictEqual(filtered.map(deal => deal.id), [
  'all-india-marketplace',
  'same-pin-quick-commerce-live'
]);
assert.strictEqual(filtered[0].delivery_status, 'delivery_unverified');
assert.strictEqual(filtered[1].delivery_status, 'verified_for_pincode');
assert.throws(() => filterDealsForPincode(listings, '12'), /6-digit/);

console.log('Provider registry and pincode checks passed.');
