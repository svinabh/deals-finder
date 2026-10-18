/**
 * DealsFinder.AI — Client Application Engine
 * Handles search, reactive filtering, affiliate link tagging, location switching & modals
 */

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    platform: 'all',
    category: 'all',
    minDiscount: 0,
    sortBy: 'best_match',
    verifiedOnly: false,
    query: '',
    pincode: localStorage.getItem('dealsfinder_pin') || '283135',
    cityName: localStorage.getItem('dealsfinder_city') || 'Shikohabad',
    amazonTag: localStorage.getItem('dealsfinder_amz_tag') || '',
    searchSubmitted: false,
    deals: [],
    loading: false
  };

  // DOM Elements
  const dealsGrid = document.getElementById('dealsGrid');
  const emptyState = document.getElementById('emptyState');
  const engineIdleState = document.getElementById('engineIdleState');
  const controlsSection = document.getElementById('controlsSection');
  const dealsSection = document.getElementById('dealsSection');
  const providerStatus = document.getElementById('providerStatus');
  const resultsCountBadge = document.getElementById('resultsCountBadge');
  const resultsFilterNotice = document.getElementById('resultsFilterNotice');
  const headerCountBadge = document.getElementById('headerCountBadge');
  const searchInput = document.getElementById('searchInput');
  const searchSubmitBtn = document.getElementById('searchSubmitBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const trendingChips = document.getElementById('trendingChips');
  const platformTabs = document.getElementById('platformTabs');
  const discountFilter = document.getElementById('discountFilter');
  const sortFilter = document.getElementById('sortFilter');
  const verifiedStockCheckbox = document.getElementById('verifiedStockCheckbox');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  // Stats Elements
  const statTotalDeals = document.getElementById('statTotalDeals');
  const statMaxDiscount = document.getElementById('statMaxDiscount');
  const statTotalSavings = document.getElementById('statTotalSavings');

  // Location Modal Elements
  const locationBtn = document.getElementById('locationBtn');
  const activeLocationText = document.getElementById('activeLocationText');
  const locationModal = document.getElementById('locationModal');
  const closeLocationModal = document.getElementById('closeLocationModal');
  const cancelLocationModal = document.getElementById('cancelLocationModal');
  const saveLocationBtn = document.getElementById('saveLocationBtn');
  const pincodeInput = document.getElementById('pincodeInput');
  const locChips = document.querySelectorAll('.loc-chip');

  // Monetization Modal Elements
  const affiliateSettingsBtn = document.getElementById('affiliateSettingsBtn');
  const affiliateModal = document.getElementById('affiliateModal');
  const closeAffiliateModal = document.getElementById('closeAffiliateModal');
  const cancelAffiliateModal = document.getElementById('cancelAffiliateModal');
  const saveAffiliateBtn = document.getElementById('saveAffiliateBtn');
  const amazonTagInput = document.getElementById('amazonTagInput');

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // Initialize UI with stored preferences
  if (state.cityName && state.pincode) {
    activeLocationText.textContent = `${state.cityName} (${state.pincode})`;
    pincodeInput.value = state.pincode;
  }
  if (state.amazonTag) amazonTagInput.value = state.amazonTag;

  /**
   * Apply the Associates tag only to genuine Amazon India product links.
   */
  function buildAffiliateLink(url, platform) {
    try {
      const target = new URL(url);
      const hostname = target.hostname.toLowerCase();
      if (
        target.protocol === 'https:' &&
        (hostname === 'amazon.in' || hostname.endsWith('.amazon.in')) &&
        String(platform || '').toLowerCase() === 'amazon' &&
        /^[a-zA-Z0-9-]{1,64}$/.test(state.amazonTag)
      ) {
        target.searchParams.set('tag', state.amazonTag);
      }
      return target.toString();
    } catch (error) {
      console.error('Invalid deal destination URL:', error);
      return '#';
    }
  }

  /**
   * Toast notification display
   */
  function showToast(message, icon = '✨') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  /**
   * Fetch Deals from Server API
   */
  let searchSequence = 0;
  async function fetchDeals(liveSearch = state.searchSubmitted) {
    const requestSequence = ++searchSequence;
    // If no query and platform is all, keep homepage 100% clean and empty
    if (!state.query && state.platform === 'all' && state.category === 'all') {
      document.body.classList.add('is-home');
      if (engineIdleState) engineIdleState.style.display = 'flex';
      if (controlsSection) controlsSection.style.display = 'none';
      if (dealsSection) dealsSection.style.display = 'none';
      dealsGrid.innerHTML = '';
      if (resultsCountBadge) resultsCountBadge.textContent = '(0 items)';
      state.loading = false;
      return;
    }

    // Active query or store selected: reveal controls and results
    document.body.classList.remove('is-home');
    if (engineIdleState) engineIdleState.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'block';
    if (dealsSection) dealsSection.style.display = 'block';

    state.loading = true;
    renderSkeleton();

    try {
      const params = new URLSearchParams({
        platform: state.platform,
        category: state.category,
        minDiscount: state.minDiscount.toString(),
        sortBy: state.sortBy,
        verified: state.verifiedOnly ? 'true' : 'false',
        q: state.query,
        pin: state.pincode,
        live: liveSearch ? 'true' : 'false'
      });

      const res = await fetch(`/api/deals?${params.toString()}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      if (requestSequence !== searchSequence) return;
      state.deals = data.deals || [];

      if (providerStatus) {
        const provider = data.provider || {};
        const ai = data.ai || {};
        const liveState = provider.status === 'ok'
          ? 'Live merchant results.'
          : provider.status === 'demo'
            ? 'Demo mode: sample listings — price aur delivery retailer website par confirm karein.'
            : provider.status === 'unavailable'
              ? 'Merchant live search is not connected yet.'
              : 'No cached listings used.';
        const aiState = ai.status === 'ok'
          ? 'AI understood your request.'
          : ai.status === 'not_configured'
            ? 'AI query helper is not configured.'
            : ai.status === 'error'
              ? 'AI query helper had a problem; original keywords were used.'
                : ai.status === 'skipped_no_live_source'
                  ? 'AI is waiting for a live merchant connection.'
                : '';
        const searchStatus = [liveState, aiState].filter(Boolean).join(' ');
        providerStatus.textContent = data.location
          ? `${data.location.message} ${searchStatus}`.trim()
          : searchStatus || provider.message || 'Live provider status is unavailable.';
        providerStatus.title = [provider.message, ai.message].filter(Boolean).join(' ');
        providerStatus.dataset.state = provider.status || (data.provider ? 'unknown' : 'error');
      }
      updateStatsAndBadges(data.total);
      renderDeals(state.deals);
    } catch (err) {
      if (requestSequence !== searchSequence) return;
      console.error('Error fetching deals:', err);
      dealsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #f87171;">
          <p>Unable to load search results. Check whether the local server is running.</p>
        </div>
      `;
    } finally {
      if (requestSequence === searchSequence) state.loading = false;
    }
  }

  /**
   * Fetch Global Stats
   */
  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const stats = await res.json();
        if (statTotalDeals) statTotalDeals.textContent = stats.totalDeals || '100+';
        if (statTotalSavings && stats.totalSavings) {
          statTotalSavings.textContent = `₹${stats.totalSavings.toLocaleString('en-IN')}`;
        }
      }
    } catch (e) {
      console.error('Stats could not be loaded:', e);
    }
  }

  async function fetchProviderStatus() {
    try {
      const res = await fetch(`/api/providers?pin=${encodeURIComponent(state.pincode)}`);
      if (!res.ok) throw new Error(`Provider status failed (${res.status})`);
      if (!res.headers.get('content-type')?.includes('application/json')) {
        if (providerStatus) {
          providerStatus.textContent = 'Restart the local server to load the redesigned search engine; saved listings are still available.';
          providerStatus.dataset.state = 'error';
        }
        return;
      }
      const data = await res.json();
      const amazon = (data.providers || []).find(provider => provider.id === 'amazon_paapi');
      const aiConfigured = Boolean(data.ai && data.ai.configured);
      const amazonConnected = Boolean(amazon && amazon.configured);
      if (!providerStatus || state.query) return;
      providerStatus.textContent = amazonConnected
        ? `Live search only · Amazon connected · ${aiConfigured ? 'AI ready' : 'AI optional'}.`
        : 'Demo mode: sample listings (demo data) · price aur delivery retailer website par confirm karein · live merchant feeds connect nahi hain · AI optional.';
      providerStatus.dataset.state = amazonConnected ? 'ok' : 'demo';
    } catch (error) {
      console.warn('Provider status could not be loaded:', error.message);
      if (providerStatus && !state.query) {
        providerStatus.textContent = 'Provider status is unavailable; saved listings can still be searched.';
        providerStatus.dataset.state = 'error';
      }
    }
  }

  /**
   * Update badges & dynamic titles
   */
  function updateStatsAndBadges(count) {
    if (resultsCountBadge) resultsCountBadge.textContent = `(${count} matches)`;
    if (headerCountBadge) headerCountBadge.textContent = `${count} Deals`;

    let notice = 'Ranked by product match, freshness and deal value';
    if (state.platform !== 'all') {
      notice += ` on ${state.platform.toUpperCase()}`;
    }
    if (state.query) {
      notice += ` for "${state.query}"`;
    }
    if (state.minDiscount > 0) {
      notice += ` with min ${state.minDiscount}% OFF`;
    }
    if (resultsFilterNotice) resultsFilterNotice.textContent = notice;

    if (count === 0) {
      dealsGrid.style.display = 'none';
      emptyState.classList.remove('hidden');
    } else {
      dealsGrid.style.display = 'grid';
      emptyState.classList.add('hidden');
    }
  }

  /**
   * Render Loading Skeleton Cards
   */
  function renderSkeleton() {
    emptyState.classList.add('hidden');
    dealsGrid.style.display = 'grid';
    dealsGrid.innerHTML = `
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    `;
  }

  /**
   * Render Deal Cards into Grid
   */
  function renderDeals(deals) {
    if (!deals || deals.length === 0) {
      dealsGrid.innerHTML = '';
      return;
    }

    const platformIcons = {
      myntra: '🛍️',
      flipkart: '📦',
      amazon: '🛒',
      blinkit: '⚡'
    };

    dealsGrid.innerHTML = deals.map((deal, index) => {
      const platKey = (deal.platform || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      const monetizedUrl = buildAffiliateLink(deal.url, deal.platform);
      const icon = platformIcons[platKey] || '🌐';
      const imageUrl = safeImageUrl(deal.image);
      const price = Number(deal.price) || 0;
      const mrp = Number(deal.mrp) || 0;
      const savings = Math.max(0, Number(deal.savings) || 0);
      const discount = Math.max(0, Math.min(100, Number(deal.discount_pct) || 0));
      const lastCheckedAt = deal.last_checked_at || deal.last_seen;
      const checkedAt = lastCheckedAt ? new Date(lastCheckedAt) : null;
      const ageMinutes = checkedAt && Number.isFinite(checkedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - checkedAt.getTime()) / 60000))
        : null;
      const isDemo = deal.is_demo === true;
      let freshnessLabel = 'Price freshness unknown';
      if (isDemo) {
        freshnessLabel = 'Sample price — retailer site par confirm karein';
      } else if (deal.freshness_status === 'live_checked') {
        freshnessLabel = ageMinutes !== null && ageMinutes > 0
          ? `Price checked ${ageMinutes}m ago`
          : 'Price checked just now';
      }
      else if (ageMinutes !== null && ageMinutes < 60) freshnessLabel = `Index updated ${ageMinutes}m ago`;
      else if (ageMinutes !== null && ageMinutes < 48 * 60) {
        freshnessLabel = `Index updated ${Math.floor(ageMinutes / 60)}h ago`;
      } else if (deal.freshness_status === 'stale') freshnessLabel = 'Old listing — recheck price';
      const availabilityLabel = isDemo
        ? 'Delivery retailer website par confirm karein'
        : deal.delivery_status === 'verified_for_pincode'
          ? `✓ In stock for ${state.pincode}`
          : deal.is_verified_live
            ? 'Stock checked · delivery unconfirmed'
            : 'Availability not confirmed';
      const locationLabel = isDemo
        ? `📍 ${state.pincode} · delivery retailer site par confirm karein`
        : deal.delivery_status === 'verified_for_pincode'
          ? `📍 ${state.pincode} · checked`
          : deal.delivery_status === 'pincode_listing_unverified'
            ? `📍 ${state.pincode} listing · unverified`
            : '📍 Delivery unconfirmed';
      const isBestMatch = index === 0 && state.sortBy === 'best_match' && state.query;
      const isBestPrice = deal.best_price_for_match && deal.comparison_offer_count > 1;

      const metaParts = [];
      if (deal.brand) metaParts.push(`<span class="brand-pill">${escapeHtml(deal.brand)}</span>`);
      if (deal.size && deal.size !== 'Standard') metaParts.push(`<span class="size-pill">${escapeHtml(deal.size)}</span>`);
      if (deal.rating) metaParts.push(`<span class="rating-pill">★ ${deal.rating}</span>`);

      return `
        <article class="deal-card" data-id="${escapeHtml(deal.id)}">
          <div class="card-header-bar">
            <span class="platform-chip platform-${platKey}">
              <span class="platform-icon">${icon}</span>
              ${escapeHtml(deal.platform)}
            </span>
            ${isDemo ? '<span class="demo-pill">DEMO</span>' : ''}
            ${isBestMatch ? '<span class="best-match-pill">Best match</span>' : ''}
            ${isBestPrice ? '<span class="best-match-pill">Lowest listed price for this match</span>' : ''}
            ${discount > 0 ? `<span class="discount-pill">-${discount}% ${isDemo ? 'sample' : 'listed'}</span>` : ''}
            ${deal.is_verified_live ? '<span class="badge-live"><span class="live-pulse"></span>LIVE CHECK</span>' : ''}
          </div>

          <div class="card-image-wrap">
            ${imageUrl
              ? `<img class="card-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(deal.title)}" loading="lazy">`
              : '<span class="card-image-placeholder" aria-hidden="true">🛍️</span>'}
          </div>

          <div class="card-body">
            <div class="card-meta-row">
              ${metaParts.join('')}
            </div>

            <h3 class="card-title" title="${escapeHtml(deal.title)}">
              ${escapeHtml(deal.title)}
            </h3>

            <div class="price-row">
              <span class="deal-price">₹${price.toLocaleString('en-IN')}</span>
              ${mrp > price ? `<span class="mrp-price">₹${mrp.toLocaleString('en-IN')}</span>` : ''}
              ${savings > 0 ? `<span class="save-tag" title="Difference from the source's listed MRP">₹${savings.toLocaleString('en-IN')} off MRP</span>` : ''}
            </div>

            <div class="card-footer-badges">
              <span class="${deal.is_verified_live ? 'badge-stock' : 'badge-unknown'}">${availabilityLabel}</span>
              <span class="badge-pincode">${escapeHtml(locationLabel)}</span>
            </div>
            <p class="freshness-label">${escapeHtml(freshnessLabel)}</p>
          </div>

          <div class="card-actions">
            <a
              href="${escapeHtml(monetizedUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="buy-now-btn"
              title="Open deal on ${escapeHtml(deal.platform)}"
            >
              <span>View on ${escapeHtml(deal.platform)}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <line x1="7" y1="17" x2="17" y2="7"></line>
                <polyline points="7 7 17 7 17 17"></polyline>
              </svg>
            </a>
            <button
              class="copy-btn copy-deal-link"
              data-link="${escapeHtml(monetizedUrl)}"
              data-title="${escapeHtml(deal.title)}"
              data-price="${price}"
              data-demo="${isDemo}"
              title="Copy deal link"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </article>
      `;
    }).join('');

    // Attach Copy Link Listeners
    document.querySelectorAll('.copy-deal-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const link = btn.getAttribute('data-link');
        const title = btn.getAttribute('data-title');
        const price = btn.getAttribute('data-price');
        const snapshotLabel = btn.getAttribute('data-demo') === 'true'
          ? 'DealsFinder demo listing (sample price, not live)'
          : 'DealsFinder price snapshot';
        const priceLabel = btn.getAttribute('data-demo') === 'true'
          ? `Sample price: ₹${price}`
          : `Listed price: ₹${price}`;
        const shareText = `${snapshotLabel}\n${title}\n${priceLabel}\nCheck price & availability: ${link}`;

        navigator.clipboard.writeText(shareText).then(() => {
          showToast('Deal & Affiliate Link copied to clipboard! 🚀', '📋');
        }).catch(() => {
          navigator.clipboard.writeText(link);
          showToast('Link copied to clipboard!', '🔗');
        });
      });
    });
  }

  // HTML Sanitizer
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeImageUrl(value) {
    try {
      const imageUrl = new URL(value);
      return imageUrl.protocol === 'https:' ? imageUrl.toString() : '';
    } catch (error) {
      return '';
    }
  }

  // Event Listeners: Search
  searchInput.addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    state.searchSubmitted = false;
    if (state.query) {
      clearSearchBtn.style.display = 'block';
      document.body.classList.add('is-home');
      if (controlsSection) controlsSection.style.display = 'none';
      if (dealsSection) dealsSection.style.display = 'none';
    } else {
      clearSearchBtn.style.display = 'none';
      fetchDeals(false);
    }
  });

  searchSubmitBtn.addEventListener('click', () => {
    state.query = searchInput.value.trim();
    state.searchSubmitted = true;
    fetchDeals(true);
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      state.query = searchInput.value.trim();
      state.searchSubmitted = true;
      fetchDeals(true);
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.query = '';
    state.searchSubmitted = false;
    clearSearchBtn.style.display = 'none';
    document.querySelectorAll('.trending-chips .chip').forEach(c => c.classList.remove('active-chip'));
    fetchDeals();
  });

  // Event Listeners: Trending Chips
  trendingChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    document.querySelectorAll('.trending-chips .chip').forEach(c => c.classList.remove('active-chip'));
    chip.classList.add('active-chip');

    const query = chip.getAttribute('data-query');
    searchInput.value = query;
    state.query = query;
    state.searchSubmitted = true;
    clearSearchBtn.style.display = 'block';
    fetchDeals(true);

    // Scroll smoothly to results
    dealsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Event Listeners: Platform Tabs
  platformTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.p-tab');
    if (!tab) return;

    document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    state.platform = tab.getAttribute('data-platform');
    fetchDeals();
  });

  // Event Listeners: Filters
  discountFilter.addEventListener('change', (e) => {
    state.minDiscount = parseInt(e.target.value, 10);
    fetchDeals();
  });

  sortFilter.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    fetchDeals();
  });

  verifiedStockCheckbox.addEventListener('change', (e) => {
    state.verifiedOnly = e.target.checked;
    fetchDeals();
  });

  resetFiltersBtn.addEventListener('click', () => {
    state.platform = 'all';
    state.query = '';
    state.searchSubmitted = false;
    state.minDiscount = 0;
    state.sortBy = 'best_match';
    state.verifiedOnly = false;

    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    discountFilter.value = '0';
    sortFilter.value = 'best_match';
    verifiedStockCheckbox.checked = false;

    document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.p-tab[data-platform="all"]').classList.add('active');
    document.querySelectorAll('.trending-chips .chip').forEach(c => c.classList.remove('active-chip'));

    fetchDeals();
  });

  // Location Modal Handlers
  locationBtn.addEventListener('click', () => {
    locationModal.classList.remove('hidden');
    pincodeInput.focus();
  });

  closeLocationModal.addEventListener('click', () => locationModal.classList.add('hidden'));
  cancelLocationModal.addEventListener('click', () => locationModal.classList.add('hidden'));
  locationModal.addEventListener('click', (e) => {
    if (e.target === locationModal) locationModal.classList.add('hidden');
  });

  locChips.forEach(chip => {
    chip.addEventListener('click', () => {
      locChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      pincodeInput.value = chip.getAttribute('data-pin');
    });
  });

  saveLocationBtn.addEventListener('click', () => {
    const pin = pincodeInput.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      showToast('Enter a valid 6-digit pincode.', '⚠️');
      pincodeInput.focus();
      return;
    }
    let city = 'Custom Area';
    locChips.forEach(c => {
      if (c.getAttribute('data-pin') === pin) {
        city = c.getAttribute('data-city');
      }
    });
    if (pin === '283135') city = 'Shikohabad';

    state.pincode = pin;
    state.cityName = city;
    localStorage.setItem('dealsfinder_pin', pin);
    localStorage.setItem('dealsfinder_city', city);

    activeLocationText.textContent = `${city} (${pin})`;
    locationModal.classList.add('hidden');
    showToast(`Pincode set to ${city} (${pin}). Store delivery coverage is not yet confirmed.`, '📍');
    fetchProviderStatus();
    fetchDeals();
  });

  // Affiliate Monetization Modal Handlers
  affiliateSettingsBtn.addEventListener('click', () => {
    affiliateModal.classList.remove('hidden');
  });

  closeAffiliateModal.addEventListener('click', () => affiliateModal.classList.add('hidden'));
  cancelAffiliateModal.addEventListener('click', () => affiliateModal.classList.add('hidden'));
  affiliateModal.addEventListener('click', (e) => {
    if (e.target === affiliateModal) affiliateModal.classList.add('hidden');
  });

  saveAffiliateBtn.addEventListener('click', () => {
    const tag = amazonTagInput.value.trim();
    if (!tag) {
      showToast('Enter your active Amazon Associates tracking ID first.', '⚠️');
      amazonTagInput.focus();
      return;
    }
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(tag)) {
      showToast('Amazon Associates tag can contain letters, numbers and hyphens only.', '⚠️');
      amazonTagInput.focus();
      return;
    }

    state.amazonTag = tag;

    localStorage.setItem('dealsfinder_amz_tag', tag);

    affiliateModal.classList.add('hidden');
    showToast('Amazon Associates tag saved. Other stores use direct links until approved integrations are added.', '✓');

    // Re-render deals with new tags
    renderDeals(state.deals);
  });

  // Crawler Live Scanner Trigger Handler
  const triggerScanBtn = document.getElementById('triggerScanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const scanIcon = triggerScanBtn ? triggerScanBtn.querySelector('.scan-icon') : null;

  if (triggerScanBtn) {
    triggerScanBtn.addEventListener('click', async () => {
      if (triggerScanBtn.disabled) return;

      triggerScanBtn.disabled = true;
      if (scanIcon) scanIcon.classList.add('spin-anim');
      if (scanBtnText) scanBtnText.textContent = 'Scanning...';
      showToast('Checking configured, authorized data sources…', '⚡');

      try {
        const res = await fetch('/api/crawler/trigger', { method: 'POST' });
        if (!res.ok && res.status !== 202) {
          throw new Error('Crawler already running or unavailable');
        }

        // Poll crawler status until finished
        const pollInterval = setInterval(async () => {
          try {
            const stRes = await fetch('/api/crawler/status');
            const stData = await stRes.json();
            if (stData.status !== 'running') {
              clearInterval(pollInterval);
              triggerScanBtn.disabled = false;
              if (scanIcon) scanIcon.classList.remove('spin-anim');
              if (scanBtnText) scanBtnText.textContent = 'Scan Deals';

              showToast(
                stData.message || (stData.status === 'error' ? 'Source scan failed.' : 'Source scan finished.'),
                stData.status === 'error' ? '⚠️' : '✓'
              );
              await fetchStats();
              await fetchDeals();
            }
          } catch (e) {
            console.error('Crawler status request failed:', e);
          }
        }, 1500);

      } catch (err) {
        console.error('Crawler trigger error:', err);
        triggerScanBtn.disabled = false;
        if (scanIcon) scanIcon.classList.remove('spin-anim');
        if (scanBtnText) scanBtnText.textContent = 'Scan Deals';
        showToast(err.message || 'Source scan is temporarily unavailable.', '⚠️');
      }
    });
  }

  // Initial Load - Keep engine clean on startup
  fetchStats();
  fetchProviderStatus();
  fetchDeals(); // Evaluates to empty idle state
});
