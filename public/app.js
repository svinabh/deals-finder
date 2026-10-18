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
    sortBy: 'discount_desc',
    verifiedOnly: true,
    query: '',
    pincode: localStorage.getItem('dealsfinder_pin') || '283135',
    cityName: localStorage.getItem('dealsfinder_city') || 'Shikohabad',
    amazonTag: localStorage.getItem('dealsfinder_amz_tag') || 'dealsfinder-21',
    earnkaroPrefix: localStorage.getItem('dealsfinder_earnkaro') || '',
    deals: [],
    loading: false
  };

  // DOM Elements
  const dealsGrid = document.getElementById('dealsGrid');
  const emptyState = document.getElementById('emptyState');
  const engineIdleState = document.getElementById('engineIdleState');
  const controlsSection = document.getElementById('controlsSection');
  const dealsSection = document.getElementById('dealsSection');
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
  const earnkaroCodeInput = document.getElementById('earnkaroCodeInput');

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // Initialize UI with stored preferences
  if (state.cityName && state.pincode) {
    activeLocationText.textContent = `${state.cityName} (${state.pincode})`;
    pincodeInput.value = state.pincode;
  }
  if (state.amazonTag) amazonTagInput.value = state.amazonTag;
  if (state.earnkaroPrefix) earnkaroCodeInput.value = state.earnkaroPrefix;

  /**
   * Generates a monetized affiliate URL for any store
   */
  function buildAffiliateLink(url, platform) {
    if (!url) return '#';
    const platLower = (platform || '').toLowerCase();

    // Amazon Direct Tagging
    if (platLower === 'amazon' || url.includes('amazon.in')) {
      const tag = state.amazonTag || 'dealsfinder-21';
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}tag=${encodeURIComponent(tag)}`;
    }

    // EarnKaro / Cuelinks Wrapper for Flipkart, Myntra, Blinkit
    if (state.earnkaroPrefix && state.earnkaroPrefix.trim() !== '') {
      const prefix = state.earnkaroPrefix.trim();
      return `${prefix}${encodeURIComponent(url)}`;
    }

    return url;
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
  async function fetchDeals() {
    // If no query and platform is all, keep homepage 100% clean and empty
    if (!state.query && state.platform === 'all' && state.category === 'all') {
      if (engineIdleState) engineIdleState.style.display = 'flex';
      if (controlsSection) controlsSection.style.display = 'none';
      if (dealsSection) dealsSection.style.display = 'none';
      dealsGrid.innerHTML = '';
      if (resultsCountBadge) resultsCountBadge.textContent = '(0 items)';
      return;
    }

    // Active query or store selected: reveal controls and results
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
        q: state.query
      });

      const res = await fetch(`/api/deals?${params.toString()}`);
      if (!res.ok) throw new Error('API server error');
      const data = await res.json();
      state.deals = data.deals || [];

      updateStatsAndBadges(data.total);
      renderDeals(state.deals);
    } catch (err) {
      console.error('Error fetching deals:', err);
      dealsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #f87171;">
          <p>⚠️ Unable to load live deals. Please check if the local server is running.</p>
        </div>
      `;
    } finally {
      state.loading = false;
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
      // Keep static defaults
    }
  }

  /**
   * Update badges & dynamic titles
   */
  function updateStatsAndBadges(count) {
    if (resultsCountBadge) resultsCountBadge.textContent = `(${count} verified items)`;
    if (headerCountBadge) headerCountBadge.textContent = `${count} Deals`;

    let notice = 'Showing verified live discounts';
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
    if (!deals || deals.length === 0) return;

    dealsGrid.innerHTML = deals.map(deal => {
      const platKey = deal.platform.toLowerCase();
      const monetizedUrl = buildAffiliateLink(deal.url, deal.platform);
      const image = deal.image ? escapeHtml(deal.image) : '';
      const fallbackText = escapeHtml((deal.brand || deal.platform || 'D').charAt(0).toUpperCase());

      const metaBits = [
        deal.brand ? `<span>${escapeHtml(deal.brand)}</span>` : '',
        deal.size && deal.size !== 'Standard' ? `<span>${escapeHtml(deal.size)}</span>` : '',
        deal.rating ? `<span class="meta-rating">★ ${deal.rating}</span>` : ''
      ].filter(Boolean).join('<span class="meta-sep">·</span>');

      return `
        <article class="deal-card" data-id="${deal.id}">
          <div class="card-media">
            <span class="media-fallback">${fallbackText}</span>
            ${image ? `<img class="product-img" src="${image}" alt="${escapeHtml(deal.title)}" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
            <span class="platform-chip platform-${platKey}">${deal.platform}</span>
            <span class="discount-pill">${deal.discount_pct}% OFF</span>
          </div>

          <div class="card-body">
            <h3 class="card-title" title="${escapeHtml(deal.title)}">
              ${escapeHtml(deal.title)}
            </h3>
            <div class="card-meta">${metaBits}</div>
            <div class="price-row">
              <span class="deal-price">₹${deal.price.toLocaleString('en-IN')}</span>
              <span class="mrp-price">₹${deal.mrp.toLocaleString('en-IN')}</span>
              <span class="save-tag">Save ₹${deal.savings.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div class="card-actions">
            <a
              href="${escapeHtml(monetizedUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="buy-now-btn"
              title="Open deal on ${deal.platform}"
            >
              <span>Buy on ${deal.platform}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <line x1="7" y1="17" x2="17" y2="7"></line>
                <polyline points="7 7 17 7 17 17"></polyline>
              </svg>
            </a>
            <button
              class="copy-btn copy-deal-link"
              data-link="${escapeHtml(monetizedUrl)}"
              data-title="${escapeHtml(deal.title)}"
              data-price="${deal.price}"
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
        const shareText = `🔥 *DealsFinder Alert*\n${title}\n💰 Offer Price: ₹${price}\n👉 Buy Here: ${link}`;

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

  // Event Listeners: Search
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    if (state.query) {
      clearSearchBtn.style.display = 'block';
    } else {
      clearSearchBtn.style.display = 'none';
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchDeals();
    }, 300);
  });

  searchSubmitBtn.addEventListener('click', () => {
    state.query = searchInput.value.trim();
    fetchDeals();
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      state.query = searchInput.value.trim();
      fetchDeals();
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.query = '';
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
    clearSearchBtn.style.display = 'block';
    fetchDeals();

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
    state.minDiscount = 0;
    state.sortBy = 'discount_desc';
    state.verifiedOnly = false;

    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    discountFilter.value = '0';
    sortFilter.value = 'discount_desc';
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
    const pin = pincodeInput.value.trim() || '283135';
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
    showToast(`Dark store location set to ${city} (${pin})!`, '📍');
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
    const tag = amazonTagInput.value.trim() || 'dealsfinder-21';
    const prefix = earnkaroCodeInput.value.trim();

    state.amazonTag = tag;
    state.earnkaroPrefix = prefix;

    localStorage.setItem('dealsfinder_amz_tag', tag);
    localStorage.setItem('dealsfinder_earnkaro', prefix);

    affiliateModal.classList.add('hidden');
    showToast('Affiliate settings applied! All Buy buttons now monetize sales 💰', '🎉');

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
      showToast('Live scanner scanning Amazon, Flipkart, Myntra & Blinkit...', '⚡');

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
            if (stData.status === 'idle') {
              clearInterval(pollInterval);
              triggerScanBtn.disabled = false;
              if (scanIcon) scanIcon.classList.remove('spin-anim');
              if (scanBtnText) scanBtnText.textContent = 'Scan Deals';

              showToast(stData.message || 'Scan complete! Verified deals updated.', '🎉');
              await fetchStats();
              await fetchDeals();
            }
          } catch (e) {
            // Polling error ignored
          }
        }, 1500);

      } catch (err) {
        console.error('Crawler trigger error:', err);
        triggerScanBtn.disabled = false;
        if (scanIcon) scanIcon.classList.remove('spin-anim');
        if (scanBtnText) scanBtnText.textContent = 'Scan Deals';
        showToast('Scanner busy or temporarily unavailable.', '⚠️');
      }
    });
  }

  // Initial Load - Keep engine clean on startup
  fetchStats();
  fetchDeals(); // Evaluates to empty idle state
});
