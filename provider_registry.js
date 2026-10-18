'use strict';

const PROVIDERS = [
  { id: 'amazon_paapi', name: 'Amazon India', kind: 'marketplace', integration: 'amazon_paapi', requiresPincode: false },
  { id: 'flipkart', name: 'Flipkart', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'myntra', name: 'Myntra', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'ajio', name: 'AJIO', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'meesho', name: 'Meesho', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'snapdeal', name: 'Snapdeal', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'shopsy', name: 'Shopsy', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'tatacliq', name: 'Tata CLiQ', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'nykaa', name: 'Nykaa', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'firstcry', name: 'FirstCry', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'lenskart', name: 'Lenskart', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'pepperfry', name: 'Pepperfry', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'croma', name: 'Croma', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'reliancedigital', name: 'Reliance Digital', kind: 'marketplace', integration: 'partner_feed', requiresPincode: false },
  { id: 'jiomart', name: 'JioMart', kind: 'marketplace', integration: 'partner_feed', requiresPincode: true },
  { id: 'amazon_fresh', name: 'Amazon Fresh', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'flipkart_minutes', name: 'Flipkart Minutes', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'jiomart_quick', name: 'JioMart Quick', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'bigbasket', name: 'BigBasket / BBnow', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'blinkit', name: 'Blinkit', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'zepto', name: 'Zepto', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'swiggy_instamart', name: 'Swiggy Instamart', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'dmart_ready', name: 'DMart Ready', kind: 'quick_commerce', integration: 'partner_feed', requiresPincode: true },
  { id: 'ondc', name: 'ONDC network', kind: 'marketplace', integration: 'network_participant_feed', requiresPincode: true }
];

const QUICK_COMMERCE_PLATFORMS = new Set(
  PROVIDERS.filter(provider => provider.kind === 'quick_commerce')
    .map(provider => normalizePlatform(provider.name))
);
QUICK_COMMERCE_PLATFORMS.add('bigbasket');
QUICK_COMMERCE_PLATFORMS.add('bbnow');
QUICK_COMMERCE_PLATFORMS.add('swiggy');
const PIN_SCOPED_PLATFORMS = new Set(
  PROVIDERS.filter(provider => provider.requiresPincode)
    .map(provider => normalizePlatform(provider.name))
);
PIN_SCOPED_PLATFORMS.add('bigbasket');
PIN_SCOPED_PLATFORMS.add('bbnow');
PIN_SCOPED_PLATFORMS.add('swiggy');

function normalizePlatform(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isQuickCommerce(platform) {
  return QUICK_COMMERCE_PLATFORMS.has(normalizePlatform(platform));
}

function hasSixDigitPincodeFormat(pincode) {
  return /^\d{6}$/.test(String(pincode || ''));
}

function filterDealsForPincode(deals, pincode) {
  if (!hasSixDigitPincodeFormat(pincode)) {
    throw new Error('A 6-digit Indian pincode format is required for location filtering.');
  }

  return deals.flatMap(deal => {
    const listingPin = String(deal.pincode || '').trim();
    const quickCommerce = isQuickCommerce(deal.platform);
    const requiresPincode = PIN_SCOPED_PLATFORMS.has(normalizePlatform(deal.platform));

    if (quickCommerce) {
      const verifiedForPin =
        listingPin === pincode &&
        deal.freshness_status === 'live_checked' &&
        deal.availability_status === 'in_stock';
      if (!verifiedForPin) return [];
      return [{ ...deal, delivery_status: 'verified_for_pincode' }];
    }

    if (requiresPincode && listingPin !== pincode) return [];
    if (listingPin !== 'All India' && listingPin !== pincode) return [];
    return [{
      ...deal,
      delivery_status: listingPin === pincode ? 'pincode_listing_unverified' : 'delivery_unverified'
    }];
  });
}

function getProviderDirectory({ amazonConfigured = false, pincode = null } = {}) {
  return {
    country: 'IN',
    requested_pincode: pincode,
    pincode_format_valid: pincode === null || hasSixDigitPincodeFormat(pincode),
    availability: pincode
      ? 'No live delivery coverage is confirmed for this pincode until a partner feed reports it.'
      : 'Enter a pincode to scope location-specific listings.',
    providers: PROVIDERS.map(provider => {
      const configured = provider.integration === 'amazon_paapi' && amazonConfigured;
      return {
        ...provider,
        configured,
        status: configured
          ? 'ready'
          : provider.integration === 'amazon_paapi'
            ? 'needs_approval_and_credentials'
            : 'requires_authorized_partner_feed',
        coverage: 'not_confirmed'
      };
    })
  };
}

module.exports = {
  filterDealsForPincode,
  getProviderDirectory,
  hasSixDigitPincodeFormat,
  isQuickCommerce
};
